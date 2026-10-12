import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  reviewTransaction,
  transactionLinks,
} from "../apps/web/src/pro/transaction-review";

const signature =
  "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
const fixture = JSON.parse(
  readFileSync("tests/fixtures/settle-tx.json", "utf8"),
);
const rpc = "https://voucherguard.pages.dev/api/solana-rpc";
describe("Pro transaction link review", () => {
  it("accepts links without technical fields, bounds batches and deduplicates signatures", () => {
    expect(
      transactionLinks(`https://solscan.io/tx/${signature}\n${signature}`),
    ).toEqual([signature]);
    expect(() =>
      transactionLinks(
        "https://solscan.io/token/6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump",
      ),
    ).toThrow();
    expect(() =>
      transactionLinks(Array(21).fill(signature).join("\n")),
    ).toThrow();
  });
  it("fetches only the configured relay and reviews actual historical evidence without a policy", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(fixture)),
    );
    const result = await reviewTransaction(signature, rpc, undefined, fetcher);
    expect(result.result.kind).toBe("historical");
    if (result.result.kind !== "historical") throw Error("Missing evidence");
    expect(result.result.voucherReport.status).toBe("PASS");
    expect(result.policyReport).toBeUndefined();
    expect(fetcher.mock.calls[0]?.[0]).toBe(rpc);
  });
  it("keeps missing policy context indeterminate and retains amount failures", async () => {
    const fetcher = async () => new Response(JSON.stringify(fixture));
    const original = { requireState: true, maxCumulativeAmount: "1" };
    const result = await reviewTransaction(signature, rpc, original, fetcher);
    expect(result.policyReport?.status).toBe("FAIL");
    expect(
      result.policyReport?.checks.some((c) => c.code === "CHANNEL_REQUIRED"),
    ).toBe(true);
    expect(
      result.policyReport?.checks.some((c) => c.code === "STATE_REQUIRED"),
    ).toBe(true);
    expect(
      result.policyReport?.checks.some((c) => c.code === "AMOUNT_LIMIT"),
    ).toBe(true);
    original.maxCumulativeAmount = "999";
    expect(result.policy?.maxCumulativeAmount).toBe("1");
  });
  it("does not run historical policy checks without block time or certify a failed transaction", async () => {
    const missing = structuredClone(fixture);
    missing.result.blockTime = null;
    missing.result.meta.err = { InstructionError: [0, "test"] };
    const result = await reviewTransaction(
      signature,
      rpc,
      { requireState: true },
      async () => new Response(JSON.stringify(missing)),
    );
    expect(result.policyReport).toBeUndefined();
    expect(result.policyNotice).toContain("block time");
    expect(result.result.kind === "historical" && result.result.success).toBe(
      false,
    );
  });
  it("reports ordinary transfers outside scope and propagates RPC failures", async () => {
    const empty = structuredClone(fixture);
    empty.result.transaction.message.instructions = [];
    const result = await reviewTransaction(
      signature,
      rpc,
      undefined,
      async () => new Response(JSON.stringify(empty)),
    );
    expect(result.result.kind).toBe("unsupported");
    await expect(
      reviewTransaction(
        signature,
        rpc,
        undefined,
        async () => new Response("", { status: 503 }),
      ),
    ).rejects.toThrow("RPC unavailable");
  });
  it("rejects missing execution metadata instead of assuming success", async () => {
    const missing = structuredClone(fixture);
    missing.result.meta = null;
    await expect(
      reviewTransaction(
        signature,
        rpc,
        undefined,
        async () => new Response(JSON.stringify(missing)),
      ),
    ).rejects.toThrow("metadata");
  });
});

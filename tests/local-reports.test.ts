import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  comparison,
  readHistory,
  snapshot,
  writeHistory,
} from "../apps/web/src/pro/local-reports";
import { reviewTransaction } from "../apps/web/src/pro/transaction-review";

const signature =
  "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
const fixture = readFileSync("tests/fixtures/settle-tx.json", "utf8");
async function report() {
  return snapshot(
    await reviewTransaction(
      signature,
      "https://example.test",
      undefined,
      async () => new Response(fixture),
    ),
  );
}
const store = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
};
describe("local report history", () => {
  it("retains serializable evidence and separates wallet histories without network access", async () => {
    const r = await report();
    const storage = store();
    const fetcher = vi.spyOn(globalThis, "fetch");
    writeHistory("alice", [r], storage);
    expect(readHistory("alice", storage)).toEqual([r]);
    expect(readHistory("bob", storage)).toEqual([]);
    expect(JSON.parse(r.evidence).review.result.kind).toBe("historical");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it("bounds history and rejects oversized evidence without overwriting earlier data", async () => {
    const r = await report();
    const storage = store();
    writeHistory("alice", Array(25).fill(r), storage);
    expect(readHistory("alice", storage)).toHaveLength(20);
    expect(() =>
      writeHistory(
        "alice",
        [{ ...r, evidence: "x".repeat(2_000_001) }],
        storage,
      ),
    ).toThrow();
    expect(readHistory("alice", storage)).toHaveLength(20);
  });
  it("tolerates invalid and blocked local storage", () => {
    expect(readHistory("alice", { getItem: () => "{bad" })).toEqual([]);
    expect(
      readHistory("alice", {
        getItem: () => JSON.stringify([{ signature: "javascript:alert(1)" }]),
      }),
    ).toEqual([]);
    expect(
      readHistory("alice", {
        getItem: () => {
          throw Error("blocked");
        },
      }),
    ).toEqual([]);
  });
  it("compares failed execution and missing coverage without promoting either to safe", async () => {
    const a = await report();
    const b = {
      ...a,
      execution: "Failed",
      coverage: ["Missing token metadata"],
    };
    expect(comparison(a, b)).toContainEqual([
      "Execution",
      "Succeeded",
      "Failed",
    ]);
    expect(
      comparison(a, b).find((r) => r[0] === "Coverage & warnings")?.[2],
    ).toBe("Missing token metadata");
  });
});

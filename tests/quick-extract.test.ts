import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractPaymentChannelVoucher,
  historicalVerifyTransaction,
  parseTransactionInput,
} from "../apps/web/src/quick/extract";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/settle-tx.json", import.meta.url), "utf8"),
) as { result: Parameters<typeof extractPaymentChannelVoucher>[0] };

const REAL_SIG =
  "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";

describe("Quick Check transaction extraction", () => {
  it("parses Solscan URLs and raw signatures", () => {
    expect(parseTransactionInput(`https://solscan.io/tx/${REAL_SIG}`)).toBe(
      REAL_SIG,
    );
    expect(
      parseTransactionInput(
        `https://explorer.solana.com/tx/${REAL_SIG}?cluster=mainnet`,
      ),
    ).toBe(REAL_SIG);
    expect(parseTransactionInput(REAL_SIG)).toBe(REAL_SIG);
  });

  it("rejects garbage input", () => {
    expect(() => parseTransactionInput("not-a-sig")).toThrow(/Unrecognized/);
    expect(() => parseTransactionInput("")).toThrow(/Paste/);
  });

  it("extracts the voucher from a real mainnet settle fixture", () => {
    const extracted = extractPaymentChannelVoucher(fixture.result);
    expect(extracted).toMatchObject({
      settlement: "settle",
      channelId: "HEpdnJYt4MjwNFsLqv4FcC82KUUt3CWczRsHBNinPZKP",
    });
    if ("unsupported" in extracted) throw new Error("expected extract");
    expect(extracted.extracted.cumulativeAmount).toBe("516386230000");
    expect(extracted.extracted.expiresAt).toBe("1791621447");
  });

  it("historically verifies the fixture with requireState false", async () => {
    const report = await historicalVerifyTransaction(REAL_SIG, fixture.result);
    expect(report.kind).toBe("historical");
    if (report.kind !== "historical") return;
    expect(report.success).toBe(true);
    expect(report.voucherReport.status).toBe("PASS");
    expect(report.notice).toMatch(/does not certify current spendability/i);
  });

  it("reports unsupported for empty instruction lists", () => {
    const empty = {
      slot: 1,
      blockTime: 1,
      meta: { err: null },
      transaction: {
        message: { accountKeys: [], instructions: [] },
      },
    };
    const extracted = extractPaymentChannelVoucher(empty);
    expect(extracted).toHaveProperty("unsupported");
  });
});

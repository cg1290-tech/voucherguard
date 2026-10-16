import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  buildTradeJournal,
  journalCSV,
} from "../apps/web/src/pro/trade-journal";
import {
  buildTradeReceipt,
  receiptEligible,
  receiptRate,
  USDC,
  WSOL,
} from "../apps/web/src/xray/trade-receipt";

const address = (byte: number) => base58.encode(new Uint8Array(32).fill(byte));
const owner = address(1),
  token = address(2);
function model(
  slot: number,
  before: string,
  after: string,
  cash: string,
  quote = USDC,
  decimals = 6,
) {
  return {
    slot,
    blockTime: 1700000000 + slot,
    execution: "succeeded",
    walletImpact: {
      signature: base58.encode(new Uint8Array(64).fill(slot)),
      execution: "succeeded",
      gaps: [],
      feeLamports: "5000",
      feePayer: owner,
      wallets: [
        {
          address: owner,
          balances: [
            {
              asset: "SOL",
              decimals: 9,
              before: "2000000000",
              after: "1999995000",
              change: "-5000",
              accounts: [owner],
            },
            {
              asset: token,
              decimals,
              before,
              after,
              change: (BigInt(after) - BigInt(before)).toString(),
              accounts: [address(3)],
            },
            {
              asset: quote,
              decimals: quote === USDC ? 6 : 9,
              before: "10000000000",
              after: (10000000000n + BigInt(cash)).toString(),
              change: cash,
              accounts: [address(4)],
            },
          ],
        },
      ],
    },
  };
}
function receipt(...args: Parameters<typeof model>) {
  const r = buildTradeReceipt(model(...args), owner);
  if (!r) throw Error("Missing receipt");
  return r;
}
const position = (...args: Parameters<typeof buildTradeJournal>) => {
  const p = buildTradeJournal(...args).positions[0];
  if (!p) throw Error("Missing position");
  return p;
};
describe("Trade Receipt and conditional Trade Journal", () => {
  it("retains exact balances and reports a net exchange ratio without promoting it to a quote", () => {
    const r = receipt(1, "0", "100000000", "-100000000");
    expect(r.candidate?.side).toBe("buy");
    expect(receiptEligible(r)).toBe(true);
    expect(receiptRate(r)).toBe("1000000000");
    expect(r.balances.find((b) => b.asset === token)?.before).toBe("0");
    const m = model(1, "0", "18446744073709551615", "-1");
    expect(buildTradeReceipt(m, owner)?.candidate?.token.after).toBe(
      "18446744073709551615",
    );
  });
  it("requires complete-history confirmation, calculates partial FIFO in USDC and keeps SOL fees separate", () => {
    const buy = receipt(1, "0", "100000000", "-100000000"),
      sell = receipt(2, "100000000", "50000000", "60000000");
    expect(position([buy, sell], false).realizedResult).toBeNull();
    const p = position([sell, buy, buy], true);
    expect(p.realizedResult).toBe("10000000");
    expect(p.remaining).toBe("50000000");
    expect(p.remainingCost).toBe("50000000");
    expect(p.networkFeesLamports).toBe("10000");
    expect(p.costsIncludeNetworkFees).toBe(false);
    expect(p.signatures).toHaveLength(2);
  });
  it("includes network costs for persistent WSOL and handles negative realized results", () => {
    const buy = receipt(1, "0", "100000000", "-1000000000", WSOL),
      sell = receipt(2, "100000000", "0", "900000000", WSOL);
    const p = position([buy, sell], true);
    expect(p.realizedResult).toBe("-100010000");
    expect(p.remainingCost).toBe("0");
    expect(p.costsIncludeNetworkFees).toBe(true);
  });
  it("carries proportional rounding into the remaining FIFO lot instead of losing cost", () => {
    const buy = receipt(1, "0", "3", "-10", USDC, 0),
      a = receipt(2, "3", "2", "5", USDC, 0),
      b = receipt(3, "2", "0", "10", USDC, 0);
    expect(position([buy, a], true).remainingCost).toBe("7");
    expect(position([buy, a, b], true).allocatedCost).toBe("10");
    expect(position([buy, a, b], true).realizedResult).toBe("5");
  });
  it("withholds cost basis for opening inventory, missing trades, ambiguous order and conflicting duplicates", () => {
    const buy = receipt(1, "0", "100", "-100"),
      sell = receipt(2, "100", "0", "110");
    expect(
      position([receipt(1, "10", "100", "-100"), sell], true).realizedResult,
    ).toBeNull();
    expect(
      position([buy, receipt(2, "90", "0", "110")], true).realizedResult,
    ).toBeNull();
    const sameSlot = { ...sell, slot: 1 };
    expect(position([buy, sameSlot], true).realizedResult).toBeNull();
    const altered = structuredClone(buy);
    altered.feeLamports = "6000";
    expect(position([buy, altered, sell], true).reasons.join()).toContain(
      "Conflicting",
    );
    const noFee = { ...buy, feeLamports: null };
    expect(position([noFee, sell], true).networkFeesLamports).toBeNull();
    expect(position([noFee, sell], true).realizedResult).toBeNull();
    const old = { ...buy, slot: null };
    const differentAccounts = structuredClone(sell);
    if (differentAccounts.candidate)
      differentAccounts.candidate.token.accounts = [address(10)];
    expect(position([buy, differentAccounts], true).realizedResult).toBeNull();
    expect(position([old, sell], true).realizedResult).toBeNull();
    const precision = receipt(2, "100", "0", "110", USDC, 9);
    expect(position([buy, precision], true).bought).toBeNull();
    const mixed = receipt(2, "100", "0", "110", WSOL);
    expect(position([buy, mixed], true).realizedResult).toBeNull();
  });
  it("does not treat native SOL, failures, missing owners or malformed snapshots as established trades", () => {
    const native = model(1, "0", "100", "-100");
    native.walletImpact.wallets[0]?.balances.splice(2, 1);
    expect(buildTradeReceipt(native, owner)?.candidate).toBeUndefined();
    const gaps = model(1, "0", "100", "-100");
    gaps.walletImpact.gaps.push("missing record" as never);
    const r = buildTradeReceipt(gaps, owner);
    expect(r && receiptEligible(r)).toBe(false);
    const failed = {
      ...model(1, "0", "100", "-100"),
      execution: "failed",
      walletImpact: {
        ...model(1, "0", "100", "-100").walletImpact,
        execution: "failed",
      },
    };
    expect(buildTradeReceipt(failed, owner)?.candidate).toBeUndefined();
    expect(
      buildTradeReceipt(model(1, "0", "100", "-100"), address(9)),
    ).toBeUndefined();
    const bad = model(1, "0", "100", "-100");
    const b = bad.walletImpact.wallets[0]?.balances[1];
    if (b) b.change = "99";
    expect(buildTradeReceipt(bad, owner)).toBeUndefined();
    const otherCosts = model(1, "0", "100", "-100");
    const sol = otherCosts.walletImpact.wallets[0]?.balances[0];
    if (sol) {
      sol.change = "-10000";
      sol.after = "1999990000";
    }
    const costs = buildTradeReceipt(otherCosts, owner);
    expect(costs && receiptEligible(costs)).toBe(false);
  });
  it("exports withheld results as blank cells, never zero profit", () => {
    const csv = journalCSV(
      buildTradeJournal([receipt(1, "10", "100", "-100")], true),
    );
    expect(csv).toContain('"withheld"');
    expect(csv).toContain('"",""');
    expect(csv).toContain("Opening token balance");
  });
});

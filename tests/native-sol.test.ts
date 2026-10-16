import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  buildTradeJournal,
  journalCSV,
} from "../apps/web/src/pro/trade-journal";
import { buildXRay } from "../apps/web/src/xray/model";
import { nativeSolFlow } from "../apps/web/src/xray/native-sol";
import {
  buildTradeReceipt,
  receiptEligible,
  USDC,
  WSOL,
} from "../apps/web/src/xray/trade-receipt";

const a = (n: number) => base58.encode(new Uint8Array(32).fill(n));
const owner = a(1),
  token = a(5),
  SYSTEM = "11111111111111111111111111111111",
  TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
function transfer(from: number, to: number, lamports: bigint) {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, lamports, true);
  return { programIdIndex: 5, accounts: [from, to], data: base58.encode(data) };
}
function raw(slot: number, before: string, after: string, cash: bigint) {
  const balance = (
    accountIndex: number,
    amount: string,
    ownerAddress: string,
  ) => ({
    accountIndex,
    mint: token,
    owner: ownerAddress,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const out = cash < 0n ? -cash : cash;
  return {
    slot,
    blockTime: 1700000000 + slot,
    transaction: {
      signatures: [base58.encode(new Uint8Array(64).fill(slot))],
      message: {
        accountKeys: [owner, a(2), a(3), a(4), token, SYSTEM, TOKEN, a(8)],
        instructions: [transfer(cash < 0n ? 0 : 1, cash < 0n ? 1 : 0, out)],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [5000000000, 5000000000, 2039280, 2039280, 1, 1, 1, 1],
      postBalances: [
        Number(5000000000n + cash - 5000n),
        Number(5000000000n - cash),
        2039280,
        2039280,
        1,
        1,
        1,
        1,
      ],
      preTokenBalances: [balance(2, before, owner)],
      postTokenBalances: [balance(2, after, owner)],
      innerInstructions: [] as {
        index: number;
        instructions: ReturnType<typeof transfer>[];
      }[],
      loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
    },
  };
}
function receipt(tx: unknown) {
  const r = buildTradeReceipt(buildXRay(tx), owner);
  if (!r) throw Error("No receipt");
  return r;
}
describe("Native SOL trade reconciliation", () => {
  it("reconciles buy/sell cash flows and includes network fees exactly once", () => {
    const buy = receipt(raw(1, "0", "100000000", -1000000000n)),
      sell = receipt(raw(2, "100000000", "0", 1200000000n));
    expect(receiptEligible(buy)).toBe(true);
    expect(buy.candidate?.quoteSymbol).toBe("SOL");
    expect(buy.nativeSol?.observedNetLamports).toBe("-1000005000");
    expect(buy.candidate?.quote.change).toBe("-1000000000");
    expect(buy.nativeSol?.transfers).toHaveLength(1);
    expect(
      buildTradeJournal([buy, sell], false).positions[0]?.realizedResult,
    ).toBeNull();
    const journal = buildTradeJournal([buy, sell], true),
      p = journal.positions[0];
    expect(p?.realizedResult).toBe("199990000");
    expect(p?.networkFeesLamports).toBe("10000");
    expect(p?.costsIncludeNetworkFees).toBe(true);
    expect(p?.realizedResult).toBe(
      (
        BigInt(buy.nativeSol?.observedNetLamports ?? "0") +
        BigInt(sell.nativeSol?.observedNetLamports ?? "0")
      ).toString(),
    );
    expect(journalCSV(journal)).toContain('"0.19999"');
  });
  it("supports partial FIFO and native SOL/persistent WSOL quote continuity without double conversion", () => {
    const buy = receipt(raw(1, "0", "100000000", -1000000000n)),
      sell = receipt(raw(2, "100000000", "50000000", 600000000n));
    const p = buildTradeJournal([buy, sell], true).positions[0];
    expect(p?.realizedResult).toBe("99992500");
    expect(p?.remainingCost).toBe("500002500");
    const mixed = structuredClone(sell);
    if (mixed.candidate) {
      mixed.candidate.quote.asset = WSOL;
      mixed.candidate.quoteSymbol = "WSOL";
    }
    expect(
      buildTradeJournal([buy, mixed], true).positions[0]?.realizedResult,
    ).toBe(p?.realizedResult);
    const usd = raw(3, "0", "100000000", -1000000000n);
    usd.transaction.message.accountKeys[4] = USDC;
    for (const b of [
      ...usd.meta.preTokenBalances,
      ...usd.meta.postTokenBalances,
    ])
      b.mint = USDC;
    const usdPosition = receipt(usd),
      otherTrade = structuredClone(sell);
    if (otherTrade.candidate) {
      otherTrade.candidate.quote = {
        asset: USDC,
        decimals: 6,
        change: "1000000",
        accounts: [a(3)],
      };
      otherTrade.candidate.quoteSymbol = "USDC";
    }
    expect(
      buildTradeJournal([usdPosition, otherTrade], true).positions.find(
        (p) => p.token === USDC,
      )?.realizedResult,
    ).toBeNull();
  });
  it("reads nested transfers and loaded account keys from the same transaction response", () => {
    const tx = raw(1, "0", "100", -1000000000n);
    const ix = tx.transaction.message.instructions[0];
    if (!ix) throw Error();
    tx.transaction.message.instructions = [
      { programIdIndex: 7, accounts: [0, 1], data: "3" },
    ];
    tx.meta.innerInstructions = [{ index: 0, instructions: [ix] }];
    expect(receiptEligible(receipt(tx))).toBe(true);
    tx.transaction.message.accountKeys.pop();
    tx.meta.loadedAddresses.readonly = [a(8)];
    expect(receiptEligible(receipt(tx))).toBe(true);
  });
  it("withholds for unrecorded direct lamport changes and rent refunds, even with a matching candidate direction", () => {
    const drift = raw(1, "0", "100", -1000000000n);
    drift.meta.postBalances[0] = 3999990000;
    const r = receipt(drift);
    expect(r.candidate).toBeUndefined();
    expect(r.notes.join()).toContain("do not reconcile");
    const close = raw(1, "0", "100", -1000000000n);
    close.transaction.message.instructions.push({
      programIdIndex: 6,
      accounts: [2, 0, 0],
      data: base58.encode(new Uint8Array([9])),
    });
    expect(receipt(close).notes.join()).toContain("creation, closure");
    expect(buildTradeJournal([receipt(close)], true).positions).toHaveLength(0);
    const create = raw(1, "0", "100", -1000000000n);
    create.transaction.message.instructions.push({
      programIdIndex: 5,
      accounts: [0, 2],
      data: base58.encode(new Uint8Array(52)),
    });
    expect(receiptEligible(receipt(create))).toBe(false);
    const topup = raw(1, "0", "100", -1000000000n);
    topup.transaction.message.instructions = [transfer(0, 2, 1000000000n)];
    expect(receiptEligible(receipt(topup))).toBe(false);
  });
  it("withholds missing/truncated/malformed trace, unknown fees and legacy evidence; never refetches", () => {
    const missing = raw(1, "0", "100", -1000000000n);
    const noTrace = {
      ...missing,
      meta: { ...missing.meta, innerInstructions: null },
    };
    expect(receiptEligible(receipt(noTrace))).toBe(false);
    const duplicate = raw(1, "0", "100", -1000000000n);
    duplicate.meta.innerInstructions = [
      { index: 0, instructions: [] },
      { index: 0, instructions: [] },
    ];
    expect(receiptEligible(receipt(duplicate))).toBe(false);
    const truncated = raw(1, "0", "100", -1000000000n);
    const ix = truncated.transaction.message.instructions[0];
    if (!ix) throw Error();
    truncated.transaction.message.instructions = Array(201).fill(ix);
    expect(receiptEligible(receipt(truncated))).toBe(false);
    const model = buildXRay(raw(1, "0", "100", -1000000000n));
    delete model.nativeSol;
    expect(buildTradeReceipt(model, owner)?.candidate).toBeUndefined();
    const fee = raw(1, "0", "100", -1000000000n);
    fee.meta.fee = Number.NaN;
    expect(receiptEligible(receipt(fee))).toBe(false);
    const saved = {
      version: 1,
      complete: true,
      transfers: [{ from: owner, to: a(2), lamports: "18446744073709551616" }],
      blockedAccounts: [],
      reasons: [],
    };
    expect(nativeSolFlow(saved, owner).net).toBeNull();
    expect(
      nativeSolFlow({ ...saved, transfers: [], reasons: ["incomplete"] }, owner)
        .net,
    ).toBeNull();
  });
});

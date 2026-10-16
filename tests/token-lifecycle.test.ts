import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { buildTradeJournal } from "../apps/web/src/pro/trade-journal";
import { buildXRay } from "../apps/web/src/xray/model";
import {
  buildTokenLifecycle,
  lifecycleForOwner,
} from "../apps/web/src/xray/token-lifecycle";
import {
  buildTradeReceipt,
  receiptEligible,
} from "../apps/web/src/xray/trade-receipt";
import { buildWalletImpact } from "../apps/web/src/xray/wallet-impact";
import {
  close,
  createAccount,
  lifecycleTransaction,
  lifecycleOwner as owner,
  temporaryFunding,
  tokenDeposit,
  WSOL,
} from "./lifecycle-fixtures";

const receipt = (tx: unknown) => {
  const r = buildTradeReceipt(buildXRay(tx), owner);
  if (!r) throw Error("Receipt missing");
  return r;
};
describe("Classic token lifecycle cash conservation", () => {
  it("proves missing opening/closing zeros without relaxing the original Wallet Impact", () => {
    const buy = lifecycleTransaction(),
      sell = lifecycleTransaction(true);
    expect(buildWalletImpact(buy).gaps.length).toBeGreaterThan(0);
    const unchanged = structuredClone(buy);
    const a = receipt(buy),
      b = receipt(sell);
    expect(buy).toEqual(unchanged);
    expect(receiptEligible(a)).toBe(true);
    expect(receiptEligible(b)).toBe(true);
    expect(a.candidate?.token.before).toBe("0");
    expect(b.candidate?.token.after).toBe("0");
    expect(
      a.lifecycle?.accounts.find((a) => a.zeroBeforeProven && a.mint !== WSOL),
    ).toBeDefined();
    expect(
      b.lifecycle?.accounts.find((a) => a.zeroAfterProven && a.mint !== WSOL),
    ).toBeDefined();
    expect(a.lifecycle?.accountDeltaLamports).toBe(tokenDeposit.toString());
    expect(b.lifecycle?.accountDeltaLamports).toBe((-tokenDeposit).toString());
    expect(a.candidate?.quote.change).toBe("-1000000000");
    expect(b.candidate?.quote.change).toBe("1200000000");
    expect(buildTradeJournal([a, b], true).positions[0]?.realizedResult).toBe(
      "199990000",
    );
    expect(
      buildTradeJournal([a, b], false).positions[0]?.realizedResult,
    ).toBeNull();
  });
  it("retains partial-sale FIFO cost and excludes unclosed account deposits from trade cost", () => {
    const a = receipt(lifecycleTransaction()),
      b = receipt(lifecycleTransaction(true, true));
    expect(receiptEligible(b)).toBe(true);
    const p = buildTradeJournal([a, b], true).positions[0];
    expect(p?.realizedResult).toBe("99992500");
    expect(p?.remainingCost).toBe("500002500");
  });
  it("unwraps existing WSOL without counting opening principal or reserve/unsynced capital as income", () => {
    const sell = lifecycleTransaction(true),
      prior = 250000000n,
      extra = 98123n;
    sell.transaction.message.instructions.splice(0, 2);
    sell.meta.preBalances[7] = Number(temporaryFunding + prior + extra);
    sell.meta.postBalances[0] =
      (sell.meta.postBalances[0] ?? 0) +
      Number(temporaryFunding + prior + extra);
    sell.meta.preTokenBalances.push({
      accountIndex: 7,
      mint: WSOL,
      owner,
      uiTokenAmount: { amount: prior.toString(), decimals: 9 },
    });
    const b = receipt(sell);
    expect(receiptEligible(b)).toBe(true);
    expect(b.candidate?.quote.change).toBe("1200000000");
    expect(
      buildTradeJournal([receipt(lifecycleTransaction()), b], true).positions[0]
        ?.realizedResult,
    ).toBe("199990000");
  });
  it("uses recorded CPI order and loaded addresses, with no rent constants or balance guesses", () => {
    const tx = lifecycleTransaction();
    const instructions = tx.transaction.message.instructions;
    tx.transaction.message.accountKeys.push(
      base58.encode(new Uint8Array(32).fill(18)),
    );
    tx.meta.preBalances.push(1);
    tx.meta.postBalances.push(1);
    tx.transaction.message.instructions = [
      { programIdIndex: 10, accounts: [0, 2, 7], data: "3" },
    ];
    tx.meta.innerInstructions = [{ index: 0, instructions }];
    expect(receiptEligible(receipt(tx))).toBe(true);
    tx.meta.innerInstructions[0]?.instructions.unshift({
      programIdIndex: 6,
      accounts: [4],
      data: base58.encode(new Uint8Array([21, 7, 0])),
    });
    tx.meta.innerInstructions[0]?.instructions.splice(2, 0, {
      programIdIndex: 6,
      accounts: [2],
      data: base58.encode(new Uint8Array([22])),
    });
    expect(receiptEligible(receipt(tx))).toBe(true);
    tx.meta.loadedAddresses.readonly = [
      tx.transaction.message.accountKeys.pop() ?? "",
    ];
    expect(receiptEligible(receipt(tx))).toBe(true);
  });
  it("withholds malformed, conflicting, truncated or unsupported lifecycle evidence", () => {
    for (const mutate of [
      (tx: ReturnType<typeof lifecycleTransaction>) =>
        (tx.meta.postBalances[0] = (tx.meta.postBalances[0] ?? 0) + 1),
      (tx: ReturnType<typeof lifecycleTransaction>) =>
        tx.transaction.message.instructions.splice(1, 1),
      (tx: ReturnType<typeof lifecycleTransaction>) => {
        const b = tx.meta.postTokenBalances[0];
        if (b) b.owner = base58.encode(new Uint8Array(32).fill(19));
      },
      (tx: ReturnType<typeof lifecycleTransaction>) =>
        tx.meta.innerInstructions.push(
          { index: 0, instructions: [] },
          { index: 0, instructions: [] },
        ),
      (tx: ReturnType<typeof lifecycleTransaction>) =>
        tx.transaction.message.instructions.push(close(7)),
      (tx: ReturnType<typeof lifecycleTransaction>) =>
        tx.transaction.message.instructions.push(
          createAccount(7, temporaryFunding),
        ),
    ]) {
      const tx = lifecycleTransaction();
      mutate(tx);
      expect(receiptEligible(receipt(tx))).toBe(false);
    }
    const bad = lifecycleTransaction();
    bad.transaction.message.instructions = Array(201).fill(
      bad.transaction.message.instructions[0],
    );
    expect(buildTokenLifecycle(bad).complete).toBe(false);
    const extension = lifecycleTransaction();
    extension.transaction.message.accountKeys[6] =
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    expect(buildTokenLifecycle(extension).complete).toBe(false);
    const foreign = lifecycleTransaction(true);
    const last = foreign.transaction.message.instructions.at(-1);
    if (last) last.accounts[1] = 1;
    expect(receiptEligible(receipt(foreign))).toBe(false);
  });
  it("rejects incomplete saved certificates and does not accept unexplained token quantity changes", () => {
    const tx = lifecycleTransaction(),
      e = buildTokenLifecycle(tx),
      base = buildWalletImpact(tx);
    expect(lifecycleForOwner(e, owner, base)).toBeDefined();
    const modified = structuredClone(e);
    if (modified.wallets[0]) modified.wallets[0].cashNetLamports = "999";
    expect(lifecycleForOwner(modified, owner, base)).toBeUndefined();
    expect(
      lifecycleForOwner({ ...e, version: 2 }, owner, base),
    ).toBeUndefined();
    const unexplained = lifecycleTransaction();
    const b = unexplained.meta.postTokenBalances[0];
    if (b) b.uiTokenAmount.amount = "100000001";
    expect(receiptEligible(receipt(unexplained))).toBe(false);
  });
});

it("validates seeded classic account creation and rejects a mismatched derived key", () => {
  const tx = lifecycleTransaction(),
    seed = new TextEncoder().encode("temporary"),
    base = base58.decode(owner),
    program = base58.decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const derive = new Uint8Array(64 + seed.length);
  derive.set(base);
  derive.set(seed, 32);
  derive.set(program, 32 + seed.length);
  tx.transaction.message.accountKeys[7] = base58.encode(sha256(derive));
  const data = new Uint8Array(92 + seed.length),
    v = new DataView(data.buffer);
  v.setUint32(0, 3, true);
  data.set(base, 4);
  v.setBigUint64(36, BigInt(seed.length), true);
  data.set(seed, 44);
  v.setBigUint64(44 + seed.length, temporaryFunding, true);
  v.setBigUint64(52 + seed.length, 165n, true);
  data.set(program, 60 + seed.length);
  tx.transaction.message.instructions[2] = {
    programIdIndex: 5,
    accounts: [0, 7],
    data: base58.encode(data),
  };
  expect(receiptEligible(receipt(tx))).toBe(true);
  tx.transaction.message.accountKeys[7] = base58.encode(
    new Uint8Array(32).fill(29),
  );
  expect(receiptEligible(receipt(tx))).toBe(false);
});

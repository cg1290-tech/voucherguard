import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { buildWalletImpact } from "../apps/web/src/xray/wallet-impact";

const key = (n: number) => base58.encode(new Uint8Array(32).fill(n));
const balance = (
  index: number,
  amount: string,
  owner = key(1),
  decimals = 6,
) => ({
  accountIndex: index,
  mint: key(9),
  owner,
  uiTokenAmount: { amount, decimals },
});
function tx() {
  return {
    transaction: { message: { accountKeys: [key(1), key(2), key(3)] } },
    meta: {
      err: null as unknown,
      fee: 5000,
      preBalances: [100000, 1, 1],
      postBalances: [95000, 1, 1],
      preTokenBalances: [balance(1, "1000000"), balance(2, "2000000")],
      postTokenBalances: [balance(1, "4000000"), balance(2, "1000000")],
    },
  };
}
describe("Wallet Impact", () => {
  it("groups documented token accounts, keeps exact before/after and avoids double subtracting fees", () => {
    const result = buildWalletImpact(tx());
    const w = result.wallets.find((w) => w.address === key(1));
    expect(w?.tokenAccounts).toEqual([key(2), key(3)]);
    expect(w?.balances.find((b) => b.asset === key(9))).toMatchObject({
      before: "3000000",
      after: "5000000",
      change: "2000000",
      decimals: 6,
    });
    expect(w?.balances.find((b) => b.asset === "SOL")?.change).toBe("-5000");
    expect(result.feeLamports).toBe("5000");
    expect(result.feePayer).toBe(key(1));
  });
  it("excludes missing, changed-owner and duplicate token records instead of inventing zero or ownership", () => {
    const t = tx();
    t.meta.postTokenBalances = [balance(1, "9", key(8))];
    const r = buildWalletImpact(t);
    expect(r.wallets.flatMap((w) => w.tokenAccounts)).toEqual([]);
    expect(r.gaps.join(" ")).toContain("changed ownership");
    t.meta.postTokenBalances = [
      balance(1, "9"),
      balance(1, "10"),
      balance(2, "1"),
    ];
    expect(
      buildWalletImpact(t).wallets.find((w) => w.address === key(1))
        ?.tokenAccounts,
    ).toEqual([key(3)]);
    t.meta.preTokenBalances = [{ ...balance(1, "1"), owner: "" }];
    expect(buildWalletImpact(t).gaps.join(" ")).toContain("owners");
  });
  it("keeps u64 values precise, excludes conflicting precision and unsafe SOL balances", () => {
    const t = tx();
    t.meta.preTokenBalances = [balance(1, "18446744073709551615")];
    t.meta.postTokenBalances = [balance(1, "18446744073709551614")];
    expect(
      buildWalletImpact(t)
        .wallets.find((w) => w.address === key(1))
        ?.balances.find((b) => b.asset === key(9))?.change,
    ).toBe("-1");
    t.meta.preTokenBalances.push(balance(2, "1", key(1), 9));
    t.meta.postTokenBalances.push(balance(2, "2", key(1), 9));
    t.meta.preBalances[0] = Number.MAX_SAFE_INTEGER + 1;
    const r = buildWalletImpact(t);
    expect(r.wallets.find((w) => w.address === key(1))?.balances).toEqual([]);
    expect(r.gaps.join(" ")).toContain("precision");
  });
  it("keeps failed and unknown execution explicit and handles loaded addresses", () => {
    const t = tx();
    t.meta.err = { InstructionError: [0, "test"] };
    expect(buildWalletImpact(t).execution).toBe("failed");
    expect(buildWalletImpact({}).execution).toBe("unknown");
    const r = buildWalletImpact({
      ...t,
      transaction: { message: { accountKeys: [key(1)] } },
      meta: {
        ...t.meta,
        loadedAddresses: { writable: [key(2)], readonly: [key(3)] },
      },
    });
    expect(
      r.wallets.find((w) => w.address === key(1))?.tokenAccounts,
    ).toHaveLength(2);
  });
});

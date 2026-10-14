import { base58 } from "@scure/base";
export interface ImpactBalance {
  asset: string;
  decimals: number;
  before: string;
  after: string;
  change: string;
  accounts: string[];
}
export interface WalletImpact {
  signature?: string;
  wallets: {
    address: string;
    balances: ImpactBalance[];
    tokenAccounts: string[];
  }[];
  gaps: string[];
  feeLamports?: string;
  feePayer?: string;
  execution: "succeeded" | "failed" | "unknown";
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function key(v: unknown): string {
  const s = typeof v === "string" ? v : obj(v).pubkey;
  try {
    return typeof s === "string" &&
      s.length <= 44 &&
      base58.decode(s).length === 32
      ? s
      : "";
  } catch {
    return "";
  }
}
const integer = (v: unknown): bigint | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ? BigInt(v)
    : undefined;
/** Historical ownership must agree on both sides; missing records are never assumed zero. */
export function buildWalletImpact(raw: unknown): WalletImpact {
  const tx = obj(raw),
    meta = obj(tx.meta),
    msg = obj(obj(tx.transaction).message),
    loaded = obj(meta.loadedAddresses);
  const keys = [
    ...list(msg.accountKeys),
    ...list(loaded.writable),
    ...list(loaded.readonly),
  ].map(key);
  const result: WalletImpact = {
    wallets: [],
    gaps: [],
    execution: !("err" in meta)
      ? "unknown"
      : meta.err === null
        ? "succeeded"
        : "failed",
  };
  const signature = list(obj(tx.transaction).signatures)[0];
  try {
    if (
      typeof signature === "string" &&
      signature.length <= 88 &&
      base58.decode(signature).length === 64
    )
      result.signature = signature;
  } catch {
    /* Unavailable signature remains absent. */
  }
  const wallets = new Map<string, WalletImpact["wallets"][number]>();
  function wallet(address: string) {
    let w = wallets.get(address);
    if (!w) {
      w = { address, balances: [], tokenAccounts: [] };
      wallets.set(address, w);
    }
    return w;
  }
  const pre = list(meta.preBalances),
    post = list(meta.postBalances);
  keys.forEach((address, i) => {
    if (!address) return;
    if (keys.indexOf(address) !== keys.lastIndexOf(address)) {
      result.gaps.push("Duplicate account addresses excluded from SOL totals.");
      return;
    }
    const a = integer(pre[i]),
      b = integer(post[i]);
    if (a === undefined || b === undefined) {
      result.gaps.push("Some SOL balances are missing or unsafe integers.");
      return;
    }
    wallet(address).balances.push({
      asset: "SOL",
      decimals: 9,
      before: a.toString(),
      after: b.toString(),
      change: (b - a).toString(),
      accounts: [address],
    });
  });
  type Token = {
    address: string;
    owner: string;
    mint: string;
    decimals: number;
    amount: bigint;
  };
  function tokens(value: unknown) {
    const map = new Map<string, Token>();
    const duplicates = new Set<string>();
    if (!Array.isArray(value))
      result.gaps.push("Token balance records unavailable.");
    for (const item of list(value)) {
      const t = obj(item),
        u = obj(t.uiTokenAmount),
        i = t.accountIndex;
      const address =
        typeof i === "number" && Number.isSafeInteger(i) && i >= 0
          ? keys[i]
          : undefined;
      const owner = key(t.owner),
        mint = key(t.mint),
        amount = u.amount,
        decimals = u.decimals;
      if (
        !address ||
        !owner ||
        !mint ||
        typeof amount !== "string" ||
        !/^\d{1,20}$/.test(amount) ||
        BigInt(amount) > (1n << 64n) - 1n ||
        typeof decimals !== "number" ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255
      ) {
        result.gaps.push(
          "Some token balances or historical owners are unavailable or malformed.",
        );
        continue;
      }
      if (map.has(address)) duplicates.add(address);
      map.set(address, {
        address,
        owner,
        mint,
        decimals,
        amount: BigInt(amount),
      });
    }
    for (const address of duplicates) {
      map.delete(address);
      result.gaps.push("Duplicate token records excluded.");
    }
    return { map, duplicates };
  }
  const a = tokens(meta.preTokenBalances),
    b = tokens(meta.postTokenBalances);
  for (const address of new Set([...a.map.keys(), ...b.map.keys()])) {
    const before = a.map.get(address),
      after = b.map.get(address);
    if (
      a.duplicates.has(address) ||
      b.duplicates.has(address) ||
      !before ||
      !after ||
      before.owner !== after.owner ||
      before.mint !== after.mint ||
      before.decimals !== after.decimals
    ) {
      result.gaps.push(
        "Token accounts with missing records or changed ownership/asset excluded; zero balances are not assumed.",
      );
      continue;
    }
    const w = wallet(before.owner);
    w.tokenAccounts.push(address);
    let balance = w.balances.find(
      (c) => c.asset === before.mint && c.decimals === before.decimals,
    );
    if (!balance) {
      balance = {
        asset: before.mint,
        decimals: before.decimals,
        before: "0",
        after: "0",
        change: "0",
        accounts: [],
      };
      w.balances.push(balance);
    }
    balance.before = (BigInt(balance.before) + before.amount).toString();
    balance.after = (BigInt(balance.after) + after.amount).toString();
    balance.change = (
      BigInt(balance.after) - BigInt(balance.before)
    ).toString();
    balance.accounts.push(address);
  }
  // Conflicting precision for a mint cannot be combined into a wallet total.
  for (const w of wallets.values()) {
    const conflicting = new Set(
      w.balances
        .filter((c) =>
          w.balances.some(
            (d) => d.asset === c.asset && d.decimals !== c.decimals,
          ),
        )
        .map((c) => c.asset),
    );
    if (conflicting.size) {
      w.balances = w.balances.filter((c) => !conflicting.has(c.asset));
      result.gaps.push("Conflicting token precision excluded.");
    }
  }
  result.wallets = [...wallets.values()];
  result.gaps = [...new Set(result.gaps)];
  const fee = integer(meta.fee);
  if (fee !== undefined) result.feeLamports = fee.toString();
  if (keys[0]) result.feePayer = keys[0];
  return result;
}

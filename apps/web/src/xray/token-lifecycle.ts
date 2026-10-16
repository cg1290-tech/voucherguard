import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { buildWalletImpact, type WalletImpact } from "./wallet-impact";

const SYSTEM = "11111111111111111111111111111111",
  TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  WSOL = "So11111111111111111111111111111111111111112";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const addr = (v: unknown): string => {
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
};
const uint = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,20}$/.test(v) && BigInt(v) < 1n << 64n;
const integer = (v: unknown): bigint => {
  if (!Number.isSafeInteger(v) || Number(v) < 0)
    throw Error("Unsafe or missing lamport snapshot.");
  return BigInt(Number(v));
};
export interface LifecycleAccount {
  account: string;
  mint: string;
  created: boolean;
  closed: boolean;
  beforeLamports: string;
  afterLamports: string;
  beforeAmount: string;
  afterAmount: string;
  zeroBeforeProven: boolean;
  zeroAfterProven: boolean;
}
export interface LifecycleWallet {
  owner: string;
  walletNetLamports: string;
  accountDeltaLamports: string;
  cashNetLamports: string;
  feeLamports: string;
  fundingLamports: string;
  refundLamports: string;
  accounts: LifecycleAccount[];
  flows: { from: string; to: string; lamports: string; kind: string }[];
}
export interface TokenLifecycleEvidence {
  version: 1;
  complete: boolean;
  impact?: WalletImpact;
  wallets: LifecycleWallet[];
  reasons: string[];
}
interface Identity {
  account: string;
  index: number;
  mint: string;
  owner: string;
  decimals: number;
  pre?: string;
  post?: string;
  created: boolean;
  initialized: boolean;
  closed: boolean;
  payer?: string;
  destination?: string;
  quantity: bigint;
}
/** Replay only supported classic Token/System monetary instructions. Reconcile the
 * actual lamports of every controlled account; never estimate a rent reserve.
 */
export function buildTokenLifecycle(raw: unknown): TokenLifecycleEvidence {
  const result: TokenLifecycleEvidence = {
    version: 1,
    complete: false,
    wallets: [],
    reasons: [],
  };
  try {
    const tx = obj(raw),
      meta = obj(tx.meta),
      msg = obj(obj(tx.transaction).message),
      loaded = obj(meta.loadedAddresses);
    if (
      meta.err !== null ||
      !Array.isArray(msg.instructions) ||
      !Array.isArray(meta.innerInstructions) ||
      !Array.isArray(meta.preTokenBalances) ||
      !Array.isArray(meta.postTokenBalances)
    )
      throw Error(
        "Successful execution and complete token/instruction snapshots are required.",
      );
    const keys = [
      ...arr(msg.accountKeys),
      ...arr(loaded.writable),
      ...arr(loaded.readonly),
    ].map(addr);
    if (
      !keys.length ||
      keys.length > 256 ||
      keys.some((k) => !k) ||
      new Set(keys).size !== keys.length
    )
      throw Error("Account keys are incomplete or duplicated.");
    const before = arr(meta.preBalances).map(integer),
      after = arr(meta.postBalances).map(integer);
    if (before.length !== keys.length || after.length !== keys.length)
      throw Error("Lamport snapshots are incomplete.");
    const fee = integer(meta.fee),
      state = new Map(keys.map((k, i) => [k, before[i] ?? 0n]));
    const identities = new Map<string, Identity>();
    for (const [side, rows] of [
      ["pre", meta.preTokenBalances],
      ["post", meta.postTokenBalances],
    ] as const) {
      const seen = new Set<string>();
      for (const value of rows as unknown[]) {
        const b = obj(value),
          u = obj(b.uiTokenAmount),
          i = b.accountIndex,
          key = Number.isSafeInteger(i) ? keys[Number(i)] : undefined,
          mint = addr(b.mint),
          owner = addr(b.owner);
        if (
          !key ||
          !mint ||
          !owner ||
          !uint(u.amount) ||
          !Number.isInteger(u.decimals) ||
          (mint === WSOL && u.decimals !== 9) ||
          Number(u.decimals) < 0 ||
          Number(u.decimals) > 255 ||
          seen.has(key)
        )
          throw Error("Token identity, precision or snapshot is invalid.");
        seen.add(key);
        const old = identities.get(key);
        if (
          old &&
          (old.mint !== mint ||
            old.owner !== owner ||
            old.decimals !== u.decimals)
        )
          throw Error("Token ownership, mint or precision changes.");
        const identity = old ?? {
          account: key,
          index: Number(i),
          mint,
          owner,
          decimals: Number(u.decimals),
          created: false,
          initialized: false,
          closed: false,
          quantity: 0n,
        };
        identity[side] = u.amount;
        if (side === "pre") identity.quantity = BigInt(u.amount);
        identities.set(key, identity);
      }
    }
    const nested = new Map<number, unknown[]>();
    for (const value of meta.innerInstructions) {
      const g = obj(value);
      if (
        !Number.isSafeInteger(g.index) ||
        Number(g.index) < 0 ||
        Number(g.index) >= msg.instructions.length ||
        !Array.isArray(g.instructions) ||
        nested.has(Number(g.index))
      )
        throw Error("Inner trace is malformed or duplicated.");
      nested.set(Number(g.index), g.instructions);
    }
    const instructions = msg.instructions.flatMap((ix, i) => [
      ix,
      ...(nested.get(i) ?? []),
    ]);
    if (instructions.length > 200)
      throw Error("Lifecycle evidence exceeds 200 recorded instructions.");
    const flows: LifecycleWallet["flows"] = [],
      created = new Map<string, { payer: string; program: string }>(),
      closed = new Set<string>();
    let relevant = false;
    const move = (from: string, to: string, n: bigint, kind: string) => {
      if (n < 0n || (state.get(from) ?? -1n) < n || !state.has(to))
        throw Error("Lamport flow cannot be replayed exactly.");
      state.set(from, (state.get(from) ?? 0n) - n);
      state.set(to, (state.get(to) ?? 0n) + n);
      flows.push({ from, to, lamports: n.toString(), kind });
    };
    const payer = keys[0];
    if (!payer) throw Error("Fee payer missing.");
    state.set(payer, (state.get(payer) ?? 0n) - fee);
    if ((state.get(payer) ?? -1n) < 0n)
      throw Error("Fee exceeds available balance.");
    for (const value of instructions) {
      const ix = obj(value),
        program = Number.isSafeInteger(ix.programIdIndex)
          ? keys[Number(ix.programIdIndex)]
          : undefined,
        accounts = arr(ix.accounts).map((i) =>
          Number.isSafeInteger(i) && Number(i) >= 0
            ? keys[Number(i)]
            : undefined,
        );
      if (
        !program ||
        !Array.isArray(ix.accounts) ||
        accounts.some((a) => !a) ||
        typeof ix.data !== "string" ||
        ix.data.length > 4096
      )
        throw Error("Instruction evidence is malformed.");
      const a = accounts as string[],
        data = base58.decode(ix.data),
        view = new DataView(data.buffer, data.byteOffset, data.byteLength),
        u64 = (i: number) => view.getBigUint64(i, true),
        op = data[0];
      if (program === SYSTEM) {
        if (
          data.length === 12 &&
          view.getUint32(0, true) === 2 &&
          a.length === 2
        ) {
          move(a[0] ?? "", a[1] ?? "", u64(4), "system-transfer");
          continue;
        }
        let funding: bigint | undefined,
          space: bigint | undefined,
          assigned = "";
        if (
          data.length === 52 &&
          view.getUint32(0, true) === 0 &&
          a.length === 2
        ) {
          funding = u64(4);
          space = u64(12);
          assigned = base58.encode(data.slice(20, 52));
        } else if (
          data.length >= 92 &&
          view.getUint32(0, true) === 3 &&
          (a.length === 2 || a.length === 3)
        ) {
          const length = u64(36);
          if (length > 32n) throw Error("Create-with-seed is malformed.");
          const offset = 44 + Number(length);
          if (data.length !== offset + 48)
            throw Error("Create-with-seed is malformed.");
          funding = u64(offset);
          space = u64(offset + 8);
          assigned = base58.encode(data.slice(offset + 16));
          const base = data.slice(4, 36),
            seed = data.slice(44, offset);
          new TextDecoder("utf-8", { fatal: true }).decode(seed);
          if ((a[2] ?? a[0]) !== base58.encode(base))
            throw Error("Create-with-seed base does not match its accounts.");
          const derivation = new Uint8Array(64 + seed.length);
          derivation.set(base);
          derivation.set(seed, 32);
          derivation.set(data.slice(offset + 16), 32 + seed.length);
          if (a[1] !== base58.encode(sha256(derivation)))
            throw Error("Create-with-seed derived address does not match.");
        }
        const target = a[1],
          source = a[0];
        if (
          funding === undefined ||
          space !== 165n ||
          assigned !== TOKEN ||
          !source ||
          !target ||
          created.has(target) ||
          closed.has(target) ||
          (state.get(target) ?? -1n) !== 0n ||
          before[keys.indexOf(target)] !== 0n
        )
          throw Error(
            "Unsupported or ambiguous account creation/System operation.",
          );
        created.set(target, { payer: source, program: assigned });
        move(source, target, funding, "account-funding");
        relevant = true;
        continue;
      }
      if (program === TOKEN2022)
        throw Error("Token-2022 lifecycle/extensions are not replayed.");
      if (program !== TOKEN) continue;
      const account = a[0] ?? "";
      // Classic Token ignores extension requests in GetAccountDataSize and
      // InitializeImmutableOwner is its documented no-op (not Token-2022).
      if (op === 21 && a.length === 1) continue;
      if (
        op === 22 &&
        data.length === 1 &&
        a.length === 1 &&
        created.has(account)
      )
        continue;
      if (op === 1 || op === 16 || op === 18) {
        const owner =
            op === 1
              ? a[2]
              : data.length === 33
                ? base58.encode(data.slice(1))
                : undefined,
          mint = a[1],
          creation = created.get(account);
        if (
          !owner ||
          !mint ||
          !creation ||
          (op === 1 && (data.length !== 1 || a.length < 4)) ||
          ((op === 16 || op === 18) && data.length !== 33)
        )
          throw Error("Initialization lacks a proven account creation.");
        const prior = identities.get(account);
        if (
          prior &&
          (prior.mint !== mint ||
            prior.owner !== owner ||
            prior.pre !== undefined ||
            prior.initialized)
        )
          throw Error("Initialized account identity conflicts with snapshots.");
        identities.set(account, {
          account,
          index: keys.indexOf(account),
          mint,
          owner,
          decimals: mint === WSOL ? 9 : (prior?.decimals ?? -1),
          ...(prior?.post !== undefined ? { post: prior.post } : {}),
          created: true,
          initialized: true,
          closed: false,
          payer: creation.payer,
          quantity: 0n,
        });
        relevant = true;
        continue;
      }
      if (op === 3 || op === 12) {
        const checked = op === 12,
          source = identities.get(account),
          destination = identities.get(a[checked ? 2 : 1] ?? "");
        if (
          data.length !== (checked ? 10 : 9) ||
          a.length < (checked ? 4 : 3) ||
          !source ||
          !destination ||
          (source.pre === undefined && !source.initialized) ||
          (destination.pre === undefined && !destination.initialized) ||
          source.mint !== destination.mint ||
          source.closed ||
          destination.closed
        )
          throw Error("Transfer identity or amount cannot be established.");
        if (source.decimals < 0 && destination.decimals >= 0)
          source.decimals = destination.decimals;
        if (destination.decimals < 0 && source.decimals >= 0)
          destination.decimals = source.decimals;
        if (checked && source.decimals < 0 && data[9] !== undefined)
          source.decimals = destination.decimals = data[9];
        if (
          checked &&
          (a[1] !== source.mint ||
            data[9] !== source.decimals ||
            data[9] !== destination.decimals)
        )
          throw Error("Checked transfer precision conflicts.");
        const n = u64(1);
        if (source.mint === WSOL)
          move(source.account, destination.account, n, "wsol-transfer");
        else {
          if (source.quantity < n)
            throw Error("Token flow exceeds known inventory.");
          source.quantity -= n;
          destination.quantity += n;
        }
        continue;
      }
      if (op === 17) {
        if (
          data.length !== 1 ||
          a.length !== 1 ||
          identities.get(account)?.mint !== WSOL
        )
          throw Error("SyncNative identity unavailable.");
        relevant = true;
        continue;
      }
      if (op === 9) {
        const identity = identities.get(account),
          destination = a[1];
        if (
          data.length !== 1 ||
          a.length < 3 ||
          !identity ||
          !destination ||
          identity.closed ||
          closed.has(account) ||
          (identity.mint !== WSOL && identity.quantity !== 0n)
        )
          throw Error("Closure identity or empty token balance is unproven.");
        move(account, destination, state.get(account) ?? -1n, "account-refund");
        identity.closed = true;
        identity.destination = destination;
        closed.add(account);
        relevant = true;
        continue;
      }
      throw Error("Unsupported classic Token operation in lifecycle trace.");
    }
    if (!relevant) throw Error("No supported lifecycle operation recorded.");
    for (const key of created.keys())
      if (!identities.get(key)?.initialized)
        throw Error("Created account has no matching token initialization.");
    const normalized = structuredClone(raw) as {
      meta: { preTokenBalances: unknown[]; postTokenBalances: unknown[] };
    };
    for (const t of identities.values()) {
      if (t.decimals < 0) throw Error("Token precision is unavailable.");
      if (t.pre === undefined && !t.created)
        throw Error("Missing opening token record without proven creation.");
      if (t.post === undefined && !t.closed)
        throw Error("Missing closing token record without proven closure.");
      if (
        t.closed &&
        (after[t.index] !== 0n ||
          (t.post !== undefined && BigInt(t.post) !== 0n))
      )
        throw Error("Closed account retains lamports or is recreated.");
      if (
        t.mint !== WSOL &&
        t.post !== undefined &&
        BigInt(t.post) !== t.quantity
      )
        throw Error("Token trace does not reconcile with final snapshots.");
      const record = (amount: string) => ({
        accountIndex: t.index,
        mint: t.mint,
        owner: t.owner,
        uiTokenAmount: { amount, decimals: t.decimals },
      });
      if (t.pre === undefined)
        normalized.meta.preTokenBalances.push(record("0"));
      if (t.post === undefined)
        normalized.meta.postTokenBalances.push(record("0"));
    }
    const impact = buildWalletImpact(normalized);
    if (impact.gaps.length)
      throw Error("Normalized balances remain incomplete.");
    for (const owner of new Set([...identities.values()].map((t) => t.owner))) {
      const owned = [...identities.values()].filter((t) => t.owner === owner),
        oi = keys.indexOf(owner);
      if (
        owner !== payer ||
        oi < 0 ||
        !owned.some(
          (t) =>
            t.created ||
            t.closed ||
            flows.some(
              (f) =>
                f.kind === "system-transfer" &&
                f.from === owner &&
                f.to === t.account,
            ),
        )
      )
        continue;
      const scope = new Set([owner, ...owned.map((t) => t.account)]);
      if (
        owned.some(
          (t) =>
            (t.created && t.payer !== owner) ||
            (t.closed && t.destination !== owner),
        )
      )
        continue;
      if (
        [...identities.values()].some(
          (t) =>
            t.owner !== owner &&
            ((t.created && t.payer === owner) ||
              (t.closed && t.destination === owner)),
        )
      )
        continue;
      if ([...scope].some((k) => state.get(k) !== after[keys.indexOf(k)]))
        continue;
      const accountDelta = owned.reduce(
          (n, t) => n + (after[t.index] ?? 0n) - (before[t.index] ?? 0n),
          0n,
        ),
        walletNet = (after[oi] ?? 0n) - (before[oi] ?? 0n);
      let cash = 0n;
      for (const f of flows) {
        if (scope.has(f.to) && !scope.has(f.from)) cash += BigInt(f.lamports);
        if (scope.has(f.from) && !scope.has(f.to)) cash -= BigInt(f.lamports);
      }
      if (walletNet + accountDelta + fee !== cash) continue;
      result.wallets.push({
        owner,
        walletNetLamports: walletNet.toString(),
        accountDeltaLamports: accountDelta.toString(),
        cashNetLamports: cash.toString(),
        feeLamports: fee.toString(),
        fundingLamports: flows
          .filter((f) => f.kind === "account-funding" && f.from === owner)
          .reduce((n, f) => n + BigInt(f.lamports), 0n)
          .toString(),
        refundLamports: flows
          .filter((f) => f.kind === "account-refund" && f.to === owner)
          .reduce((n, f) => n + BigInt(f.lamports), 0n)
          .toString(),
        accounts: owned.map((t) => ({
          account: t.account,
          mint: t.mint,
          created: t.created,
          closed: t.closed,
          beforeLamports: (before[t.index] ?? 0n).toString(),
          afterLamports: (after[t.index] ?? 0n).toString(),
          beforeAmount: t.pre ?? "0",
          afterAmount: t.post ?? "0",
          zeroBeforeProven: t.pre === undefined,
          zeroAfterProven: t.post === undefined,
        })),
        flows: flows.filter((f) => scope.has(f.from) || scope.has(f.to)),
      });
    }
    if (!result.wallets.length)
      throw Error(
        "Lifecycle cash flows, ownership or final lamports could not be reconciled.",
      );
    result.complete = true;
    result.impact = impact;
  } catch (e) {
    result.reasons = [
      e instanceof Error ? e.message : "Lifecycle evidence unavailable.",
    ];
  }
  return result;
}

/** Structural and conservation checks on saved local evidence. Not authenticity. */
export function lifecycleForOwner(
  value: unknown,
  owner: string,
  original: unknown,
): { impact: WalletImpact; proof: LifecycleWallet } | undefined {
  const e = obj(value),
    impact = obj(e.impact),
    base = obj(original);
  if (
    e.version !== 1 ||
    e.complete !== true ||
    !Array.isArray(e.reasons) ||
    e.reasons.length ||
    !Array.isArray(e.wallets) ||
    e.wallets.length > 256 ||
    impact.feePayer !== owner ||
    impact.feePayer !== base.feePayer ||
    impact.feeLamports !== base.feeLamports
  )
    return undefined;
  const matches = e.wallets.map(obj).filter((p) => p.owner === owner),
    p = matches[0];
  if (
    matches.length !== 1 ||
    !p ||
    !Array.isArray(p.accounts) ||
    p.accounts.length > 256 ||
    !Array.isArray(p.flows) ||
    p.flows.length > 200
  )
    return undefined;
  const signed = (v: unknown): v is string =>
    typeof v === "string" && /^-?\d{1,30}$/.test(v);
  if (
    ![p.walletNetLamports, p.accountDeltaLamports, p.cashNetLamports].every(
      signed,
    ) ||
    ![p.feeLamports, p.fundingLamports, p.refundLamports].every(uint) ||
    p.feeLamports !== base.feeLamports
  )
    return undefined;
  let delta = 0n;
  const scope = new Set([owner]);
  for (const value of p.accounts) {
    const a = obj(value);
    if (
      typeof a.account !== "string" ||
      !addr(a.account) ||
      scope.has(a.account) ||
      typeof a.mint !== "string" ||
      !addr(a.mint) ||
      ![a.beforeLamports, a.afterLamports, a.beforeAmount, a.afterAmount].every(
        uint,
      ) ||
      ![a.created, a.closed, a.zeroBeforeProven, a.zeroAfterProven].every(
        (v) => typeof v === "boolean",
      ) ||
      (a.zeroBeforeProven &&
        (!a.created || a.beforeAmount !== "0" || a.beforeLamports !== "0")) ||
      (a.zeroAfterProven &&
        (!a.closed || a.afterAmount !== "0" || a.afterLamports !== "0"))
    )
      return undefined;
    scope.add(a.account);
    delta += BigInt(String(a.afterLamports)) - BigInt(String(a.beforeLamports));
  }
  let cash = 0n;
  for (const value of p.flows) {
    const f = obj(value);
    if (
      typeof f.from !== "string" ||
      !addr(f.from) ||
      typeof f.to !== "string" ||
      !addr(f.to) ||
      !uint(f.lamports) ||
      ![
        "system-transfer",
        "account-funding",
        "wsol-transfer",
        "account-refund",
      ].includes(String(f.kind))
    )
      return undefined;
    if (scope.has(f.to) && !scope.has(f.from)) cash += BigInt(f.lamports);
    if (scope.has(f.from) && !scope.has(f.to)) cash -= BigInt(f.lamports);
  }
  const sol = (v: Record<string, unknown>) =>
    arr(v.wallets)
      .map(obj)
      .filter((w) => w.address === owner)
      .flatMap((w) => arr(w.balances).map(obj))
      .find((b) => b.asset === "SOL");
  const a = sol(base),
    b = sol(impact);
  if (
    !a ||
    !b ||
    a.before !== b.before ||
    a.after !== b.after ||
    a.change !== b.change ||
    a.change !== p.walletNetLamports ||
    delta !== BigInt(String(p.accountDeltaLamports)) ||
    cash !== BigInt(String(p.cashNetLamports)) ||
    cash !==
      BigInt(String(p.walletNetLamports)) +
        delta +
        BigInt(String(p.feeLamports))
  )
    return undefined;
  return {
    impact: e.impact as WalletImpact,
    proof: p as unknown as LifecycleWallet,
  };
}

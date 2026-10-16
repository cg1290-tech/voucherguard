import { base58 } from "@scure/base";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export interface NativeSolEvidence {
  version: 1;
  complete: boolean;
  transfers: { from: string; to: string; lamports: string }[];
  blockedAccounts: string[];
  reasons: string[];
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function address(v: unknown): string {
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
/** Decode recorded System transfers only. Other account lifecycle operations block
 * affected wallets; arbitrary direct lamport mutations must fail reconciliation.
 * No account metadata lookup, rent estimate or simulation is used.
 */
export function buildNativeSolEvidence(raw: unknown): NativeSolEvidence {
  const tx = obj(raw),
    meta = obj(tx.meta),
    msg = obj(obj(tx.transaction).message),
    loaded = obj(meta.loadedAddresses);
  const result: NativeSolEvidence = {
    version: 1,
    complete: true,
    transfers: [],
    blockedAccounts: [],
    reasons: [],
  };
  const fail = (reason: string) => {
    result.complete = false;
    if (!result.reasons.includes(reason)) result.reasons.push(reason);
  };
  const keys = [
    ...list(msg.accountKeys),
    ...list(loaded.writable),
    ...list(loaded.readonly),
  ].map(address);
  if (
    !Array.isArray(msg.accountKeys) ||
    !keys.length ||
    keys.length > 256 ||
    keys.some((k) => !k) ||
    new Set(keys).size !== keys.length
  )
    fail("Account keys cannot be resolved uniquely.");
  if (meta.err !== null) fail("Successful execution is not established.");
  const top = list(msg.instructions),
    inner = list(meta.innerInstructions),
    groups = new Map<number, unknown[]>();
  if (
    !Array.isArray(msg.instructions) ||
    !Array.isArray(meta.innerInstructions)
  )
    fail("Complete recorded instruction trace is unavailable.");
  for (const value of inner) {
    const g = obj(value);
    if (
      !Number.isSafeInteger(g.index) ||
      Number(g.index) < 0 ||
      Number(g.index) >= top.length ||
      !Array.isArray(g.instructions) ||
      groups.has(Number(g.index))
    ) {
      fail("Inner instruction groups are malformed or duplicated.");
      continue;
    }
    groups.set(Number(g.index), g.instructions);
  }
  let count = 0;
  const blocked = new Set<string>();
  function decode(value: unknown) {
    if (++count > 200) {
      fail("Native SOL trace exceeds the 200-step evidence limit.");
      return;
    }
    const ix = obj(value);
    const program = Number.isSafeInteger(ix.programIdIndex)
      ? keys[Number(ix.programIdIndex)]
      : undefined;
    const accounts = list(ix.accounts).map((i) =>
      Number.isSafeInteger(i) && Number(i) >= 0 ? keys[Number(i)] : undefined,
    );
    if (
      !program ||
      !Array.isArray(ix.accounts) ||
      accounts.length > 256 ||
      accounts.some((a) => !a) ||
      typeof ix.data !== "string" ||
      ix.data.length > 4096
    ) {
      fail("Instruction accounts or data are incomplete.");
      return;
    }
    let data: Uint8Array;
    try {
      data = base58.decode(ix.data);
    } catch {
      fail("Instruction data encoding is invalid.");
      return;
    }
    if (program === SYSTEM) {
      if (
        data.length === 12 &&
        accounts.length === 2 &&
        new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
          0,
          true,
        ) === 2
      ) {
        const from = accounts[0],
          to = accounts[1];
        if (from && to)
          result.transfers.push({
            from,
            to,
            lamports: new DataView(
              data.buffer,
              data.byteOffset,
              data.byteLength,
            )
              .getBigUint64(4, true)
              .toString(),
          });
      } else {
        for (const a of accounts) if (a) blocked.add(a);
      }
    }
    if ((program === TOKEN || program === TOKEN2022) && data[0] === 9) {
      // CloseAccount refunds lamports; do not guess rent vs wrapped principal.
      for (const a of accounts) if (a) blocked.add(a);
    }
  }
  for (const [i, ix] of top.entries()) {
    decode(ix);
    for (const nested of groups.get(i) ?? []) decode(nested);
  }
  // Funding one's own token account can be recoverable rent or wrapped principal,
  // not a purchase cost. Without a full lifecycle decoder, reject that wallet.
  for (const value of [
    ...list(meta.preTokenBalances),
    ...list(meta.postTokenBalances),
  ]) {
    const b = obj(value),
      owner = address(b.owner);
    const tokenAccount = Number.isSafeInteger(b.accountIndex)
      ? keys[Number(b.accountIndex)]
      : undefined;
    if (
      owner &&
      tokenAccount &&
      result.transfers.some((t) => t.from === owner && t.to === tokenAccount)
    )
      blocked.add(owner);
  }
  result.blockedAccounts = [...blocked];
  return result;
}
/** Validate saved evidence before using it; local files remain editable/untrusted. */
export function nativeSolFlow(
  value: unknown,
  owner: string,
): {
  net: string | null;
  reasons: string[];
  transfers?: NativeSolEvidence["transfers"];
} {
  const e = obj(value);
  if (
    e.version !== 1 ||
    e.complete !== true ||
    !Array.isArray(e.transfers) ||
    e.transfers.length > 200 ||
    !Array.isArray(e.blockedAccounts) ||
    e.blockedAccounts.length > 256 ||
    !e.blockedAccounts.every(
      (a) => typeof a === "string" && address(a) === a,
    ) ||
    !Array.isArray(e.reasons) ||
    e.reasons.length !== 0 ||
    !e.reasons.every((r) => typeof r === "string" && r.length <= 2000)
  )
    return {
      net: null,
      reasons: [
        "Native SOL instruction evidence is missing, incomplete or malformed.",
      ],
    };
  if (e.blockedAccounts.includes(owner))
    return {
      net: null,
      reasons: [
        "Account creation, closure, own token-account funding or unsupported System operations affect this wallet; rent/principal is not isolated.",
      ],
    };
  let net = 0n;
  const transfers: NativeSolEvidence["transfers"] = [];
  for (const value of e.transfers) {
    const t = obj(value);
    if (
      typeof t.from !== "string" ||
      !address(t.from) ||
      typeof t.to !== "string" ||
      !address(t.to) ||
      typeof t.lamports !== "string" ||
      !/^\d{1,20}$/.test(t.lamports) ||
      BigInt(t.lamports) > (1n << 64n) - 1n
    )
      return {
        net: null,
        reasons: ["Recorded native SOL transfer evidence is malformed."],
      };
    if (t.to === owner) net += BigInt(t.lamports);
    if (t.from === owner) net -= BigInt(t.lamports);
    if (t.to === owner || t.from === owner)
      transfers.push({
        from: String(t.from),
        to: String(t.to),
        lamports: t.lamports,
      });
  }
  return { net: net.toString(), reasons: [], transfers };
}

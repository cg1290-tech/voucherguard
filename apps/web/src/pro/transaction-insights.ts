import { base58 } from "@scure/base";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const key = (v: unknown): string => {
  const s = typeof v === "string" ? v : obj(v).pubkey;
  if (typeof s !== "string") return "";
  try {
    return base58.decode(s).length === 32 ? s : "";
  } catch {
    return "";
  }
};
const integer = (v: unknown): bigint | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ? BigInt(v)
    : undefined;
export function displayUnits(raw: string, decimals: number): string {
  const n = BigInt(raw),
    sign = n < 0n ? "-" : "",
    value = (n < 0n ? -n : n).toString().padStart(decimals + 1, "0");
  if (!decimals) return `${sign}${value}`;
  const fraction = value.slice(-decimals).replace(/0+$/, "");
  return `${sign}${value.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
export interface BalanceChange {
  account: string;
  asset: string;
  decimals: number;
  change: string;
  owner?: string;
}
export interface PermissionEvent {
  position: string;
  action: string;
  account: string;
  details: string;
  applied: boolean;
}
export interface TransactionInsights {
  success: boolean;
  programsComplete: boolean;
  permissionsComplete: boolean;
  feeLamports?: string;
  feePayer?: string;
  feePayerNetLamports?: string;
  balanceChanges: BalanceChange[];
  permissionEvents: PermissionEvent[];
  programs: string[];
  warnings: string[];
  coverage: string[];
  innerInstructionCount: number;
  solBalancesComplete: boolean;
  tokenBalancesComplete: boolean;
}
/** Historical transaction facts only. No current account permission or asset-reputation claim. */
export function inspectTransaction(value: unknown): TransactionInsights {
  const tx = obj(value),
    meta = obj(tx.meta),
    message = obj(obj(tx.transaction).message);
  const loaded = obj(meta.loadedAddresses);
  const keys = [
    ...list(message.accountKeys),
    ...list(loaded.writable),
    ...list(loaded.readonly),
  ].map(key);
  const out: TransactionInsights = {
    success: meta.err === null,
    programsComplete:
      Array.isArray(message.instructions) &&
      Array.isArray(meta.innerInstructions),
    permissionsComplete: false,
    balanceChanges: [],
    permissionEvents: [],
    programs: [],
    warnings: [],
    coverage: [],
    innerInstructionCount: 0,
    solBalancesComplete: false,
    tokenBalancesComplete: false,
  };
  if (!out.success)
    out.warnings.push(
      "Transaction failed: listed instruction effects were attempted, not applied. Transaction fees may still be charged.",
    );
  const fee = integer(meta.fee);
  if (fee !== undefined) out.feeLamports = fee.toString();
  else
    out.coverage.push(
      "Fee unavailable or outside exact JSON integer precision.",
    );
  if (keys[0]) out.feePayer = keys[0];
  const pre = list(meta.preBalances),
    post = list(meta.postBalances);
  out.solBalancesComplete =
    Array.isArray(meta.preBalances) &&
    Array.isArray(meta.postBalances) &&
    pre.length === keys.length &&
    post.length === keys.length &&
    keys.every(Boolean);
  for (let i = 0; i < keys.length; i++) {
    const before = integer(pre[i]),
      after = integer(post[i]);
    if (before === undefined || after === undefined) {
      out.solBalancesComplete = false;
      continue;
    }
    const delta = after - before;
    if (i === 0) out.feePayerNetLamports = delta.toString();
    if (delta !== 0n && keys[i])
      out.balanceChanges.push({
        account: keys[i] as string,
        asset: "SOL",
        decimals: 9,
        change: delta.toString(),
      });
  }
  if (!out.solBalancesComplete)
    out.coverage.push(
      "SOL balance coverage is incomplete. Unsafe JSON integers are not rounded into financial values.",
    );
  type TokenBalance = {
    index: number;
    mint: string;
    amount: bigint;
    decimals: number;
    owner: string;
  };
  function tokens(v: unknown): Map<string, TokenBalance> {
    const map = new Map<string, TokenBalance>();
    for (const item of list(v)) {
      const b = obj(item),
        a = obj(b.uiTokenAmount),
        index = b.accountIndex,
        mint = key(b.mint),
        decimals = a.decimals;
      if (
        typeof index !== "number" ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !keys[index] ||
        !mint ||
        typeof a.amount !== "string" ||
        !/^\d{1,20}$/.test(a.amount) ||
        BigInt(a.amount) > (1n << 64n) - 1n ||
        typeof decimals !== "number" ||
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255
      ) {
        out.tokenBalancesComplete = false;
        continue;
      }
      const id = `${index}:${mint}`;
      if (map.has(id)) {
        out.tokenBalancesComplete = false;
        continue;
      }
      map.set(id, {
        index,
        mint,
        amount: BigInt(a.amount),
        decimals,
        owner: key(b.owner),
      });
    }
    return map;
  }
  out.tokenBalancesComplete =
    Array.isArray(meta.preTokenBalances) &&
    Array.isArray(meta.postTokenBalances);
  const beforeTokens = tokens(meta.preTokenBalances),
    afterTokens = tokens(meta.postTokenBalances);
  for (const id of new Set([...beforeTokens.keys(), ...afterTokens.keys()])) {
    const a = beforeTokens.get(id),
      b = afterTokens.get(id),
      ref = b ?? a;
    if (!ref) continue;
    // Missing records alone do not prove a zero token balance. New/closed accounts require zero SOL evidence.
    const before =
      a?.amount ?? (integer(pre[ref.index]) === 0n ? 0n : undefined);
    const after =
      b?.amount ?? (integer(post[ref.index]) === 0n ? 0n : undefined);
    if (
      before === undefined ||
      after === undefined ||
      (a && b && a.decimals !== b.decimals)
    ) {
      out.tokenBalancesComplete = false;
      continue;
    }
    if (a?.owner && b?.owner && a.owner !== b.owner)
      out.warnings.push(`Token-account owner changed: ${keys[ref.index]}.`);
    const delta = after - before;
    if (delta !== 0n) {
      const change: BalanceChange = {
        account: keys[ref.index] as string,
        asset: ref.mint,
        decimals: ref.decimals,
        change: delta.toString(),
      };
      if (ref.owner) change.owner = ref.owner;
      out.balanceChanges.push(change);
    }
  }
  if (!out.tokenBalancesComplete)
    out.coverage.push(
      "Token balance coverage is incomplete; missing balances are not assumed to be zero.",
    );
  const instructions: { instruction: unknown; position: string }[] = list(
    message.instructions,
  ).map((instruction, i) => ({
    instruction,
    position: `Instruction ${i + 1}`,
  }));
  if (!Array.isArray(meta.innerInstructions))
    out.coverage.push(
      "Inner-instruction trace unavailable. Nested authorization changes may be missing.",
    );
  const seenInner = new Set<unknown>();
  for (const group of list(meta.innerInstructions)) {
    const g = obj(group);
    if (seenInner.has(g.index)) out.programsComplete = false;
    seenInner.add(g.index);
    if (
      !Number.isSafeInteger(g.index) ||
      Number(g.index) < 0 ||
      Number(g.index) >= list(message.instructions).length
    )
      out.programsComplete = false;
    if (!Array.isArray(g.instructions)) {
      out.programsComplete = false;
      out.coverage.push("Malformed inner-instruction trace.");
      continue;
    }
    list(g.instructions).forEach((instruction, i) => {
      out.innerInstructionCount++;
      instructions.push({
        instruction,
        position: `Inner ${String(g.index)}.${i + 1}`,
      });
    });
  }
  if (instructions.length > 2000) {
    out.programsComplete = false;
    out.coverage.push("Instruction inspection limit reached.");
    instructions.length = 2000;
  }
  let unknownTokens = 0;
  for (const { instruction, position } of instructions) {
    const ix = obj(instruction),
      index = ix.programIdIndex,
      pid =
        typeof index === "number" && Number.isSafeInteger(index)
          ? keys[index]
          : undefined;
    if (!pid) {
      out.programsComplete = false;
      out.coverage.push(`${position}: program address could not be resolved.`);
      continue;
    }
    if (!out.programs.includes(pid)) out.programs.push(pid);
    if (pid !== TOKEN && pid !== TOKEN2022) continue;
    const accounts = list(ix.accounts).map((i) =>
      typeof i === "number" && Number.isSafeInteger(i) ? keys[i] : "",
    );
    try {
      if (
        typeof ix.data !== "string" ||
        ix.data.length > 4096 ||
        !accounts.every(Boolean)
      )
        throw Error();
      const data = base58.decode(ix.data),
        op = data[0];
      const minimum = (
        {
          3: 3,
          12: 4,
          17: 1,
          4: 3,
          13: 4,
          6: 2,
          9: 3,
          8: 3,
          15: 3,
          10: 3,
          5: 2,
        } as Record<number, number>
      )[op ?? -1];
      if (minimum !== undefined && accounts.length < minimum) throw Error();
      const event = (action: string, details: string) => {
        if (!accounts[0]) throw Error();
        out.permissionEvents.push({
          position,
          action,
          account: accounts[0],
          details,
          applied: out.success,
        });
      };
      const amount = () => {
        if (data.length < 9) throw Error();
        return new DataView(data.buffer, data.byteOffset, data.byteLength)
          .getBigUint64(1, true)
          .toString();
      };
      // Known transfer/sync instructions do not create the selected delegation or SetAuthority operations.
      // SPL encoding reference: https://github.com/solana-program/token/blob/main/interface/src/instruction.rs
      if (op === 3 || op === 12 || op === 17) {
        if (data.length !== (op === 3 ? 9 : op === 12 ? 10 : 1)) throw Error();
      } else if (op === 4 || op === 13) {
        const delegate = accounts[op === 13 ? 2 : 1];
        if (!delegate || data.length !== (op === 13 ? 10 : 9)) throw Error();
        event(
          "Spending delegation",
          `Delegate ${delegate}; allowance ${amount()} base units${op === 13 ? ` (${displayUnits(amount(), data[9] as number)} tokens)` : ""}. This permission may allow later transfers or burns; its current state is not checked.`,
        );
      } else if (op === 6) {
        if (
          data.length < 3 ||
          ![0, 1].includes(data[2] as number) ||
          data.length !== (data[2] === 1 ? 35 : 3)
        )
          throw Error();
        const authority =
          ["mint", "freeze", "account owner", "close"][data[1] as number] ??
          `type ${data[1]}`;
        event(
          "Authority change",
          `${authority} authority ${data[2] === 0 ? "removed" : `set to ${base58.encode(data.slice(3, 35))}`}. Current authority is not checked.`,
        );
      } else if (op === 9) {
        if (data.length !== 1 || !accounts[1]) throw Error();
        event(
          "Account closure",
          `Account SOL/rent destination: ${accounts[1]}.`,
        );
      } else if (op === 8 || op === 15) {
        if (data.length !== (op === 15 ? 10 : 9)) throw Error();
        event("Token burn", `${amount()} base units requested for burn.`);
      } else if (op === 10) {
        if (data.length !== 1) throw Error();
        event("Account freeze", "Token account requested to be frozen.");
      } else if (op === 5) {
        if (data.length !== 1) throw Error();
        event(
          "Delegation revocation",
          "Existing spending delegation requested to be revoked.",
        );
      } else unknownTokens++;
    } catch {
      unknownTokens++;
    }
  }
  out.permissionsComplete = out.programsComplete && unknownTokens === 0;
  if (unknownTokens)
    out.coverage.push(
      `${unknownTokens} token instruction(s) not decoded by the permission inspector, including unsupported Token-2022 extensions.`,
    );
  out.coverage.push(
    "Permission inspection covers selected SPL Token and Token-2022 instructions only. Other program behavior, current permissions, token legitimacy and future safety are not certified.",
  );
  return out;
}

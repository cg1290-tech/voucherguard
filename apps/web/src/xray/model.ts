import { base58 } from "@scure/base";
import {
  inspectTransaction,
  type TransactionInsights,
} from "../pro/transaction-insights";
import {
  fetchTransaction,
  historicalVerifyTransaction,
  parseTransactionInput,
  type QuickExtractResult,
} from "../quick/extract";

import { explainFailure, type FailureEvidence } from "./failure";

import { buildWalletImpact, type WalletImpact } from "./wallet-impact";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const address = (v: unknown): string => {
  const s = typeof v === "string" ? v : object(v).pubkey;
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
export interface XRayStep {
  id: string;
  position: string;
  program: string;
  kind: "money" | "permission" | "unknown";
  label: string;
  details: string;
  from?: string;
  to?: string;
  amount?: string;
  decimals?: number;
  asset?: string;
  permissionAction?: string;
  instructionData?: string;
  accountAddresses?: string[];
  instructionIndex?: number;
}
export interface XRayModel {
  execution: "succeeded" | "failed" | "unknown";
  steps: XRayStep[];
  gaps: string[];
  insights: TransactionInsights;
  failure?: FailureEvidence;
  walletImpact?: WalletImpact;
}
/** Recorded instruction order, not simulated intermediate balances or an audit of arbitrary programs. */
export function buildXRay(
  raw: unknown,
  insights = inspectTransaction(raw),
): XRayModel {
  const tx = object(raw),
    meta = object(tx.meta),
    msg = object(object(tx.transaction).message),
    loaded = object(meta.loadedAddresses);
  const keys = [
    ...array(msg.accountKeys),
    ...array(loaded.writable),
    ...array(loaded.readonly),
  ].map(address);
  const model: XRayModel = {
    execution: !("err" in meta)
      ? "unknown"
      : meta.err === null
        ? "succeeded"
        : "failed",
    steps: [],
    gaps: [],
    insights,
    walletImpact: buildWalletImpact(raw),
  };
  const top = array(msg.instructions);
  const failure = explainFailure(meta, top.length);
  if (failure) model.failure = failure;
  const inner = new Map<number, unknown[]>();
  if (!Array.isArray(msg.instructions))
    model.gaps.push("Top-level instructions unavailable.");
  if (!Array.isArray(meta.innerInstructions))
    model.gaps.push(
      "Inner-instruction trace unavailable; nested operations may be missing.",
    );
  for (const value of array(meta.innerInstructions)) {
    const g = object(value);
    const index = g.index;
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= top.length ||
      !Array.isArray(g.instructions) ||
      inner.has(index)
    ) {
      model.gaps.push(
        "Malformed or duplicate inner trace omitted; complete ordering cannot be established.",
      );
      continue;
    }
    inner.set(index, g.instructions);
  }
  const tokenIdentity = (index: number) => {
    const matches = [
      ...array(meta.preTokenBalances),
      ...array(meta.postTokenBalances),
    ]
      .map(object)
      .filter((b) => b.accountIndex === index);
    if (!matches.length) return undefined;
    const first = matches[0];
    if (!first) return undefined;
    const mint = address(first.mint),
      decimals = object(first.uiTokenAmount).decimals;
    if (
      !mint ||
      typeof decimals !== "number" ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 255 ||
      !matches.every(
        (b) =>
          address(b.mint) === mint &&
          object(b.uiTokenAmount).decimals === decimals,
      )
    )
      return undefined;
    return { mint, decimals };
  };
  function decode(value: unknown, position: string, instructionIndex: number) {
    if (model.steps.length >= 200) return;
    const ix = object(value),
      pi = ix.programIdIndex;
    const program =
      typeof pi === "number" && Number.isSafeInteger(pi)
        ? (keys[pi] ?? "")
        : "";
    const step: XRayStep = {
      instructionIndex,
      id: position,
      position,
      program,
      kind: "unknown",
      label: "Undecoded program instruction",
      details: "This operation is not decoded. Its behavior is not assessed.",
    };
    if (typeof ix.data === "string" && ix.data.length <= 4096)
      step.instructionData = ix.data;
    model.steps.push(step);
    try {
      if (
        !program ||
        !Array.isArray(ix.accounts) ||
        typeof ix.data !== "string" ||
        ix.data.length > 4096
      )
        throw Error();
      const indices = ix.accounts;
      const accounts = indices.map((i) =>
        typeof i === "number" && Number.isSafeInteger(i) ? (keys[i] ?? "") : "",
      );
      if (!accounts.every(Boolean) || accounts.length > 256) throw Error();
      step.accountAddresses = accounts;
      const data = base58.decode(ix.data);
      const u64 = (offset: number) =>
        new DataView(data.buffer, data.byteOffset, data.byteLength)
          .getBigUint64(offset, true)
          .toString();
      if (
        program === SYSTEM &&
        data.length === 12 &&
        new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
          0,
          true,
        ) === 2 &&
        accounts.length >= 2
      ) {
        Object.assign(step, {
          kind: "money",
          label: "SOL transfer instruction",
          from: accounts[0],
          to: accounts[1],
          amount: u64(4),
          decimals: 9,
          asset: "SOL",
          details:
            "Recorded transfer instruction amount. Final balances also reflect fees, rent and other operations.",
        });
        return;
      }
      if (program !== TOKEN && program !== TOKEN2022) return;
      const op = data[0];
      if (
        (op === 3 && data.length === 9 && accounts.length >= 3) ||
        (op === 12 && data.length === 10 && accounts.length >= 4)
      ) {
        const source = tokenIdentity(Number(indices[0]));
        const destination = tokenIdentity(Number(indices[op === 12 ? 2 : 1]));
        const mint =
          op === 12
            ? accounts[1]
            : source &&
                destination &&
                source.mint === destination.mint &&
                source.decimals === destination.decimals
              ? source.mint
              : undefined;
        const decimals =
          op === 12 ? data[9] : mint ? source?.decimals : undefined;
        Object.assign(step, {
          kind: "money",
          label: "Token transfer instruction",
          from: accounts[0],
          to: accounts[op === 12 ? 2 : 1],
          amount: u64(1),
          asset: mint ?? "Token (mint not established)",
          details:
            "Instruction amount, not guaranteed net received. Token fees and hooks may affect the outcome. Endpoints are token accounts; wallet owners are not inferred.",
        });
        if (decimals !== undefined) step.decimals = decimals;
        return;
      }
      const event = insights.permissionEvents.find(
        (e) => e.position === position,
      );
      if (event) {
        Object.assign(step, {
          kind: "permission",
          label: event.action,
          permissionAction: event.action,
          from: event.account,
          details: event.details,
        });
        if (op === 4 || op === 13) {
          const target = accounts[op === 13 ? 2 : 1];
          if (target) step.to = target;
        } else if (op === 6 && data[2] === 1)
          step.to = base58.encode(data.slice(3, 35));
        else if (op === 9 && accounts[1]) step.to = accounts[1];
      }
    } catch {
      step.label = "Unresolved or malformed instruction";
      step.details =
        "Addresses or instruction bytes could not be decoded; no transfer or permission is inferred.";
    }
  }
  top.forEach((ix, i) => {
    decode(ix, `Instruction ${i + 1}`, i);
    inner.get(i)?.forEach((nested, j) => {
      decode(nested, `Inner ${i}.${j + 1}`, i);
    });
  });
  const count =
    top.length + [...inner.values()].reduce((n, a) => n + a.length, 0);
  if (count > 200)
    model.gaps.push("Playback limited to the first 200 recorded instructions.");
  if (model.execution === "unknown")
    model.gaps.push(
      "Execution metadata unavailable. Application of these instructions is not established.",
    );
  return model;
}
export async function loadXRay(
  input: string,
  rpc: string,
  fetcher: typeof fetch = fetch,
): Promise<{ result: QuickExtractResult; xray?: XRayModel }> {
  let signature = "";
  try {
    signature = parseTransactionInput(input);
    const tx = await fetchTransaction(signature, rpc, fetcher);
    const xray = buildXRay(tx);
    let result: QuickExtractResult;
    if (
      !tx.meta ||
      !("err" in tx.meta) ||
      !Number.isSafeInteger(tx.slot) ||
      tx.slot < 0
    )
      result = {
        kind: "not-found",
        signature,
        message:
          "Transaction execution metadata unavailable. X-Ray shows instructions only.",
      };
    else {
      try {
        result = await historicalVerifyTransaction(signature, tx);
      } catch {
        result = {
          kind: "unsupported",
          signature,
          message:
            "Voucher evidence could not be decoded. X-Ray remains available.",
        };
      }
    }
    return { result, xray };
  } catch (e) {
    return {
      result: {
        kind: "not-found",
        signature,
        message: e instanceof Error ? e.message : "Transaction unavailable.",
      },
    };
  }
}

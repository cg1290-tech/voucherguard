import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { XRayModel, XRayStep } from "./model";

export interface DNAOperation {
  position: string;
  program: string;
  kind: XRayStep["kind"];
  label: string;
  from: string;
  to: string;
  asset: string;
  decimals: number | null;
  amount: string | null;
  action: string;
  accounts: string[];
  data: string;
  state: "recorded" | "attempted" | "not-reached" | "unknown";
}
export interface TransactionDNA {
  version: 1;
  fingerprint: string;
  execution: XRayModel["execution"];
  programs: string[];
  operations: DNAOperation[];
  gaps: string[];
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown, max = 512): v is string =>
  typeof v === "string" && v.length <= max;
const optionalText = (v: unknown, max = 512) => v === undefined || text(v, max);

/** Fixed scope: ordered X-Ray operations + resolved program inventory + coverage.
 * Not a hash of raw transaction bytes, signatures, fees or net balances.
 * Accept unknown because saved local evidence is user-controlled.
 */
export function buildTransactionDNA(
  value: unknown,
): TransactionDNA | undefined {
  const model = object(value),
    insights = object(model.insights);
  if (
    typeof model.execution !== "string" ||
    !["succeeded", "failed", "unknown"].includes(String(model.execution)) ||
    !Array.isArray(model.steps) ||
    model.steps.length > 200 ||
    !Array.isArray(model.gaps) ||
    model.gaps.length > 500 ||
    !model.gaps.every((g) => text(g, 2000)) ||
    !Array.isArray(insights.programs) ||
    insights.programs.length > 256 ||
    !insights.programs.every((p) => text(p, 44)) ||
    !Array.isArray(insights.coverage) ||
    insights.coverage.length > 500 ||
    !insights.coverage.every((g) => text(g, 2000)) ||
    typeof insights.programsComplete !== "boolean"
  )
    return undefined;
  const execution = model.execution as XRayModel["execution"];
  const failure = object(model.failure);
  const failureIndex =
    Number.isSafeInteger(failure.instructionIndex) &&
    Number(failure.instructionIndex) >= 0
      ? Number(failure.instructionIndex)
      : undefined;
  const operations: DNAOperation[] = [];
  const positions = new Set<string>();
  for (const raw of model.steps) {
    const s = object(raw);
    if (
      !text(s.position, 100) ||
      !text(s.program, 44) ||
      typeof s.kind !== "string" ||
      !["money", "permission", "unknown"].includes(String(s.kind)) ||
      !text(s.label) ||
      !optionalText(s.from, 44) ||
      !optionalText(s.to, 44) ||
      !optionalText(s.asset, 44) ||
      !optionalText(s.permissionAction) ||
      !optionalText(s.instructionData, 20000) ||
      (s.amount !== undefined &&
        (!text(s.amount, 20) ||
          !/^\d+$/.test(s.amount) ||
          BigInt(s.amount) > (1n << 64n) - 1n)) ||
      (s.decimals !== undefined &&
        (!Number.isInteger(s.decimals) ||
          Number(s.decimals) < 0 ||
          Number(s.decimals) > 255)) ||
      (s.instructionIndex !== undefined &&
        (!Number.isSafeInteger(s.instructionIndex) ||
          Number(s.instructionIndex) < 0)) ||
      (s.accountAddresses !== undefined &&
        (!Array.isArray(s.accountAddresses) ||
          s.accountAddresses.length > 256 ||
          !s.accountAddresses.every((a) => text(a, 44))))
    )
      return undefined;
    if (positions.has(s.position)) return undefined;
    positions.add(s.position);
    const kind = s.kind as DNAOperation["kind"];
    operations.push({
      position: s.position,
      program: s.program,
      kind,
      label: s.label,
      from: typeof s.from === "string" ? s.from : "",
      to: typeof s.to === "string" ? s.to : "",
      asset: typeof s.asset === "string" ? s.asset : "",
      decimals: typeof s.decimals === "number" ? s.decimals : null,
      amount: typeof s.amount === "string" ? BigInt(s.amount).toString() : null,
      action: typeof s.permissionAction === "string" ? s.permissionAction : "",
      accounts: (s.accountAddresses ?? []) as string[],
      data:
        kind === "unknown" && typeof s.instructionData === "string"
          ? s.instructionData
          : "",
      state:
        execution === "unknown"
          ? "unknown"
          : execution === "succeeded"
            ? "recorded"
            : failureIndex !== undefined &&
                typeof s.instructionIndex === "number" &&
                s.instructionIndex > failureIndex
              ? "not-reached"
              : "attempted",
    });
  }
  const programs = [...new Set(insights.programs as string[])].sort();
  const gaps = [
    ...new Set([
      ...(model.gaps as string[]),
      ...(insights.coverage as string[]),
      ...(!insights.programsComplete
        ? ["Program inventory is incomplete."]
        : []),
      ...(execution === "unknown" ? ["Execution outcome is unknown."] : []),
      ...(!operations.length
        ? ["No recorded instruction steps available."]
        : []),
      ...(operations.some((op) => op.kind === "unknown")
        ? [
            "Undecoded operations retained as opaque instruction evidence; behavior is not established.",
          ]
        : []),
    ]),
  ].sort();
  const canonical = JSON.stringify({
    version: 1,
    execution,
    programs,
    operations: operations.map(
      ({ position: _position, label: _label, ...op }) => op,
    ),
    gaps,
  });
  return {
    version: 1,
    execution,
    programs,
    operations,
    gaps,
    fingerprint: bytesToHex(sha256(new TextEncoder().encode(canonical))),
  };
}

export function savedTransactionDNA(
  evidence: string,
): TransactionDNA | undefined {
  if (evidence.length > 2_000_000) return undefined;
  try {
    return buildTransactionDNA(
      object(object(JSON.parse(evidence)).review).xray,
    );
  } catch {
    return undefined;
  }
}
const identity = ({
  amount: _amount,
  state: _state,
  position: _position,
  label: _label,
  ...operation
}: DNAOperation) => JSON.stringify(operation);
export function compareTransactionDNA(
  baseline: TransactionDNA,
  current: TransactionDNA,
) {
  const remaining = [...baseline.operations];
  const added: DNAOperation[] = [],
    changed: { before: DNAOperation; after: DNAOperation }[] = [];
  const unmatched: DNAOperation[] = [];
  let matching = 0;
  for (const after of current.operations) {
    // Match exact duplicates first; consume each recorded occurrence only once.
    const index = remaining.findIndex(
      (before) =>
        identity(before) === identity(after) &&
        before.amount === after.amount &&
        before.state === after.state,
    );
    if (index >= 0) {
      remaining.splice(index, 1);
      matching++;
      continue;
    }
    unmatched.push(after);
  }
  for (const after of unmatched) {
    const index = remaining.findIndex(
      (before) => identity(before) === identity(after),
    );
    if (index < 0) added.push(after);
    else {
      const before = remaining.splice(index, 1)[0];
      if (before) changed.push({ before, after });
    }
  }
  return {
    matching,
    added,
    removed: remaining,
    changed,
    addedPrograms: current.programs.filter(
      (p) => !baseline.programs.includes(p),
    ),
    removedPrograms: baseline.programs.filter(
      (p) => !current.programs.includes(p),
    ),
    sequenceChanged:
      JSON.stringify(baseline.operations.map(identity)) !==
      JSON.stringify(current.operations.map(identity)),
    executionChanged: baseline.execution !== current.execution,
    sameFingerprint: baseline.fingerprint === current.fingerprint,
    coverageIncomplete: !!baseline.gaps.length || !!current.gaps.length,
  };
}

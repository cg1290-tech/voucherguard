import { base58 } from "@scure/base";
import { displayUnits, type TransactionInsights } from "./transaction-insights";
export interface TransactionRules {
  version: 1;
  maxFeeSol: string;
  flagDelegations: boolean;
  flagAuthorityChanges: boolean;
  restrictPrograms: boolean;
  allowedPrograms: string[];
}
export interface RuleCheck {
  name: string;
  status: "within-rule" | "flagged" | "incomplete";
  explanation: string;
}
export interface RuleReport {
  rules: TransactionRules;
  status: "within-rule" | "flagged" | "incomplete" | "not-configured";
  checks: RuleCheck[];
}
export const DEFAULT_RULES: TransactionRules = {
  version: 1,
  maxFeeSol: "",
  flagDelegations: true,
  flagAuthorityChanges: true,
  restrictPrograms: false,
  allowedPrograms: [],
};
const storageKey = (owner: string) =>
  `voucherguard:transaction-rules:v1:${owner}`;
export function feeLamports(text: string): bigint {
  if (!/^\d{1,11}(?:\.\d{1,9})?$/.test(text))
    throw Error("Use a SOL amount with a dot and up to 9 decimal places.");
  const [whole = "0", fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
  if (amount > (1n << 64n) - 1n) throw Error("Fee limit is too large.");
  return amount;
}
export function validateRules(value: unknown): TransactionRules {
  if (!value || typeof value !== "object")
    throw Error("Invalid transaction rules.");
  const r = value as Record<string, unknown>;
  if (
    r.version !== 1 ||
    typeof r.maxFeeSol !== "string" ||
    !["flagDelegations", "flagAuthorityChanges", "restrictPrograms"].every(
      (k) => typeof r[k] === "boolean",
    ) ||
    !Array.isArray(r.allowedPrograms) ||
    r.allowedPrograms.length > 64
  )
    throw Error("Invalid transaction rules.");
  const maxFeeSol = r.maxFeeSol.trim();
  if (maxFeeSol) feeLamports(maxFeeSol);
  const allowedPrograms: string[] = [];
  for (const p of r.allowedPrograms) {
    if (typeof p !== "string" || p.length > 44)
      throw Error("Use valid Solana program addresses.");
    try {
      if (base58.decode(p).length !== 32) throw Error();
    } catch {
      throw Error("Use valid Solana program addresses.");
    }
    if (!allowedPrograms.includes(p)) allowedPrograms.push(p);
  }
  if (r.restrictPrograms && !allowedPrograms.length)
    throw Error("Add a program or turn off the program list rule.");
  return {
    version: 1,
    maxFeeSol,
    flagDelegations: r.flagDelegations as boolean,
    flagAuthorityChanges: r.flagAuthorityChanges as boolean,
    restrictPrograms: r.restrictPrograms as boolean,
    allowedPrograms,
  };
}
export function loadRules(
  owner: string,
  storage: Pick<Storage, "getItem">,
): { rules: TransactionRules; saved: boolean; notice: string } {
  try {
    const raw = storage.getItem(storageKey(owner));
    if (!raw)
      return {
        rules: structuredClone(DEFAULT_RULES),
        saved: false,
        notice: "",
      };
    if (raw.length > 6000) throw Error();
    return { rules: validateRules(JSON.parse(raw)), saved: true, notice: "" };
  } catch {
    return {
      rules: structuredClone(DEFAULT_RULES),
      saved: false,
      notice:
        "Saved preferences could not be loaded. Default rules are active; review and save your preferences.",
    };
  }
}
export function saveRules(
  owner: string,
  rules: TransactionRules,
  storage: Pick<Storage, "setItem">,
) {
  storage.setItem(storageKey(owner), JSON.stringify(validateRules(rules)));
}
export function evaluateRules(
  insights: TransactionInsights,
  input: TransactionRules,
): RuleReport {
  const rules = validateRules(input);
  const checks: RuleCheck[] = [];
  if (rules.maxFeeSol) {
    const cap = feeLamports(rules.maxFeeSol);
    const fee = insights.feeLamports;
    const known = typeof fee === "string" && /^\d{1,20}$/.test(fee);
    checks.push({
      name: "Network fee",
      status: !known
        ? "incomplete"
        : BigInt(fee) > cap
          ? "flagged"
          : "within-rule",
      explanation: known
        ? `Recorded fee ${displayUnits(fee, 9)} SOL; your limit ${rules.maxFeeSol} SOL. This is the transaction's network fee, not total spending.`
        : "The recorded fee is missing or could not be represented exactly.",
    });
  }
  for (const [enabled, action, name] of [
    [rules.flagDelegations, "Spending delegation", "Spending delegations"],
    [rules.flagAuthorityChanges, "Authority change", "Authority changes"],
  ] as const) {
    if (!enabled) continue;
    const events = insights.permissionEvents.filter((e) => e.action === action);
    checks.push({
      name,
      status: events.length
        ? "flagged"
        : insights.permissionsComplete
          ? "within-rule"
          : "incomplete",
      explanation: events.length
        ? events
            .map(
              (e) =>
                `${e.position}: ${e.details} ${e.applied ? "Recorded in successful execution." : "Attempted only; execution failed."}`,
            )
            .join("\n")
        : insights.permissionsComplete
          ? "No matching operation decoded in the selected SPL Token / Token-2022 inspection scope. Other program behavior and current permissions are not checked."
          : "Instruction coverage is incomplete or unsupported token instructions were encountered. Absence of a decoded operation does not establish compliance.",
    });
  }
  if (rules.restrictPrograms) {
    const other = insights.programs.filter(
      (p) => !rules.allowedPrograms.includes(p),
    );
    checks.push({
      name: "Allowed programs",
      status: other.length
        ? "flagged"
        : insights.programsComplete
          ? "within-rule"
          : "incomplete",
      explanation: other.length
        ? `Referenced programs outside your saved list: ${other.join(", ")}. This is a list mismatch, not a reputation assessment.${insights.programsComplete ? "" : " Program coverage is also incomplete."}`
        : insights.programsComplete
          ? "All resolved top-level and recorded inner-instruction programs are in your saved list. This does not audit those programs."
          : "Program references or the inner-instruction trace are missing; the complete list could not be checked.",
    });
  }
  return {
    rules: structuredClone(rules),
    checks,
    status: checks.some((c) => c.status === "flagged")
      ? "flagged"
      : checks.some((c) => c.status === "incomplete")
        ? "incomplete"
        : checks.length
          ? "within-rule"
          : "not-configured",
  };
}

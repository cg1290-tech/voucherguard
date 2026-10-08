import {
  type Encoding,
  type PolicyDocument,
  parsePolicyDocument,
} from "@voucherguard/core";

export interface PolicyDraft {
  maxCumulativeAmount: string;
  maxIncrease: string;
  rejectNonExpiring: boolean;
  minRemainingSeconds: string;
  maxRemainingSeconds: string;
  requireState: boolean;
  expectedChannelId: string;
  channelEncoding: Encoding;
}
export const STANDARD_POLICY: PolicyDraft = {
  maxCumulativeAmount: "",
  maxIncrease: "",
  rejectNonExpiring: true,
  minRemainingSeconds: "",
  maxRemainingSeconds: "",
  requireState: true,
  expectedChannelId: "",
  channelEncoding: "hex",
};
export const CONSERVATIVE_POLICY: PolicyDraft = {
  ...STANDARD_POLICY,
  maxCumulativeAmount: "1000000",
  maxIncrease: "100000",
  minRemainingSeconds: "30",
  maxRemainingSeconds: "300",
};
export function buildPolicy(draft: PolicyDraft): PolicyDocument {
  const policy: PolicyDocument = {
    rejectNonExpiring: draft.rejectNonExpiring,
    requireState: draft.requireState,
  };
  for (const key of [
    "maxCumulativeAmount",
    "maxIncrease",
    "minRemainingSeconds",
    "maxRemainingSeconds",
  ] as const) {
    if (draft[key].trim()) policy[key] = draft[key].trim();
  }
  if (draft.expectedChannelId.trim())
    policy.expectedChannelId = {
      encoding: draft.channelEncoding,
      value: draft.expectedChannelId.trim(),
    };
  parsePolicyDocument(policy);
  return policy;
}
export function applyPolicyToDocument(
  payload: string,
  policy: PolicyDocument,
): string {
  parsePolicyDocument(policy);
  if (payload.length > 65536)
    throw new Error("Voucher document exceeds 64 KiB.");
  let doc: unknown;
  try {
    doc = JSON.parse(payload);
  } catch {
    throw new Error(
      "Paste valid voucher JSON into the playground before applying a policy.",
    );
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    throw new Error("The playground voucher must be a JSON object.");
  return JSON.stringify({ ...doc, policy }, null, 2);
}

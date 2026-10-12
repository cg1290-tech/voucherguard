import {
  type PolicyDocument,
  parsePolicyDocument,
  parseVoucherDocument,
  type Report,
  serializeReport,
  verifyVoucher,
} from "@voucherguard/core";
import { type PolicyDraft, STANDARD_POLICY } from "./policy";

export function draftFromPolicy(value: unknown): PolicyDraft {
  parsePolicyDocument(value);
  const p = value as PolicyDocument;
  return {
    ...STANDARD_POLICY,
    maxCumulativeAmount: p.maxCumulativeAmount ?? "",
    maxIncrease: p.maxIncrease ?? "",
    minRemainingSeconds: p.minRemainingSeconds ?? "",
    maxRemainingSeconds: p.maxRemainingSeconds ?? "",
    rejectNonExpiring: p.rejectNonExpiring ?? false,
    requireState: p.requireState ?? true,
    expectedChannelId: p.expectedChannelId?.value ?? "",
    channelEncoding: p.expectedChannelId?.encoding ?? "hex",
  };
}
export interface BatchItem {
  name: string;
  document: unknown;
}
export interface BatchResult {
  id: string;
  name: string;
  report?: Report;
  error?: string;
}
export function parseBatch(
  text: string,
  name = "Imported voucher",
): BatchItem[] {
  if (new TextEncoder().encode(text).length > 1024 * 1024)
    throw Error("Import is limited to 1 MiB.");
  const value: unknown = JSON.parse(text);
  const docs = Array.isArray(value) ? value : [value];
  if (!docs.length || docs.length > 100)
    throw Error("Choose between 1 and 100 vouchers.");
  return docs.map((document, i) => ({
    name: docs.length === 1 ? name : `${name} ${i + 1}`,
    document,
  }));
}
export async function runBatch(
  items: BatchItem[],
  policy: PolicyDocument,
): Promise<BatchResult[]> {
  parsePolicyDocument(policy);
  if (items.length > 100) throw Error("Maximum 100 vouchers per run.");
  const results: BatchResult[] = [];
  for (const item of items) {
    try {
      // Validate the original before replacing policy. Imported identity/state remain assertions.
      const input = parseVoucherDocument(item.document);
      input.policy = parsePolicyDocument(policy);
      results.push({
        id: crypto.randomUUID(),
        name: item.name,
        report: await verifyVoucher(input),
      });
    } catch (e) {
      results.push({
        id: crypto.randomUUID(),
        name: item.name,
        error: e instanceof Error ? e.message : "Invalid voucher",
      });
    }
  }
  return results;
}
export function exportBatch(
  results: BatchResult[],
  policy: PolicyDocument,
): string {
  return serializeReport({
    version: 1,
    exportedAt: new Date().toISOString(),
    policy,
    limitations: [
      "Independent signer, channel and state authentication is required. PASS is not a settlement guarantee.",
      "Batch results do not detect concurrent replay or enforce sequential channel watermarks.",
    ],
    results,
  });
}
export interface SavedPolicy {
  id: string;
  name: string;
  revision: number;
  savedAt: string;
  policy: PolicyDocument;
}
export function readLibrary(raw: string | null): SavedPolicy[] {
  if (!raw) return [];
  if (raw.length > 1024 * 1024) throw Error("Saved library is too large.");
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list) || list.length > 100)
    throw Error("Invalid saved library.");
  return list.map((entry: unknown) => {
    if (!entry || typeof entry !== "object")
      throw Error("Invalid saved policy.");
    const p = entry as SavedPolicy;
    if (
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      p.name.length > 80 ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 1 ||
      typeof p.savedAt !== "string"
    )
      throw Error("Invalid saved policy.");
    parsePolicyDocument(p.policy);
    return p;
  });
}

export function tokenBaseUnits(amount: string, decimals: string): string {
  if (!/^(0|[1-9][0-9]?)$/.test(decimals) || Number(decimals) > 18)
    throw Error("Use 0–18 token decimals.");
  if (!/^(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$/.test(amount))
    throw Error("Enter a positive decimal amount without commas.");
  const [whole = "0", fraction = ""] = amount.split(".");
  const precision = Number(decimals);
  if (fraction.length > precision)
    throw Error("Amount has more precision than the payment token supports.");
  const units =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0") || "0");
  if (units <= 0n || units > (1n << 64n) - 1n)
    throw Error("Amount must fit a positive u64 token amount.");
  return units.toString();
}

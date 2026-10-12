import { serializeReport } from "@voucherguard/core";
import { displayUnits } from "./transaction-insights";
import type { TransactionReview } from "./transaction-review";
export interface LocalReport {
  id: string;
  savedAt: string;
  signature: string;
  execution: string;
  voucher: string;
  policy: string;
  fee: string;
  operations: string[];
  balances: string[];
  coverage: string[];
  evidence: string;
}
export const HISTORY_LIMIT = 20;
const MAX_STORAGE = 2_000_000;
const key = (owner: string) => `voucherguard:local-reports:v1:${owner}`;
export function snapshot(review: TransactionReview): LocalReport {
  const savedAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    savedAt,
    signature: review.signature,
    execution: review.insights.success ? "Succeeded" : "Failed",
    voucher:
      review.result.kind === "historical"
        ? review.result.voucherReport.status
        : "Outside supported scope",
    policy: review.policyReport?.status ?? "Not checked",
    fee:
      review.insights.feeLamports === undefined
        ? "Unavailable"
        : `${displayUnits(review.insights.feeLamports, 9)} SOL`,
    operations: review.insights.permissionEvents.map(
      (e) =>
        `${e.action} (${e.applied ? "applied" : "attempted"}) · ${e.account} · ${e.details}`,
    ),
    balances: review.insights.balanceChanges.map(
      (c) =>
        `${c.account} · ${c.asset} · ${displayUnits(c.change, c.decimals)}`,
    ),
    coverage: [...review.insights.coverage, ...review.insights.warnings],
    evidence: serializeReport({ version: 1, savedAt, review }),
  };
}
function valid(v: unknown): v is LocalReport {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    [
      "id",
      "savedAt",
      "signature",
      "execution",
      "voucher",
      "policy",
      "fee",
      "evidence",
    ].every((k) => typeof r[k] === "string") &&
    typeof r.signature === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(r.signature) &&
    typeof r.savedAt === "string" &&
    Number.isFinite(Date.parse(r.savedAt)) &&
    ["operations", "balances", "coverage"].every(
      (k) =>
        Array.isArray(r[k]) &&
        (r[k] as unknown[]).every((x) => typeof x === "string"),
    )
  );
}
export function readHistory(
  owner: string,
  storage: Pick<Storage, "getItem">,
): LocalReport[] {
  try {
    const text = storage.getItem(key(owner));
    if (!text || text.length > MAX_STORAGE) return [];
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter(valid).slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function writeHistory(
  owner: string,
  reports: LocalReport[],
  storage: Pick<Storage, "setItem">,
): void {
  const text = JSON.stringify(reports.slice(0, HISTORY_LIMIT));
  if (text.length > MAX_STORAGE)
    throw Error(
      "Local history is full. Delete older reports before saving this review.",
    );
  storage.setItem(key(owner), text);
}
export function comparison(a: LocalReport, b: LocalReport) {
  return [
    ["Transaction", a.signature, b.signature],
    ["Execution", a.execution, b.execution],
    ["Voucher proof", a.voucher, b.voucher],
    ["Custom policy result", a.policy, b.policy],
    ["Network fee", a.fee, b.fee],
    [
      "Net account balance changes",
      a.balances.join("\n") || "None available",
      b.balances.join("\n") || "None available",
    ],
    [
      "Decoded operations",
      a.operations.join("\n") || "None decoded",
      b.operations.join("\n") || "None decoded",
    ],
    [
      "Coverage & warnings",
      a.coverage.join("\n") || "See full evidence",
      b.coverage.join("\n") || "See full evidence",
    ],
  ];
}
export function downloadLocal(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Plain canvas text. No external assets, uploads or RPC calls. */
export async function downloadCard(report: LocalReport) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Image export unavailable.");
  ctx.fillStyle = "#101811";
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#c5f879";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText("VoucherGuard Pro", 64, 86);
  ctx.fillStyle = "#ffffff";
  ctx.font = "28px sans-serif";
  [
    "HISTORICAL TRANSACTION REVIEW",
    `Report saved: ${report.savedAt}`,
    `Execution: ${report.execution}`,
    `Voucher proof: ${report.voucher}`,
    `Custom policy: ${report.policy}`,
    `Network fee: ${report.fee}`,
    `Decoded account operations: ${report.operations.length}`,
    `Coverage notes / warnings: ${report.coverage.length}`,
  ].forEach((line, i) => {
    ctx.fillText(line, 64, 150 + i * 55, 1072);
  });
  ctx.font = "20px monospace";
  ctx.fillText("solscan.io/tx/", 64, 620);
  for (let i = 0; i < report.signature.length; i += 64)
    ctx.fillText(
      report.signature.slice(i, i + 64),
      64,
      655 + Math.floor(i / 64) * 30,
    );
  ctx.fillStyle = "#c5f879";
  ctx.font = "24px sans-serif";
  ctx.fillText(
    "Historical evidence only. Not a safety certification.",
    64,
    765,
  );
  ctx.fillStyle = "#dddddd";
  ctx.font = "21px sans-serif";
  ctx.fillText(
    "No live permission check. None decoded does not mean no risk.",
    64,
    807,
  );
  ctx.fillText(
    "voucherguard.pages.dev/#pro · Read the full saved JSON evidence.",
    64,
    849,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw Error("Image export failed.");
  downloadLocal(blob, "voucherguard-review-card.png");
}

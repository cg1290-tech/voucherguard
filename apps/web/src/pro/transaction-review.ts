import {
  decodeBytes,
  type PolicyDocument,
  parsePolicyDocument,
  type Report,
  verifyVoucher,
} from "@voucherguard/core";
import {
  fetchTransaction,
  historicalVerifyTransaction,
  parseTransactionInput,
  type QuickExtractResult,
} from "../quick/extract";

export interface TransactionReview {
  signature: string;
  result: QuickExtractResult;
  policy?: PolicyDocument;
  policyReport?: Report;
  policyNotice?: string;
}
export function transactionLinks(text: string): string[] {
  if (text.length > 12000) throw Error("Paste up to 20 transaction links.");
  const lines = text.split(/\s+/).filter(Boolean);
  if (!lines.length || lines.length > 20)
    throw Error("Paste between 1 and 20 transaction links, one per line.");
  return [...new Set(lines.map(parseTransactionInput))];
}
export async function reviewTransaction(
  signature: string,
  rpc: string,
  policy?: PolicyDocument,
  fetcher: typeof fetch = fetch,
): Promise<TransactionReview> {
  const tx = await fetchTransaction(signature, rpc, fetcher);
  if (
    !tx.meta ||
    !("err" in tx.meta) ||
    !Number.isSafeInteger(tx.slot) ||
    tx.slot < 0
  )
    throw Error("Transaction execution metadata is unavailable.");
  if (
    tx.blockTime != null &&
    (!Number.isSafeInteger(tx.blockTime) || tx.blockTime < 0)
  )
    throw Error("Invalid transaction block time.");
  const result = await historicalVerifyTransaction(signature, tx);
  if (result.kind === "historical" && result.blockTime === null) {
    if (result.voucherReport.status === "PASS")
      result.voucherReport.status = "INDETERMINATE";
    result.voucherReport.checks.push({
      code: "TIME_WINDOW",
      status: "INDETERMINATE",
      category: "context",
      explanation:
        "Transaction block time is unavailable; historical expiry cannot be established. Other time checks use the current clock.",
    });
    result.notice +=
      " Block time unavailable: historical expiry is not established.";
  }
  const review: TransactionReview = { signature, result };
  if (!policy || result.kind !== "historical") return review;
  review.policy = structuredClone(policy);
  if (result.blockTime === null) {
    review.policyNotice =
      "Historical policy checks unavailable: this RPC did not return a block time.";
    return review;
  }
  const evidence = result.voucherReport.evidence;
  if (!evidence?.messageHex || !evidence.signatureHex)
    throw Error("Extracted evidence unavailable.");
  review.policyReport = await verifyVoucher({
    message: decodeBytes(evidence.messageHex, "hex", 50),
    signature: decodeBytes(evidence.signatureHex, "hex", 64),
    authorizedSigner: decodeBytes(result.authorizedSigner, "base58", 32),
    policy: parsePolicyDocument(policy),
    now: BigInt(result.blockTime),
  });
  review.policyNotice =
    "Policy checked at the transaction block time. No independent signer authentication or trusted channel state was supplied by the link. Missing context remains INDETERMINATE; extracted channel data is not promoted to a trusted policy.";
  return review;
}

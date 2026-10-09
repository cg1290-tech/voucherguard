import { base58 } from "@scure/base";
import {
  decodeVoucher,
  encodeBytes,
  type Report,
  verifyVoucher,
} from "@voucherguard/core";

/** Solana Foundation payment-channels program (mainnet). */
export const PAYMENT_CHANNELS_PROGRAM =
  "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
export const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";
const SETTLE = 2;
const SETTLE_AND_SEAL = 4;

export type SettlementKind = "settle" | "settle_and_seal";

export interface ExtractedVoucher {
  message: Uint8Array;
  signature: Uint8Array;
  authorizedSigner: Uint8Array;
  channelId: string;
  cumulativeAmount: string;
  expiresAt: string;
}

export interface HistoricalTxReport {
  kind: "historical";
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  settlement: SettlementKind;
  channelId: string;
  authorizedSigner: string;
  cumulativeAmount: string;
  expiresAt: string;
  /** Crypto + format checks only; state/watermark intentionally excluded. */
  voucherReport: Report;
  notice: string;
}

export type QuickExtractResult =
  | HistoricalTxReport
  | { kind: "unsupported"; signature: string; message: string }
  | { kind: "not-found"; signature: string; message: string };

/** Accept a Solscan/Explorer URL or a raw base58 transaction signature. */
export function parseTransactionInput(raw: string): string {
  const text = raw.trim();
  if (!text)
    throw new Error("Paste a Solscan URL or Solana transaction signature.");
  const fromUrl = text.match(
    /(?:solscan\.io|explorer\.solana\.com|solana\.fm)\/tx\/([1-9A-HJ-NP-Za-km-z]{64,100})/i,
  );
  const candidate = fromUrl?.[1] ?? text;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(candidate))
    throw new Error("Unrecognized Solana transaction signature.");
  const bytes = base58.decode(candidate);
  if (bytes.length !== 64)
    throw new Error("Transaction signature must decode to 64 bytes.");
  if (base58.encode(bytes) !== candidate)
    throw new Error("Non-canonical transaction signature encoding.");
  return candidate;
}

function keyStr(k: unknown): string {
  return typeof k === "string" ? k : (k as { pubkey: string }).pubkey;
}

/** Parse a single-signature Ed25519 precompile instruction (in-ix offsets). */
export function parseEd25519Instruction(data: Uint8Array): {
  signature: Uint8Array;
  publicKey: Uint8Array;
  message: Uint8Array;
} {
  if (data.length < 16) throw new Error("Ed25519 instruction data too short.");
  if (data[0] !== 1)
    throw new Error(
      "Only single-signature Ed25519 instructions are supported.",
    );
  const sigOff = data[2]! | (data[3]! << 8);
  const sigIx = data[4]! | (data[5]! << 8);
  const pkOff = data[6]! | (data[7]! << 8);
  const pkIx = data[8]! | (data[9]! << 8);
  const msgOff = data[10]! | (data[11]! << 8);
  const msgLen = data[12]! | (data[13]! << 8);
  const msgIx = data[14]! | (data[15]! << 8);
  if (sigIx !== 0xffff || pkIx !== 0xffff || msgIx !== 0xffff)
    throw new Error(
      "Ed25519 instruction must embed signature, key and message.",
    );
  if (
    sigOff + 64 > data.length ||
    pkOff + 32 > data.length ||
    msgOff + msgLen > data.length
  )
    throw new Error("Ed25519 instruction offsets are out of range.");
  return {
    signature: data.slice(sigOff, sigOff + 64),
    publicKey: data.slice(pkOff, pkOff + 32),
    message: data.slice(msgOff, msgOff + msgLen),
  };
}

type WireIx = { programIdIndex: number; data: string; accounts: number[] };
type WireTx = {
  slot: number;
  blockTime?: number | null;
  meta?: { err: unknown } | null;
  transaction: {
    message: {
      accountKeys: unknown[];
      instructions: WireIx[];
    };
  };
};

export function extractPaymentChannelVoucher(tx: WireTx):
  | {
      settlement: SettlementKind;
      channelId: string;
      extracted: ExtractedVoucher;
    }
  | { unsupported: string } {
  const keys = tx.transaction.message.accountKeys.map(keyStr);
  const ixs = tx.transaction.message.instructions;
  for (let i = 0; i < ixs.length; i++) {
    const ix = ixs[i]!;
    const pid = keys[ix.programIdIndex]!;
    if (pid !== PAYMENT_CHANNELS_PROGRAM) continue;
    const raw = base58.decode(ix.data || "");
    if (raw.length < 1) continue;
    const disc = raw[0]!;
    let settlement: SettlementKind | null = null;
    if (disc === SETTLE && raw.length === 1) settlement = "settle";
    else if (disc === SETTLE_AND_SEAL && raw.length >= 1)
      settlement = "settle_and_seal";
    if (!settlement) continue;
    // Canonical pattern: Ed25519 precompile immediately before settle*.
    if (i === 0) continue;
    const prev = ixs[i - 1]!;
    if (keys[prev.programIdIndex] !== ED25519_PROGRAM) continue;
    const ed = parseEd25519Instruction(base58.decode(prev.data || ""));
    const voucher = decodeVoucher(ed.message);
    const channelId = encodeBytes(voucher.channelId, "base58");
    const settleChannel = keys[ix.accounts[0]!];
    if (settleChannel && settleChannel !== channelId)
      return {
        unsupported:
          "Settlement channel account does not match the signed voucher channel.",
      };
    if (settlement === "settle_and_seal" && raw.length >= 2 && raw[1] === 0)
      return {
        unsupported:
          "This settle_and_seal transaction locked an existing watermark without a new voucher.",
      };
    return {
      settlement,
      channelId,
      extracted: {
        message: ed.message,
        signature: ed.signature,
        authorizedSigner: ed.publicKey,
        channelId,
        cumulativeAmount: voucher.cumulativeAmount.toString(),
        expiresAt: voucher.expiresAt.toString(),
      },
    };
  }
  return {
    unsupported:
      "No supported Solana Payment Channels V1 settlement voucher was found in this transaction.",
  };
}

export async function historicalVerifyTransaction(
  signature: string,
  tx: WireTx,
): Promise<QuickExtractResult> {
  const extracted = extractPaymentChannelVoucher(tx);
  if ("unsupported" in extracted)
    return {
      kind: "unsupported",
      signature,
      message: extracted.unsupported,
    };
  const now = BigInt(tx.blockTime ?? Math.floor(Date.now() / 1000));
  const voucherReport = await verifyVoucher({
    message: extracted.extracted.message,
    signature: extracted.extracted.signature,
    authorizedSigner: extracted.extracted.authorizedSigner,
    policy: {
      expectedChannelId: extracted.extracted.message.slice(2, 34),
      requireState: false,
    },
    now,
  });
  return {
    kind: "historical",
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    success: !tx.meta?.err,
    settlement: extracted.settlement,
    channelId: extracted.channelId,
    authorizedSigner: encodeBytes(
      extracted.extracted.authorizedSigner,
      "base58",
    ),
    cumulativeAmount: extracted.extracted.cumulativeAmount,
    expiresAt: extracted.extracted.expiresAt,
    voucherReport,
    notice:
      "Historical verification of transaction evidence. This does not certify current spendability or replay safety of the voucher.",
  };
}

export async function fetchTransaction(
  signature: string,
  rpcUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<WireTx> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`RPC unavailable (${response.status}).`);
  const body = (await response.json()) as {
    result?: WireTx | null;
    error?: { message?: string };
  };
  if (body.error?.message) throw new Error(body.error.message);
  if (!body.result)
    throw new Error(
      "Transaction not found on this RPC (too old, wrong network, or not indexed).",
    );
  return body.result;
}

export async function quickCheckTransaction(
  input: string,
  rpcUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<QuickExtractResult> {
  let signature: string;
  try {
    signature = parseTransactionInput(input);
  } catch (e) {
    return {
      kind: "not-found",
      signature: "",
      message: e instanceof Error ? e.message : "Invalid input",
    };
  }
  try {
    const tx = await fetchTransaction(signature, rpcUrl, fetcher);
    return historicalVerifyTransaction(signature, tx);
  } catch (e) {
    return {
      kind: "not-found",
      signature,
      message: e instanceof Error ? e.message : "RPC request failed",
    };
  }
}

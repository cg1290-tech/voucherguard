import { encodeBytes, U64_MAX } from "@voucherguard/core";
import type { WalletAccount } from "@wallet-standard/base";
import {
  MAINNET_CHAIN,
  MAINNET_GENESIS,
  type ProConfig,
  publicKey,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  thresholdUnits,
  validateConfig,
} from "./config";

export type AccessStatus =
  | "not-configured"
  | "disconnected"
  | "checking"
  | "eligible"
  | "ineligible"
  | "unsupported-network"
  | "rpc-error";
export interface AccessResult {
  status: AccessStatus;
  message: string;
  balance?: bigint;
  required?: bigint;
  decimals?: number;
  slot?: number;
}
export interface HoldingSnapshot {
  balance: bigint;
  decimals: number;
  slot: number;
}
export interface OwnershipReader {
  read(
    config: ProConfig,
    owner: string,
    signal: AbortSignal,
  ): Promise<HoldingSnapshot>;
}
export class NetworkError extends Error {}
export const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
export const MAX_TOKEN_ACCOUNTS = 1024;

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("Content-Length");
  if (declared && Number(declared) > MAX_RPC_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("RPC response exceeds the size limit.");
  }
  if (!response.body) throw new Error("RPC response body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RPC_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("RPC response exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Unavailable or malformed ${label}.`);
  return value as Record<string, unknown>;
}
function rawAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    throw new Error("RPC token amount is not an exact integer string.");
  const amount = BigInt(value);
  if (amount > U64_MAX) throw new Error("RPC token amount exceeds u64.");
  return amount;
}
function slot(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("RPC context slot is invalid.");
  return value;
}
function mintInfo(result: unknown): {
  decimals: number;
  program: string;
  slot: number;
} {
  const r = record(result, "mint response");
  const context = record(r.context, "mint context");
  const a = record(r.value, "mint account");
  if (
    a.executable !== false ||
    ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(String(a.owner))
  )
    throw new Error(
      "Configured mint is not owned by a supported SPL Token program.",
    );
  const parsed = record(record(a.data, "mint data").parsed, "parsed mint");
  const info = record(parsed.info, "mint information");
  if (
    parsed.type !== "mint" ||
    info.isInitialized !== true ||
    typeof info.decimals !== "number" ||
    !Number.isInteger(info.decimals) ||
    info.decimals < 0 ||
    info.decimals > 255
  )
    throw new Error(
      "Configured account is not an initialized token mint with valid decimals.",
    );
  return {
    decimals: info.decimals,
    program: String(a.owner),
    slot: slot(context.slot),
  };
}
export function aggregateTokenAccounts(
  result: unknown,
  owner: string,
  mint: string,
  program: string,
  decimals: number,
  minimumSlot: number,
): HoldingSnapshot {
  const r = record(result, "token accounts response");
  const observedSlot = slot(record(r.context, "token accounts context").slot);
  if (observedSlot < minimumSlot || !Array.isArray(r.value))
    throw new Error(
      "Token account data is unavailable or older than the mint snapshot.",
    );
  if (r.value.length > MAX_TOKEN_ACCOUNTS)
    throw new Error("RPC returned too many token accounts.");
  const seen = new Set<string>();
  let balance = 0n;
  for (const value of r.value) {
    const entry = record(value, "token account entry");
    const address = publicKey(entry.pubkey);
    if (seen.has(address))
      throw new Error("RPC returned duplicate token accounts.");
    seen.add(address);
    const a = record(entry.account, "token account");
    const parsed = record(
      record(a.data, "token data").parsed,
      "parsed token account",
    );
    const info = record(parsed.info, "token account information");
    if (
      a.executable !== false ||
      a.owner !== program ||
      parsed.type !== "account" ||
      info.owner !== owner ||
      info.mint !== mint ||
      !["initialized", "frozen"].includes(String(info.state))
    )
      throw new Error(
        "RPC token account does not match the connected owner, configured mint or token program.",
      );
    const tokenAmount = record(info.tokenAmount, "token amount");
    if (tokenAmount.decimals !== decimals)
      throw new Error("Token account decimals disagree with the mint.");
    balance += rawAmount(tokenAmount.amount);
    if (balance > U64_MAX)
      throw new Error(
        "Aggregated token holdings exceed the token supply integer range.",
      );
  }
  return { balance, decimals, slot: observedSlot };
}
/** Only these three read-only RPC methods exist; no signing or transaction API. */
export class SolanaOwnershipReader implements OwnershipReader {
  private nextId = 0;
  constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 8000,
  ) {}
  private async rpc(
    config: ProConfig,
    method: "getGenesisHash" | "getAccountInfo" | "getTokenAccountsByOwner",
    params: unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const id = ++this.nextId;
    try {
      const response = await this.fetcher(config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          `RPC request failed (${response.status}). Refresh to retry.`,
        );
      const doc = record(await boundedJson(response), "JSON-RPC response");
      if (
        doc.jsonrpc !== "2.0" ||
        doc.id !== id ||
        doc.error !== undefined ||
        !("result" in doc)
      )
        throw new Error(
          "RPC returned an error or an invalid response. Refresh to retry.",
        );
      return doc.result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
  async read(
    config: ProConfig,
    owner: string,
    signal: AbortSignal,
  ): Promise<HoldingSnapshot> {
    publicKey(owner);
    const genesis = await this.rpc(config, "getGenesisHash", [], signal);
    if (genesis !== MAINNET_GENESIS)
      throw new NetworkError("The configured RPC is not Solana mainnet-beta.");
    const mint = mintInfo(
      await this.rpc(
        config,
        "getAccountInfo",
        [config.mint, { encoding: "jsonParsed", commitment: "confirmed" }],
        signal,
      ),
    );
    const accounts = await this.rpc(
      config,
      "getTokenAccountsByOwner",
      [
        owner,
        { mint: config.mint },
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          minContextSlot: mint.slot,
        },
      ],
      signal,
    );
    return aggregateTokenAccounts(
      accounts,
      owner,
      config.mint,
      mint.program,
      mint.decimals,
      mint.slot,
    );
  }
}
export function accountOnMainnet(account: WalletAccount): boolean {
  return (
    Array.isArray(account.chains) &&
    account.chains.includes(MAINNET_CHAIN) &&
    account.publicKey instanceof Uint8Array &&
    account.publicKey.length === 32 &&
    encodeBytes(account.publicKey, "base58") === account.address
  );
}
export async function checkEligibility(
  config: ProConfig,
  account: WalletAccount | null,
  reader: OwnershipReader,
  signal: AbortSignal,
): Promise<AccessResult> {
  const setup = validateConfig(config);
  if (setup.status !== "ready") return setup;
  if (!account)
    return {
      status: "disconnected",
      message: "Connect a Solana wallet to check token access.",
    };
  if (!accountOnMainnet(account))
    return {
      status: "unsupported-network",
      message: "Choose a wallet account authorized for Solana mainnet-beta.",
    };
  try {
    const snapshot = await reader.read(config, account.address, signal);
    if (signal.aborted) throw new Error("Access check was canceled.");
    slot(snapshot.slot);
    // Validate injected adapters too; they are never trusted merely for returning eligible.
    if (
      typeof snapshot.balance !== "bigint" ||
      snapshot.balance < 0n ||
      snapshot.balance > U64_MAX ||
      !Number.isInteger(snapshot.decimals) ||
      snapshot.decimals < 0 ||
      snapshot.decimals > 255
    )
      throw new Error("Holding snapshot is invalid.");
    const required = thresholdUnits(config.threshold, snapshot.decimals);
    const eligible = snapshot.balance >= required;
    return {
      status: eligible ? "eligible" : "ineligible",
      message: eligible
        ? "Holder threshold met. Pro tools are available."
        : "This wallet does not meet the configured holder threshold.",
      balance: snapshot.balance,
      required,
      decimals: snapshot.decimals,
      slot: snapshot.slot,
    };
  } catch (e) {
    return {
      status: e instanceof NetworkError ? "unsupported-network" : "rpc-error",
      message:
        e instanceof NetworkError
          ? e.message
          : "Could not verify token holdings. Access remains locked. Check the RPC configuration and refresh to retry.",
    };
  }
}

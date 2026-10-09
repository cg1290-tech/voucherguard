import { decodeBytes } from "@voucherguard/core";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const MAINNET_CHAIN = "solana:mainnet";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export interface ProConfig {
  mint: string;
  rpcUrl: string;
  threshold: string;
  network: string;
}
export type ConfigCheck =
  | { status: "ready"; config: ProConfig }
  | {
      status: "not-configured" | "unsupported-network" | "rpc-error";
      message: string;
    };
export function publicKey(address: unknown): string {
  if (typeof address !== "string")
    throw new Error("Expected a base58 public key.");
  decodeBytes(address, "base58", 32);
  return address;
}
export function validateConfig(config: ProConfig): ConfigCheck {
  if (!config.mint.trim())
    return {
      status: "not-configured",
      message:
        "Token access coming soon. The official $VG mint has not been configured.",
    };
  if (config.network !== "mainnet-beta")
    return {
      status: "unsupported-network",
      message: "Pro token access supports Solana mainnet-beta only.",
    };
  try {
    publicKey(config.mint);
    if (
      !/^(0|[1-9][0-9]{0,19})(\.[0-9]{1,255})?$/.test(config.threshold) ||
      !/[1-9]/.test(config.threshold)
    )
      throw new Error(
        "Holder threshold must be a positive decimal token amount.",
      );
    const url = new URL(config.rpcUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error(
        "Use a public HTTPS RPC endpoint without embedded credentials.",
      );
    return { status: "ready", config };
  } catch (e) {
    return {
      status: "rpc-error",
      message: `Token access configuration is invalid: ${e instanceof Error ? e.message : "invalid value"}`,
    };
  }
}
/** Decimal strings to raw units, never float/UI amount. */
export function thresholdUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error("Mint decimals are invalid.");
  if (!/^(0|[1-9][0-9]{0,19})(\.[0-9]{1,255})?$/.test(amount))
    throw new Error("Invalid holder threshold.");
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals)))
    throw new Error(
      "Holder threshold has more precision than the mint supports.",
    );
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  if (result <= 0n) throw new Error("Holder threshold must be positive.");
  return result;
}
export function formatTokenUnits(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  if (!decimals) return s;
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return s.slice(0, -decimals) + (frac ? `.${frac}` : "");
}
export function loadProConfig(): ProConfig {
  return {
    mint: import.meta.env.VITE_VG_TOKEN_MINT?.trim() || "",
    rpcUrl:
      import.meta.env.VITE_VG_RPC_URL?.trim() ||
      "https://voucherguard.pages.dev/api/solana-rpc",
    threshold: import.meta.env.VITE_VG_HOLDER_THRESHOLD?.trim() || "1",
    network: import.meta.env.VITE_VG_NETWORK?.trim() || "mainnet-beta",
  };
}

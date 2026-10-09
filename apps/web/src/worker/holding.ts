import { decodeBase58 } from "./base58";
import {
  boundedBytes,
  isObj,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  upstreamsForMethod,
  type WorkerEnv,
} from "./shared";

const MAX_RESPONSE = 1024 * 1024;

function thresholdUnits(amount: string, decimals: number): bigint {
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

async function rpc(
  method: string,
  params: unknown[],
  env: WorkerEnv,
  fetcher: typeof fetch,
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  for (const upstream of upstreamsForMethod(method, env)) {
    let response: Response;
    try {
      response = await fetcher(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "VoucherGuard/0.1 Pro gate",
        },
        body,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "manual",
      });
    } catch {
      continue;
    }
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400) ||
      !response.ok
    ) {
      await response.body?.cancel();
      continue;
    }
    try {
      const bytes = await boundedBytes(response.body, MAX_RESPONSE);
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (isObj(parsed) && "result" in parsed) return parsed.result;
    } catch {}
  }
  throw new Error("RPC unavailable");
}

export async function verifyHolding(
  owner: string,
  env: WorkerEnv,
  fetcher: typeof fetch = fetch,
): Promise<{
  eligible: boolean;
  balance: string;
  required: string;
  decimals: number;
  slot: number;
  mint: string;
}> {
  const mint = env.VG_TOKEN_MINT?.trim();
  const threshold = env.VG_HOLDER_THRESHOLD?.trim() || "1";
  if (!mint) throw new Error("not-configured");
  decodeBase58(mint, 32);
  decodeBase58(owner, 32);

  const mintResult = await rpc(
    "getAccountInfo",
    [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
    env,
    fetcher,
  );
  if (!isObj(mintResult) || !isObj(mintResult.value))
    throw new Error("Mint account unavailable");
  const mintOwner = String(mintResult.value.owner || "");
  if (mintOwner !== TOKEN_PROGRAM && mintOwner !== TOKEN_2022_PROGRAM)
    throw new Error("Configured mint is not an SPL token mint");
  const context = isObj(mintResult.context) ? mintResult.context : {};
  const slot = Number(context.slot);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error("Invalid slot");
  const data = isObj(mintResult.value.data) ? mintResult.value.data : {};
  const parsed = isObj(data.parsed) ? data.parsed : {};
  const info = isObj(parsed.info) ? parsed.info : {};
  const decimals = Number(info.decimals);
  if (parsed.type !== "mint" || !Number.isInteger(decimals))
    throw new Error("Invalid mint account");

  const accounts = await rpc(
    "getTokenAccountsByOwner",
    [
      owner,
      { mint },
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        minContextSlot: slot,
      },
    ],
    env,
    fetcher,
  );
  if (!isObj(accounts) || !Array.isArray(accounts.value))
    throw new Error("Token accounts unavailable");
  let balance = 0n;
  for (const entry of accounts.value.slice(0, 1024)) {
    if (!isObj(entry) || !isObj(entry.account)) continue;
    if (entry.account.owner !== mintOwner) continue;
    const accountData = isObj(entry.account.data) ? entry.account.data : {};
    const accountParsed = isObj(accountData.parsed) ? accountData.parsed : {};
    const accountInfo = isObj(accountParsed.info) ? accountParsed.info : {};
    const tokenAmount = isObj(accountInfo.tokenAmount)
      ? accountInfo.tokenAmount
      : {};
    if (
      accountParsed.type !== "account" ||
      accountInfo.mint !== mint ||
      accountInfo.owner !== owner ||
      typeof tokenAmount.amount !== "string" ||
      !/^[0-9]+$/.test(tokenAmount.amount)
    )
      continue;
    balance += BigInt(tokenAmount.amount);
  }
  const required = thresholdUnits(threshold, decimals);
  return {
    eligible: balance >= required,
    balance: balance.toString(),
    required: required.toString(),
    decimals,
    slot,
    mint,
  };
}

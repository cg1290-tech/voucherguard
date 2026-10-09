import { boundedBytes, isObj, type WorkerEnv } from "./shared";

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
const U256_MAX = (1n << 256n) - 1n;

export function evmAddress(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value) ||
    /^0x0{40}$/i.test(value)
  )
    throw new Error("Invalid Ethereum address");
  return value.toLowerCase();
}
export function robinhoodContract(env: WorkerEnv): string {
  return evmAddress(env.VG_TOKEN_CONTRACT?.trim());
}
export function holderUnits(value: string, decimals: number): bigint {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !/^(0|[1-9][0-9]{0,77})(\.[0-9]{1,255})?$/.test(value)
  )
    throw new Error("Invalid holder threshold");
  const [whole = "0", fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(decimals)))
    throw new Error("Threshold exceeds token precision");
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  if (result <= 0n || result > U256_MAX)
    throw new Error("Invalid holder threshold");
  return result;
}
function hexNumber(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value))
    throw new Error("Invalid RPC integer");
  return BigInt(value);
}
function abiUint(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Invalid ERC-20 result");
  return BigInt(value);
}
export interface RobinhoodHolding {
  eligible: boolean;
  balance: string;
  required: string;
  decimals: number;
  contract: string;
  chainId: number;
  blockNumber: string;
}
export async function verifyRobinhoodHolding(
  owner: string,
  env: WorkerEnv,
  fetcher: typeof fetch = fetch,
): Promise<RobinhoodHolding> {
  const address = evmAddress(owner);
  const contract = robinhoodContract(env);
  const endpoint = new URL(env.RH_RPC_URL?.trim() || ROBINHOOD_RPC);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new Error("Invalid server RPC configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let nextId = 0;
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const id = ++nextId;
    const response = await fetcher(endpoint.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("RPC unavailable");
    }
    const bytes = await boundedBytes(response.body, 128 * 1024);
    const result: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !isObj(result) ||
      result.jsonrpc !== "2.0" ||
      result.id !== id ||
      result.error !== undefined ||
      !("result" in result)
    )
      throw new Error("Invalid RPC response");
    return result.result;
  }
  try {
    if (hexNumber(await rpc("eth_chainId", [])) !== BigInt(ROBINHOOD_CHAIN_ID))
      throw new Error("RPC is not Robinhood Chain mainnet");
    const blockNumber = hexNumber(await rpc("eth_blockNumber", []));
    if (blockNumber <= 0n || blockNumber > (1n << 64n) - 1n)
      throw new Error("Invalid block number");
    const block = `0x${blockNumber.toString(16)}`;
    const code = await rpc("eth_getCode", [contract, block]);
    if (
      typeof code !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) ||
      /^0x(?:00)+$/i.test(code)
    )
      throw new Error("Token contract is unavailable");
    const decimalsRaw = abiUint(
      await rpc("eth_call", [{ to: contract, data: "0x313ce567" }, block]),
    );
    if (decimalsRaw > 255n) throw new Error("Invalid token decimals");
    const decimals = Number(decimalsRaw);
    const balance = abiUint(
      await rpc("eth_call", [
        {
          to: contract,
          data: `0x70a08231${address.slice(2).padStart(64, "0")}`,
        },
        block,
      ]),
    );
    if (controller.signal.aborted) throw new Error("RPC check expired");
    const required = holderUnits(
      env.VG_HOLDER_THRESHOLD?.trim() || "1",
      decimals,
    );
    return {
      eligible: balance >= required,
      balance: balance.toString(),
      required: required.toString(),
      decimals,
      contract,
      chainId: ROBINHOOD_CHAIN_ID,
      blockNumber: blockNumber.toString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

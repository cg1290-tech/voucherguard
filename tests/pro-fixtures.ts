import { encodeBytes } from "@voucherguard/core";
import {
  MAINNET_CHAIN,
  MAINNET_GENESIS,
  type ProConfig,
  TOKEN_PROGRAM,
} from "../apps/web/src/pro/config";
import type { WalletAccount } from "../apps/web/src/pro/wallet";

export const address = (byte: number) =>
  encodeBytes(new Uint8Array(32).fill(byte), "base58");
export const TEST_MINT = address(7);
export const TEST_CONFIG: ProConfig = {
  mint: TEST_MINT,
  rpcUrl: "https://voucherguard-rpc.example.test",
  threshold: "1",
  network: "mainnet-beta",
};
export const account = (
  byte = 9,
  chains: WalletAccount["chains"] = [MAINNET_CHAIN],
): WalletAccount => ({
  address: address(byte),
  publicKey: new Uint8Array(32).fill(byte),
  chains,
  features: [],
});
export function mintResponse(program = TOKEN_PROGRAM, decimals = 6): unknown {
  return {
    context: { slot: 1000 },
    value: {
      owner: program,
      executable: false,
      data: {
        parsed: {
          type: "mint",
          info: { decimals, isInitialized: true, supply: "1000000000000" },
        },
      },
    },
  };
}
export function tokenEntry(
  amount = "1000000",
  byte = 20,
  owner = address(9),
  mint = TEST_MINT,
  program = TOKEN_PROGRAM,
  decimals = 6,
) {
  return {
    pubkey: address(byte),
    account: {
      owner: program,
      executable: false,
      data: {
        parsed: {
          type: "account",
          info: {
            mint,
            owner,
            state: "initialized",
            tokenAmount: {
              amount,
              decimals,
              uiAmount: 1234567.89,
              uiAmountString: "untrusted",
            },
          },
        },
      },
    },
  };
}
export function tokens(entries: unknown[] = [tokenEntry()], slot = 1001) {
  return { context: { slot }, value: entries };
}
export function rpcFetcher({
  mint = mintResponse(),
  accounts = tokens(),
  genesis = MAINNET_GENESIS,
}: {
  mint?: unknown;
  accounts?: unknown;
  genesis?: unknown;
} = {}) {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
    };
    methods.push(body.method);
    const result =
      body.method === "getGenesisHash"
        ? genesis
        : body.method === "getAccountInfo"
          ? mint
          : accounts;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { fetcher, methods };
}

import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it, vi } from "vitest";
import { encodeBase58 } from "../apps/web/src/worker/base58";
import {
  buildSignMessage,
  createChallenge,
  handleProApi,
} from "../apps/web/src/worker/session";

const secret = "x".repeat(32);
const mint = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const env = {
  ASSETS: { fetch: async () => new Response("asset") },
  PRO_SESSION_SECRET: secret,
  VG_TOKEN_MINT: mint,
  VG_HOLDER_THRESHOLD: "1",
  HELIUS_API_KEY: "test",
};

function originRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://voucherguard.pages.dev${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://voucherguard.pages.dev",
      "Sec-Fetch-Site": "same-origin",
      ...(init.headers || {}),
    },
  });
}

describe("Pro holder session Worker gate", () => {
  it("reports not-configured without mint", async () => {
    const response = await handleProApi(
      originRequest("/api/pro/status", { method: "GET" }),
      { ...env, VG_TOKEN_MINT: "" },
      fetch,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "not-configured" });
  });

  it("issues a session only after signature and holdings pass", async () => {
    const seed = new Uint8Array(32).fill(7);
    const publicKey = ed25519.getPublicKey(seed);
    const address = encodeBase58(publicKey);
    const challenge = await createChallenge(env);
    const signature = ed25519.sign(buildSignMessage(challenge.challenge), seed);

    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        method: string;
      };
      if (body.method === "getAccountInfo")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              context: { slot: 42 },
              value: {
                owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                data: {
                  parsed: {
                    type: "mint",
                    info: { decimals: 6, isInitialized: true },
                  },
                },
              },
            },
          }),
        );
      if (body.method === "getTokenAccountsByOwner")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              context: { slot: 42 },
              value: [
                {
                  account: {
                    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                    data: {
                      parsed: {
                        type: "account",
                        info: {
                          mint,
                          owner: address,
                          tokenAmount: { amount: "1000000", decimals: 6 },
                        },
                      },
                    },
                  },
                },
              ],
            },
          }),
        );
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;

    const response = await handleProApi(
      originRequest("/api/pro/session", {
        method: "POST",
        body: JSON.stringify({
          address,
          challenge: challenge.challenge,
          signature: encodeBase58(signature),
        }),
      }),
      env,
      fetcher,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "eligible" });
    expect(response.headers.get("Set-Cookie")).toContain("vg_pro_session=");
  });

  it("refuses sessions below the holder threshold", async () => {
    const seed = new Uint8Array(32).fill(8);
    const publicKey = ed25519.getPublicKey(seed);
    const address = encodeBase58(publicKey);
    const challenge = await createChallenge(env);
    const signature = ed25519.sign(buildSignMessage(challenge.challenge), seed);
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}")) as {
        method: string;
      };
      if (body.method === "getAccountInfo")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              context: { slot: 42 },
              value: {
                owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                data: {
                  parsed: {
                    type: "mint",
                    info: { decimals: 6, isInitialized: true },
                  },
                },
              },
            },
          }),
        );
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 42 }, value: [] },
        }),
      );
    }) as unknown as typeof fetch;

    const response = await handleProApi(
      originRequest("/api/pro/session", {
        method: "POST",
        body: JSON.stringify({
          address,
          challenge: challenge.challenge,
          signature: encodeBase58(signature),
        }),
      }),
      env,
      fetcher,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Holder threshold not met",
    });
  });
});

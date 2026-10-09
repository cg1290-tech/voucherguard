import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { describe, expect, it, vi } from "vitest";
import {
  ROBINHOOD_NAMESPACES,
  robinhoodAccount,
} from "../apps/web/src/pro/robinhood-wallet";
import worker from "../apps/web/src/worker/index";
import {
  holderUnits,
  verifyRobinhoodHolding,
} from "../apps/web/src/worker/robinhood-holding";
import {
  createRobinhoodChallenge,
  guardRobinhoodProAssets,
  handleRobinhoodProApi,
  personalMessageHash,
  readRobinhoodSession,
  recoverPersonalAddress,
} from "../apps/web/src/worker/robinhood-session";
import type { WorkerEnv } from "../apps/web/src/worker/shared";

const hex = (value: Uint8Array) =>
  [...value].map((b) => b.toString(16).padStart(2, "0")).join("");
// Public test seed only; never use or fund this key.
const seed = new Uint8Array(32).fill(7);
const address = `0x${hex(keccak_256(secp256k1.getPublicKey(seed, false).slice(1))).slice(-40)}`;
const contract = `0x${"11".repeat(20)}`;
const env: WorkerEnv = {
  ASSETS: { fetch: async () => new Response("protected asset") },
  VG_ACCESS_CHAIN: "robinhood",
  VG_TOKEN_CONTRACT: contract,
  PRO_SESSION_SECRET: "test-only-secret-".repeat(3),
  VG_HOLDER_THRESHOLD: "1",
  WALLETCONNECT_PROJECT_ID: "f".repeat(32),
};
const req = (path: string, body?: unknown, cookie?: string) =>
  new Request(`https://voucherguard.pages.dev${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: "https://voucherguard.pages.dev",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
function sign(message: string) {
  const sig = secp256k1.sign(personalMessageHash(message), seed, {
    prehash: false,
    format: "recovered",
  });
  return `0x${hex(sig.slice(1))}${((sig[0] || 0) + 27).toString(16)}`;
}
function rpc(
  options: {
    balance?: bigint;
    chain?: string;
    decimals?: bigint;
    code?: string;
    malformedId?: boolean;
    oversized?: boolean;
  } = {},
) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    calls.push(body);
    const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
    const result =
      body.method === "eth_chainId"
        ? options.chain || "0x1237"
        : body.method === "eth_blockNumber"
          ? "0x123"
          : body.method === "eth_getCode"
            ? (options.code ?? "0x6000")
            : (body.params[0] as { data: string }).data === "0x313ce567"
              ? word(options.decimals ?? 18n)
              : word(options.balance ?? 10n ** 18n);
    return new Response(
      options.oversized
        ? "x".repeat(128 * 1024 + 1)
        : JSON.stringify({
            jsonrpc: "2.0",
            id: options.malformedId ? body.id + 1 : body.id,
            result,
          }),
    );
  };
  return { fetcher, calls };
}
async function proof() {
  const challenge = await createRobinhoodChallenge(env, address);
  return { ...challenge, address, signature: sign(challenge.message) };
}
describe("Robinhood Chain server holder gate", () => {
  it("requires only personal_sign on chain 4663 and refuses wrong-chain wallet namespaces", () => {
    expect(ROBINHOOD_NAMESPACES.eip155.methods).toEqual(["personal_sign"]);
    expect(
      robinhoodAccount({
        eip155: {
          methods: ["personal_sign"],
          accounts: [`eip155:4663:${address}`],
        },
      }),
    ).toBe(address);
    expect(() =>
      robinhoodAccount({
        eip155: {
          methods: ["personal_sign"],
          accounts: [`eip155:1:${address}`],
        },
      }),
    ).toThrow();
    expect(() =>
      robinhoodAccount({
        eip155: {
          methods: ["eth_sendTransaction"],
          accounts: [`eip155:4663:${address}`],
        },
      }),
    ).toThrow();
  });
  it("verifies EIP-191 signatures of the exact challenge message", async () => {
    const p = await proof();
    expect(p.message).toContain("Chain ID: 4663");
    expect(p.message).toContain("voucherguard.pages.dev");
    expect(recoverPersonalAddress(p.message, p.signature)).toBe(address);
    expect(recoverPersonalAddress(`${p.message}altered`, p.signature)).not.toBe(
      address,
    );
  });
  it("stays not-configured without the official ERC-20 contract and serves no Pro assets", async () => {
    const config = { ...env, VG_TOKEN_CONTRACT: "" };
    const status = await handleRobinhoodProApi(req("/api/pro/status"), config);
    expect(await status.json()).toMatchObject({
      status: "not-configured",
      network: "robinhood",
      chainId: 4663,
    });
    expect(
      (await guardRobinhoodProAssets(req("/pro.html"), config))?.status,
    ).toBe(503);
    expect((await worker.fetch(req("/api/pro/status"), config)).status).toBe(
      200,
    );
  });
  it("reads the correct chain, token and owner at one pinned block with exact bigint units", async () => {
    const f = rpc();
    const result = await verifyRobinhoodHolding(address, env, f.fetcher);
    expect(result).toMatchObject({
      eligible: true,
      balance: "1000000000000000000",
      required: "1000000000000000000",
      chainId: 4663,
      blockNumber: "291",
      contract,
    });
    expect(f.calls.map((c) => c.method)).toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getCode",
      "eth_call",
      "eth_call",
    ]);
    expect(f.calls.slice(2).every((c) => c.params[1] === "0x123")).toBe(true);
    expect(f.calls[4]?.params[0]).toEqual({
      to: contract,
      data: `0x70a08231${address.slice(2).padStart(64, "0")}`,
    });
  });
  it("does not read holdings on a wrong network", async () => {
    const f = rpc({ chain: "0x1" });
    await expect(
      verifyRobinhoodHolding(address, env, f.fetcher),
    ).rejects.toThrow(/mainnet/);
    expect(f.calls).toHaveLength(1);
  });
  it("rejects missing code, invalid ABI, wrong response IDs and oversized replies", async () => {
    for (const options of [
      { code: "0x" },
      { decimals: 256n },
      { malformedId: true },
      { oversized: true },
    ])
      await expect(
        verifyRobinhoodHolding(address, env, rpc(options).fetcher),
      ).rejects.toThrow();
  });
  it("never rounds thresholds and rejects precision loss, zero and uint256 overflow", () => {
    expect(holderUnits("1.000000000000000001", 18)).toBe(1000000000000000001n);
    for (const [value, decimals] of [
      ["0", 18],
      ["1.1", 0],
      ["1", 255],
    ] as const)
      expect(() => holderUnits(value, decimals)).toThrow();
  });
  it("issues an HttpOnly session only after both wallet proof and real holding validation", async () => {
    const p = await proof();
    const response = await handleRobinhoodProApi(
      req("/api/pro/session", p),
      env,
      rpc().fetcher,
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(
      await readRobinhoodSession(req("/pro.html", undefined, cookie), env),
    ).toMatchObject({ address });
    expect(
      await guardRobinhoodProAssets(
        req("/pro/app.js", undefined, cookie),
        env,
        rpc().fetcher,
      ),
    ).toBeNull();
    expect(
      (
        await guardRobinhoodProAssets(
          req("/pro.html", undefined, cookie),
          env,
          rpc({ balance: 0n }).fetcher,
        )
      )?.status,
    ).toBe(403);
    expect(
      (
        await guardRobinhoodProAssets(
          req("/pro.html", undefined, cookie),
          env,
          rpc({ chain: "0x1" }).fetcher,
        )
      )?.status,
    ).toBe(502);
    expect(
      await readRobinhoodSession(req("/pro.html", undefined, cookie), {
        ...env,
        VG_TOKEN_CONTRACT: `0x${"22".repeat(20)}`,
      }),
    ).toBeNull();
    expect(
      await readRobinhoodSession(
        req(
          "/pro.html",
          undefined,
          cookie.replace("vg_pro_session=", "vg_pro_session=X"),
        ),
        env,
      ),
    ).toBeNull();
  });
  it("an unauthenticated challenge cannot be reused as a holder session", async () => {
    const challenge = await createRobinhoodChallenge(env, address);
    const cookie = `vg_pro_session=${challenge.challenge}`;
    expect(
      await readRobinhoodSession(req("/pro.html", undefined, cookie), env),
    ).toBeNull();
    expect(
      (await guardRobinhoodProAssets(req("/pro.html", undefined, cookie), env))
        ?.status,
    ).toBe(302);
  });

  it("insufficient holdings never issue a cookie", async () => {
    const response = await handleRobinhoodProApi(
      req("/api/pro/session", await proof()),
      env,
      rpc({ balance: 0n }).fetcher,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
  it("refuses a claimed holder address without its signature before any RPC read", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const p = await proof();
    const response = await handleRobinhoodProApi(
      req("/api/pro/session", { ...p, address: `0x${"33".repeat(20)}` }),
      env,
      fetcher,
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("expired or modified challenges cannot authenticate", async () => {
    const p = await proof();
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(
      (
        await handleRobinhoodProApi(
          req("/api/pro/session", { ...p, challenge: `${p.challenge}a` }),
          env,
          fetcher,
        )
      ).status,
    ).toBe(401);
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now + 120001);
    try {
      expect(
        (await handleRobinhoodProApi(req("/api/pro/session", p), env, fetcher))
          .status,
      ).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses foreign origins and bounded oversized proof documents", async () => {
    const foreign = new Request(
      "https://voucherguard.pages.dev/api/pro/challenge",
      { method: "POST", headers: { Origin: "https://attacker.test" } },
    );
    expect((await handleRobinhoodProApi(foreign, env)).status).toBe(403);
    expect(
      (
        await handleRobinhoodProApi(
          req("/api/pro/session", { address, padding: "x".repeat(8192) }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});

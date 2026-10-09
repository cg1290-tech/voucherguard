import { describe, expect, it, vi } from "vitest";
import { createRpcRelay } from "../apps/web/src/rpc-worker";

const env = {
  ASSETS: { fetch: async () => new Response("asset") },
  HELIUS_API_KEY: undefined as string | undefined,
};
const request = (body: unknown, origin = "https://voucherguard.pages.dev") =>
  new Request("https://voucherguard.pages.dev/api/solana-rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: "secret=never-forward",
    },
    body: JSON.stringify(body),
  });
const genesis = { jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] };
describe("read-only Pages RPC relay", () => {
  it("forwards only canonical read requests to the fixed upstream without browser credentials", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "genesis" }),
        ),
    ) as unknown as typeof fetch;
    const response = await createRpcRelay(fetcher).fetch(
      request({ ...genesis, url: "https://attacker.test" }),
      env,
    );
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.mainnet-beta.solana.com",
      expect.objectContaining({
        body: JSON.stringify(genesis),
        credentials: "omit",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "VoucherGuard/0.1 RPC relay",
        },
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects signing, transaction, batch and malformed calls without forwarding", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const worker = createRpcRelay(fetcher);
    for (const body of [
      { ...genesis, method: "sendTransaction" },
      [genesis],
      { ...genesis, params: ["unexpected"] },
    ])
      expect((await worker.fetch(request(body), env)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards canonical getTransaction reads", async () => {
    const sig =
      "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null })),
    ) as unknown as typeof fetch;
    const response = await createRpcRelay(fetcher).fetch(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [sig, { encoding: "jsonParsed" }],
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.mainnet-beta.solana.com",
      expect.objectContaining({
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            sig,
            {
              encoding: "json",
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            },
          ],
        }),
      }),
    );
  });
  it("rejects other origins", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(
      (
        await createRpcRelay(fetcher).fetch(
          request(genesis, "https://attacker.test"),
          env,
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds request bytes before forwarding", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(
      (
        await createRpcRelay(fetcher).fetch(
          request({ ...genesis, padding: "x".repeat(4096) }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds upstream responses and fails closed", async () => {
    const fetcher = vi.fn(
      async () => new Response("x".repeat(1024 * 1024 + 1)),
    ) as unknown as typeof fetch;
    expect(
      (await createRpcRelay(fetcher).fetch(request(genesis), env)).status,
    ).toBe(502);
  });
  it("falls back to the next fixed upstream when the first is unavailable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "genesis" }),
        ),
      ) as unknown as typeof fetch;
    const response = await createRpcRelay(fetcher).fetch(request(genesis), env);
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.mainnet-beta.solana.com",
      expect.any(Object),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://solana-rpc.publicnode.com",
      expect.any(Object),
    );
  });
  it("falls back when the first upstream returns a JSON-RPC error body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32602,
              message: "Indexed requests require a personal token",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "genesis" }),
        ),
      ) as unknown as typeof fetch;
    const response = await createRpcRelay(fetcher).fetch(request(genesis), env);
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("prefers Helius when HELIUS_API_KEY is configured on the Worker env", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "genesis" }),
        ),
    ) as unknown as typeof fetch;
    await createRpcRelay(fetcher).fetch(request(genesis), {
      ...env,
      HELIUS_API_KEY: "test-key",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://mainnet.helius-rpc.com/?api-key=test-key",
      expect.any(Object),
    );
  });
  it("caps per-isolate requests and does not forward excess", async () => {
    const fetcher = vi.fn(
      async () => new Response("{}"),
    ) as unknown as typeof fetch;
    const worker = createRpcRelay(fetcher);
    for (let i = 0; i < 30; i++)
      expect((await worker.fetch(request(genesis), env)).status).toBe(200);
    expect((await worker.fetch(request(genesis), env)).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(30);
  });
});

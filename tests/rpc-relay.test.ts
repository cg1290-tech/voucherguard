import { describe, expect, it, vi } from "vitest";
import { createRpcRelay } from "../apps/web/src/rpc-worker";

const env = { ASSETS: { fetch: async () => new Response("asset") } };
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
      "https://solana-rpc.publicnode.com",
      expect.objectContaining({
        body: JSON.stringify(genesis),
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
      }),
    );
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

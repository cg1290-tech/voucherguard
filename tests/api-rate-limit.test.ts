import { describe, expect, it, vi } from "vitest";
import { enforceApiRateLimit } from "../apps/web/src/worker/rate-limit";

describe("shared /api rate limit", () => {
  it("allows traffic under the binding limit and blocks after", async () => {
    let n = 0;
    const limiter = {
      limit: vi.fn(async () => {
        n += 1;
        return { success: n <= 2 };
      }),
    };
    const req = new Request("https://voucherguard.pages.dev/api/pro/status", {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });
    expect(await enforceApiRateLimit(req, limiter)).toBeNull();
    expect(await enforceApiRateLimit(req, limiter)).toBeNull();
    const blocked = await enforceApiRateLimit(req, limiter);
    expect(blocked?.status).toBe(429);
  });

  it("skips OPTIONS preflight", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const req = new Request("https://voucherguard.pages.dev/api/solana-rpc", {
      method: "OPTIONS",
    });
    expect(await enforceApiRateLimit(req, limiter)).toBeNull();
    expect(limiter.limit).not.toHaveBeenCalled();
  });
});

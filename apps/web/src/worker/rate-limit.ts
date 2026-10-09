/** Shared /api/* throttle. Prefer the CF Rate Limiting binding when present. */
const PERIOD_SEC = 60;
const DEFAULT_LIMIT = 60;

export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export async function enforceApiRateLimit(
  request: Request,
  limiter?: RateLimiter,
): Promise<Response | null> {
  if (request.method === "OPTIONS") return null;
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const key = `api:${ip}`;
  let allowed = true;
  if (limiter) {
    try {
      const result = await limiter.limit({ key });
      allowed = result.success;
    } catch {
      allowed = await cacheAllow(key, DEFAULT_LIMIT);
    }
  } else {
    allowed = await cacheAllow(key, DEFAULT_LIMIT);
  }
  if (allowed) return null;
  return new Response(JSON.stringify({ error: "Try again later" }), {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Retry-After": String(PERIOD_SEC),
    },
  });
}

async function cacheAllow(key: string, limit: number): Promise<boolean> {
  try {
    const bucket = Math.floor(Date.now() / (PERIOD_SEC * 1000));
    const url = new Request(
      `https://voucherguard-rate-limit.internal/${encodeURIComponent(key)}/${bucket}`,
    );
    const cache = (caches as CacheStorage & { default: Cache }).default;
    const existing = await cache.match(url);
    const count = existing
      ? Number.parseInt(await existing.text(), 10) || 0
      : 0;
    if (count >= limit) return false;
    await cache.put(
      url,
      new Response(String(count + 1), {
        headers: { "Cache-Control": `max-age=${PERIOD_SEC}` },
      }),
    );
    return true;
  } catch {
    // Fail open if Cache API is unavailable in a given runtime.
    return true;
  }
}

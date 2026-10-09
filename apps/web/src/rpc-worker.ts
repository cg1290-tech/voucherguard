/** Optional Pages relay: fixed public upstream and read-only methods only. */
const UPSTREAM = "https://solana-rpc.publicnode.com";
const MAX_BODY = 4096;
const MAX_RESPONSE = 1024 * 1024;
const ORIGINS = new Set([
  "https://voucherguard.pages.dev",
  "https://cg1290-tech.github.io",
  "http://127.0.0.1:4185", // Explicit local holder-access test.
]);
const key = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
async function boundedBytes(
  body: ReadableStream<Uint8Array> | null,
  max: number,
) {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export function createRpcRelay(fetcher: typeof fetch = fetch) {
  const requests = new Map<string, { start: number; count: number }>();
  return {
    async fetch(
      request: Request,
      env: { ASSETS: { fetch(request: Request): Promise<Response> } },
    ) {
      const url = new URL(request.url);
      if (url.pathname !== "/api/solana-rpc") return env.ASSETS.fetch(request);
      const origin = request.headers.get("Origin");
      const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        Vary: "Origin",
      });
      const reply = (status: number, message: string) =>
        new Response(JSON.stringify({ error: message }), { status, headers });
      if (origin && !ORIGINS.has(origin))
        return reply(403, "Origin not allowed");
      if (origin) headers.set("Access-Control-Allow-Origin", origin);
      if (request.method === "OPTIONS") {
        headers.set("Access-Control-Allow-Methods", "POST");
        headers.set("Access-Control-Allow-Headers", "Content-Type");
        return new Response(null, { status: 204, headers });
      }
      if (
        request.method !== "POST" ||
        !request.headers.get("Content-Type")?.startsWith("application/json")
      )
        return reply(405, "JSON POST required");
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      const now = Date.now();
      for (const [address, entry] of requests)
        if (now - entry.start >= 60000) requests.delete(address);
      const bucket = requests.get(ip) || { start: now, count: 0 };
      if (bucket.count >= 30 || (!requests.has(ip) && requests.size >= 4096))
        return reply(429, "Try again later");
      bucket.count++;
      requests.set(ip, bucket);
      let rpc: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await boundedBytes(request.body, MAX_BODY),
          ),
        );
        if (
          !obj(parsed) ||
          parsed.jsonrpc !== "2.0" ||
          !Number.isSafeInteger(parsed.id) ||
          !Array.isArray(parsed.params)
        )
          throw new Error("Invalid envelope");
        const params = parsed.params;
        let canonical: unknown[];
        if (parsed.method === "getGenesisHash" && params.length === 0)
          canonical = [];
        else if (
          parsed.method === "getAccountInfo" &&
          params.length === 2 &&
          key(params[0])
        )
          canonical = [
            params[0],
            { encoding: "jsonParsed", commitment: "confirmed" },
          ];
        else if (
          parsed.method === "getTokenAccountsByOwner" &&
          params.length === 3 &&
          key(params[0]) &&
          obj(params[1]) &&
          key(params[1].mint) &&
          obj(params[2]) &&
          Number.isSafeInteger(params[2].minContextSlot) &&
          Number(params[2].minContextSlot) >= 0
        )
          canonical = [
            params[0],
            { mint: params[1].mint },
            {
              encoding: "jsonParsed",
              commitment: "confirmed",
              minContextSlot: params[2].minContextSlot,
            },
          ];
        else throw new Error("Method or parameters not allowed");
        rpc = {
          jsonrpc: "2.0",
          id: parsed.id,
          method: parsed.method,
          params: canonical,
        };
      } catch {
        return reply(400, "Invalid read-only RPC request");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher(UPSTREAM, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rpc),
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return reply(502, "RPC unavailable");
        }
        const bytes = await boundedBytes(response.body, MAX_RESPONSE);
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        return new Response(bytes, { status: 200, headers });
      } catch {
        return reply(502, "RPC unavailable");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export default createRpcRelay();

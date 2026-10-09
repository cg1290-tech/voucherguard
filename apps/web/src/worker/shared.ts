export const ORIGINS = new Set([
  "https://voucherguard.pages.dev",
  "https://cg1290-tech.github.io",
  "http://127.0.0.1:4185",
]);

export const FALLBACK_UPSTREAMS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
] as const;

export const HELIUS_FIRST = new Set(["getTokenAccountsByOwner"]);
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SESSION_COOKIE = "vg_pro_session";
export const SESSION_TTL_MS = 10 * 60 * 1000;
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export type WorkerEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HELIUS_API_KEY?: string;
  VG_TOKEN_MINT?: string;
  VG_HOLDER_THRESHOLD?: string;
  PRO_SESSION_SECRET?: string;
};

export const isKey = (v: unknown): v is string =>
  typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);

export const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function looksLikeBrowser(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (!site) return false;
  return (
    site === "same-origin" || site === "same-site" || site === "cross-site"
  );
}

export async function boundedBytes(
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

export function upstreamsForMethod(
  method: string,
  env: { HELIUS_API_KEY?: string },
): string[] {
  const helius = env.HELIUS_API_KEY?.trim();
  if (!helius) return [...FALLBACK_UPSTREAMS];
  const url = `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  if (HELIUS_FIRST.has(method)) return [url, ...FALLBACK_UPSTREAMS];
  return [...FALLBACK_UPSTREAMS, url];
}

export function jsonHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  });
  if (origin && ORIGINS.has(origin))
    headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

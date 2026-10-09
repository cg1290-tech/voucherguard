import { decodeBase58 } from "./base58";
import { verifyHolding } from "./holding";
import {
  CHALLENGE_TTL_MS,
  isObj,
  jsonHeaders,
  ORIGINS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type WorkerEnv,
} from "./shared";

const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2)
    throw new Error("Invalid hex");
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data)),
  );
  return hex(mac);
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function hmacOk(
  secret: string,
  data: string,
  macHex: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      asBufferSource(fromHex(macHex)),
      enc.encode(data),
    );
  } catch {
    return false;
  }
}

function requireSecret(env: WorkerEnv): string {
  const secret = env.PRO_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new Error("Pro session secret is not configured");
  return secret;
}

function mintConfigured(env: WorkerEnv): boolean {
  return Boolean(env.VG_TOKEN_MINT?.trim());
}

export function buildSignMessage(challenge: string): Uint8Array {
  return enc.encode(`VoucherGuard Pro access\n${challenge}\n`);
}

export async function createChallenge(env: WorkerEnv): Promise<{
  challenge: string;
  expiresAt: number;
}> {
  const secret = requireSecret(env);
  if (!mintConfigured(env)) throw new Error("not-configured");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${expiresAt}.${nonce}`;
  const mac = await hmacSign(secret, body);
  return { challenge: `${body}.${mac}`, expiresAt };
}

export async function verifyChallenge(
  env: WorkerEnv,
  challenge: string,
): Promise<boolean> {
  const secret = requireSecret(env);
  const parts = challenge.split(".");
  if (parts.length !== 3) return false;
  const [expRaw, nonce, mac] = parts;
  if (!expRaw || !nonce || !mac) return false;
  if (!/^[0-9]+$/.test(expRaw) || !/^[0-9a-f]+$/i.test(nonce)) return false;
  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt) || Date.now() > expiresAt) return false;
  return hmacOk(secret, `${expRaw}.${nonce}`, mac);
}

async function verifyWalletSignature(
  address: string,
  challenge: string,
  signatureBase58: string,
): Promise<boolean> {
  const publicKey = decodeBase58(address, 32);
  const signature = decodeBase58(signatureBase58, 64);
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(publicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    asBufferSource(signature),
    asBufferSource(buildSignMessage(challenge)),
  );
}

export async function issueSession(
  env: WorkerEnv,
  address: string,
  holding: Awaited<ReturnType<typeof verifyHolding>>,
): Promise<{ cookie: string; expiresAt: number }> {
  const secret = requireSecret(env);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const body = `v1.${address}.${expiresAt}.${holding.slot}`;
  const mac = await hmacSign(secret, body);
  const value = `${body}.${mac}`;
  const cookie = `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  return { cookie, expiresAt };
}

export async function readSession(
  request: Request,
  env: WorkerEnv,
): Promise<{ address: string; expiresAt: number; slot: number } | null> {
  try {
    const secret = requireSecret(env);
    const raw = request.headers.get("Cookie") || "";
    const match = raw
      .split(/;\s*/)
      .map((part) => part.split("="))
      .find(([name]) => name === SESSION_COOKIE);
    const value = match?.[1];
    if (!value) return null;
    const parts = value.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") return null;
    const [, address, expRaw, slotRaw, mac] = parts;
    if (!address || !expRaw || !slotRaw || !mac) return null;
    decodeBase58(address, 32);
    const expiresAt = Number(expRaw);
    const slot = Number(slotRaw);
    if (
      !Number.isSafeInteger(expiresAt) ||
      !Number.isSafeInteger(slot) ||
      Date.now() > expiresAt
    )
      return null;
    if (!(await hmacOk(secret, `v1.${address}.${expRaw}.${slotRaw}`, mac)))
      return null;
    return { address, expiresAt, slot };
  } catch {
    return null;
  }
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isProAssetPath(pathname: string): boolean {
  return (
    pathname === "/pro" ||
    pathname === "/pro/" ||
    pathname === "/pro.html" ||
    pathname.startsWith("/pro/")
  );
}

export async function handleProApi(
  request: Request,
  env: WorkerEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const headers = jsonHeaders(origin);
  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers });

  if (request.method === "OPTIONS") {
    if (!origin || !ORIGINS.has(origin))
      return reply(403, { error: "Origin not allowed" });
    headers.set("Access-Control-Allow-Methods", "GET, POST");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Credentials", "true");
    return new Response(null, { status: 204, headers });
  }

  // Reject disallowed Origins; same-origin requests may omit Origin.
  if (origin && !ORIGINS.has(origin))
    return reply(403, { error: "Origin not allowed" });
  if (request.method !== "GET" && url.pathname !== "/api/pro/status" && !origin)
    return reply(403, { error: "Origin not allowed" });
  if (origin && ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (!mintConfigured(env) || !env.PRO_SESSION_SECRET?.trim()) {
    if (url.pathname === "/api/pro/status" && request.method === "GET")
      return reply(200, {
        status: "not-configured",
        message:
          "Token access coming soon. Holder mint is not configured on the server.",
      });
    return reply(503, {
      error: "Pro holder gate is not configured on the server.",
    });
  }

  if (url.pathname === "/api/pro/status" && request.method === "GET") {
    const session = await readSession(request, env);
    if (!session)
      return reply(200, {
        status: "locked",
        message: "Prove $VG holdings with a wallet signature to unlock Pro.",
      });
    try {
      const holding = await verifyHolding(session.address, env, fetcher);
      if (!holding.eligible) {
        headers.append("Set-Cookie", clearSessionCookie());
        return reply(200, {
          status: "ineligible",
          message: "Connected wallet no longer meets the holder threshold.",
          address: session.address,
          balance: holding.balance,
          required: holding.required,
          decimals: holding.decimals,
          mint: holding.mint,
          slot: holding.slot,
        });
      }
      return reply(200, {
        status: "eligible",
        message: "Holder session verified. Pro tools are available.",
        address: session.address,
        balance: holding.balance,
        required: holding.required,
        decimals: holding.decimals,
        mint: holding.mint,
        slot: holding.slot,
        expiresAt: session.expiresAt,
        toolsPath: "/pro.html",
      });
    } catch {
      return reply(200, {
        status: "rpc-error",
        message: "Holdings could not be re-verified. Try again.",
        address: session.address,
      });
    }
  }

  if (url.pathname === "/api/pro/challenge" && request.method === "POST") {
    try {
      const challenge = await createChallenge(env);
      return reply(200, {
        challenge: challenge.challenge,
        expiresAt: challenge.expiresAt,
        message: new TextDecoder().decode(
          buildSignMessage(challenge.challenge),
        ),
      });
    } catch (e) {
      return reply(503, {
        error: e instanceof Error ? e.message : "Challenge unavailable",
      });
    }
  }

  if (url.pathname === "/api/pro/session" && request.method === "POST") {
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return reply(400, { error: "Invalid JSON" });
    }
    if (
      !isObj(body) ||
      typeof body.address !== "string" ||
      typeof body.challenge !== "string" ||
      typeof body.signature !== "string"
    )
      return reply(400, { error: "address, challenge and signature required" });
    try {
      decodeBase58(body.address, 32);
      if (!(await verifyChallenge(env, body.challenge)))
        return reply(400, { error: "Challenge expired or invalid" });
      if (
        !(await verifyWalletSignature(
          body.address,
          body.challenge,
          body.signature,
        ))
      )
        return reply(401, { error: "Invalid wallet signature" });
      const holding = await verifyHolding(body.address, env, fetcher);
      if (!holding.eligible)
        return reply(403, {
          error: "Holder threshold not met",
          balance: holding.balance,
          required: holding.required,
          decimals: holding.decimals,
          mint: holding.mint,
          slot: holding.slot,
        });
      const session = await issueSession(env, body.address, holding);
      headers.append("Set-Cookie", session.cookie);
      return reply(200, {
        status: "eligible",
        message: "Holder session issued.",
        address: body.address,
        balance: holding.balance,
        required: holding.required,
        decimals: holding.decimals,
        mint: holding.mint,
        slot: holding.slot,
        expiresAt: session.expiresAt,
        toolsPath: "/pro.html",
      });
    } catch (e) {
      return reply(502, {
        error: e instanceof Error ? e.message : "Session failed",
      });
    }
  }

  if (url.pathname === "/api/pro/logout" && request.method === "POST") {
    headers.append("Set-Cookie", clearSessionCookie());
    return reply(200, { status: "locked", message: "Pro session cleared." });
  }

  return reply(404, { error: "Not found" });
}

export async function guardProAssets(
  request: Request,
  env: WorkerEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isProAssetPath(url.pathname)) return null;
  if (!mintConfigured(env) || !env.PRO_SESSION_SECRET?.trim())
    return new Response("Pro is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
    });
  const session = await readSession(request, env);
  if (!session) return Response.redirect(new URL("/#pro", url.origin), 302);
  try {
    const holding = await verifyHolding(session.address, env, fetcher);
    if (!holding.eligible) {
      return new Response("Holder threshold not met", {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain",
          "Set-Cookie": clearSessionCookie(),
        },
      });
    }
  } catch {
    return new Response("Holdings could not be verified", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
    });
  }
  return null;
}

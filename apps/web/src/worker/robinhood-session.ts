import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  evmAddress,
  ROBINHOOD_CHAIN_ID,
  robinhoodContract,
  verifyRobinhoodHolding,
} from "./robinhood-holding";
import { clearSessionCookie, isProAssetPath } from "./session";
import {
  boundedBytes,
  CHALLENGE_TTL_MS,
  isObj,
  jsonHeaders,
  ORIGINS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type WorkerEnv,
} from "./shared";

const DOMAIN = "voucherguard.pages.dev";
const enc = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
function bytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value))
    throw new Error("Invalid signature");
  return Uint8Array.from(value.match(/../g) || [], (b) =>
    Number.parseInt(b, 16),
  );
}
function pack(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unpack(value: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new Error("Invalid proof");
  return JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
}
function secret(env: WorkerEnv): string {
  const value = env.PRO_SESSION_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("Pro is not configured");
  return value;
}
async function macKey(env: WorkerEnv) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function seal(body: string, env: WorkerEnv): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", await macKey(env), enc.encode(body)),
    ),
  );
}
async function open(token: string, env: WorkerEnv): Promise<unknown> {
  if (token.length > 2200) throw new Error("Invalid proof");
  const parts = token.split(".");
  const body = parts[0],
    mac = parts[1];
  if (parts.length !== 2 || !body || !mac || !/^[0-9a-f]{64}$/.test(mac))
    throw new Error("Invalid proof");
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      await macKey(env),
      bytes(mac),
      enc.encode(body),
    ))
  )
    throw new Error("Invalid proof");
  return unpack(body);
}
interface Challenge {
  kind: "challenge";
  v: 2;
  domain: string;
  chainId: number;
  contract: string;
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}
function validateChallenge(value: unknown, env: WorkerEnv): Challenge {
  if (
    !isObj(value) ||
    value.v !== 2 ||
    value.kind !== "challenge" ||
    value.domain !== DOMAIN ||
    value.chainId !== ROBINHOOD_CHAIN_ID ||
    value.contract !== robinhoodContract(env) ||
    typeof value.address !== "string" ||
    typeof value.nonce !== "string" ||
    !/^[0-9a-f]{32}$/.test(value.nonce) ||
    typeof value.issuedAt !== "number" ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.issuedAt > Date.now() ||
    Date.now() >= value.expiresAt ||
    value.expiresAt - value.issuedAt !== CHALLENGE_TTL_MS
  )
    throw new Error("Challenge expired or invalid");
  evmAddress(value.address);
  return value as unknown as Challenge;
}
function checksummed(address: string): string {
  const lower = evmAddress(address).slice(2);
  const hash = hex(keccak_256(enc.encode(lower)));
  return `0x${[...lower].map((c, i) => (Number.parseInt(hash[i] || "0", 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}
export function robinhoodSignMessage(challenge: Challenge): string {
  return `${DOMAIN} wants you to sign in with your Ethereum account:\n${checksummed(challenge.address)}\n\nSign in to VoucherGuard Pro. No payment or token approval.\n\nURI: https://${DOMAIN}\nVersion: 1\nChain ID: ${ROBINHOOD_CHAIN_ID}\nNonce: ${challenge.nonce}\nIssued At: ${new Date(challenge.issuedAt).toISOString()}\nExpiration Time: ${new Date(challenge.expiresAt).toISOString()}\nResources:\n- urn:voucherguard:token:${challenge.contract}`;
}
export function personalMessageHash(message: string): Uint8Array {
  const data = enc.encode(message);
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${data.byteLength}`);
  const all = new Uint8Array(prefix.length + data.length);
  all.set(prefix);
  all.set(data, prefix.length);
  return keccak_256(all);
}
export function recoverPersonalAddress(
  message: string,
  signature: string,
): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error("Invalid wallet signature");
  const sig = bytes(signature.slice(2));
  const v = sig[64];
  if (v !== 27 && v !== 28 && v !== 0 && v !== 1)
    throw new Error("Invalid recovery bit");
  const recovered = new Uint8Array(65);
  recovered[0] = v >= 27 ? v - 27 : v;
  recovered.set(sig.slice(0, 64), 1);
  const point = secp256k1.Signature.fromBytes(recovered, "recovered");
  if (point.hasHighS()) throw new Error("Noncanonical signature");
  const pub = point
    .recoverPublicKey(personalMessageHash(message))
    .toBytes(false);
  return `0x${hex(keccak_256(pub.slice(1))).slice(-40)}`;
}
export async function createRobinhoodChallenge(
  env: WorkerEnv,
  address: string,
) {
  secret(env);
  const issuedAt = Date.now();
  const payload: Challenge = {
    kind: "challenge",
    v: 2,
    domain: DOMAIN,
    chainId: ROBINHOOD_CHAIN_ID,
    contract: robinhoodContract(env),
    address: evmAddress(address),
    nonce: hex(crypto.getRandomValues(new Uint8Array(16))),
    issuedAt,
    expiresAt: issuedAt + CHALLENGE_TTL_MS,
  };
  const body = pack(payload);
  return {
    challenge: `${body}.${await seal(body, env)}`,
    message: robinhoodSignMessage(payload),
    expiresAt: payload.expiresAt,
  };
}
export async function readRobinhoodSession(
  request: Request,
  env: WorkerEnv,
): Promise<{ address: string; expiresAt: number } | null> {
  try {
    const cookie = (request.headers.get("Cookie") || "")
      .split(/;\s*/)
      .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (!cookie) return null;
    const value = await open(cookie, env);
    if (
      !isObj(value) ||
      value.v !== 2 ||
      value.kind !== "session" ||
      value.chainId !== ROBINHOOD_CHAIN_ID ||
      value.contract !== robinhoodContract(env) ||
      typeof value.address !== "string" ||
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.expiresAt) ||
      Date.now() >= value.expiresAt ||
      value.expiresAt > Date.now() + SESSION_TTL_MS
    )
      return null;
    return { address: evmAddress(value.address), expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}
function metadata(env: WorkerEnv) {
  const projectId = env.WALLETCONNECT_PROJECT_ID?.trim();
  return {
    network: "robinhood",
    chainId: ROBINHOOD_CHAIN_ID,
    ...(projectId && /^[0-9a-f]{32}$/i.test(projectId)
      ? { walletConnectProjectId: projectId }
      : {}),
  };
}
function configured(env: WorkerEnv): boolean {
  try {
    secret(env);
    robinhoodContract(env);
    return true;
  } catch {
    return false;
  }
}
export async function handleRobinhoodProApi(
  request: Request,
  env: WorkerEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url),
    origin = request.headers.get("Origin");
  const headers = jsonHeaders(origin);
  const reply = (status: number, value: Record<string, unknown>) =>
    new Response(JSON.stringify({ ...metadata(env), ...value }), {
      status,
      headers,
    });
  if ((origin && !ORIGINS.has(origin)) || (request.method !== "GET" && !origin))
    return reply(403, { error: "Origin not allowed" });
  if (origin) headers.set("Access-Control-Allow-Credentials", "true");
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, POST");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    return new Response(null, { status: 204, headers });
  }
  if (url.pathname === "/api/pro/logout" && request.method === "POST") {
    headers.append("Set-Cookie", clearSessionCookie());
    return reply(200, { status: "locked", message: "Pro session cleared." });
  }
  if (!configured(env))
    return url.pathname === "/api/pro/status" && request.method === "GET"
      ? reply(200, {
          status: "not-configured",
          message:
            "Token access coming soon. The official $VG contract is not configured on the server.",
        })
      : reply(503, { error: "Pro holder gate is not configured." });
  if (url.pathname === "/api/pro/status" && request.method === "GET") {
    const session = await readRobinhoodSession(request, env);
    if (!session)
      return reply(200, {
        status: "locked",
        message:
          "Connect Robinhood Wallet and prove $VG holdings to unlock Pro.",
      });
    try {
      const holding = await verifyRobinhoodHolding(
        session.address,
        env,
        fetcher,
      );
      if (!holding.eligible) {
        headers.append("Set-Cookie", clearSessionCookie());
        return reply(200, {
          ...holding,
          address: session.address,
          status: "ineligible",
          message: "Wallet no longer meets the holder threshold.",
        });
      }
      return reply(200, {
        ...holding,
        address: session.address,
        expiresAt: session.expiresAt,
        status: "eligible",
        message: "Holder session verified. Pro tools are available.",
        toolsPath: "/pro.html",
      });
    } catch {
      headers.append("Set-Cookie", clearSessionCookie());
      return reply(200, {
        status: "rpc-error",
        message: "Holdings could not be verified. Access remains locked.",
      });
    }
  }
  if (
    request.method !== "POST" ||
    !request.headers.get("Content-Type")?.startsWith("application/json")
  )
    return reply(405, { error: "JSON POST required" });
  let body: unknown;
  try {
    body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBytes(request.body, 8192),
      ),
    );
  } catch {
    return reply(400, { error: "Invalid request" });
  }
  if (!isObj(body) || typeof body.address !== "string")
    return reply(400, { error: "Wallet address required" });
  if (url.pathname === "/api/pro/challenge") {
    try {
      return reply(200, await createRobinhoodChallenge(env, body.address));
    } catch {
      return reply(400, { error: "Invalid wallet address" });
    }
  }
  if (url.pathname !== "/api/pro/session")
    return reply(404, { error: "Not found" });
  if (typeof body.challenge !== "string" || typeof body.signature !== "string")
    return reply(400, { error: "Wallet proof required" });
  let address: string;
  try {
    address = evmAddress(body.address);
    const challenge = validateChallenge(await open(body.challenge, env), env);
    if (
      address !== challenge.address ||
      recoverPersonalAddress(
        robinhoodSignMessage(challenge),
        body.signature,
      ) !== address
    )
      return reply(401, { error: "Invalid wallet signature" });
  } catch {
    return reply(401, {
      error: "Challenge or wallet signature is invalid or expired",
    });
  }
  try {
    const holding = await verifyRobinhoodHolding(address, env, fetcher);
    if (!holding.eligible)
      return reply(403, { ...holding, error: "Holder threshold not met" });
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const packed = pack({
      kind: "session",
      v: 2,
      chainId: ROBINHOOD_CHAIN_ID,
      contract: holding.contract,
      address,
      expiresAt,
    });
    headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${packed}.${await seal(packed, env)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
    );
    return reply(200, {
      ...holding,
      address,
      expiresAt,
      status: "eligible",
      message: "Holder session issued.",
      toolsPath: "/pro.html",
    });
  } catch {
    return reply(502, {
      error: "Token holdings could not be verified. Access remains locked.",
    });
  }
}
export async function guardRobinhoodProAssets(
  request: Request,
  env: WorkerEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isProAssetPath(url.pathname)) return null;
  const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain" };
  if (!configured(env))
    return new Response("Pro is not configured", { status: 503, headers });
  const session = await readRobinhoodSession(request, env);
  if (!session) return Response.redirect(new URL("/#pro", url.origin), 302);
  try {
    const holding = await verifyRobinhoodHolding(session.address, env, fetcher);
    if (!holding.eligible)
      return new Response("Holder threshold not met", {
        status: 403,
        headers: { ...headers, "Set-Cookie": clearSessionCookie() },
      });
  } catch {
    return new Response("Holdings could not be verified", {
      status: 502,
      headers,
    });
  }
  return null;
}

export type ProSessionStatus =
  | "not-configured"
  | "locked"
  | "eligible"
  | "ineligible"
  | "rpc-error"
  | "checking"
  | "error";

export interface ProSessionState {
  status: ProSessionStatus;
  message: string;
  network?: "solana" | "robinhood";
  chainId?: number;
  contract?: string;
  blockNumber?: string;
  walletConnectProjectId?: string;
  address?: string;
  balance?: string;
  required?: string;
  decimals?: number;
  mint?: string;
  slot?: number;
  expiresAt?: number;
  toolsPath?: string;
}

const PENDING_POLICY_KEY = "vg_pending_policy";

/** Same-origin Pro API on Pages; production host when preview cannot run the Worker. */
export function proApiBase(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  if (
    host === "voucherguard.pages.dev" ||
    host.endsWith(".voucherguard.pages.dev") ||
    host === "127.0.0.1" ||
    host === "localhost"
  )
    return "";
  return "https://voucherguard.pages.dev";
}

async function proFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  return fetch(`${proApiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
}

export async function fetchProStatus(
  signal?: AbortSignal,
): Promise<ProSessionState> {
  const response = await proFetch("/api/pro/status", {
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json()) as ProSessionState & { error?: string };
  if (!response.ok)
    return {
      status: "error",
      message: body.error || "Pro status unavailable",
    };
  return body;
}

export async function requestChallenge(
  signal?: AbortSignal,
  address?: string,
): Promise<{
  challenge: string;
  message: string;
  expiresAt: number;
}> {
  const response = await proFetch("/api/pro/challenge", {
    method: "POST",
    body: JSON.stringify(address ? { address } : {}),
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json()) as {
    challenge?: string;
    message?: string;
    expiresAt?: number;
    error?: string;
  };
  if (
    !response.ok ||
    !body.challenge ||
    !body.message ||
    body.expiresAt === undefined
  )
    throw new Error(body.error || "Challenge unavailable");
  return {
    challenge: body.challenge,
    message: body.message,
    expiresAt: body.expiresAt,
  };
}

export async function createProSession(
  address: string,
  challenge: string,
  signature: string,
  signal?: AbortSignal,
): Promise<ProSessionState> {
  const response = await proFetch("/api/pro/session", {
    method: "POST",
    body: JSON.stringify({ address, challenge, signature }),
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json()) as ProSessionState & { error?: string };
  if (!response.ok) {
    const failed: ProSessionState = {
      status: response.status === 403 ? "ineligible" : "error",
      message: body.error || "Session refused",
      address,
    };
    if (body.balance !== undefined) failed.balance = body.balance;
    if (body.required !== undefined) failed.required = body.required;
    if (body.decimals !== undefined) failed.decimals = body.decimals;
    if (body.mint !== undefined) failed.mint = body.mint;
    if (body.slot !== undefined) failed.slot = body.slot;
    if (body.network !== undefined) failed.network = body.network;
    if (body.chainId !== undefined) failed.chainId = body.chainId;
    if (body.contract !== undefined) failed.contract = body.contract;
    if (body.blockNumber !== undefined) failed.blockNumber = body.blockNumber;
    if (body.walletConnectProjectId !== undefined)
      failed.walletConnectProjectId = body.walletConnectProjectId;
    return failed;
  }
  return body;
}

export async function logoutProSession(): Promise<void> {
  const response = await proFetch("/api/pro/logout", {
    method: "POST",
    body: "{}",
  });
  if (!response.ok) throw new Error("Hosted session could not be ended");
}

export function stashPolicyForAdvanced(policy: unknown): void {
  sessionStorage.setItem(PENDING_POLICY_KEY, JSON.stringify(policy));
}

export function takePendingPolicy(): unknown | undefined {
  const raw = sessionStorage.getItem(PENDING_POLICY_KEY);
  if (!raw) return undefined;
  sessionStorage.removeItem(PENDING_POLICY_KEY);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

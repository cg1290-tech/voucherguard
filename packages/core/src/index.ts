import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64, hex } from "@scure/base";

export const PROTOCOL = "solana-payment-channels/v1" as const;
export const UPSTREAM_COMMIT = "3ffa4d6728ad88e4a9667a76ad9ccd68a302c696";
export const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
export type Status = "PASS" | "FAIL" | "INDETERMINATE";
export type ReasonCode =
  | "FORMAT_VALID"
  | "INVALID_INPUT"
  | "INVALID_LENGTH"
  | "BAD_MAGIC"
  | "UNSUPPORTED_VERSION"
  | "SIGNATURE_VALID"
  | "SIGNATURE_INVALID"
  | "SIGNER_REQUIRED"
  | "SIGNER_MATCH"
  | "SIGNER_MISMATCH"
  | "CHANNEL_MATCH"
  | "CHANNEL_MISMATCH"
  | "CHANNEL_REQUIRED"
  | "NOT_EXPIRED"
  | "EXPIRED"
  | "NON_EXPIRING"
  | "EXPIRY_REQUIRED"
  | "AMOUNT_ALLOWED"
  | "AMOUNT_LIMIT"
  | "TIME_ALLOWED"
  | "TIME_WINDOW"
  | "STATE_REQUIRED"
  | "STATE_OPEN"
  | "STATE_NOT_OPEN"
  | "DEPOSIT_ALLOWED"
  | "OVER_DEPOSIT"
  | "WATERMARK_ADVANCED"
  | "STALE_AUTHORIZATION"
  | "INCREASE_ALLOWED"
  | "INCREASE_LIMIT";
export interface Check {
  code: ReasonCode;
  status: Status;
  category: "protocol" | "policy" | "context";
  explanation: string;
}
export interface Voucher {
  channelId: Uint8Array;
  cumulativeAmount: bigint;
  expiresAt: bigint;
}
/** Application policies; channel binding itself is a protocol requirement. */
export interface Policy {
  expectedChannelId?: Uint8Array;
  maxCumulativeAmount?: bigint;
  maxIncrease?: bigint;
  rejectNonExpiring?: boolean;
  minRemainingSeconds?: bigint;
  maxRemainingSeconds?: bigint;
  /** Verify deposit, settled watermark and Open lifecycle; defaults to true. */
  requireState?: boolean;
}
/** Caller must independently authenticate this snapshot and bind it to channel/signer. */
export interface TrustedState {
  channelId: Uint8Array;
  authorizedSigner: Uint8Array;
  deposit: bigint;
  settledAmount: bigint;
  status: "Open" | "Closing" | "Sealed" | "Distributed";
  previouslyAcceptedAmount?: bigint;
}
export interface VerifyInput {
  message: Uint8Array;
  signature: Uint8Array;
  authorizedSigner?: Uint8Array;
  policy?: Policy;
  trustedState?: TrustedState;
  now?: bigint;
}
export interface Report {
  status: Status;
  protocol: typeof PROTOCOL;
  upstreamCommit: string;
  verificationTime: string;
  checks: Check[];
  decoded?: { channelId: string; cumulativeAmount: string; expiresAt: string };
  evidence?: {
    messageHex: string;
    signatureHex: string;
    authorizedSignerHex?: string;
  };
  assumptions: Record<string, unknown>;
  limitations: string[];
  nextSteps: string[];
}
export class VoucherError extends Error {
  constructor(
    public code: ReasonCode,
    message: string,
  ) {
    super(message);
    this.name = "VoucherError";
  }
}
function invalid(message: string): never {
  throw new VoucherError("INVALID_INPUT", message);
}
function bytes(
  value: unknown,
  size: number,
  label: string,
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) invalid(`${label} must be Uint8Array`);
  if (value.length !== size)
    throw new VoucherError(
      "INVALID_LENGTH",
      `${label} must contain exactly ${size} bytes`,
    );
}
function integer(
  value: unknown,
  min: bigint,
  max: bigint,
  label: string,
): asserts value is bigint {
  if (typeof value !== "bigint" || value < min || value > max)
    invalid(`${label} must be a bigint in [${min}, ${max}]`);
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
export function decodeVoucher(message: Uint8Array): Voucher {
  bytes(message, 50, "message");
  if (message[0] !== 0x56)
    throw new VoucherError("BAD_MAGIC", "Expected voucher domain marker 0x56");
  if (message[1] !== 1)
    throw new VoucherError(
      "UNSUPPORTED_VERSION",
      "Only voucher format version 1 is supported",
    );
  const view = new DataView(
    message.buffer,
    message.byteOffset,
    message.byteLength,
  );
  return {
    channelId: message.slice(2, 34),
    cumulativeAmount: view.getBigUint64(34, true),
    expiresAt: view.getBigInt64(42, true),
  };
}
/** Encodes only; never signs or performs a payment. */
export function encodeVoucher(voucher: Voucher): Uint8Array {
  bytes(voucher.channelId, 32, "channelId");
  integer(voucher.cumulativeAmount, 0n, U64_MAX, "cumulativeAmount");
  integer(voucher.expiresAt, I64_MIN, I64_MAX, "expiresAt");
  const message = new Uint8Array(50);
  message.set([0x56, 1]);
  message.set(voucher.channelId, 2);
  const view = new DataView(message.buffer);
  view.setBigUint64(34, voucher.cumulativeAmount, true);
  view.setBigInt64(42, voucher.expiresAt, true);
  return message;
}
export type Encoding = "hex" | "base64" | "base58";
export function decodeBytes(
  value: string,
  encoding: Encoding,
  size: number,
): Uint8Array {
  if (typeof value !== "string" || value.length > 256)
    invalid("Encoded field must be a string of at most 256 characters");
  const codec =
    encoding === "hex"
      ? hex
      : encoding === "base64"
        ? base64
        : encoding === "base58"
          ? base58
          : undefined;
  if (!codec) invalid("Unsupported encoding");
  try {
    const result = codec.decode(value);
    if (
      encoding === "hex"
        ? codec.encode(result).toLowerCase() !== value.toLowerCase()
        : codec.encode(result) !== value
    )
      invalid("Non-canonical encoding");
    bytes(result, size, "encoded field");
    return result;
  } catch (e) {
    if (e instanceof VoucherError) throw e;
    invalid(`Invalid ${encoding} encoding`);
  }
}
export function encodeBytes(value: Uint8Array, encoding: Encoding): string {
  if (
    !(value instanceof Uint8Array) ||
    !["hex", "base64", "base58"].includes(encoding)
  )
    invalid("Expected byte array and supported encoding");
  return (
    encoding === "hex" ? hex : encoding === "base64" ? base64 : base58
  ).encode(value);
}
export function serializeReport(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v: unknown) =>
      typeof v === "bigint"
        ? v.toString()
        : v instanceof Uint8Array
          ? hex.encode(v)
          : v,
    2,
  );
}

function validatePolicy(p: Policy): void {
  const allowed = [
    "expectedChannelId",
    "maxCumulativeAmount",
    "maxIncrease",
    "rejectNonExpiring",
    "minRemainingSeconds",
    "maxRemainingSeconds",
    "requireState",
  ];
  for (const k of Object.keys(p))
    if (!allowed.includes(k)) invalid(`Unknown policy: ${k}`);
  if (p.expectedChannelId !== undefined)
    bytes(p.expectedChannelId, 32, "expectedChannelId");
  for (const k of [
    "maxCumulativeAmount",
    "maxIncrease",
    "minRemainingSeconds",
    "maxRemainingSeconds",
  ] as const)
    if (p[k] !== undefined) integer(p[k], 0n, U64_MAX, k);
  for (const k of ["rejectNonExpiring", "requireState"] as const)
    if (p[k] !== undefined && typeof p[k] !== "boolean")
      invalid(`${k} must be boolean`);
  if (
    p.minRemainingSeconds !== undefined &&
    p.maxRemainingSeconds !== undefined &&
    p.minRemainingSeconds > p.maxRemainingSeconds
  )
    invalid("Time window is inverted");
}
function validateState(state: TrustedState): void {
  const o = object(state, "trustedState");
  keys(
    o,
    [
      "channelId",
      "authorizedSigner",
      "deposit",
      "settledAmount",
      "status",
      "previouslyAcceptedAmount",
    ],
    "state",
  );
  bytes(state.channelId, 32, "state.channelId");
  bytes(state.authorizedSigner, 32, "state.authorizedSigner");
  integer(state.deposit, 0n, U64_MAX, "deposit");
  integer(state.settledAmount, 0n, U64_MAX, "settledAmount");
  if (state.previouslyAcceptedAmount !== undefined)
    integer(
      state.previouslyAcceptedAmount,
      0n,
      U64_MAX,
      "previouslyAcceptedAmount",
    );
  if (!["Open", "Closing", "Sealed", "Distributed"].includes(state.status))
    invalid("Unknown channel lifecycle status");
  if (state.settledAmount > state.deposit)
    invalid("Settled amount exceeds deposit in supplied state");
}

export async function verifyVoucher(input: VerifyInput): Promise<Report> {
  const checks: Check[] = [];
  const report: Report = {
    status: "INDETERMINATE",
    protocol: PROTOCOL,
    upstreamCommit: UPSTREAM_COMMIT,
    verificationTime: "",
    checks,
    assumptions: {},
    limitations: [
      "Offline inputs are caller assertions, not authenticated on-chain state.",
      "PASS covers the reported checks only. It does not prove funds, settlement, recipient distribution, or absence of concurrent replay.",
      "No x402 envelope, open transaction, PDA derivation, or Ed25519 precompile instruction is verified.",
      "Strict Ed25519 verification rejects non-canonical or small-order keys/signatures; consensus edge-case equivalence is not claimed.",
    ],
    nextSteps: [],
  };
  const add = (
    code: ReasonCode,
    status: Status,
    category: Check["category"],
    explanation: string,
  ) => checks.push({ code, status, category, explanation });
  const test = (
    ok: boolean,
    yes: ReasonCode,
    no: ReasonCode,
    category: Check["category"],
    explanation: string,
  ) => add(ok ? yes : no, ok ? "PASS" : "FAIL", category, explanation);
  try {
    if (!input || typeof input !== "object")
      invalid("Expected a verification input object");
    if (
      input.now === null ||
      input.policy === null ||
      input.trustedState === null
    )
      invalid("Null is not an omitted verification input");
    const now = input.now ?? BigInt(Math.floor(Date.now() / 1000));
    integer(now, 0n, I64_MAX, "now");
    report.verificationTime = now.toString();
    const message =
      input.message instanceof Uint8Array
        ? input.message.slice()
        : input.message;
    const voucher = decodeVoucher(message);
    add(
      "FORMAT_VALID",
      "PASS",
      "protocol",
      "Canonical 50-byte V1 voucher decoded",
    );
    report.decoded = {
      channelId: hex.encode(voucher.channelId),
      cumulativeAmount: voucher.cumulativeAmount.toString(),
      expiresAt: voucher.expiresAt.toString(),
    };
    const p = input.policy ?? {};
    if (!p || typeof p !== "object" || Array.isArray(p))
      invalid("Policy must be an object");
    validatePolicy(p);
    if (input.trustedState !== undefined) validateState(input.trustedState);
    report.assumptions = JSON.parse(
      serializeReport({
        policy: { requireState: true, ...p },
        trustedState: input.trustedState ?? null,
      }),
    );
    bytes(input.signature, 64, "signature");
    const signature = input.signature.slice();
    report.evidence = {
      messageHex: hex.encode(message),
      signatureHex: hex.encode(signature),
    };
    let signer: Uint8Array | undefined;
    if (input.authorizedSigner === undefined)
      add(
        "SIGNER_REQUIRED",
        "INDETERMINATE",
        "context",
        "Supply the independently trusted authorized public key",
      );
    else {
      bytes(input.authorizedSigner, 32, "authorizedSigner");
      signer = input.authorizedSigner.slice();
      report.evidence.authorizedSignerHex = hex.encode(signer);
      let valid = false;
      try {
        valid = ed25519.verify(signature, message, signer, { zip215: false });
      } catch {
        valid = false;
      }
      test(
        valid,
        "SIGNATURE_VALID",
        "SIGNATURE_INVALID",
        "protocol",
        valid
          ? "Exact signed bytes verified against the supplied trusted key"
          : "Ed25519 signature or public key is invalid for these bytes",
      );
    }
    if (!p.expectedChannelId)
      add(
        "CHANNEL_REQUIRED",
        "INDETERMINATE",
        "context",
        "Supply the independently expected channel address",
      );
    else
      test(
        equal(voucher.channelId, p.expectedChannelId),
        "CHANNEL_MATCH",
        "CHANNEL_MISMATCH",
        "protocol",
        "Signed channel must match the independently expected address",
      );
    if (voucher.expiresAt === 0n) {
      add(
        "NON_EXPIRING",
        "PASS",
        "protocol",
        "Zero disables expiry in the channel protocol",
      );
      if (
        p.rejectNonExpiring ||
        p.minRemainingSeconds !== undefined ||
        p.maxRemainingSeconds !== undefined
      )
        add(
          "EXPIRY_REQUIRED",
          "FAIL",
          "policy",
          "Policy requires a finite expiration",
        );
    } else {
      test(
        now < voucher.expiresAt,
        "NOT_EXPIRED",
        "EXPIRED",
        "protocol",
        `Requires now (${now}) < expiresAt (${voucher.expiresAt})`,
      );
      const remaining = voucher.expiresAt - now;
      if (
        p.minRemainingSeconds !== undefined ||
        p.maxRemainingSeconds !== undefined
      )
        test(
          (p.minRemainingSeconds === undefined ||
            remaining >= p.minRemainingSeconds) &&
            (p.maxRemainingSeconds === undefined ||
              remaining <= p.maxRemainingSeconds),
          "TIME_ALLOWED",
          "TIME_WINDOW",
          "policy",
          `Remaining lifetime: ${remaining} seconds`,
        );
    }
    if (p.maxCumulativeAmount !== undefined)
      test(
        voucher.cumulativeAmount <= p.maxCumulativeAmount,
        "AMOUNT_ALLOWED",
        "AMOUNT_LIMIT",
        "policy",
        `Cumulative amount ${voucher.cumulativeAmount}; application cap ${p.maxCumulativeAmount}`,
      );
    const state = input.trustedState;
    if (!state) {
      if (p.requireState !== false || p.maxIncrease !== undefined)
        add(
          "STATE_REQUIRED",
          "INDETERMINATE",
          "context",
          "Trusted channel state is necessary for deposit, lifecycle, freshness or increase checks",
        );
      else
        report.limitations.push(
          "State checks were explicitly excluded by policy. No replay or deposit assessment was performed.",
        );
    } else {
      test(
        equal(voucher.channelId, state.channelId),
        "CHANNEL_MATCH",
        "CHANNEL_MISMATCH",
        "context",
        "State snapshot must bind to this channel",
      );
      if (signer)
        test(
          equal(signer, state.authorizedSigner),
          "SIGNER_MATCH",
          "SIGNER_MISMATCH",
          "context",
          "State snapshot must bind to the independently expected signer",
        );
      test(
        state.status === "Open",
        "STATE_OPEN",
        "STATE_NOT_OPEN",
        "protocol",
        "This verification profile models settle on an Open channel",
      );
      test(
        voucher.cumulativeAmount <= state.deposit,
        "DEPOSIT_ALLOWED",
        "OVER_DEPOSIT",
        "protocol",
        `Cumulative ${voucher.cumulativeAmount} must not exceed deposit ${state.deposit}`,
      );
      const prior =
        state.previouslyAcceptedAmount !== undefined &&
        state.previouslyAcceptedAmount > state.settledAmount
          ? state.previouslyAcceptedAmount
          : state.settledAmount;
      test(
        voucher.cumulativeAmount > state.settledAmount,
        "WATERMARK_ADVANCED",
        "STALE_AUTHORIZATION",
        "protocol",
        `Requires cumulative ${voucher.cumulativeAmount} > settled watermark ${state.settledAmount}`,
      );
      if (state.previouslyAcceptedAmount !== undefined)
        test(
          voucher.cumulativeAmount > state.previouslyAcceptedAmount,
          "WATERMARK_ADVANCED",
          "STALE_AUTHORIZATION",
          "policy",
          `Requires cumulative > previously accepted ${state.previouslyAcceptedAmount}`,
        );
      if (p.maxIncrease !== undefined)
        test(
          voucher.cumulativeAmount > prior &&
            voucher.cumulativeAmount - prior <= p.maxIncrease,
          "INCREASE_ALLOWED",
          "INCREASE_LIMIT",
          "policy",
          `Increase from watermark ${prior} must be positive and <= ${p.maxIncrease}`,
        );
    }
  } catch (error) {
    add(
      error instanceof VoucherError ? error.code : "INVALID_INPUT",
      "FAIL",
      "context",
      error instanceof Error ? error.message : "Invalid input",
    );
  }
  report.status = checks.some((c) => c.status === "FAIL")
    ? "FAIL"
    : checks.some((c) => c.status === "INDETERMINATE")
      ? "INDETERMINATE"
      : "PASS";
  if (report.status === "INDETERMINATE")
    report.nextSteps.push(
      "Supply the missing independent channel, signer or authenticated state inputs.",
    );
  if (report.status === "FAIL")
    report.nextSteps.push(
      "Reject this authorization under these inputs; investigate each failed check.",
    );
  return report;
}

export function formatReport(report: Report): string {
  return [
    `VoucherGuard ${report.status}`,
    `${report.protocol} | Unix time ${report.verificationTime}`,
    ...report.checks.map((c) => `${c.status} [${c.code}] ${c.explanation}`),
    "",
    "Limitations:",
    ...report.limitations,
    ...report.nextSteps,
  ].join("\n");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(
  o: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) invalid(`Unknown ${label} field: ${k}`);
}
function decimal(v: unknown, label: string): bigint {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(v))
    invalid(`${label} must be a canonical non-negative decimal string`);
  return BigInt(v);
}
function encoded(v: unknown, size: number): Uint8Array {
  const o = object(v, "encoded bytes");
  keys(o, ["encoding", "value"], "encoding");
  if (
    !["hex", "base64", "base58"].includes(String(o.encoding)) ||
    typeof o.value !== "string"
  )
    invalid("Expected {encoding: hex|base64|base58, value: string}");
  return decodeBytes(o.value, o.encoding as Encoding, size);
}
/** Strict JSON adapter shared by CLI and browser. File assertions are not trust evidence. */
export function parseVoucherDocument(value: unknown): VerifyInput {
  const o = object(value, "document");
  keys(
    o,
    [
      "protocol",
      "message",
      "signature",
      "authorizedSigner",
      "policy",
      "trustedState",
      "now",
    ],
    "document",
  );
  if (o.protocol !== PROTOCOL)
    invalid(
      `Only ${PROTOCOL} documents are supported; x402 envelopes are not supported`,
    );
  const input: VerifyInput = {
    message: encoded(o.message, 50),
    signature: encoded(o.signature, 64),
  };
  if (o.authorizedSigner !== undefined)
    input.authorizedSigner = encoded(o.authorizedSigner, 32);
  if (o.now !== undefined) input.now = decimal(o.now, "now");
  if (o.policy !== undefined) {
    const p = object(o.policy, "policy");
    keys(
      p,
      [
        "expectedChannelId",
        "maxCumulativeAmount",
        "maxIncrease",
        "rejectNonExpiring",
        "minRemainingSeconds",
        "maxRemainingSeconds",
        "requireState",
      ],
      "policy",
    );
    const policy: Policy = {};
    if (p.expectedChannelId !== undefined)
      policy.expectedChannelId = encoded(p.expectedChannelId, 32);
    for (const k of [
      "maxCumulativeAmount",
      "maxIncrease",
      "minRemainingSeconds",
      "maxRemainingSeconds",
    ] as const)
      if (p[k] !== undefined) policy[k] = decimal(p[k], k);
    for (const k of ["rejectNonExpiring", "requireState"] as const)
      if (p[k] !== undefined) {
        if (typeof p[k] !== "boolean") invalid(`${k} must be boolean`);
        policy[k] = p[k];
      }
    validatePolicy(policy);
    input.policy = policy;
  }
  if (o.trustedState !== undefined) {
    const s = object(o.trustedState, "trustedState");
    keys(
      s,
      [
        "channelId",
        "authorizedSigner",
        "deposit",
        "settledAmount",
        "status",
        "previouslyAcceptedAmount",
      ],
      "state",
    );
    if (
      !["Open", "Closing", "Sealed", "Distributed"].includes(String(s.status))
    )
      invalid("Unknown state status");
    input.trustedState = {
      channelId: encoded(s.channelId, 32),
      authorizedSigner: encoded(s.authorizedSigner, 32),
      deposit: decimal(s.deposit, "deposit"),
      settledAmount: decimal(s.settledAmount, "settledAmount"),
      status: s.status as TrustedState["status"],
    };
    if (s.previouslyAcceptedAmount !== undefined)
      input.trustedState.previouslyAcceptedAmount = decimal(
        s.previouslyAcceptedAmount,
        "previouslyAcceptedAmount",
      );
  }
  return input;
}

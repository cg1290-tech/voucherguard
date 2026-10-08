# API and document schema

The core entry point is `@voucherguard/core`, ESM only. Types are emitted in `packages/core/dist`. Public exports: `PROTOCOL`, `UPSTREAM_COMMIT`, `U64_MAX`, `VoucherError`, `encodeVoucher`, `decodeVoucher`, `encodeBytes`, `decodeBytes`, `verifyVoucher`, `parseVoucherDocument`, `serializeReport`, `formatReport`, and associated TypeScript interfaces.

## Binary APIs

`decodeVoucher(message: Uint8Array): Voucher` rejects length other than 50, incorrect domain and unsupported version. Return fields: `channelId` (copied 32 bytes), `cumulativeAmount` (u64 bigint), `expiresAt` (i64 bigint).

`encodeVoucher(voucher: Voucher): Uint8Array` validates 32-byte channel and bigint ranges; no signing, keys or transaction operations. Amount range `0 .. 2^64-1`; expiry `-2^63 .. 2^63-1`. JS numbers are rejected even when safe to represent.

`decodeBytes(value: string, encoding: 'hex'|'base64'|'base58', size: number)` validates canonical encoding and exact decoded length. Hex is unprefixed, case-insensitive. Base64 is standard canonical padded encoding, not URL-safe base64. Whitespace/prefixes/invalid characters are rejected. Fields are capped at 256 encoded characters.

## verifyVoucher

```ts
interface VerifyInput {
  message: Uint8Array;
  signature: Uint8Array;
  authorizedSigner?: Uint8Array;
  policy?: Policy;
  trustedState?: TrustedState;
  now?: bigint;
}
```

Returns `Promise<Report>`. Current implementation runs cryptography synchronously inside the promise; copied message/signature/signer bytes cannot be changed across an asynchronous network step (there is none). Runtime malformed inputs return FAIL rather than throwing. The codec and JSON adapter throw `VoucherError` for malformed input.

`now` is Unix seconds in `[0, 2^63-1]`. Omission uses current local clock rounded down to seconds. Provide explicit time for deterministic verification. Report `verificationTime` is the **evaluation Unix time**, not a separate wall-clock timestamp; simulations use the simulated value.

### Policy

| Field | Meaning / default |
| --- | --- |
| `expectedChannelId?: Uint8Array` | Independent 32-byte expected channel; absence is INDETERMINATE |
| `maxCumulativeAmount?: bigint` | Application u64 ceiling, inclusive; absent means no app ceiling |
| `maxIncrease?: bigint` | Positive increase above max(settled, previously accepted), inclusive cap; always requires state |
| `rejectNonExpiring?: boolean` | Reject `expiresAt == 0`; defaults false |
| `minRemainingSeconds?: bigint` | Inclusive minimum finite remaining lifetime |
| `maxRemainingSeconds?: bigint` | Inclusive maximum finite remaining lifetime |
| `requireState?: boolean` | Defaults true; false permits explicit reduced scope when no state is supplied |

All policy integers are nonnegative u64 BigInts. An inverted time window is invalid input. A lifetime-window policy rejects non-expiring vouchers because a finite remaining lifetime cannot be established. Missing expected signer/channel cannot be overridden by disabling state checks. Policies do not relax expiry or format/signature requirements.

### Trusted state

```ts
interface TrustedState {
  channelId: Uint8Array;
  authorizedSigner: Uint8Array;
  deposit: bigint;
  settledAmount: bigint;
  status: 'Open'|'Closing'|'Sealed'|'Distributed';
  previouslyAcceptedAmount?: bigint;
}
```

Authenticate this snapshot externally. The library checks its binding, ranges and coherence (`settled <= deposit`). It does not authenticate its provenance or freshness. Only Open is accepted in the ordinary `settle` profile. `settledAmount` must be strictly below cumulative. Optional `previouslyAcceptedAmount` adds a strict application watermark; it can exceed deposit if your external acceptance history does, but will still reject any non-advancing voucher.

### Report

Contains overall `status`, supported `protocol`, `upstreamCommit`, `verificationTime`, individual `checks` (typed code, status, category and explanation), safe decoded string fields, original signed bytes/signature/expected public key as hex evidence, policy/state assumptions, limitations and next steps. `FAIL` takes precedence over INDETERMINATE. `PASS` never means the voucher was submitted, settled, or guaranteed safe.

Reason codes are defined by the exported `ReasonCode` union. A check category is `protocol` (format/crypto/field invariant), `policy` (application constraint) or `context` (supplied context/missing or malformed input). Context includes the independent-trust boundary; it is not automatically authenticated evidence.

`serializeReport(value)` serializes bigint to decimal strings and byte arrays to hex. `formatReport(report)` produces a readable text report. Reports contain public but potentially commercially sensitive inputs and should be shared deliberately.

## JSON document adapter

`parseVoucherDocument(value: unknown): VerifyInput` is shared by CLI and web. Unknown fields are rejected to catch misspelled policies and unsupported envelopes. Numbers in integer fields are rejected; use canonical nonnegative decimal strings. Signed expiration remains inside binary bytes, not a separate editable claim.

```json
{
  "protocol": "solana-payment-channels/v1",
  "message": {"encoding": "hex", "value": "<exactly 50 bytes>"},
  "signature": {"encoding": "hex", "value": "<exactly 64 bytes>"},
  "authorizedSigner": {"encoding": "hex", "value": "<32 bytes>"},
  "now": "1900000000",
  "policy": {
    "expectedChannelId": {"encoding": "hex", "value": "<32 bytes>"},
    "maxCumulativeAmount": "1000",
    "maxIncrease": "500",
    "rejectNonExpiring": true,
    "requireState": true
  },
  "trustedState": {
    "channelId": {"encoding": "hex", "value": "<32 bytes>"},
    "authorizedSigner": {"encoding": "hex", "value": "<32 bytes>"},
    "deposit": "2000",
    "settledAmount": "100",
    "status": "Open",
    "previouslyAcceptedAmount": "150"
  }
}
```

The placeholders above describe the schema; [../examples/valid.json](../examples/valid.json) is a working signed fixture. Encoded fields can independently choose hex, base64 or base58. Authorizer, time, policy and state are optional at the document level, but missing context affects verification. Raw `message`/`signature` are mandatory.

Never elevate the document's signer or state into trusted context just because the schema parses successfully.

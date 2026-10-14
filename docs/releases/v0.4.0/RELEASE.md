# VoucherGuard 0.4.0 — Solana Transaction Workspace

One Solscan link. Understand what changed, explore recorded instructions and find the reported failure point.

Free includes Transaction X-Ray, Wallet Impact, Permission Map, account focus and explanations for recognized failures. The offline Advanced Verification lab remains available for supported signed payment-channel vouchers.

Pro adds saved personal transaction preferences, fee/program/delegation/authority checks, authenticated-wallet balance guardrails and token mint lists, Wallet Impact exports, local saved reports and comparisons, and custom voucher policies/batches. Solana access requires verified holdings of 5M VG and a signed authentication challenge.

## Boundaries

All new views reuse the already loaded transaction. They add no RPC calls, background monitoring or AI service. Initial link lookup and holder eligibility still use read-only RPC.

Evidence is historical. Unknown instructions, unsupported custom errors, missing or conflicting ownership and display limits remain explicit. Permission operations are not currently active permissions; balance changes are not profit/loss. Personal list mismatches are not scam verdicts. This is not an audit or security certification.

## Validation

Typecheck, lint, production build, 277 unit tests and 17 browser tests passed. Release packages are available as downloadable assets; npm publication is not part of this release.

# Protocol research and supported profile

Source inspected on 2026-10-08. Repository source was cloned and read before implementing the verifier. Pinned commits, not floating `main`, define this release.

## Solana Foundation payment-channels

Commit: `3ffa4d6728ad88e4a9667a76ad9ccd68a302c696`.

Primary sources:

- [Wire layout and VoucherArgs](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/program/payment_channels/src/instructions/mod.rs)
- [Voucher validation and Rust unit vectors](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/program/payment_channels/src/instructions/helpers/voucher.rs)
- [Ordinary settle lifecycle checks](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/program/payment_channels/src/instructions/settle.rs)
- [Ed25519 instruction parser](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/program/payment_channels/src/instructions/helpers/ed25519/parse.rs)
- [State machine and replay contract](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/docs/001-payment-channel-state-machine.md)
- [Generated TypeScript voucher codec](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/clients/typescript/src/generated/types/voucherArgs.ts)
- [Numeric safety regressions](https://github.com/solana-foundation/payment-channels/blob/3ffa4d6728ad88e4a9667a76ad9ccd68a302c696/clients/typescript/src/__tests__/voucher-numeric-safety.test.ts)

The signed message is the exact 50-byte payload, with no extra prefix or hashing performed by VoucherGuard. Domain `0x56` and version `0x01` are distinct parser errors. Amount is u64 LE, expiration is i64 LE, channel identifier is raw 32-byte address.

### Lifecycle

`open` creates the channel PDA and escrow ceiling. Off-chain Ed25519 vouchers cumulatively authorize usage. `settle` advances the settled watermark on an Open channel. Cooperative `settle_and_seal`, or forced close/grace/seal, locks the final watermark. `distribute` pays recipients and refunds unspent balance; `reclaim` may later recover channel rent.

The upstream program derives the channel PDA with `open_slot` among its seeds, preventing reuse of an address for a later incarnation. VoucherGuard does not derive the PDA or prove account existence. Its caller must independently bind the channel identifier to the intended program/network/channel instance.

### Implemented checks

- Valid wire format, exact message length, exact signature length, expected public-key length.
- Strict Ed25519 verification against the expected public key, never a self-asserted identity inferred from the voucher.
- Signed channel equals independently supplied expected channel.
- Zero expiry disables expiry; otherwise `now >= expiresAt` is expired. Negative expiry is representable but expired for nonnegative supported verification times.
- With trusted state, signed cumulative amount is above settled watermark and at/below deposit; state binds to the expected signer and channel; ordinary `settle` profile requires Open status.
- Optional application policies: cumulative cap, bounded increment, finite expiry, inclusive remaining-lifetime window, previously accepted watermark.

### Deliberate boundary

The upstream verifier reads the signature-verified message from a canonical preceding single-signature Ed25519 precompile instruction via Instructions sysvar. VoucherGuard accepts a detached message/signature and does not inspect transaction placement, account ownership, instruction privileges, program deployment, token mint, escrow, distribution or settlement execution. It does not implement the broader lifecycle rules for `settle_and_seal`. `Closing` is rejected for the ordinary `settle` profile even if another upstream instruction might accept a voucher there.

The Rust `voucher_args_bytes_match_signed_payload_layout` test is ported to `tests/core.test.ts`: 32 repetitions of `07`, u64 bytes `77 66 55 44 33 22 11 00`, i64 bytes `f8 f9 fa fb fc fd fe 7f`. Upstream's pure validator tests stub the already verified Ed25519 instruction; they are not detached signature test vectors. We generate actual test signatures and independently cross-check them with Node crypto.

## x402

Commit: `7f2b2f1f77fa5317615735e3378a6fad41cccb4e`; core specification declares **protocol version 2**.

- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/specs/x402-specification-v2.md)
- [SVM exact scheme](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/specs/schemes/exact/scheme_exact_svm.md)
- [SVM upto scheme](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/specs/schemes/upto/scheme_upto_svm.md)
- [SVM upto implementation](https://github.com/x402-foundation/x402/tree/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/svm/src/upto)

`exact` transports a partially signed transaction and requires transaction/outcome verification. `upto` uses payment channels with a client-signed ceiling/open transaction and a receiver-authorizer-signed voucher. That authorizer can be server/facilitator controlled, so a voucher signature must not be described as necessarily the payer's signature. The scheme additionally requires recipient/distribution commitment, exact deposit ceiling, fee-payer/lifecycle rules, validAfter policy and nonzero expiration.

VoucherGuard's `rejectNonExpiring:true` can enforce the finite-expiry policy on the voucher, but this does not make it an x402 `upto` verifier. Full x402 envelopes are rejected by the document adapter rather than routed to inappropriate voucher logic.

## Ambiguities and choices resolved before implementation

- A zero expiration is protocol-valid; rejection is application policy unless implementing the full x402 SVM `upto` scheme.
- Equality with settled watermark is invalid, not a fresh authorization. Equality with a previously accepted watermark is rejected only when that application policy is requested through supplied state.
- State-free signature verification cannot know replay history. Required state absence produces INDETERMINATE; explicit reduced-scope verification states its limitations.
- Detached strict Ed25519 verification is conservative. We do not assert exhaustive matching of Solana precompile consensus behavior on exotic noncanonical/torsion encodings. False acceptance is not used to paper over uncertainty.
- PASS denotes the declared checks on the supplied snapshot. It cannot establish current chain state or future settlement success.

The x402 [shared voucher encoder/verifier](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/svm/src/payment-channels/voucher.ts) independently uses offsets 0/2/34/42 and base58 detached signatures. Its verifier uses WebCrypto Ed25519. The inspected facilitator claim path explicitly rejects `expiresAt == 0`, checks `validAfter`, re-encodes the cumulative actual amount, and verifies the receiver-authorizer signature. VoucherGuard accepts those detached bytes through explicit base58 decoding, but does not reconstruct or authenticate the complete `upto` claim context.

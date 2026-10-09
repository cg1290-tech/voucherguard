# Security model

VoucherGuard is security-sensitive, unaudited software. It has **not undergone an independent security audit**. A maintained cryptographic dependency does not make this application audited.

## Threat model

Untrusted agents or callers may provide altered, malformed, oversized or stale authorizations, claim another signer, target another channel, exceed a budget, or replay authorization. The engine decodes exact bytes, verifies Ed25519 with a maintained library, and applies explicit protocol-field and application-policy checks.

The trusted computing base includes the application/runtime, installed dependencies, verifier code, independently authenticated expected signer/channel, reliable clock, and authenticated state snapshot. A signer legitimately authorizing a malicious or expensive action can still produce a valid signature; budgets and application policy are essential. No semantic assessment of purchased resources or agent intent is performed.

## Caller responsibilities

- Obtain signer and channel independently, never solely from the untrusted signed document.
- Authenticate channel snapshot ownership/program/network and bind signer/channel/deposit/lifecycle.
- Ensure state is fresh enough for your risk model. The library cannot validate snapshot provenance.
- Use a trusted clock for expiry. Explicit bigint Unix seconds make verification deterministic; local wall time is a convenience default.
- Atomically reserve/update application watermarks. Two concurrent verifications against the same old watermark can both PASS; this stateless toolkit cannot eliminate that race.
- Keep integer values in base token units and use BigInt/decimal strings.
- Let native on-chain settlement perform all of its own verification.

## Scope

Default checks require channel state. Explicit `requireState:false` excludes absent state checks and adds a reduced-scope limitation. A required check cannot silently disappear: missing signer/channel or state requested by a policy produces INDETERMINATE. Definitive failure wins over uncertainty. Malformed inputs FAIL, never PASS.

Detached Ed25519 verification uses `@noble/curves` with `zip215:false` to reject noncanonical/small-order edge cases conservatively. This is not a claim of complete consensus equivalence with the Solana precompile. Channel checks model ordinary Open-channel `settle`; `settle_and_seal` and transaction verification are outside scope.

The voucher verifier performs no on-chain account authentication, balance inspection, PDA derivation, escrow validation, recipient distribution, x402 payload verification, fee-payer safety, program execution, inclusion/finality, wallet operation or payment execution. PASS does not certify funds or settlement. It is conditional evidence, not a security certification.

## Data and operational handling

No private keys are accepted by public APIs, CLI or playground. The development fixture generator includes a PUBLIC TEST ONLY seed, all 32 bytes equal to `0x2a`. Never fund this key. There are no network calls in core/CLI verification. The optional Pro section uses a Wallet Standard connection and read-only public RPC calls for token access; the free playground remains independent. The static web app loads local assets only; manually clicking a configured GitHub link opens that external site. JSON/text reports include public voucher bytes, policies and supplied state, which may still contain sensitive commercial data; exports remain local unless the user shares them.

CLI file inputs and web payloads have a 64 KiB cap; encoded byte fields have length bounds. BigInt ranges, exact byte lengths, explicit endianness, canonical encodings and unknown JSON/policy fields are validated. No eval, dynamic execution, secret logging, storage, telemetry, database or transaction submission is present. JSON reports are displayed as text by React, never injected HTML.

Dependency installation/build tools can access the network during initial setup. Runtime verification does not. The lockfile is committed for reproducibility. Review dependency updates and CI action updates before adoption.

## Reporting vulnerabilities

Private vulnerability reporting is enabled for `cg1290-tech/voucherguard`. Use the repository Security → Report a vulnerability interface. No private email address or external reporting service is required.

Do not post exploit details or secrets in public issues. Include affected version, minimal reproduction, violated invariant, trust assumptions and expected/observed behavior. This project currently promises no response SLA or bounty.

Only 0.1.x is in scope for initial maintenance. The initial 0.1.0 release is a pre-release, not a production security certification. Independent review remains required before relying on it for consequential payment authorization.

## Optional Pro holder access

Pro reads the configured mainnet mint and connected wallet's token accounts through a public HTTPS RPC, checks program/owner/mint/decimals, and compares BigInt raw amounts. Requests are bounded and canceled on account changes. Failure or unavailable data cannot grant access. No transaction, message signature, approval, delegation, seed or private key is requested. A public wallet address is disclosed to the configured RPC (including the Pages relay host and its fixed public upstream) only for an explicit connection with a configured mint.

The optional Pages relay accepts only getGenesisHash, getAccountInfo, getTokenAccountsByOwner and getTransaction. It reconstructs canonical read parameters, never forwards cookies, credentials, caller URLs or headers, uses fixed HTTPS upstreams (optional `HELIUS_API_KEY` Pages secret first) with manual redirect handling (Workers reject `redirect: "error"`), and bounds requests to 4 KiB and responses to 1 MiB. A per-isolate throttle allows 30 requests per IP per minute; this is best-effort abuse control, not a globally synchronized quota. CORS permits the product origin, its GitHub Pages fallback and the explicit local test origin. CORS is not authentication. It protects no secrets and exposes no signing or payment capability. Static routes bypass the worker through `_routes.json`.

The gate is bypassable client-side convenience, not authentication or protection for exclusive code/IP. A fake provider can claim a holder address without proving control; a dishonest/stale RPC can misreport data. Do not rely on it for privileged APIs, secrets, funds or other sensitive operations. Normal production ships no test wallet, mock RPC or development unlock flag. The mint remains unset until independently confirmed after launch. See [Pro model and activation](docs/pro.md).

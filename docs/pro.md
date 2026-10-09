# VoucherGuard Pro

Pro is an optional, client-side holder toolkit for the future **$VG** token on **Solana mainnet-beta**. Free Quick Check, Advanced Verification, core SDK and CLI keep their existing functionality. Advanced Verification and the SDK/CLI require no wallet. Quick Check and Pro use an optional Cloudflare Pages read-only RPC relay. It has no database, custody, token transfers, signing requests, subscriptions or paid APIs.

## Pre-launch behavior

The official mint is **unset by default**. Production shows **Token access coming soon** and the Policy Builder stays locked. Connecting a wallet does not grant eligibility. No mint, token launch, on-chain contract or holdings are invented.

The code is complete and testable before a token exists. Tests inject a Wallet Standard wallet and intercept read-only RPC responses outside the application. The browser test harness creates a separate temporary production build with a TEST-ONLY configured mint. No wallet/balance fixture, development bypass or mock flag is bundled into the normal production application. Neither URL parameters nor missing configuration unlock Pro.

## Read-only wallet integration

Wallet discovery uses the maintained `@wallet-standard/app`, `@wallet-standard/base` and `@wallet-standard/features` packages. Compatible Solana wallets are discovered dynamically rather than through hard-coded browser globals. The integration requires Wallet Standard `standard:connect` and `standard:events` version 1.0.0. `standard:disconnect` is used when provided; otherwise the application clears its local session. No reconnection or account request is made automatically on page load.

Connect obtains a public account only. The application never calls sign-message, sign-transaction, sign-and-send, approval or delegation features. A wallet can offer those capabilities; Pro does not use them. Account changes revoke the previous gate immediately and trigger a new read. Multiple authorized accounts can be selected. Disconnect clears access; unfinished connection and RPC results cannot restore it.

Wallet accounts must expose a mainnet-supported chain (`solana:mainnet`), a 32-byte public key and a matching canonical base58 address. Wallet Standard reports supported account chains, not necessarily a wallet application's current visual network selector. The configured RPC's **full genesis hash** is independently checked against mainnet-beta; no wallet network-switch or signing flow is requested.

This targets any compatible Wallet Standard Solana wallet. Local automated tests use injected providers; real Phantom/Solflare/Backpack extension sessions have not been exercised or certified by this change.

## Eligibility algorithm

The configured amount defaults to **one whole VG token**. Eligibility is based on visible raw token units, with no floating-point arithmetic:

1. Refuse missing/invalid configuration, an absent wallet, or an account without mainnet support.
2. Call `getGenesisHash` and require the full mainnet-beta genesis hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` (not the shortened CAIP-2 reference).
3. Fetch the configured mint with `getAccountInfo`, `jsonParsed`, at confirmed commitment. Require an initialized mint owned by either the legacy SPL Token Program or Token-2022 and obtain its integer decimals from chain data.
4. Fetch `getTokenAccountsByOwner` for the connected owner and exact configured mint, with `minContextSlot` bound to the observed mint slot. The mint filter covers the program associated with that mint; querying both entire program namespaces is unnecessary.
5. Validate each returned account's public key, uniqueness, program owner, parsed account type, token owner, exact mint, initialized/frozen state and decimals. Wrong or malformed data closes access rather than being trusted or counted twice.
6. Sum the canonical u64 raw amount strings using BigInt. Convert the human threshold decimal string using the mint decimals, exactly. Ignore `uiAmount` and other floating-point/display approximations.
7. Unlock only when the aggregate is at least the exact threshold. All RPC failures, unavailable data, malformed amounts or unsupported network responses keep the Builder locked.

There are three sequential read-only RPC methods per successful check. Requests have an eight-second timeout each, use no credentials/referrer, and are canceled on identity/configuration changes. No timer polls balances. Rechecks occur on connection/account events and **Refresh access**. Rechecking temporarily closes the gate; unsent Builder draft values remain in local component memory and become available again after a successful check.

Frozen accounts can count as ownership; this does not establish spendability. Confidential/unavailable amounts cannot prove a threshold. Token-2022 scaled display/interest-bearing UI amounts are not used: ownership is measured in the underlying raw units. These reads are not an atomic on-chain snapshot, a cryptographic state proof or a guarantee that holdings will remain after the check. The RPC provider is trusted to report accurate data.

## Policy Builder

Eligible users can edit:

- Maximum cumulative amount and maximum authorized increase, in voucher token base units.
- Finite-expiration requirement.
- Minimum/maximum remaining validity, in seconds.
- Requirement for trusted channel state.
- Expected channel identifier, with explicit hex/base58/base64 encoding.

The Builder validates through the core's exported `parsePolicyDocument` function, the same schema used by CLI and playground. It does not create a parallel verification engine or weaken protocol checks. Empty optional fields omit the corresponding application constraint. Integers are canonical decimal strings within the existing schema's range; negative, fractional, overflow and inverted time windows are rejected. Zero values remain valid where the core permits them.

**Standard example** enables finite expiry and trusted state without inventing a spending ceiling. **Conservative example** adds demonstrative values (1,000,000 cumulative base units, 100,000 increase, 30–300 seconds remaining). These are editable examples, not universal safe limits or security guarantees; adjust to the actual voucher token's units and risk model. The VG holder threshold is unrelated to a voucher's token amount.

Preview the generated JSON, copy it or download `voucherguard-policy.json`. **Apply to Advanced** replaces only the policy and updates corresponding visual policy controls. Signed message, signature, authorized signer, trusted state, explicit time and unrelated document fields are preserved. Applying an invalid policy or malformed voucher document is rejected before modification. Missing expected channel/state can still produce INDETERMINATE.

Batch Verification and Advanced Reports are labeled **Coming later / not implemented**. They are not available in this implementation and have no promised release date.

## Public configuration and activation

Edit `apps/web/.env.local` locally or supply the following public environment variables to the build:

```dotenv
# Leave unset until the official $VG mainnet mint is independently confirmed.
VITE_VG_TOKEN_MINT=
VITE_VG_RPC_URL=https://voucherguard.pages.dev/api/solana-rpc
VITE_VG_HOLDER_THRESHOLD=1
VITE_VG_NETWORK=mainnet-beta
```

After launch:

1. Independently confirm and review the official mainnet mint. Set `VITE_VG_TOKEN_MINT` to that exact address; never substitute a ticker, speculative mint or example fixture.
2. Set a public, browser/CORS-compatible HTTPS RPC endpoint. The default Pages relay forwards only three read methods to the fixed Solana public endpoint; direct browser requests to that upstream may return HTTP 403. The connected public address is visible to the relay host and upstream. No custom node, paid service or API subscription is required. These Vite variables are public; never add a privileged API key, credentials or secret.
3. Set a positive decimal threshold, normally `1`. Precision must be supported by the mint decimals. No balances are approximated with floats.
4. Run `pnpm check` and `pnpm test:browser`, inspect the static build, and rebuild/deploy through the existing manual GitHub Pages workflow. The Pages workflow passes **repository variables** `VG_TOKEN_MINT`, `VG_RPC_URL`, `VG_HOLDER_THRESHOLD`, `VG_NETWORK` into the public build. With no repository mint variable, the deployed gate stays coming-soon and locked.
5. On the public site, connect an independently funded holder wallet, refresh and check the displayed configuration/status. Repeat with an ineligible wallet and a disconnected session. Do not assume a fixture test proves real token availability.

The free verifier remains static and supports the existing GitHub Pages subpath. Pro uses the deployed Pages relay by default; Vite preview and GitHub Pages do not execute `_worker.js`. There is no token issuance, smart contract, staking, payment, transfer or on-chain activation transaction in this project.

## Limitations of client-side gating

**This is a convenience/access feature, not secure authentication or protected IP.** The application ships its JavaScript to every visitor. A user can alter the browser state, supply a fake provider or run the open-source Builder directly. Connecting a public account without a signed challenge is not cryptographic proof that the visitor controls that key. No privileged APIs, secrets or exclusive intellectual property can depend on this gate.

An eligible status is a report about supplied wallet identity and RPC data, not investment advice, token certification or a security audit. It does not alter the voucher engine's PASS / FAIL / INDETERMINATE semantics and does not prove settlement, available funds or replay prevention. Pro and the verifier remain unaudited.

## Verification and test harness

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

Unit tests mock ownership readers, raw RPC responses and Wallet Standard notifications. Browser tests inject a provider and intercepted RPC in isolated Playwright pages; these fixtures exist only under `tests/`. `scripts/pro-browser-server.mjs` builds a temporary TEST-ONLY configuration for those tests and serves static assets with Vite preview. It never enables a runtime development gate in production code. The ordinary production build remains unchanged by the harness and is separately tested with its default unset mint.

Tests cover missing mint, disconnected/eligible/ineligible wallets, exact and multiple-account thresholds, both token programs, ownership/mint/program/decimals mismatches, incorrect network/genesis, configuration validation, RPC failures/recovery, stale-account response races, no signing, Builder validation/export/apply/reset, unchanged signed fields and the existing free workflow.

Primary references: [Wallet Standard app API](https://github.com/wallet-standard/wallet-standard), [Solana getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo), [getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner), [Solana chain namespace](https://github.com/ChainAgnostic/namespaces/blob/main/solana/caip350.md).

# VoucherGuard

**Your Solana Transaction Workspace.**

One Solscan link. Understand what changed, explore recorded instructions and find the reported failure point. Free exploration; personal rules and evidence exports with Pro.

[Try Free X-Ray](https://voucherguard.pages.dev/#quick-check) · [Explore Pro](https://voucherguard.pages.dev/#pro) · [Release 0.4.0](https://github.com/cg1290-tech/voucherguard/releases/tag/v0.4.0) · [Source repository](https://github.com/cg1290-tech/voucherguard)

VoucherGuard combines a **Free Transaction X-Ray** for selected recorded Solana transaction effects, **Pro personal rule alerts** for $VG holders, and an offline verifier for **Solana Foundation payment channel V1 vouchers**. X-Ray remains useful when no supported voucher is present; unsupported program operations stay visibly undecoded.

AI agents can authorize spending. A valid signature alone does not establish that the authorization matches your channel, budget, clock or settlement watermark. VoucherGuard makes those checks explicit and reviewable.

**Quick Check** uses a read-only public RPC relay. **Advanced Verification** (document lab) needs no wallet. Optional **VoucherGuard Pro** is Cloudflare Worker–gated for $VG holders on Solana (signed challenge + on-chain balance); Policy Builder is served only with a valid holder session. No private-key collection, payment execution, telemetry or AI inference. Not an agent platform. Not a full x402 verifier.

**Not independently audited.** Do not treat PASS reports, Pro unlock, or this software as a security certification for consequential payment authorization.

## Free and Pro at a glance

| Capability | Free | Pro |
| --- | --- | --- |
| Rule Replay: compare editable Custom, Balanced and Strict profiles on loaded evidence | — | Yes, with comparison export |
| Trade Receipt: sent/received net changes, recorded fee and candidate exchange ratio | Yes | Yes |
| Trade Journal: confirmed imported token ↔ supported native SOL/USDC/persistent WSOL trades | — | Conditional FIFO, partial sales, remaining cost and CSV/JSON export |
| Transaction DNA: visual ordered operation fingerprint | Yes | Compare loaded and locally saved reviews; exact differences and JSON export |
| Permission Map of selected recorded account operations | Yes | Captured delegation, authority and program-list alerts |
| One-link X-Ray with Money/Permissions lenses | Yes, no wallet required | Yes |
| Wallet Impact: recorded SOL and grouped token before/after | Yes | Yes, with captured rules and JSON export |
| Failure explanation, recorded fee and top-level failure point | Yes | Yes |
| My wallet/account focus using direct recorded references | Yes | Yes |
| Pause, scrub and inspect recorded instruction evidence | Yes | Yes |
| Personal fee, delegation, authority and program-list rules | — | Saved per wallet in this browser |
| Rule highlights on relevant X-Ray steps | — | Yes |
| Saved reports, comparisons and downloadable evidence cards | — | Yes, local browser storage |
| Custom voucher policies and voucher-file batches | Advanced manual verification | Policy Builder and up to 100 voucher files |

Wallet Impact groups token accounts only when recorded ownership, mint and precision agree before and after. Missing or conflicting records are excluded explicitly. Fee-payer SOL changes already include the fee; totals are historical snapshots, not profit/loss or current holdings.

Permission Map connects account addresses and selected recorded permission operations. Repeated grants, revocations and authority changes remain separate; it does not infer currently active permissions. Display is limited to 24 connections and 16 nodes, with omissions disclosed.

Transaction DNA visualizes the ordered X-Ray evidence as a transfer/permission/undecoded sequence. Its versioned SHA-256 fingerprint covers scoped operations, exact amounts, permission targets, resolved program references, execution states and coverage notes; it is not a hash of the raw transaction and excludes signatures, fees and final balances. Matching DNA does not certify identity or safety. Pro compares loaded or locally saved reviews without refetching: added/removed programs and operations, changed amounts/states, and ordering differences. Duplicate operations are counted individually; changed targets appear as removed/added operations. Opaque instructions retain raw data and account references. Missing traces remain explicit, and older or malformed saved evidence is skipped without inference. DNA exports stay local; local reports are editable, not authenticated evidence.

Failed transactions show recognized runtime errors in plain English and the top-level instruction identified by the recorded error. Custom program codes remain uninterpreted; bounded program logs are diagnostic text, not verified explanations. Pro rule alerts are separate from failure causes. Pro also offers saved Wallet Impact guardrails for the authenticated wallet: a maximum net SOL decrease and net token decrease alerts. These use historical balances, include fees/rent in SOL changes, and do not estimate spending or losses. Missing wallet evidence remains incomplete. A personal allowed-token list flags nonzero historical token balance changes outside saved mint addresses. You can fill the draft from documented token ownership in current reviews, then save. List mismatches are not scam or safety verdicts.

Select an address already present to replay its directly referenced steps and filter final account balance changes. Token-account ownership is not inferred; missing or undecoded evidence remains explicit.

Both views use the same existing transaction lookup. Playback and personal rule checks add no RPC calls. Link lookups and hosted holder checks still require read-only RPC; the offline signed-document verifier does not.

[Release 0.4.0 details](docs/releases/v0.4.0/RELEASE.md) · [Changelog](CHANGELOG.md)

## Scope and protocol

Supports the 50-byte Ed25519-signed message from `solana-foundation/payment-channels`, pinned to commit `3ffa4d6728ad88e4a9667a76ad9ccd68a302c696`:

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 2 | `56 01`: domain `V`, format V1 |
| 2 | 32 | Channel PDA address bytes |
| 34 | 8 | Cumulative amount, little-endian u64 |
| 42 | 8 | Expiration Unix seconds, little-endian i64; zero disables expiry |

Ordinary `settle` requires an Open channel, `settled < cumulative <= deposit`, the channel's authorized signer, matching channel address, and `expiresAt == 0 || now < expiresAt`. The engine mirrors those field checks against **caller-supplied** context; it does not verify an instruction or on-chain account.

x402 v2 has scheme-specific payloads. SVM `exact` uses a signed transaction, not this voucher. SVM `upto` uses payment channels but requires additional checks beyond the voucher; it also forbids non-expiring vouchers. VoucherGuard does **not** validate x402 payment envelopes, `open` transactions, `settle_and_seal` lifecycle requirements, distribution commitments or facilitators. See [protocol research](docs/protocol.md).

## Install and launch locally

Prerequisites: **Node.js 22+**, **pnpm 10.32.1**. Package names are prepared for release; they have not been published to npm.

From this repository:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open the URL printed by Vite (normally `http://127.0.0.1:5173`). Development and preview use a temporary local static server; the free verifier ships as static assets; optional Pro balance reads use a Cloudflare Pages relay. After installation, the core, CLI, tests and build require no external services. Browser verification continues without connectivity after assets are loaded. There is no service worker promising offline page reloads.

## SDK quick start

Use the workspace package or a local package path until a reviewed release is published:

```sh
pnpm add ./packages/core
```

```ts
import {
  verifyVoucher,
  parseVoucherDocument,
  serializeReport,
} from '@voucherguard/core';

const input = parseVoucherDocument(JSON.parse(voucherJson));
// Replace payload assertions with independent context:
input.authorizedSigner = trustedAuthorizedSigner; // Uint8Array, 32 bytes
input.policy = {
  expectedChannelId: trustedChannelId,              // Uint8Array, 32 bytes
  maxCumulativeAmount: 1000000n,
  maxIncrease: 100000n,
  rejectNonExpiring: true,
};
input.trustedState = authenticatedSnapshot;
input.now = trustedUnixSeconds;                     // bigint
const report = await verifyVoucher(input);

if (report.status !== 'PASS') {
  throw new Error(serializeReport(report));
}
```

`decodeVoucher(message)` returns `{channelId: Uint8Array, cumulativeAmount: bigint, expiresAt: bigint}`. `encodeVoucher` encodes without signing. `decodeBytes` / `encodeBytes` support explicit hex, canonical padded base64 and base58. `serializeReport` safely represents BigInt as decimal strings and byte arrays as hex. Full [API and document schema](docs/api.md), [integration examples](docs/integrations.md).

## CLI

```sh
node packages/cli/dist/index.js verify examples/valid.json
node packages/cli/dist/index.js verify examples/signature.json --json
node packages/cli/dist/index.js decode examples/valid.json
node packages/cli/dist/index.js inspect examples/state.json
node packages/cli/dist/index.js --help
```

The distributable CLI package exposes the `voucherguard` command. In this workspace:

```sh
pnpm --filter @voucherguard/cli exec node dist/index.js verify ../../examples/valid.json
```

Options: `--json`, `--signer hex:<key>` (also `base58:` / `base64:`), `--channel hex:<id>`, `--max <decimal>`, `--now <Unix seconds>`, `--policy <file>` and `--state <file>`. Flags override file assertions. `--policy` replaces the file policy; `--channel` and `--max` override fields in the resulting policy. `--state` accepts the `trustedState` object documented in the schema, not an entire voucher document.

Exit codes: **0** PASS or successful decode, **1** verification FAIL, **2** INDETERMINATE, **3** invalid input / file / usage. `decode` never claims that a signature was verified. `inspect` performs verification with readable detailed output.

All example documents are simulations with a public test-only seed and explicit simulated time. They are legitimate signatures, not real payments. Never trust a signer or state just because it appears in the same JSON file as the voucher.

## Quick Check and Advanced Verification

**Transaction X-Ray (Free)** plays selected decoded transfers and account operations from one transaction lookup. Paste a Solscan link and press Play; switch Money/Permissions lenses, pause or scrub, and inspect exact instruction evidence. Unknown operations remain explicitly undecoded, and failed transactions show attempts. Pro overlays captured personal rule alerts without another RPC call. This is historical inspection, not a simulator or live permission check.

**Quick Check** accepts a Solscan URL or Solana signature, fetches the confirmed transaction through the read-only Pages relay, extracts a Payment Channels V1 settlement voucher when present, and runs historical Ed25519 verification in the browser. It does not certify current spendability.

**Advanced Verification** is the document lab: paste a voucher JSON, supply the independently expected signer and channel, edit amount/increase caps and expiry/state policies, then verify offline. Seven shared fixtures demonstrate common failure modes. Export JSON or a readable text report.

## VoucherGuard Pro — holder workspace

Hold **5,000,000 VG on Solana** and sign an authentication message to unlock the hosted Pro workspace. Official mint: `6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump` ([token page](https://pump.fun/coin/6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump)). Hosted unlock is enforced by the Cloudflare Pages Worker: wallet `signMessage` over a challenge, live SPL balance check against Pages secrets (`VG_TOKEN_MINT`, `VG_HOLDER_THRESHOLD`, `PRO_SESSION_SECRET`), then an HttpOnly session. **`/pro.html` and `/pro/*` are refused without that session.** Deployments without a mint remain locked with **Token access coming soon**. Free Quick Check and Advanced Verification stay available without holder access.

Connect uses Wallet Standard. Pro asks for a one-time message signature to prove address control—no payment transaction. Holdings are re-checked when serving Pro tools. See [configuration and activation](docs/pro.md).

Set transaction preferences once, then paste a link: fee caps, selected permission alerts and allowed-program lists are checked against existing metadata. X-Ray highlights matching alerts; incomplete checks remain incomplete. Captured preferences stay attached to exported and saved reports even after settings change.

The **Policy Builder** (amount/increase caps, expiry windows, trusted-state requirement, expected channel) uses the core policy schema and can apply a policy to Advanced Verification without altering signed bytes. Standard/Conservative presets are editable examples, not security guarantees. The Pro link review automatically inspects recorded fees, SOL/token balance changes, selected token authorizations (including inner instructions), failed effects and decoding coverage. It does not certify current permissions or safety. The Pro workspace also adds exact token-unit quick setup, policy/voucher file import, browser-local saved revisions, batch verification (up to 100 vouchers / 1 MiB), simulated scenario testing, status filters and evidence report export. Batch checks remain conditional on supplied trust context and do not enforce sequential watermarks.

Do **not** put the holder mint in public `VITE_*` build vars for access control. Worker Pages secrets are authoritative. Open-source forks can rebuild Policy Builder offline; that is outside the hosted gate. Pro is not authentication for secrets, funds or privileged APIs beyond the hosted tool surface.

## Results and security boundaries

- **PASS:** all applicable checks passed using the supplied trusted inputs, within the declared scope.
- **FAIL:** at least one definitive check or input validation failed, including when other context is missing.
- **INDETERMINATE:** no definitive failure, but required signer, expected channel or requested state checks could not be completed.

`requireState` defaults to true. To deliberately request signature/channel/expiry/policy verification without deposit/lifecycle/watermark assessment, set it to false; the report states the reduced scope. `maxIncrease` always requires state. State provided explicitly is always validated. Missing signer or expected channel remains INDETERMINATE even in stateless mode.

The protocol settled watermark is strict. `previouslyAcceptedAmount` is an optional **application** watermark, also strict; equality is rejected under that policy. With both watermarks supplied, increase is measured from their maximum.

No offline verifier can authenticate current chain state, discover unseen vouchers or competing submissions, guarantee settlement, or ensure atomic application replay prevention. Your application must authenticate context and atomically reserve/update its acceptance watermark. A report is an observation, not a security certificate. See [SECURITY.md](SECURITY.md).

## Architecture

```text
voucherguard/
├── packages/core/src/       binary codec, crypto, policy, JSON adapters, reports
├── packages/cli/src/        local files and flags; delegates to core
├── apps/web/src/            React static site; delegates to core
├── examples/               seven signed/corrupted test documents
├── tests/                  engine, CLI and real-browser integration
├── scripts/fixtures.ts     public test-key fixture generation
├── docs/                   protocol, API, integrations, deployment, validation
└── .github/workflows/      CI and manually triggered static Pages deployment
```

ESM, strict TypeScript, minimal runtime dependencies (`@noble/curves`, `@scure/base`), no Node built-ins in the core. Crypto uses maintained noble Ed25519 with strict `zip215:false` verification. Canonical encoding/small-order rejection is intentionally conservative; consensus equivalence for exotic Ed25519 edge cases is not claimed. Browser uses native BigInt and system fonts with no remote resources.

## Development and verification

```sh
pnpm fixtures                 # reproducible PUBLIC TEST ONLY signatures
pnpm typecheck
pnpm lint
pnpm build
pnpm test                     # core + CLI, requires built packages
pnpm check                    # all preceding validation in correct order
pnpm exec playwright install chromium
pnpm test:browser             # production site under /voucherguard/, offline checks
```

Initial Playwright browser installation downloads a test browser; this is a development requirement only. CI runs type checks, lint, production build, core/CLI tests, and browser tests. See [executed validation](docs/validation.md).

## Static deployment

`apps/web/dist` contains static assets plus the optional read-only Pages RPC worker. Relative assets support GitHub Pages subpaths; no history routing is used. See [deployment instructions](docs/deployment.md). The production site at [voucherguard.pages.dev](https://voucherguard.pages.dev/) uses Cloudflare Pages Direct Upload; GitHub commits do not automatically update it. GitHub Pages remains a fallback with a workflow that runs **only on manual dispatch**. The source repository is published under cg1290-tech. npm packages are not published.

## Roadmap and contributions

**Independent security audit has not been completed.** Before relying on VoucherGuard for consequential payment authorization: commission an independent review and verify the protocol pin and release metadata yourself. Private vulnerability reporting is enabled on the repository. Future scope may include additional independently tested protocol profiles; no generic multi-chain or comprehensive x402 support is promised.

Contributions should include protocol evidence and tests for security behavior. Read [CONTRIBUTING.md](CONTRIBUTING.md). MIT license; no endorsements, adoption claims or audit certification.

### Optional Robinhood Wallet access

Pro also supports a server-selected Robinhood Chain holder gate for separately configured deployments. Production uses the official Solana mint above. Robinhood Wallet connects using WalletConnect and signs only an authentication message; the Worker checks the configured ERC-20 contract and holdings on chain 4663. No contract configured means no unlock. Setup and real-wallet validation are documented in [Pro configuration](docs/pro.md#optional-robinhood-chain-integration).


### Trade Receipt and Trade Journal

Trade Receipt reuses the loaded historical balance snapshots. It shows sent/received net changes, the recorded network fee and a candidate net exchange ratio for simple token ↔ supported native SOL, USDC or persistent WSOL pairs. Opposing balance changes do not prove a swap; ratios are not market quotes, slippage or profit. Native SOL changes can include rent, tips and account operations and are not automatically treated as a trade price. Newly created/closed token accounts with missing before/after records remain unsupported rather than assumed zero.

Pro Trade Journal combines current reviews and the existing per-wallet local history (20 snapshots). Confirm the imported transactions are trades and that the position history is complete, without external transfers, unrelated SOL payments, rewards or rebases. This assumption is not verified by RPC and confirmation resets when evidence/selection changes. Results require an explicit zero opening token balance, continuous observed quantities and consistent token-account coverage, a single quote currency/precision, distinct known slots, known owned network fees and no unexplained native SOL effects (fee-only for token quotes, exactly reconciled transfer cash flows for native SOL). Unknown, conflicting, mixed-currency, incomplete or ambiguous records withhold the result; user confirmation cannot override those checks.

FIFO allocations support partial sales. USDC results are **gross before SOL network fees**; fees are shown separately, never converted at an invented historical price. Native SOL and persistent WSOL results include successful-trade network fees once in SOL units. They may be combined in the same FIFO position without an exchange-rate conversion. Proportional lot cost rounds down in quote base units and carries the remainder forward. Failed/excluded transaction fees and other expenses are not allocated. This is a conditional result for imported trades, not total wallet profit, unrealized profit, live valuation or a tax report. CSV leaves withheld results blank and JSON includes the evidence and assumptions. No additional RPC calls, price APIs, uploads or background scans are introduced.


Native SOL support requires a complete, resolved recorded top-level/inner instruction trace (up to 200 steps), recognized System transfers and exact reconciliation: **wallet SOL net change + owned network fee = incoming transfers − outgoing transfers**. The transfer cash flow becomes the quote; the recorded network fee is allocated exactly once. Tips and other recorded payments stay inside the transaction cash flow; they are not classified as protocol swap price. Affected account creations, closures, funding of the wallet’s own token accounts (recoverable rent/wrapped principal) and unsupported System operations, unexplained direct program lamport credits/debits, missing trace, missing token records or unknown fee ownership withhold the result. Rent is never estimated or subtracted from a hard-coded value. Legacy saved reviews without native transfer evidence stay unsupported until the user explicitly imports the link again; no automatic refetch occurs. This remains conditional on the user's complete-history/trade-purpose assertion, not a proof that transfers are swaps or history is complete.

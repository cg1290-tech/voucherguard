# VoucherGuard

**Verify what your AI agents sign.**

[Live site](https://voucherguard.pages.dev/) · [Source repository](https://github.com/cg1290-tech/voucherguard)

An open-source verification toolkit for **Solana Foundation payment channel V1 vouchers**. Quick Check reads confirmed settlement transactions; Advanced Verification inspects imported signed documents offline; both reuse the same Ed25519/policy engine.

AI agents can authorize spending. A valid signature alone does not establish that the authorization matches your channel, budget, clock or settlement watermark. VoucherGuard makes those checks explicit and reviewable.

**Quick Check** uses a read-only public RPC relay. **Advanced Verification** (document lab) needs no wallet. Optional **VoucherGuard Pro** is Cloudflare Worker–gated for future $VG holders (signed challenge + on-chain balance); Policy Builder is served only with a valid holder session. No private-key collection, payment execution, telemetry or AI inference. Not an agent platform. Not a full x402 verifier.

**Not independently audited.** Do not treat PASS reports, Pro unlock, or this software as a security certification for consequential payment authorization.

![Site preview](docs/preview-desktop.png)

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

**Quick Check** accepts a Solscan URL or Solana signature, fetches the confirmed transaction through the read-only Pages relay, extracts a Payment Channels V1 settlement voucher when present, and runs historical Ed25519 verification in the browser. It does not certify current spendability.

**Advanced Verification** is the document lab: paste a voucher JSON, supply the independently expected signer and channel, edit amount/increase caps and expiry/state policies, then verify offline. Seven shared fixtures demonstrate common failure modes. Export JSON or a readable text report.

## VoucherGuard Pro (pre-launch)

Optional holder toolkit for the future **$VG** token. Hosted unlock is enforced by the Cloudflare Pages Worker: wallet `signMessage` over a challenge, live SPL balance check against Pages secrets (`VG_TOKEN_MINT`, `VG_HOLDER_THRESHOLD`, `PRO_SESSION_SECRET`), then an HttpOnly session. **`/pro.html` and `/pro/*` are refused without that session.** The official mint is **unset by default**, so production shows **Token access coming soon**. Free Quick Check and Advanced Verification stay available without holder access.

Connect uses Wallet Standard. Pro asks for a one-time message signature to prove address control—no payment transaction. Holdings are re-checked when serving Pro tools. See [configuration and activation](docs/pro.md).

The **Policy Builder** (amount/increase caps, expiry windows, trusted-state requirement, expected channel) uses the core policy schema and can apply a policy to Advanced Verification without altering signed bytes. Standard/Conservative presets are editable examples, not security guarantees. Batch Verification and Advanced Reports are not implemented.

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

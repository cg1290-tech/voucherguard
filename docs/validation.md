# Executed validation

Local validation performed on 2026-10-08 using macOS arm64, Node.js v26.7.0 and pnpm 10.32.1. Lockfile records exact installed dependency versions. CI is prepared for Node.js 22 on Linux; no GitHub-hosted CI run is claimed.

## Passed

- `pnpm typecheck`: strict TypeScript across core, CLI, web, fixtures and tests.
- `pnpm lint`: Biome, with no errors or warnings. CSS descending-specificity lint is disabled because independent component selectors do not cascade onto the same elements; other recommended rules remain enabled.
- `pnpm build`: core ESM/declarations, CLI ESM/declarations, static Vite production site.
- `pnpm test`: **184 tests passed**: 98 engine/schema/fixture tests, 14 CLI tests, 67 Pro eligibility/policy tests and 5 read-only wallet-controller tests.
- `pnpm test:browser`: **10 real Chromium integration tests passed**, including all seven scenarios with exact SDK/browser report equality, offline verification after asset load, JSON/text export, editing invalidates results, reset, malformed payload rejection, missing signer, keyboard invocation, mobile width and a GitHub Pages project subpath.
- `node examples/node-integration.mjs`: PASS with genuine signed public fixture and separately defined simulation context.
- CLI with independent policy/state files: PASS; workspace CLI invocation also succeeds.
- Core/CLI package tarball generation: compiled exports/declarations and package metadata inspected. Packages include the MIT license and package README. No npm publication performed.
- Production desktop/mobile screenshots inspected; mobile has no horizontal document overflow.

The wire-layout test ports the pinned upstream Rust vector. Generated signatures are independently verified with Node's native Ed25519 verifier. Unit tests include malformed encoding, u64/i64 boundaries, numeric precision, signature corruption, small-order identity-key forgery, expiry equality/negative/zero, unknown policy/state fields, state binding/deposit/lifecycle, watermark equality, prior acceptance, increment limits and missing-context precedence.

A Rollup warning about a pure annotation in upstream `@scure/base` is emitted during build; Rollup removes that comment and build succeeds. No dependency source was patched to hide it.

## Limits of this validation

Local automated checks are not an independent security audit. Chromium was tested; no real on-chain settlement, RPC, wallet, npm registry publication or remote CI/deployment was exercised. Node.js 22 compatibility is targeted by package engines and CI configuration, but the local execution host used Node.js 26.7.0. Exhaustive Solana precompile consensus equivalence for exotic Ed25519 encodings is not established.

PNG report export is not implemented (optional feature). No cloud services or production publication were used. All GitHub ownership configuration points exclusively to cg1290-tech. Publication uses the browser session authenticated as that account. Remote CI/deployment results must be checked separately from these local results.

## Pro feature validation (2026-10-08)

The Pro branch additionally verifies pre-launch closed access even with a connected fixture wallet, exact holder threshold and multi-account aggregation, both token programs, wrong ownership/mint/program/decimals, full mainnet genesis validation, RPC failure/recovery, account switches and delayed-response races. Builder tests cover input validation, clipboard/JSON downloads, presets/reset and applying policy without changing signed fields. A test scans the normal production bundle for fixture markers and proves an unset mint never sends ownership RPC calls or unlocks the Builder.

The browser harness builds a separate temporary production configuration and injects wallet/RPC mocks from tests. No real mint has been configured, no token was launched, and no real wallet approval or transaction was requested. UI snapshots `pro-policy-builder-test.png` and `pro-coming-soon.png` are labeled through the fixture wallet; they are simulations.

# Changelog

## Unreleased

### Added

- Supported classic Token account lifecycle in Trade Receipt/Journal: temporary SOL wrapping, unwrapping existing WSOL, and creation/closure of traded token accounts. A separate versioned certificate replays monetary instructions, proves missing zero boundaries and reconciles wallet plus owned-account capital without counting deposits/refunds as trade profit. Unknown extensions, incomplete trace and unexplained token/lamport movements withhold the result; no additional RPC calls or rent estimates.

- Native SOL Trade Journal support for user-confirmed simple trades with complete recorded System-transfer evidence and exact wallet/fee reconciliation. Fees are allocated once; SOL and persistent WSOL share a FIFO quote currency. Unreconciled lifecycle effects, unexplained lamport changes and incomplete traces withhold results; rent is never guessed and legacy reviews are not refetched automatically.

- Free Trade Receipt: historical sent/received net changes, recorded fees and candidate exchange ratios from loaded snapshots.
- Pro Trade Journal: conditional FIFO for user-confirmed imported token/USDC or persistent WSOL trades, partial sales, remaining cost, local-history reuse and CSV/JSON export. Missing opening cost, discontinuities, ambiguous ordering and cost evidence withhold results. USDC results exclude SOL network fees; native SOL requires explicit transfer reconciliation, not a guessed trade price.

- Transaction DNA in Free: an ordered visual fingerprint of scoped historical X-Ray evidence, preserving exact quantities and undecoded instruction data.
- Pro DNA comparison between loaded and locally saved reviews: added/removed program references and operations, changed amounts/execution states, ordering differences and JSON export. Existing saved evidence is reused without a storage migration or extra RPC requests.
- Pro Rule Replay: editable Custom, Balanced and Strict preference comparisons on already loaded evidence, Permission Map highlights and local comparison export. Captured reports and saved preferences remain unchanged.

### Scope

- DNA is not raw transaction identity, a similarity-based safety score or a current permission check. Missing coverage remains explicit; edited local evidence is not authenticated by a fingerprint.

## [0.4.0] - 2026-10-14

### Added

- Solana Transaction Workspace presentation across the public site, Pro workspace and social preview.
- Free Wallet Impact: exact recorded before/after balances, grouped token accounts where historical owner/mint/precision agree, and recorded fees without double subtraction.
- Free Permission Map: clickable account/operation nodes, decoded allowance evidence, directional connections, revocations and authority operations; captured rule highlights in Pro.
- Free failure explanations for selected recognized Solana runtime errors, reported top-level failure navigation, bounded diagnostic logs and explicit custom-code limitations.
- My wallet/account focus for directly referenced X-Ray instructions.
- Pro saved net SOL decrease limits, net token decrease alerts and personal allowed-token mint lists populated from existing reviews.
- Pro Wallet Impact JSON export with transaction signature, captured rules and evidence coverage.
- Public official $VG contract address with copy, Solscan and Pump.fun links.

### Validation and scope

- Typecheck, lint, build, 277 unit tests and 17 browser tests pass.
- Existing transaction data feeds all views and personal rule checks. No additional RPC calls, monitoring, AI services or uploads are introduced. Initial transaction lookups and hosted holder checks still use read-only RPC.
- Permission Map is limited to 16 nodes/24 connections; X-Ray remains capped at 200 recorded steps. Missing and unsupported evidence stays explicit.
- No current permission state, current holdings, prices, profit/loss, token reputation or arbitrary-program audit is inferred. Failed operations remain unapplied or not reached.
- Pro remains Worker-gated for verified 5M VG holders on Solana with a signed authentication challenge. The official mint is 6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump.
- This remains a pre-release without an independent audit. npm packages are prepared for manual distribution, not published to npm.

## [0.3.0] - 2026-10-13

### Added

- Free Transaction X-Ray: paste a Solscan link and press Play, switch Money/Permissions lenses, pause, scrub and inspect exact instruction evidence.
- Selected SOL and SPL Token/Token-2022 transfer relationships with exact u64 amounts, explicit unknown steps, recorded inner-instruction ordering and failed-execution attempt labels.
- Pro preferences saved per wallet in this browser: exact network-fee caps, selected spending-delegation and authority-change alerts, and referenced-program allowlists populated from existing reviews.
- Pro X-Ray overlays of captured personal rules; complete X-Ray evidence retained in JSON exports and saved reports.
- Updated product documentation and ready-to-use announcement text.

### Validation and scope

- Typecheck, lint, build, 257 unit tests and 16 browser tests pass. Existing offline verification and holder-access regressions remain covered.
- One existing transaction lookup feeds verification and X-Ray. Playback, evidence inspection, rule evaluation and saving add no RPC calls, uploads or AI services.
- X-Ray displays recorded instruction amounts and separate final net balances. It does not simulate intermediate balances, audit arbitrary programs or check current permissions. Playback is capped at 200 steps; missing/unsupported data remains explicit.
- Pro access remains backend-gated for 5M VG on Solana with a wallet authentication message. Free X-Ray requires no wallet.
- This remains a pre-release without an independent audit. npm packages are not published.

## [0.2.0] - 2026-10-12

### Added

- Solscan-first Pro workspace: review supported Solana mainnet transactions without manually preparing JSON or technical inputs.
- Historical transaction effects: network fee, exact account balance changes, referenced programs, and selected SPL Token / Token-2022 account operations, including recorded inner instructions.
- Custom policies, locally saved policy revisions, and batch verification of up to 100 voucher files.
- Local transaction report history, comparison of two saved reports, downloadable PNG cards, and full JSON evidence exports. Saving, comparing and generating cards make no additional RPC requests or uploads.
- Plain-language explanations of selected account operations and explicit coverage gaps.
- Backend holder sessions using wallet authentication signatures and configured on-chain holdings. Optional Robinhood Wallet connectivity and separately configured Robinhood Chain access support.

### Changed

- Production site moved to Cloudflare Pages at https://voucherguard.pages.dev/.
- Production Pro access uses the official Solana $VG mint and a 5,000,000 VG holder threshold.
- Pro historical transaction review is distinct from free voucher verification. Unsupported voucher profiles are not promoted to verified evidence.

### Validation and scope

- 244 unit tests and 13 browser tests pass, alongside typecheck, lint and build. Lint retains 21 existing warnings.
- Free voucher verification remains local; link lookups and holder authentication use read-only RPC data. New local report tools require no additional RPC calls.
- No independent security audit. Historical reports are not current permission checks, token recommendations or safety certificates. No watchlist or continuous monitoring is included.
- npm packages remain unpublished. Release archives are for local use and self-hosting; deployed Pro requires the documented Worker secrets and holder configuration.

## [0.1.0] - 2026-10-08

### Added

- Initial open-source preview: offline Solana Foundation payment-channel V1 voucher verification with a TypeScript core, CLI and browser playground.
- Canonical decoding, Ed25519 signatures, BigInt policies, trusted-state checks and seven simulation fixtures.

[0.3.0]: https://github.com/cg1290-tech/voucherguard/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cg1290-tech/voucherguard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cg1290-tech/voucherguard/releases/tag/v0.1.0

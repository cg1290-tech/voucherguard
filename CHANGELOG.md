# Changelog

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

[0.2.0]: https://github.com/cg1290-tech/voucherguard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cg1290-tech/voucherguard/releases/tag/v0.1.0

# VoucherGuard Pro

Pro is an optional **server-gated** holder toolkit for **$VG on Solana mainnet-beta**. The official mint is `6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump`, a Token-2022 mint with 6 decimals. [Official token page](https://pump.fun/coin/6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump). Free Quick Check, Advanced Verification, core SDK and CLI stay available without a wallet. Hosted Pro unlock and `/pro.html` Policy Builder require a Cloudflare Pages Worker session after on-chain holdings are verified.

Production selects `VG_ACCESS_CHAIN=solana` and the official `VG_TOKEN_MINT` as Pages secrets. Robinhood Chain support remains available for a separately configured deployment; it does not grant access for this Solana token.

## Pre-launch behavior

`VG_TOKEN_MINT` and `PRO_SESSION_SECRET` are **Pages secrets** (Worker env). When unset, `/api/pro/status` returns **not-configured**, no sessions are issued, and `/pro/*` stays closed. Connecting a wallet does not unlock anything.

## Holder unlock (Worker)

1. Client requests `POST /api/pro/challenge` (allowlisted Origin).
2. Wallet signs `VoucherGuard Pro access\n{challenge}\n` via Wallet Standard `solana:signMessage`.
3. Client posts address + challenge + signature to `POST /api/pro/session`.
4. Worker verifies the Ed25519 signature, reads SPL token accounts for the configured mint (Helius-first for indexed reads), and compares raw units to `VG_HOLDER_THRESHOLD`.
5. On success it sets an HttpOnly `vg_pro_session` cookie. `/pro.html` and `/pro/*` are served only while that session remains valid and holdings still meet the threshold.

No payment transaction is submitted. RPC failure cannot grant access. Pasting another wallet's address without a valid signature cannot unlock.

## Start with a Solscan link

After holder unlock, the default Pro flow is **paste a Solscan transaction link → Review transaction → download the review**. No JSON files or technical fields are required. Up to 20 links/signatures can be pasted (one per line); duplicates are checked once. RPC requests go only through the configured same-origin relay, not to pasted URLs, and each request has a 15-second timeout.

Supported Payment Channels V1 settlement transactions produce historical on-chain outcome and voucher evidence. Ordinary swaps and token transfers are explicitly outside supported scope, not a safety PASS. Failed transactions remain failed even if their voucher signature is valid. Missing block time leaves historical expiry indeterminate.

Custom policy checks are opt-in, use the fetched block time, and preserve missing signer/channel/state context as unresolved. Token and account pages are not transaction links. File tools and the policy builder are collapsed optional sections.

## Additional automatic Pro checks

One transaction link also produces a historical effects report, even when no supported Payment Channels voucher is found:

- Total network fee, fee payer and net SOL balance changes, using only exact safe JSON integers.
- Exact raw token balance changes with RPC-provided decimals and mint/account identities; missing records remain unknown unless a new/closed account is supported by a zero SOL snapshot.
- Selected SPL Token / Token-2022 operations: Approve, ApproveChecked, SetAuthority, CloseAccount, Burn/BurnChecked, FreezeAccount and Revoke. Top-level and recorded inner instructions are inspected; versioned lookup addresses resolve writable then readonly.
- Failed transactions mark instruction effects as attempted, not applied. Net balances and fees come from the recorded execution metadata.
- Referenced program inventory, coverage gaps, undecoded token instructions/extensions and missing inner traces are explicit. There is no program reputation, token legitimacy or current-permission certification.

No additional form or RPC lookup is required. Net balance changes include rent, fees and transfers; they are not a transfer graph or personal P&L. No absence-of-risk verdict is derived from an empty permission list. The exported review includes these facts and coverage limits.

References: [Solana RPC JSON structures](https://solana.com/docs/rpc/json-structures), [SPL Token instruction layout](https://github.com/solana-program/token/blob/main/interface/src/instruction.rs).

## Policy Builder

Eligible holders open **Open Pro workspace** → `/pro.html` (Worker-protected). The Builder validates through `parsePolicyDocument`, same schema as CLI and Advanced. **Apply to Advanced** stashes the policy and returns to the main verifier without altering signed voucher fields.

The workspace includes:

- Quick setup with exact conversion of payment-token amounts (0–18 decimals) and validity-window choices.
- Policy or voucher JSON import. Imported policy context must still be independently confirmed.
- Named, immutable policy revisions stored in this browser, scoped by the connected holder address. No cloud sync or encrypted vault is implied; download a backup.
- Batch verification of 1–100 voucher documents, 1 MiB total, through the same core verifier. One JSON document per file or JSON arrays are accepted.
- Seven clearly labeled simulated scenarios; per-voucher evidence and status filters; JSON reports containing the exact policy used, evidence and limitations.
- Recent-run history for this visit only (last ten runs). Download reports to retain them.

Batch results are independent checks. They do not authenticate imported signer/channel/state assertions, advance watermarks between vouchers, or guarantee settlement or protection from concurrent replay. Production access requires at least **5,000,000 VG**; that holder threshold is separate from payment-token limits.

## Activation (Cloudflare Pages secrets)

```bash
# ≥32 random bytes/string
wrangler pages secret put PRO_SESSION_SECRET --project-name voucherguard
# Official mint only after independent confirmation
wrangler pages secret put VG_TOKEN_MINT --project-name voucherguard
wrangler pages secret put VG_HOLDER_THRESHOLD --project-name voucherguard   # e.g. 1
# Existing
wrangler pages secret put HELIUS_API_KEY --project-name voucherguard
```

Do **not** put the mint gate in `VITE_VG_TOKEN_MINT` for access control—that value is public. Optional `VITE_*` vars may remain for docs/legacy display only; the Worker secrets are authoritative.

Redeploy `apps/web/dist` (including `_worker.js` and `_routes.json`) after setting secrets. Vite preview and GitHub Pages do **not** run the Worker; hosted Pro unlock works on `voucherguard.pages.dev`.

## Trust boundary

- Hosted Pro on Cloudflare Pages: Worker-enforced holder session.
- Open-source repo: anyone can rebuild Policy Builder offline; that is outside the hosted gate.
- Do not use Pro as authentication for secrets, funds or privileged APIs beyond the hosted tool surface.

## Optional Robinhood Chain integration

Set `VG_ACCESS_CHAIN=robinhood` as a Pages secret to select the Robinhood gate. It requires `VG_TOKEN_CONTRACT` (the official Pons ERC-20 contract), `VG_HOLDER_THRESHOLD`, and `PRO_SESSION_SECRET`. Leave the contract unset before launch: hosted tools remain locked. `VG_TOKEN_MINT` is the legacy Solana mint and does not activate the Robinhood gate.

Robinhood Wallet connects through WalletConnect Sign v2. The client lazily loads the SDK only after a user asks to connect, requests only `personal_sign` on `eip155:4663`, displays a locally generated pairing QR, and disables SDK telemetry. Configure a public Reown `WALLETCONNECT_PROJECT_ID` on Pages; `/api/pro/status` intentionally publishes this ID for the browser. It is a public project identifier, not the session HMAC secret. Configure Reown allowed origins for `https://voucherguard.pages.dev`. Without a project ID, the Robinhood connection button remains disabled.

The short-lived sign-in message includes the canonical domain, account, chain ID, nonce, timestamps and token contract. The Worker validates its HMAC, recovers the EIP-191 signer and compares the claimed account before querying balances. The challenge is valid for two minutes; it is not a globally consumed single-use nonce. Sessions expire after ten minutes and are bound to the network and configured token contract. EOA signatures are supported; contract-wallet EIP-1271 proofs are not implemented and are rejected.

The Worker verifies `eth_chainId`, pins one block and uses only `eth_getCode` plus `eth_call` for `decimals()` and `balanceOf(address)`. Exact uint256 arithmetic, ABI-size checks, response bounds and an overall timeout keep malformed or unavailable data locked. The RPC default is `https://rpc.mainnet.chain.robinhood.com`; an optional `RH_RPC_URL` override is server-side only. No transaction, allowance or transfer call exists in this flow. Holdings are rechecked before protected assets are served.

The free Solana Quick Check and Advanced verifier remain independent of the network used for Pro access. A Pons/RH contract is not a Solana mint.

### Robinhood activation checklist

1. Configure the Reown project ID (public), select the server access chain, and keep the official contract unset until confirmed.
2. After launch, set the exact official `VG_TOKEN_CONTRACT` and desired threshold as Pages secrets and redeploy.
3. Test Robinhood Wallet pairing and actual message approval; holder and non-holder accounts; wrong chain, rejected signature, account change, disconnect, expired session, lost holdings and RPC outage.
4. Verify protected `/pro.html` and `/pro/app.js`, not merely the homepage button. Mock tests do not replace this real-wallet check.

References: [Pons network and token integration](https://docs.ponsfamily.com/), [Robinhood Chain network configuration](https://docs.robinhood.com/chain/add-network-to-wallet/), [Robinhood Wallet connection guide](https://robinhood.com/us/en/support/articles/connect-to-dapps/).

## Local report tools

Pro can save up to 20 historical transaction reviews per wallet on the current browser, compare two saved reports, and generate downloadable PNG evidence cards. Saved JSON retains the full original review and any custom policy. These operations do not fetch blockchain data, upload reports or use an AI service. The original transaction lookup and holder access checks still use RPC.

History uses unencrypted localStorage, is editable local data rather than authenticated evidence, and does not sync between devices. Clearing browser data deletes history; saving more than 20 reviews replaces the oldest. Storage errors do not erase the existing history. Cards include historical scope and coverage counts and must not be treated as current permission checks or safety certificates. Comparisons show differences between recorded reports, potentially for different transactions or policies; they do not imply a live change in wallet permissions.

## Saved transaction rules

Set transaction preferences once in Pro, then paste a Solscan transaction link. Preferences are scoped to the authenticated wallet and stored in this browser: an optional maximum network fee in SOL, selected SPL spending-delegation and authority-change alerts, and an optional allowlist of referenced programs. The program list can be populated from the current reviews without an additional lookup; users must review and save that draft list.

The evaluator uses only already-fetched transaction metadata. No extra RPC, AI call, upload, monitoring service or on-chain action is added. Fee caps use exact integer lamports; missing or unsafe fee values, missing inner traces, unresolved program references, unsupported token instructions and inspection truncation produce incomplete checks rather than a clean result. Positive findings remain flagged even when other checks are incomplete. Failed executions label attempted operations explicitly.

Reports retain an immutable copy of the preferences and checks used when generated, including saved JSON evidence and local report comparisons. Changed preferences apply to subsequent reviews. Preferences are not synced; if local storage is unavailable, the UI explains that changes apply only for the current visit. Passing the selected rules is conditional on the recorded data and inspection scope, not a safety certificate or current-permission check. Rules report historical findings; they do not prevent transaction execution.

## Transaction X-Ray (Free + Pro)

The free Quick Check entry accepts a Solscan transaction link and starts X-Ray with **Play transaction**. It uses one existing `getTransaction` response for both historical voucher verification and the visualization. Money and Permissions lenses show selected decoded relationships; playback follows recorded top-level instructions with each recorded inner trace immediately after its parent. The timeline has play/pause, previous/next, scrubbing and clickable evidence. Other programs and malformed instructions remain explicitly undecoded. Playback is limited to 200 steps and trace gaps are disclosed. Reduced-motion preferences suppress automatic playback and CSS motion; playback pauses when the tab is hidden.

Supported money relationships are ordinary System Program SOL transfers and SPL Token / Token-2022 Transfer and TransferChecked instructions. Amounts come from exact instruction bytes. Unchecked token transfers only receive mint/decimal labels when source and destination snapshots establish matching identities; otherwise they show base units. These amounts are not reconstructed net receipts: token fees, hooks, rent and other operations can affect final balances. Failed transactions show attempts and never animate applied movement. Final net account changes are shown separately, with no simulated intermediate balance claims.

Pro reuses the same X-Ray component and the existing captured transaction rules: spending delegations, authority changes and referenced programs outside the allowlist are highlighted on individual steps; fee checks and incomplete coverage remain in the rule summary. The full X-Ray model is retained in exported/saved Pro evidence. No RPC request is made for playback, lens switching, rule highlights or evidence inspection. Free does not load or evaluate saved Pro preferences. This is historical inspection, not a transaction simulator, live permission checker or program audit.

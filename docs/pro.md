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

## Policy Builder

Eligible holders open **Open Policy Builder** → `/pro.html` (Worker-protected). The Builder validates through `parsePolicyDocument`, same schema as CLI and Advanced. **Apply to Advanced** stashes the policy and returns to the main verifier without altering signed voucher fields.

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

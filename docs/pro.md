# VoucherGuard Pro

Pro is an optional **server-gated** holder toolkit for the future **$VG** token on the configured network: **Robinhood Chain mainnet (4663)** for the Pons launch, or the existing Solana mainnet-beta integration. Free Quick Check, Advanced Verification, core SDK and CLI stay available without a wallet. Hosted Pro unlock and `/pro.html` Policy Builder require a Cloudflare Pages Worker session after on-chain holdings are verified.

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

Batch Verification and Advanced Reports remain **not implemented**.

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

## Robinhood Wallet and the Pons launch

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

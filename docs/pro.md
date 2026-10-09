# VoucherGuard Pro

Pro is an optional **server-gated** holder toolkit for the future **$VG** token on **Solana mainnet-beta**. Free Quick Check, Advanced Verification, core SDK and CLI stay available without a wallet. Hosted Pro unlock and `/pro.html` Policy Builder require a Cloudflare Pages Worker session after on-chain holdings are verified.

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

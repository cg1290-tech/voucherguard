## Learned User Preferences

- Prefer Italian when the user writes in Italian.
- Do not nag about revoking or rotating API keys, PATs, or similar secrets after the user has said to stop.
- Reject client-only Pro gating; Pro must be backend/Worker-gated and unlock exclusively via verified $VG token holdings.
- Keep HELIUS_API_KEY and Pro gate config as Cloudflare Pages secrets (Worker env), never as public `VITE_*` build values or otherwise exposed to the public.
- Use the GitHub CLI against the `cg1290-tech` org/account for this repo.

## Learned Workspace Facts

- Production host is Cloudflare Pages at `voucherguard.pages.dev`; the Pages Worker protects `/api/*` and `/pro.html` + `/pro/*`.
- GitHub repo/org is `cg1290-tech/voucherguard`.
- Soft-launch posture: free Quick Check / Advanced Verification are ready for the public; Pro stays locked until the official `VG_TOKEN_MINT` is set as a Pages secret.
- Product access model: Quick Check, Import Voucher, and Advanced Verification are free; Policy Builder is Pro for $VG holders only.
- Authoritative Pro secrets on Pages are `VG_TOKEN_MINT`, `HELIUS_API_KEY`, `PRO_SESSION_SECRET` (and holder threshold); unset mint means Pro remains `not-configured`.

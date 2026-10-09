# Static deployment and manual release

All hosting is optional. The verification engine itself does not require any hosting. `apps/web/dist` contains the complete website; serve it as static files. Do not try to execute it with `file://`: ESM assets normally require a static HTTP origin. This is a hosting requirement, not an application backend.

## Build and preview

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @voucherguard/web preview --port 4173
```

Default Vite base is `./`, so JS/CSS resolve relative to the document and work under a Pages project subpath. There is no client-side history router. Hash links identify sections.

To pin an explicit project path:

```sh
VITE_BASE_PATH=/voucherguard/ pnpm build
VITE_BASE_PATH=/voucherguard/ pnpm --filter @voucherguard/web preview --port 4173
```

Only after the repository actually exists, set its link when building:

```sh
VITE_REPOSITORY_URL=https://github.com/cg1290-tech/voucherguard pnpm build
```

The link is omitted by default rather than claiming a nonexistent public release. `apps/web/.env.example` shows configuration. Vite env values are public and must not contain secrets. Other static hosts can upload `apps/web/dist` with no server functions, database, API keys or rewrites.

## GitHub Pages

1. Review source, protocol pin, license and security reporting before release.
2. Create the repository on **cg1290-tech only**, then push reviewed local source. Do not use another account's credentials.
3. Configure repository Settings → Pages → GitHub Actions.
4. Manually dispatch `.github/workflows/pages.yml`. No automatic deployment trigger is configured.
5. Verify the deployed `/voucherguard/` URL, assets, scenario results and browser console.

The workflow grants deployment permissions only to the deploy job, uses a static artifact and does not publish npm packages. Change `VITE_BASE_PATH` for a renamed repository or a root/custom-domain deployment. The current workflow intentionally targets the prepared `voucherguard` repository name.

## Cloudflare Pages (current production site)

The public site is **https://voucherguard.pages.dev/**. The Cloudflare Pages project `voucherguard` uses Direct Upload. Commits to GitHub do **not** automatically rebuild or deploy this project. No Cloudflare credential belongs in this repository or browser bundle.

Build from the monorepo root for the root URL:

```sh
VITE_BASE_PATH=/ VITE_REPOSITORY_URL=https://github.com/cg1290-tech/voucherguard pnpm build
```

In the existing Cloudflare account, open Workers & Pages → `voucherguard` (Pages) → Create deployment. Choose Production and upload the **contents** of `apps/web/dist` (including `index.html`, `assets/`, the logo, `social-card.png`, `_worker.js` and `_routes.json`). Include the `_headers` file: Cloudflare applies its Content Security Policy, frame restrictions and browser permission restrictions. The policy permits only the same origin and canonical Pages relay; if a different RPC endpoint is configured, update `connect-src` to that exact trusted origin before building. Vite preview and GitHub Pages do not apply this Cloudflare header file. Confirm the upload and deploy. Keep the prior successful deployment available for rollback.

Verify the homepage, logo, social image URL, Quick Check, Advanced Verification fixtures, the unaudited disclaimer, and Pro's `Token access coming soon` state (no `VG_TOKEN_MINT` Pages secret) at the production URL. Open Graph and X card metadata point to this canonical domain; X may cache older previews.

For CLI uploads, an account-scoped token with Cloudflare Pages Edit or a Wrangler session with Pages authorization is required. Configure credentials locally, never commit them. The existing Workers-only OAuth session cannot deploy Pages. After authorizing Pages, use:

```sh
wrangler pages deploy apps/web/dist --project-name=voucherguard --branch=main
```

## Cloudflare Workers fallback

`wrangler.jsonc` configures a separate static-assets Worker named `voucherguard`. It is available at `https://voucherguard.cloudflare-plugin-migration.workers.dev/` and is updated separately from Pages:

```sh
wrangler deploy --config wrangler.jsonc --dry-run
wrangler deploy --config wrangler.jsonc
```

Changing the account's `workers.dev` subdomain affects other Workers. Do not change it to customize this product's URL. GitHub Pages remains a separately deployed fallback.

## Other static hosts

From monorepo root: install `pnpm install --frozen-lockfile`, build `pnpm build`, output directory `apps/web/dist`. Serve static assets with no functions or backend runtime. Set `VITE_REPOSITORY_URL` to the actual repository and select the correct `VITE_BASE_PATH` for that host.

## npm package preparation

Packages are ESM with declarations and publish only `dist`. Metadata points exclusively to cg1290-tech. Build first, inspect `pnpm --filter @voucherguard/core pack` and CLI tarballs, review generated content and workspace dependency replacement, then manually decide whether to publish. Scope ownership/availability has not been verified. Never publish automatically.

Before public release, independently review security semantics, enable and verify private vulnerability reporting, recheck upstream drift and validate supported Node/browser versions. The GitHub source repository is published under cg1290-tech. npm publication remains a separate manual release step.

## Read-only Pro RPC relay

The Vite build emits `_worker.js` and `_routes.json` for Cloudflare Pages. The worker handles `/api/*` and protects `/pro` + `/pro.html` + `/pro/*`. Upload these files with the production ZIP.

Pages secrets (Worker env, never `VITE_*`):
- `HELIUS_API_KEY` — indexed token-account reads
- `VG_TOKEN_MINT` — official SPL mint (leave unset until confirmed)
- `VG_HOLDER_THRESHOLD` — decimal token amount, default `1`
- `PRO_SESSION_SECRET` — ≥32 character random secret for challenge/session HMAC

Without mint + session secret, Pro stays locked (`not-configured`). With them set, holders prove access via `/api/pro/challenge` + `/api/pro/session`; Policy Builder is only at `/pro.html` behind the session cookie.

The RPC relay requires an allowlisted Origin, allows only getGenesisHash, getAccountInfo, getTokenAccountsByOwner and getTransaction, prefers Helius only for token-account reads, and rate-limits non-browser clients more tightly. All `/api/*` routes also share a per-IP Cache API throttle (60 requests/minute/colo; Pages does not yet accept Workers `ratelimits` bindings in `wrangler.jsonc`). Worker fetch must use `redirect: "manual"`. Vite preview and GitHub Pages do not run this worker—hosted Pro unlock only works on Cloudflare Pages.

```sh
pnpm --filter @voucherguard/web build
wrangler pages deploy --project-name voucherguard --branch main
```

(`wrangler.jsonc` sets `pages_build_output_dir` to `apps/web/dist`.)

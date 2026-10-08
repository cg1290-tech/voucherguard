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

## Vercel / Cloudflare static hosting

From monorepo root: install `pnpm install --frozen-lockfile`, build `pnpm build`, output directory `apps/web/dist`. Do not add functions or backend runtime. Set `VITE_REPOSITORY_URL` only to the actual repository. Hosting platform setup/submission is manual and has not been performed.

## npm package preparation

Packages are ESM with declarations and publish only `dist`. Metadata points exclusively to cg1290-tech. Build first, inspect `pnpm --filter @voucherguard/core pack` and CLI tarballs, review generated content and workspace dependency replacement, then manually decide whether to publish. Scope ownership/availability has not been verified. Never publish automatically.

Before public release, independently review security semantics, enable and verify private vulnerability reporting, recheck upstream drift and validate supported Node/browser versions. The GitHub source repository is published under cg1290-tech. npm publication remains a separate manual release step.

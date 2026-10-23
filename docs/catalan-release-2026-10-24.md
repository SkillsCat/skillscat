# Web 0.9.9 release verification

## Authorized scope and source

The user authorized merging PR #1, including all review fixes, and deploying
from main. GitHub merged the exact reviewed head
`0566338e12e8d2e1e95ba20f296b23abc2660d28` as
`10ce18a24a9db776de23bb53b85a550c814141dc`.
The main tree is identical to that reviewed head. Ancestry checks confirm
`c988294`, `1e46e1a` and `0566338` are all included.

This release deploys only the Web Worker. No schema migrations, independent
background Worker changes, credential changes or CLI package publication are
needed. The existing release script also bootstraps the state Worker, so this
release uses its build/assets preparation and Web deploy steps directly to
avoid redeploying an unchanged service.

## Pre-deployment checklist

- Previous release: Web 0.9.8, Worker `skillscat-web-production`, deployment
  `a552807c-8695-44ac-9937-0cb82453c56c`.
- Rollback target: Worker version `85397e08-571c-4704-af1f-03990be08c6b`.
- Compare deployed bindings and runtime flags before/after deployment.
- Build version 0.9.9 from committed main; prepare `.assetsignore`; validate the
  production Wrangler upload with a dry run before deployment.
- Verify ordinary English/Catalan URLs: home, Recent, Top, Trending, search,
  categories/category, a known skill, user and organization; pagination, empty
  results and missing resources; all new docs/articles and locale controls.
- Check response status, body, language, canonical/hreflang and cache headers;
  use the deployment transition/natural expiry for cache MISS/HIT observations.
- Use real Chromium for direct opens, refresh, in-site/SvelteKit navigation,
  light/dark themes, mobile layout and clipboard contents. Intercept analytics,
  access counters, recommendation refresh, avatar proxies and unverified APIs.
- Read-only preflight checks R2 snapshots and the selected detail's derived
  objects, plus bounded D1 reads of known keys. Do not request a path whose GET
  would write business data or R2 derivatives; wait for natural refresh or mark
  it unverified. Never clear caches or trigger queues/cron to make tests pass.
- Capture sanitized Worker logs during validation, retaining version, path,
  method, status/outcome and exception categories only. Never retain credentials
  or request headers. Production auth/write flows remain covered only by the
  preceding isolated local review unless an existing authorized session exists.

## Results

Deployment and production acceptance are pending at this checklist commit.

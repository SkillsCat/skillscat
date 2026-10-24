# Web 0.9.11 documentation icon release

The user authorized commit, push and production deployment. Commit `924d418`
removes the docs book badge's `rotate(-5deg)` declaration and bumps Web from
0.9.10 to 0.9.11. It was pushed to `main` before deployment. No database,
CLI, binding, background Worker, cron or queue configuration changed.

Deployed at 2026-10-24 10:17:49 UTC (18:17:49 Singapore), at 100% traffic:
`b0ecc58a-c81d-4e18-8ca3-54eb5160c08c`. Rollback version:
`a16c7e15-7110-4f2a-8346-6cb091e24465`. Bindings and runtime compatibility
settings match the previous version. Plan and baseline were saved before deploy.

## Verified

- Production build, component ESLint and diff checks passed. Actual project
  typecheck passed with zero errors and warnings. Test suites were not rerun
  for this single CSS declaration removal.
- All 13 baseline and 42 post-deployment HTTP checks passed: Recent, Top,
  Trending, search/results/empty results, categories/category, existing skill,
  user and organization, pagination, missing resources, and localized docs.
  Status, body content/language and cache headers were recorded.
- Five real Chromium scenario groups passed. English/Catalan docs directly
  opened and refreshed, guide/back navigation issued SvelteKit data requests,
  and mobile dark mode showed an upright badge. Computed transform was `none`.
  Recent pagination and the core public routes above also rendered correctly.
  Final browser run had no page errors, console errors, failed network requests
  or unexpected HTTP errors. The production mobile screenshot was inspected.
- Ordinary Recent and skill URLs showed Cache API HIT and CDN MISS-to-HIT;
  deploy transition and natural cache expiry were observed without clearing
  production caches. Public version.json and sw.js hashes match the build.
- Sanitized logs contain 229 events from this new version, all outcome
  `ok`, with 0 exceptions and 0 HTTP 5xx. One external
  POST /xmlrpc.php scan produced a logged 404; no tested route had an error log.

## Acceptance boundary

The changed docs UI is verified live. **The full mandatory production checklist
is incomplete:** the existing home snapshot was older than the five-minute
validity window. Requesting home on a cache miss could write a replacement R2
snapshot, so home was not requested under the read-only verification rule.
No cache was cleared or production data altered to pass this check.

Authentication, production write flows and Service Worker lifecycle/offline
were not exercised. No background job was manually triggered or queue message
injected. Browser reporting/counters, mutations, unverified APIs, avatars and
unverified skill prefetches were intercepted. These services are outside the
successful browser assertions. Bounded D1 preflights reported zero rows written.

Evidence: [route/cache/browser/log results](docs-icon-release-2026-10-24/evidence.json),
[production mobile dark screenshot](docs-icon-release-2026-10-24/docs-ca-mobile-dark.png).

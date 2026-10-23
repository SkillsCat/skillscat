# Web 0.9.9 release verification

## Authorized scope and source

The user authorized merging PR #1, including all review fixes, and deploying
from main. GitHub merged the exact reviewed head
`0566338e12e8d2e1e95ba20f296b23abc2660d28` as
`10ce18a24a9db776de23bb53b85a550c814141dc`.
The merge tree is identical to that reviewed head. Ancestry checks confirm
`c988294`, `1e46e1a` and `0566338` are all included.

Web version 0.9.9 was built and deployed from committed main
`60e7536a18f119ae34b4f27b9d31b10c31e5be5a`. The release also deploys
`search-precompute`, because it imports the modified shared sitemap module.
This dependency was identified during the final release audit; its existing
hourly schedule is unchanged. No schema migrations, credential changes or CLI
package publication are needed. The existing release script also bootstraps
the state Worker, so this release runs the relevant build/assets and deploy
steps directly, without redeploying unrelated services.

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

Both deployments succeeded at 100% traffic. Public Web acceptance checks passed;
full production acceptance remains pending the natural scheduled Worker run and
core sitemap verification described below. Times below use UTC unless stated.

| Worker | New version | Rollback version | Deployment time |
| --- | --- | --- | --- |
| Web | `36167581-a715-4cf1-9d78-5bb5c46c8d68` | `85397e08-571c-4704-af1f-03990be08c6b` | 2026-10-23 19:24:07 |
| Search precompute | `235e088f-2ab3-4439-910f-f3feb7519411` | `718af839-9231-4a3d-8cfc-a06985d38d0f` | 2026-10-23 19:29:56 |

- All bindings and runtime settings match the respective pre-deployment
  versions. Search precompute retains cron `15 * * * *` and has no queue binding.
- Local validation on the merged code: 1,039 Web tests, typecheck with zero
  errors/warnings, lint, production build, and both Wrangler dry runs passed.
  The earlier review also passed 191 CLI tests; subsequent fixes are Web-only.
- All 13 HTTP baseline checks and 37 post-deployment checks passed, covering
  English/Catalan lists, search, categories, detail, profiles, all new docs and
  articles, pagination, empty results and expected 404s. Two additional home
  checks returned 36 cards in each language after verifying a fresh, existing
  snapshot and its public skill IDs.
- Nine metadata checks confirmed canonical URLs, the applicable language
  alternatives and search noindex. Catalan-only articles have no invented
  translated counterparts. The search canonical retains its query. Initial
  generic harness assertions were corrected to these existing contracts; no
  application change was needed.
- Eight real Chromium scenario groups passed, including direct opens, refresh,
  SvelteKit navigation, pagination/history, language switching with query and
  section fragments, keyboard links, mobile/dark layouts and the copied Catalan
  agent-install prompt. No page errors, failed network requests or 5xx responses
  occurred in this instrumented browser session. Four screenshots were visually
  inspected. Avatars were replaced with placeholders and protected requests
  were intercepted, so those are not claims about the intercepted services.
- Ordinary URLs showed expected language isolation and MISS/HIT transitions.
  Detail responses showed `X-Cache: HIT`; repeated Recent and detail requests
  reached Cloudflare HIT. An upstream `X-Cache: MISS` can be retained in an edge
  HIT response, so both headers are recorded rather than conflated.
- Public `/_app/version.json` and `/sw.js` exactly match the local build hashes.
- The Web log window from 19:24:42 to 19:32:04 contains 370 events from the new
  version, all with outcome `ok`, no exceptions, error logs or HTTP 5xx. A wider
  transition collector separately recorded the expected old-version Catalan
  blog 404 and one canceled access POST without an exception/status. The browser
  blocked access POSTs; no further attribution of that unrelated event is made.

### Read-only boundaries and pending checks

Preflight used bounded reads of existing R2 objects, one known skill row, known
category statistics and 36 home skill IDs. D1 reported zero written rows.
Analytics, counters, recommendation refresh, avatar proxies, authentication and
unverified API requests were intercepted. No production business writes, queue
messages, manual cron invocations or cache clearing were initiated for testing.

The new core sitemap snapshot was absent in two read-only R2 checks. Its public
GET would persist the missing derivative, so that endpoint was deliberately
not requested. The deployed search Worker will generate it through its normal
schedule. No natural execution occurred in the bounded log observation; the
next scheduled run is **2026-10-23 20:15 UTC / 2026-10-24 04:15 Singapore**.
Its execution, output and retry behavior, and the resulting core sitemap HTTP
response therefore remain **unverified**, not passed. No monitoring or future
automatic follow-up was configured.

Real production OAuth/authenticated writes and Service Worker install/update/
offline behavior were not exercised. Authenticated translations were reviewed
using isolated local fixtures. Native Catalan speaker review remains pending,
as disclosed on the contribution page. These bounded checks are not a claim
that every site function or every translation is certified.

Machine-readable versions, route results, cache headers, hashes, preflight
details and log summaries: [evidence](catalan-release-2026-10-24/evidence.json).
Production screenshots: [desktop home](catalan-release-2026-10-24/home-desktop.png),
[mobile home](catalan-release-2026-10-24/home-mobile.png),
[mobile dark article](catalan-release-2026-10-24/article-mobile-dark.png),
[Catalan install prompt](catalan-release-2026-10-24/skill-agent-desktop.png).

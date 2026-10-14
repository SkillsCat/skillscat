# Production acceptance repair — 2026-09-19

**Status: the reproduced user-profile 500 is fixed and deployed.** The checks listed
below passed within their stated production/isolated boundaries. This is not a claim
of all production write paths or AI provider calls being exercised.

The user requested diagnosis and repair of failed acceptance checks after the Jev
release. Scope: public user-profile 500 and verification tooling. The deployed AI
workers continue using OpenRouter free models before Jev; they are not changed by
this repair. No Git commit/push/tag or production business-data intervention.

## Root cause and change

At 09:50:43 UTC, the unchanged Web version
`d22fda5f-fe6e-4e8a-92ed-52aa57845278` returned 500 for `/u/anthropics`.
The matching runtime error was `D1_ERROR: too many SQL variables`, with
`hydrateCategories` on the stack. The page loaded every public skill and bound
all IDs into one category query, exceeding D1's 100-variable ceiling.

Both registered-user and GitHub-author paths now use 24 skills per page. Indexed
owner/public filters select IDs before hydrating details and categories; no query
uses more than 26 binds. Count and star totals cover all matching public skills,
not only the current page. Private/unlisted skills remain excluded; registered-user personal lists also exclude
organization-owned skills. A stable ID tie-breaker avoids overlap when stars/timestamps tie.
Page URLs, pagination controls, canonical URLs and structured-data positions reflect
the current page; out-of-range pages return 404. The existing 100-page public-list
cap applies. New `user-profile:v3:<username>:<page>` keys avoid old unpaginated data.

D1 cost: totals and ID selection remain restricted to the existing owner/public
indexes; full skill fields and category rows are read only for the current page.
Counts scan that owner's matching records, not all skills; responses retain the
existing 30-minute profile cache. No schema or new index is required. Production
migration inspection reported no pending migrations.

The full-lint failure came from generated `tmp/quality-worker-build` files. The root
lint config now excludes temporary generated artifacts. Browser SW errors arose
because Playwright disabled registration while leaving the API present; the test
context now exposes service workers as unavailable. Production SW code is unchanged.

## Pre-deployment checks and rollback

- 103 tests across 12 relevant suites passed, including 137-skill regression fixtures
  for both identity paths, D1 bind ceiling, exact totals, visibility, page bounds,
  index use, cache separation, detail/cache/readme and existing Jev behavior.
- Web typecheck: zero errors/warnings; full `pnpm lint` and build passed. Build has
  an existing unused CSS selector warning in `SkillManageDialog.svelte`.
- Isolated Workers runtime uses independent local D1/R2/KV, synthetic 137-skill data,
  and no model keys, production bindings, queues or authenticated production session.
- Isolated HTTP: profile pages 1/2/6 return 24/24/17 skills; page 7 and missing user
  return 404. Home, Recent, Top, Trending, categories, Testing category, organization
  and existing skill detail return expected 200 bodies. Local fixture/cache setup
  issues were corrected before these checks; no production data was changed.
- Real Chrome in isolation: profile direct load, page-2 click/refresh and distinct-page
  contents passed, with no console or resource errors. Synthetic avatars were supplied
  locally; the initial nonexistent fixture avatar had returned 502 from the avatar proxy.
  No production avatar behavior was modified.

Web rollback version: `d22fda5f-fe6e-4e8a-92ed-52aa57845278`.
New Web version: `de99cb3b-b5ba-4b82-b7d6-9d30150e71c4`, deployed at 100% at
10:02:23 UTC and confirmed with `wrangler deployments status`. Existing build/assets
were uploaded and only the Web version was promoted. Remote settings at 10:05:01
confirm the expected secrets, D1/R2/KV, STATE_DO and queue bindings are retained.
Original AI Worker versions remain unchanged. No schema changes; rollback remains
schema-compatible.

## Post-deployment results

All production HTTP checks used ordinary `https://skills.cat` URLs and bounded low
request counts. Real browsers had no authenticated session and blocked mutations,
analytics and speculative traffic. Only normal Cache API fill and request logs were
allowed; no production R2 derivative cleanup, queue injection or test AI calls.

| Check | Result |
| --- | --- |
| Original `/u/anthropics` error | 200, correct author and **124** total skills; 24 cards on the first page. Runtime events identify the new Web version and show zero error logs. |
| Profile pagination | Page 2: 200/24 cards; page 6: 200/4 cards; page 7 and page 101: 404 with a 404 body. |
| Profile Chrome interaction | Direct load, click to page 2, refresh, disjoint first/second-page cards and `/u/anthropics/__data.json` 200 all passed. Screenshot inspected. Avatar and app assets loaded normally. |
| Public search | Normal and second page: 200/populated; empty query: 200/empty; page 101: 404. |
| Categories, Testing and Trending | 200, expected headings and populated lists; missing category 404. Browser category navigation and SvelteKit data 200 also passed. |
| Organizations / missing resources | Existing YottaMeta 200; missing user, organization and skill detail all return 404 with matching bodies. |
| Registry search/cache | Supported `skillscat/0.9.5` UA: 200, five results and `{skills,total}`; ordinary repeated URL naturally showed `X-Cache: MISS` then `HIT`. No cache purge. |
| HTTP headers | Profiles retain public s-maxage 1800, search s-maxage 60; category/Trending no-store and MISS are existing policy. No 200 error body in the tested success paths. |
| Browser console | No uncaught page errors or unexpected failed allowed resources. Remaining `net::ERR_FAILED` console entries correspond to deliberately blocked analytics/speculation/challenge requests. The previous SW registration exception no longer occurs with a consistently unavailable SW API in the test context. SW behavior itself is not asserted verified. |
| Home, Recent, Top, existing detail | HTTP and real Chrome passed using independent local D1/R2/KV and synthetic data, including page text, lists and rendered README. The detail access-statistics POST was blocked and its expected console warning recorded. |
| Production read-only preconditions | At 10:03:35, the primary stats R2 object had only ~35 seconds of remaining freshness and the versioned Recent/Top objects were absent. Production navigation could promote/write R2 derivatives, so these paths remained isolated. Existing detail may write highlighted README/recommendation derivatives and was also isolated. These are verification safety boundaries, not newly observed failures. |
| AI queues | At 10:05:01, both classification/security queues had zero messages/bytes. A natural security cron was observed with outcome ok; no classification messages occurred during the bounded window. Inactivity is not a failing Worker and does not prove provider calls or result persistence. Existing isolated queue tests cover those code paths. |

Runtime summary and precise observation window are in the
[evidence file](production-acceptance-fix-evidence-2026-09-19.json), grouped by deployed
version so pre-fix errors are not attributed to the new code. No new-version error
logs or uncaught exceptions were observed in this window.

The outstanding production-only coverage is naturally occurring AI inference/write
execution, authenticated flows, service-worker operation and the reads with R2/business
side effects listed above. They were not relabeled as passed or artificially triggered.

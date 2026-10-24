# Web 0.9.10 UI and documentation release

## Scope and pre-deployment checklist

The user explicitly authorized review, commits, push to main and production deployment of the accumulated UI and documentation changes. The reviewed scope includes the shared English/Chinese/Catalan documentation layout and section structure, concise GitHub card, custom keyboard/touch language menu, removal of duplicate Catalan introductions/navigation, one footer community link, and resource-folder transitions with reduced-motion support and reliable README file navigation. Japanese/Korean documentation continues to use the existing English fallback.

No server API, database schema, bindings, secrets or background-worker behavior changes. Deploy only the Web Worker, using the release script's build/assets/upload steps directly; the general script also redeploys the unrelated state Worker.

- Baseline: committed main `289c5e21e73ba8b6cdb931511a3a71c59f3eee01`, Web 0.9.9; remote main matched before review.
- Confirmed production/rollback Worker version: `36167581-a715-4cf1-9d78-5bb5c46c8d68` at 100% traffic.
- Build Web 0.9.10; check typecheck, lint, all Web tests, production build and Wrangler dry run.
- Repeat isolated real-browser review across languages, themes, desktop/mobile, keyboard/touch, no-JS docs, zoom, resource transitions/reversals/deep links/reduced motion.
- Commit logical groups and verify each commit is an ancestor of remote main before uploading the exact build. Record the deployed version, runtime/binding comparison and public asset hashes.
- Check ordinary production home/Recent/Top/Trending/search/categories/category/skill/user/org URLs, pagination, empty results and missing resources; all affected docs/editorial/footer/menu paths.
- In Chromium check direct open, refresh, internal navigation/SvelteKit data, body/list/detail rendering, assets, console and network failures. Intercept all writes, analytics, access/install counters, avatar proxy and unverified API calls. Do not use production auth/write flows.
- Read existing R2 derivatives and bounded known-key D1 rows before requesting pages with possible write-through behavior. Do not request unsafe paths if dependencies are absent/stale. Do not purge caches, trigger queues/cron, or create production records.
- Capture sanitized Web tail events during acceptance. Record expected 404s separately from exceptions/5xx. Check Cache API/edge hit and natural miss/revalidation without changing production cache configuration.

## Validation and deployment results

Production Web acceptance passed for the explicitly listed scope on 2026-10-24, after the asset compatibility correction below.

- Source: `64a138d487bcf0518cb89e2bc2a898ac0e0df480` on main, including `684fe71` (documentation/navigation) and `f160720` (resource transitions). Remote main matched before upload. Signed release tag: `web/v0.9.10`.
- Final Worker version: `a16c7e15-7110-4f2a-8346-6cb091e24465`, at 100% traffic. Rollback target: `36167581-a715-4cf1-9d78-5bb5c46c8d68`. Runtime settings and bindings compare equal before/after.
- Local: 136 Web test files / 1,039 tests passed; monorepo typecheck had zero errors/warnings; lint, production build and Wrangler dry run passed.
- Isolated Chromium: 40 Catalan/shared page checks, 5 zoom checks, 4 menu presentations and 7 interactions; 60 docs presentations across five locale preferences, 5 navigation scenarios, 9 zoom checks and 9 no-JS pages; 15 compact GitHub-card checks; 11 resource-motion checks. All passed without unexpected JavaScript/request/server failures. No-JS script/modulepreload blocks were recorded separately.
- Final production deployment: all 42 HTTP checks and 18 Chromium scenario groups passed, covering home, lists, search/empty results, pagination, expected 404s, profiles, docs/TOC/back links, custom locale switching, mobile/dark layouts, Catalan cleanup and original resource-folder animation. The browser exercised direct opens, reloads, internal navigation and SvelteKit data requests. Five browser console messages correspond to deliberate 404 cases; no unexpected console error, page error, failed request or 5xx occurred.
- Nine canonical/structured-data checks passed across English/Chinese/Catalan documentation. Japanese/Korean preferences continue to use the existing English docs fallback.
- Ordinary URLs showed natural MISS/revalidation and Cache API/Cloudflare HIT states. Both layers are recorded because origin `X-Cache: MISS` may remain in an edge HIT response. No cache purge or test query parameter was used for cache observations.
- Public `/_app/version.json` and `/sw.js` hashes match the tested build. Both corrected old chunks also match their recovered original bytes.
- Final Web logs, 02:46:16 UTC–02:47:43 UTC: 231 events from the final version, all outcome `ok`, zero exceptions, zero HTTP 5xx, zero missing immutable assets, and zero error-level logs on verified paths. A separate burst of unrelated requests for nonexistent `.env`, PHP/config and Next.js paths returned 404; 85 emitted route-not-found error logs. These are preserved and distinguished from application verification, not reported as zero global error logs.

## Asset compatibility correction

The initial deployment `e7c24efd-1311-4f15-9cb0-a689c4f0951e` passed page checks, but final log review found two real 404s for prior-release chunks `zVQo3Mf5.js` and `BgggL2eI.js`. This can break deferred loading in a page opened before deployment, so initial acceptance was not approved.

The signed `web/v0.9.9` source and its original SvelteKit build version `1792783396562` reproduced all 220 immutable asset paths from the original build log. The version value was verified against the previous release's published `version.json` hash. Original build paths are material to UnoCSS hashes; recovery therefore used the original build directory while preserving/restoring the current committed source and exact tested output. All current Worker/SW/version files remained byte-identical.

Retaining the previous immutable files added 93 absent assets without overwriting any current file. The final deployment contains the 0.9.10 application plus this previous-release compatibility set. Repeat Chromium checks loaded the old app's layout/error/docs/CLI/OpenClaw/skill route modules successfully, including 79 immutable asset responses, with no console errors, failed requests or 404s. The two original missing files now return 200 and match their SHA-256 hashes.

Future releases must retain the previous production immutable asset set when assembling the upload; a fresh Vite build alone removes these files. Exact local snapshots are saved in ignored `apps/web/.wrangler/web-release-assets/0.9.9` and `0.9.10`. Their contents/lineage are recorded in the evidence manifest. This release does not add automatic cross-release asset retention to the general deployment script.

## Verification boundaries

Production requests read existing public data. Known-key D1 preflights reported zero written rows; R2 checks confirmed existing derivatives and a fresh home snapshot. Analytics, visit/install counters, mutations, avatar proxy and unverified APIs were intercepted in Chromium. No production accounts, authorization records, queue messages, manual cron runs, data fixes or cache purges were initiated for verification.

The initial browser harness's empty analytics script caused expected integrity errors. The final run loaded the real integrity-checked script while intercepting telemetry POSTs; this eliminated those harness artifacts. Expected missing-resource cases remain recorded separately.

Known raw README/highlighted R2 keys for the original resource route were absent; existing page read caches supplied its README. The page and folder animation were verified, but its file API was not called. File previews, nested/deep links, rapid reversal, keyboard and reduced-motion behavior were tested using isolated fixtures. No production lazy-file refresh was triggered for testing.

Authenticated/write flows and Service Worker install/update/offline behavior were not exercised. Matching SW hashes establishes publication only. Native Catalan linguistic review remains pending as disclosed in the contribution page. No background Worker changed; prior search-worker/sitemap follow-up is outside this UI release's acceptance.

Detailed results: [evidence](ui-docs-release-2026-10-24/evidence.json), [final sanitized logs](ui-docs-release-2026-10-24/web-tail.jsonl), [initial logs including the corrected asset failure](ui-docs-release-2026-10-24/initial-web-tail.jsonl). Screenshots: [English docs](ui-docs-release-2026-10-24/docs-en-desktop.png), [Chinese docs](ui-docs-release-2026-10-24/docs-zh-CN-desktop.png), [Catalan mobile](ui-docs-release-2026-10-24/docs-ca-mobile.png), [language menu](ui-docs-release-2026-10-24/locale-mobile.png), [resource folder](ui-docs-release-2026-10-24/resources-desktop.png).

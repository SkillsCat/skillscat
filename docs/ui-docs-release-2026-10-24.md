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

Pending completion of the authorized release. Detailed results and boundaries will be recorded after production verification.

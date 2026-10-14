# Jev production release — 2026-09-19

Follow-up: the user-profile 500 recorded below was diagnosed and fixed in Web version
`de99cb3b-b5ba-4b82-b7d6-9d30150e71c4`. See [the repair and re-verification report](production-acceptance-fix-2026-09-19.md). The original release observations below are historical.

Original status at 09:47 UTC: both workers were deployed with **OpenRouter free models first, Jev fallback**.
Production acceptance was **incomplete**: an existing public user page returned 500,
and the bounded observation window cannot establish all Worker AI paths.
The user authorized the same TypeSafe key for production and both Worker deployments,
then requested free-model priority. No Git commit, Web deployment, schema migration,
or production test messages are included.

## Versions and rollback

Source checkout: `cecb16529882a5f3a50c92eaf9ecea07f5b6bdbe` plus local Jev changes.
Times below are UTC. Latest versions were confirmed with `wrangler deployments status`.

| Worker | Pre-Jev rollback version | Free-first version (100%) | Deployment time |
| --- | --- | --- | --- |
| classification | `66460dc9-03d7-4001-8579-325e58745be5` | `06643792-9a2f-4724-8dbc-24628aebda2e` | 09:37:14 |
| security-analysis | `2f75fcc4-979a-494a-ac7e-bddbd383e8c6` | `e119bcc7-7d72-4edb-8f7f-82ed2f200ce4` | 09:38:30 |
| web, unchanged | `d22fda5f-fe6e-4e8a-92ed-52aa57845278` | not deployed | unchanged |

Earlier in this session Jev-first versions were deployed: classification
`08f625a3-4e8e-4a2f-a678-07286beee6d2` at 09:27:27, security-analysis
`00414536-b517-43e8-9da4-fba565e4a4e2` at 09:28:12. The user's subsequent cost
preference is implemented in the free-first versions above; the intermediate versions
are no longer assigned traffic.

The original upload combined code and the one new secret via `wrangler versions upload
--secrets-file`. Subsequent free-first uploads retained that secret. Existing D1/R2/KV,
other secrets, model overrides, cron and queue triggers were retained. Remote settings
at 09:41:55 confirm `TYPESAFE_API_KEY` is a secret on both workers and
`TYPESAFE_MODEL=jev-1.13.0`. Classification uses `AI_MODEL` and `FREE_MODELS` equal to
`openrouter/free`; security uses `SECURITY_FREE_MODEL=openrouter/free`.
Existing paid classification fallback and premium safety review use `openai/gpt-5.4-nano`.
No schema changes; rollback can promote the pre-Jev versions with
`wrangler versions deploy <version>@100` using the corresponding production config.

## Local validation

- 106 tests passed across `typesafe`, `classification`, `security-analysis-worker`,
  `security`, `security-summary`, and `seo-growth`. They assert zero Jev calls after
  free-model success, actual free model filtering/order, cooldown persistence, paid
  compatibility fallback, malformed/uncertain results, and isolated queue persistence.
- Web typecheck: zero errors and warnings. Changed-file lint and `git diff --check` passed.
- Both production Worker bundles uploaded successfully (startup reported as 7 ms).
- Full repository lint previously encountered existing generated
  `tmp/quality-worker-build/web/_worker.js` rule-resolution errors; excluding that
  generated directory passed. This is not a clean unqualified full-lint result.
- Five real Jev API requests with synthetic English/Chinese samples verified the key,
  API contract, score rounding and confidence fallback; details in [typesafe.md](typesafe.md).
  These were local smoke checks, not production task injection or an accuracy benchmark.

## Production verification

All HTTP requests below used ordinary `https://skills.cat` URLs, bounded sequential
requests, and existing public records. Registry requests used `skillscat/0.9.5`.
Production business writes, test queue messages, manual cron and AI/GitHub test calls
were excluded. Browser contexts had no authenticated session and blocked mutations,
analytics, speculative fetches and service workers; unsafe page paths were not allowed.

| Scenario | Actual result / boundary |
| --- | --- |
| Cron and queue configuration | Confirmed via Cloudflare API. Classification `17 * * * *`; security `*/15 * * * *`. Both consumers retain batch size 5, wait 60 s, retries 3, corresponding DLQ; existing producers unchanged. |
| Queue backlog at 09:42:24 | Realtime REST metrics: both queues 0 messages, 0 bytes, no oldest message. Earlier 15-minute GraphQL aggregates returned no samples, not proof of zero backlog. |
| Natural execution logs | 09:37:14–09:47:40: new security version emitted one successful natural cron event; classification had no events. No manual triggering. |
| Search at 09:39:40–43 | Query `testing` and page 2: 200, populated body (50 skill links). Empty query sample: 200 with zero results. Page 101: 404 and 404 body. |
| Categories / category detail | 200 with correct titles/body; Testing has 24 skill links. All 49 predefined aggregate rows were verified present before access, so initialization was not required. Nonexistent category: 404 with “Category Not Found” body. |
| Trending | 200 with 24 skill links; its snapshot reader does not rewrite R2 derivatives. |
| Organization | Existing `/org/yottameta`: 200, YottaMeta heading and existing empty public list. Missing organization: 404 with matching body. |
| User | `/u/anthropics`: **500**, both before the first Jev deployment and at 09:39:46 afterward; Web version unchanged. Missing user: 404 with “User Not Found” body. Existing 500 remains unresolved and prevents full acceptance. |
| Missing skill | `/skills/jev-nonexistent-20260919/no-such-skill`: 404 with “Skill Not Found” body. |
| Registry search | `/registry/search?q=testing&limit=5`: 200, `{skills,total}`, five results, `X-Cache: HIT` twice; earlier baseline observed MISS at the same ordinary URL. Header remains `private, no-cache`. |
| HTML cache headers | Search is public with s-maxage 60, Cloudflare BYPASS. Category/Trending responses show no-store and X-Cache MISS; user is public with s-maxage 1800, organization no-store. Record observed policy, not a claim that all pages are cached. No cache purge or forced cache-busting was used. |
| Real Chrome browser | Search direct load and refresh show populated Chinese UI and a 200 `/search/__data.json`; categories direct load, click to Testing, 200 `/category/testing/__data.json`, Trending direct load and existing organization all show expected headings/content. Testing screenshot inspected. |
| Browser errors / limitations | No uncaught page errors or unexpected failing allowed resources in the checked paths. Console reports blocked resources and service-worker registration errors caused by the verification context disabling service workers. Initial navigation selector wrongly treated the Categories menu as an anchor; a follow-up using a real category link completed. No service-worker behavior or authenticated flows are claimed verified. |
| Homepage, Recent and Top | Not exercised in production: their readers can delete/refresh stale R2 derivatives; homepage stats object was stale in preflight. Normal HTTP methods alone do not make those reads safe. |
| Existing skill detail | Not directly opened: SSR may write highlighted README to R2 and invoke recommendation recomputation. Presentation and Worker write/error paths were instead exercised by isolated tests. |

## Natural execution evidence

During 09:37:14–09:47:40, security version `e119bcc7-7d72-4edb-8f7f-82ed2f200ce4`
produced one natural `*/15 * * * *` cron event, observed at 09:46:15.684, outcome `ok`,
zero error logs and zero exceptions. This event does not prove an AI task ran: no
provider markers or queue-consumption events were observed. Classification emitted
no events during this bounded window; its next hourly cron was outside the window.
Neither the absence of events nor empty queues is counted as AI-path validation.

The unchanged Web version emitted 332 observed events, all with outcome `ok`, but
one contained an error log at 09:39:46.472, contemporaneous with the recorded 500 user
page request. This illustrates why `outcome=ok` alone is not acceptance evidence.
Tails were stopped after the observation window. Sanitized timestamps, versions,
public HTTP results, browser scenarios and queue metrics are retained in
[the evidence file](jev-production-evidence-2026-09-19.json).

Actual provider calls, retries, token usage and result persistence on the new Worker
versions remain unverified in production. No claim of complete site or model-quality
validation.

Only sanitized evidence is retained: versions, timestamps, statuses, event counts and
public path results. No keys, cookies, private business records or raw request logs.

# Catalan localization

## Scope

The `ca` locale covers the core website interface, built-in categories, skill-detail
controls, account/organization settings, submission feedback, documentation and
three original tutorials. The terminal program's messages are **not** localized.
Legal documents retain their existing English text when the Catalan interface is
selected; the document is labeled and marked `lang="en"`.

- Shared public routes: `/ca`, `/ca/search`, `/ca/categories`, `/ca/category/:slug`,
  `/ca/trending`, `/ca/recent`, `/ca/top`, `/ca/docs`, `/ca/docs/cli`,
  `/ca/docs/openclaw` and `/ca/skills/:owner/:name`.
- Catalan-only editorial routes: `/ca/blog`, `/ca/blog/:slug`, `/ca/catala`.
- Content source: `apps/web/src/lib/content/catalan-blog.ts` and
  `apps/web/src/lib/components/docs/CatalanDocs.svelte`.
- Interface catalogs: `apps/web/src/lib/i18n/`.

Third-party names, descriptions, SKILL.md documents, scripts and bundles remain
unchanged. The registry does not currently provide reliable source-language
metadata, so the interface says that the original language is unspecified rather
than guessing that it is English. Collection pages have a source-content notice;
detail pages also explain the boundary. Generated summaries are not promised to
be Catalan. No partnership, endorsement or .cat registry approval is claimed.

## Routing, preferences and SEO

`hooks.ts` reroutes supported prefixed public URLs to existing SvelteKit routes.
The visible path takes precedence over cookies for Catalan. Root layout loading
tracks `url.pathname` so client-side language links refresh SSR locale data.
The browser remembers explicit locale choices without adding `Set-Cookie` to
shared public HTML responses. Language switching retains query strings and hash
fragments on shared pages; a Catalan-only editorial page has no other-language
equivalent, so switching takes the visitor to the chosen homepage.
Japanese/Korean choices from docs also use their homepage, because unprefixed
documentation has an English SSR fallback. Public route preferences synchronize
in both directions (Catalan and English), including restored `pageshow` events;
English-only docs do not erase the existing Japanese/Korean cookie preference.

Translated public content has self-canonicals and `ca` hreflang alternatives.
Search remains noindex. Catalan-only articles do not advertise invented
English/Chinese equivalents. Skill pages translate controls, not their main
third-party content: they retain the original-language canonical and are not
advertised as Catalan skill translations in hreflang or sitemaps. The static core
sitemap includes the original Catalan editorial pages; its cache key is versioned
to refresh both hot cache and R2 snapshot data without a production purge.

There are no database migrations, new bindings, secrets, background jobs or new
remote data fetches. Existing HTML cache keys already partition by locale, and
invalidation enumerates the `LOCALES` list.

## Translation conventions and review

- Preserve product/command names, flags, slugs, URLs and interpolation tokens.
- Use the product term `skill` (masculine), with an initial explanation as a
  reusable capability. Use `l’skill`, `l’slug` and `la CLI` in prose.
- Keep the published exact-slug installation path first:
  `npx skillscat add <slug>`. Repository discovery uses `info owner/repo` or
  `add owner/repo --list` instead.
- Use count-neutral labels or explicit singular/plural variants. English
  `{suffix}` is intentionally absent from Catalan profile count labels.
- Do not turn popularity, scans or presence in the catalog into safety guarantees.

The initial copy has undergone independent automated linguistic review against
source meanings, grammar, placeholders and command syntax. This is **not human
or native-speaker certification**. Human review of naturalness and terminology
remains pending and is disclosed on the Catalan resources page. Contributions
use the repository's actual GitHub issue and pull-request workflows; no response
time or maintenance schedule is promised.

## Verification

Run the normal repository checks plus the focused locale coverage:

```sh
pnpm typecheck
pnpm lint
pnpm --filter @skillscat/web test
pnpm test:cli
pnpm build
pnpm --filter @skillscat/web exec vitest run test/catalan-catalog.test.ts test/catalan-routing.test.ts test/catalan-editorial.test.ts test/catalan-errors.test.ts test/search-page.test.ts
```

Before release, use an isolated local environment for real browser checks at
mobile and desktop widths. Cover direct load/refresh, English footer → Catalan
client navigation, search query + hash preservation, Back/Forward, repeat language
switches, keyboard access, empty results/recovery links, and original-content
labels. Check `lang`, `Content-Language`, canonical/hreflang and sitemap output.
Do not treat HTTP/SSR tests as visual or browser-navigation validation. Public
production verification must follow AGENTS.md's side-effect and release rules.

Additional local regression coverage checks repeated locale choices, completion
of overlapping invalidations, route-history locale resolution and preference
restoration. Isolated SvelteKit `__data.json` smoke checks confirm the root
layout's URL invalidation dependency, explicit path precedence over conflicting
cookies, translated-category search, and empty/missing-resource responses. These
tests do not certify real browser history, visual layout or mobile interaction.

## Local PR review — 2026-10-24

Reviewed PR #1 at `898d9b541f1209496dd936cb0515399586a0a01e` against
`df1ab2ef51d14d496d43d20b982ff7e0b3e8064f`. Two browser-reproduced issues were fixed:

- English CLI/OpenClaw section fragments had no matching Catalan targets. The
  Catalan guides now expose all 13 shared section IDs and keep their original
  Catalan aliases. Switching at `#install-skills` now scrolls to the installation
  section instead of returning to the top.
- The blog's “Llegeix la guia” action was an inaccessible, noninteractive span.
  It is now a link with an article-specific accessible name; mouse activation
  and keyboard Enter both open the intended article.

Local checks passed: typecheck (0 errors/warnings), lint, Cloudflare build,
1,036 Web tests and 191 CLI tests. The previously reported submit-test timeout
did not reproduce in either local Web run.

Real Chromium checks covered 1440px desktop and 390px mobile layouts, 17 public
and error routes, language switching, query/fragment retention, history, mobile
navigation and keyboard activation. A fresh local D1/R2 environment with 55
synthetic skills additionally exercised the compiled Worker: list pagination,
page jumps, successful skill details, original content, slug-first install
commands, and English/Catalan HTML cache MISS/HIT isolation.

[Browser evidence and environment limits](catalan-review-2026-10-24/browser-evidence.json)
and desktop/mobile screenshots are saved beside this document. No production
bindings or production business data were used. Real OAuth, authenticated writes,
Service Worker behavior and native-speaker certification remain outside this
verification. The local environment intentionally omitted GitHub OAuth secrets;
one access-telemetry request also kept Chromium's network-idle wait open despite
a logged 200 response. No remote PR CI workflow exists; no CI pass, merge or
deployment is claimed.

## UI and content follow-up — 2026-10-24

The second pass reviewed all 705 strings in the seven core Catalan catalogs,
49 category names/descriptions, 11 category sections and guidance paragraphs,
the home introduction, all three documentation pages, all three articles and
the Catalan initiative page. Commands and technical identifiers were compared
with the current CLI implementation; third-party content remains unchanged.

Two additional issues were corrected:

- The shared relative-date formatter displayed zero years for timestamps
  360–364 days old. It now stays in months until the first full year, with
  boundary regression coverage.
- The Catalan detail page's agent-install prompt was still English. Its own
  instructions now follow the Catalan interface, including private/unlisted
  guidance, while preserving commands, exact slugs and bundle URLs. English
  server/API install payloads retain their existing contract.

Real Chromium checked 26 routes at 1440px and 320px in both light and dark themes
(104 page checks): all returned 200, kept `lang="ca"`, and had no document-level
horizontal overflow or JavaScript page errors. These included all new editorial
pages, discovery/detail pages, account settings, organization settings, bookmarks
and device authorization. Authenticated pages used a synthetic local user,
session, organization and private skill in the isolated D1 environment.

Six dialogs were checked for translated labels and open/cancel behavior: skill
management, organization creation/editing, member invitation, account deletion
confirmation and repository submission. Four representative pages also retained
their layout with 200% root text sizing. The translated agent prompt was copied
through the real browser clipboard and its command and endpoint were verified.

The complete Web suite passed (1,039 tests), as did typecheck, lint and the
Cloudflare production build. [Detailed UI evidence](catalan-review-2026-10-24/ui-content-evidence.json)
and five additional screenshots are saved in the review folder. This is local
verification with synthetic data, not production acceptance or real GitHub OAuth
validation. Dialog submissions/destructive actions and Service Worker behavior
were not exercised. Assistant linguistic review does not replace the pending
review by Catalan-speaking contributors.

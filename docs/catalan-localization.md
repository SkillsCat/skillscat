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

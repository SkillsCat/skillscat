# SkillsCat Contributor Guide

This document describes the local developer workflow for SkillsCat.

## What This Repository Contains

SkillsCat is a pnpm monorepo with:
- `apps/web`: SvelteKit web application + Cloudflare worker entrypoints
- `apps/cli`: `skillscat` CLI package
- `scripts`: initialization/bootstrap tooling

## High-Level Architecture

- Web app: user-facing pages, auth, APIs, org/user management
- Worker pipeline: GitHub ingestion -> indexing -> classification -> ranking/lifecycle jobs
- Data layer: D1 (relational data), R2 (cached files), KV (state/counters), Queues (async jobs)

## Local Setup

### 1. Install

```bash
pnpm install
```

### 2. Initialize

```bash
pnpm init:project
```

Alternative modes:

```bash
pnpm init:local
pnpm init:production
```

### 3. Run Web App

```bash
pnpm dev:web
```

## Common Workspace Commands

```bash
pnpm build
pnpm build:cli
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm test:cli
pnpm db:generate
pnpm db:migrate
pnpm deploy
```

## Web App Notes (`apps/web`)

- Route handlers are under `apps/web/src/routes`.
- Shared UI components are under `apps/web/src/lib/components`.
- Worker sources are under `apps/web/workers`.
- Example Wrangler configs are in `apps/web/wrangler.*.toml.example`.
- Example local env vars are in `apps/web/.dev.vars.example`.

## CLI Notes (`apps/cli`)

- Entry point: `apps/cli/src/index.ts`
- Commands: `apps/cli/src/commands/*`
- Build output: `apps/cli/dist`

## Deployment Notes

- Deploy target is Cloudflare Workers.
- Ensure all required bindings are configured per worker.
- Keep D1 migrations and worker code in sync.

## Coding Expectations

- Use strict TypeScript patterns.
- Keep runtime logic side-effect aware and testable.
- Prefer clear naming and stable public API shapes.
- Preserve backward compatibility for CLI command behavior when possible.

## Troubleshooting Checklist

1. Validate `.dev.vars` values.
2. Verify Wrangler configs and resource IDs.
3. Confirm D1 migrations have been applied.
4. Check queue bindings for producer/consumer workers.
5. Review worker logs for failed jobs or retry loops.

## License

Project license: AGPL-3.0.

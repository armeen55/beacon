# Beacon Architecture

> **PURPOSE:** the system map — kernels, surfaces, records, persistence, measurement, and the invariants
> the tests and guard enforce. Answers "how does it fit together?" Not a plan (→ `NEXT_PHASE_EXECUTION_PLAN.md`)
> or current state (→ `HANDOFF_VERIFIED_STATE.md`). Ceiling: 250 lines.

## What Beacon is

Beacon is a single-user internal product that helps an operator get found on Google and AI search. It reads
the sources a business already uses, turns what it finds into exact, ranked changes to make, and honestly
measures whether each shipped change helped. Publishing is manual: Beacon never edits the live site.

Stack: Next.js 16 (App Router), React 19, TypeScript strict, Supabase (Postgres) as the production
repository, vitest for tests. Deployed on Vercel (`main` → `beacon-bice.vercel.app`).

## The five kernels

All domain logic lives under `src/domains/` in exactly five top-level kernels. `src/app` and `src/components`
consume a kernel only through its public facade (`src/domains/<kernel>/index.ts`) for value imports; deep
`import type` is allowed. The foundation guard enforces this.

- **account** — tenants, memberships, onboarding, site/account config, explicit tenant/site resolution.
- **evidence** — the six source boundaries normalized into one `EvidenceSnapshot`: pages/scanning, GSC signals,
  GA4 values, Microsoft Clarity, DataForSEO SERP, native AI-visibility (citations, tracked prompts/entities),
  competitor evidence, CTR-curve forecasting input.
- **decision** — proposes and validates change proposals: recommendation-intelligence + page-surgeon, LLM
  drafting, factual/destructive validation, ranking, the `changes` lifecycle, opportunities.
- **measurement** — proof-gsc (the 7/14/28 read kernel), attribution, changelog, results, revenue, scoreboard.
- **runtime** — on-visit refresh, background surface preparation, connector orchestration, operational
  failure state.

**Dependency direction:** Account → Evidence → Decision → Measurement; Runtime orchestrates. Forbidden edges
(guard-checked): Evidence importing Decision or Measurement; Measurement importing Decision. A small set of
pre-existing leaks is grandfathered in the guard (`kernelDirectionExceptions`, non-increasing) and tracked
for severance — no new leak may be added.

## The four surfaces + allowed routes

The customer product is four surfaces plus settings and minimal onboarding. Routes are allowlisted in
`foundation-budget.json`; a new customer route needs operator approval.

- **Today** (`/`) — one command: the single most important thing to do, plus a scoreboard and proof strip.
- **Changes** (`/changes`, `/changes/[id]`) — the ranked queue of proposed changes (To do / Ready /
  Measuring / Results), each with exact copy and honest confidence.
- **Results** (`/results`) — every shipped change and whether it helped, as directional reads vs comparison
  pages (never a causal claim).
- **Connections** (`/settings/connectors`) — the six sources, their connection and freshness state.

Also: `/settings`, `/settings/config`, `/onboard`, `/onboard/done`, `/login`, `/signup`, and one API route
`api/connectors/google/callback` (+ `api/version`).

## Canonical records

One canonical business record per concept — no duplicate shapes:

- **Tenant / Membership / Site / Connection** (account) — who the operator is and what is connected.
- **EvidenceSnapshot** (evidence) — the normalized read of all six sources for a page/tenant.
- **ChangeProposal** (decision) — one existing-page edit path and one new-page brief path, one validator, one
  ranker.
- **Shipment / Measurement** (measurement) — a shipped change and its 7/14/28-day reads.

## Persistence

Supabase (Postgres) is the production repository, reached through `getRepository().forTenant(tenantId)` — every
read and write is tenant- and site-scoped. A tiny in-memory/file repository backs tests and local runs
(`DATA_SOURCE=file`). Historical production records are preserved. New store tables are classified in
`src/lib/persistence/store-classification.ts`; an unknown store fails loud at the boundary. (Retiring the
legacy `.data` JSON mirror + dual-write path toward Supabase-only is tracked in the execution plan.)

## Measurement

`proof-gsc` reads each shipped change over 7/14/28-day windows against comparison pages that were not changed,
and emits a directional verdict — never a causal claim. Verdict vocabulary: `waiting`, `insufficient_evidence`,
`directional_decline`, `no_clear_movement`, `directional_improvement`, `stronger_improvement`, `confounded`.
Overlapping changes on one page resolve to `confounded`. The measurement boundary (native regime start) is a
single locked constant; cross-regime windows abstain. Every count on Today matches the same count on Results
(the ONE-COUNT RULE).

## Invariants (enforced by `tests/` + the foundation guard)

- **Tenant isolation, fail-closed** — an authenticated request never falls back to another tenant or an env
  default; scoped reads only; caches are keyed per tenant.
- **No paid provider calls on render** — no shell page imports an LLM/GA4 live path; proposal generation runs
  in background refresh, not on the render path.
- **Bounded egress** — route loaders read observations windowed and column-projected, never unbounded.
- **Publishing authority** — Beacon never writes the live site; "Mark implemented" stamps `verified_live`
  only; a crawl/index directive is always held for review, never one tap.
- **Ready exactness** — active proposals carry exact copy, no raw UUIDs, no placeholder phrases.
- **Customer-copy floor** — no lab/cron vocabulary, no vendor names, no causal overclaim, no tenant-name leak,
  and **no em or en dashes** on any primary surface.

## The foundation firewall

`npm run guard:foundation` (`scripts/check-foundation-budget.mjs`, config `foundation-budget.json`)
mechanically caps production/test/combined LOC, customer routes, top-level domains (5), file sizes,
public-export count, Markdown files/lines, and runtime dependencies; it enforces the facade boundary and the
kernel dependency direction. CI runs it via `.github/workflows/foundation.yml`. `npm run gate` runs
guard + typecheck + test + build. The full growth policy and the eight required fields for any new feature
live in `AGENTS.md`.

# Beacon — Migration Handoff: Vercel + Supabase + real dogfood workspace

**Written:** 2026-04-21
**Purpose:** exhaustive context + instructions for the next Opus agent. Goal is to move Beacon from laptop-JSON-first to hosted-Supabase-first with a real deployed URL so the operator can dogfood as customer-one.

**READ THIS FILE FIRST. THEN THE LINKED DOCS. THEN ASK THE BLOCKER QUESTIONS.**

---

## 1. TL;DR

Beacon runs locally on `.data/*.json` files plus an existing Supabase dual-write layer that is partially plumbed but not the default read path. Operator wants one hosted dogfood workspace — Vercel deploy, Supabase as source of truth, Supabase Storage for bulky artifacts, magic-link auth, their own URL they can open from any device.

The work is ~40% done already: Supabase project exists (28 tables, real data), dual-write exists, `bootstrap-from-supabase.ts` exists, `DATA_SOURCE=supabase` env var exists, repository abstraction exists (`src/lib/persistence/repositories/`). The remaining 60% is: flip `DATA_SOURCE=supabase`, find and fix everything that still reads JSON directly, add minimum auth, deploy to Vercel, move scan from CLI to serverless endpoint, gate behind login, run on the hosted URL.

Operator does NOT want: multi-tenant perfection, auth theater, queues/workers yet, to keep `.data/*.json` as canonical state in production.

---

## 2. Mission + guardrails

**Objective:**
End-state: operator opens `beacon-<something>.vercel.app`, logs in with magic link, lands on Today, clicks Confirm on a rec, closes laptop, opens phone, sees the same state.

**Hard guardrails (from operator, literal):**
- ✅ One hosted dogfood workspace. You are customer-one. Not SaaS-ready.
- ✅ No multi-tenant yet. `tenant_id` scoping can exist in the schema; don't add workspace switching UI.
- ✅ No auth theater. Magic link, one user, done. Supabase Auth is there already.
- ✅ Manual Confirm flow on findings stays (operator likes clicking to confirm; don't auto-confirm).
- ❌ Do not push the current local-JSON approach onto the public web.
- ❌ Do not add features before persistence is real.
- ❌ Do not build queues/workers until the basic loop works hosted.
- ❌ Do not migrate all stores in one pass. Do Phase 1 first, validate, then Phase 2.

**Anti-loop rules (Beacon-specific, from `.cursor/rules/core.mdc` + user):**
- No re-architecture chats. If a direction isn't working, push back and replan narrowly.
- One phase per implementation pass. Stop at stopping conditions.
- Don't create new docs unless necessary. Update existing ones.

---

## 3. Current state (read this before anything)

### Stack

- Next.js 16.2.2 (App Router), React 19.2.4, TypeScript strict, Vitest 4, Tailwind 4
- Node 22
- Deployment target: Vercel (operator's call)
- DB target: Supabase (project already exists, see §5)
- Storage target: Supabase Storage (not yet used)

### Package scripts that matter

```
npm run dev         → next dev (local)
npm run build       → next build
npm run start       → next start (after build)
npm run typecheck   → tsc --noEmit
npm run test        → vitest run
npm run data:scan   → scripts/scan-owned-pages.ts (CLI-only today)
npm run data:backfill-db → scripts/backfill-to-supabase.ts (push local JSON into Supabase)
npm run data:parity → scripts/compare-parity.ts (diff JSON vs Supabase)
```

### Pain points that drove this migration

- `.data/` total size: ~160MB (dominated by Profound CSV historical files)
- Every Today SSR render runs: scanner + router + section-presence classifier + rec engine + evidence-basis classifier + shared-brain + URL-level Z-score. 5-7s per render in dev mode.
- Module-level `readStore()` calls at ~20 file imports ≈ serverless cold start will read every one on boot.
- `answer-texts.json` is 38MB loaded in memory at module import time.
- Scan requires a local CLI (`npm run data:scan`). Cannot run on Vercel today.
- `recommendation-responses.json` writes evaporate on serverless read-only filesystem.

### Git state (CRITICAL)

- Branch: `main`
- **No remote configured.** Vercel deploy requires a Git remote (GitHub is standard).
- 9 unpushed commits from the customer-one arc (see §6).
- Working tree clean except `next-env.d.ts` (auto-generated, gitignored intent but currently tracked).

**First infrastructure step:** create a private GitHub repo, `git remote add origin <url>`, `git push -u origin main`.

---

## 4. Existing recent work (don't re-do)

Last 2 weeks of commits. Read `docs/VERIFICATION_LOG.md` for the full narrative — this is the short version:

```
5ff7779  feat(scan): H2/H3/schema-name diffs + auto-link rec→finding→changelog
4c870ff  chore(logging): gate diagnostic logs behind BEACON_DEBUG_RECS env flag
829f7f4  feat(today): 3-way section-presence classifier for "Add X section" recs
90cd41f  feat(scanner): widen page extraction (h3_list, body, cards, schema names)
bff8333  feat(scanner): phrase-shape gates (B2) reject robotic concepts
6b54a86  feat(today): page-placement router + declarative customer-facing copy
3ec1ec3  feat(today): split action stack from measured wins (3B/3C)
906c0e1  feat(today): surface evidence detail and evidence-basis pills (Phase 1+2)
047cc76  fix(today): suppress redundant keyword-positioning recs when concept present (3A)
```

Plus two documentation-driving files:
- `docs/CUSTOMER_ONE_TRACKER.md` — every phase of the customer-one arc with status
- `docs/IDEAS_PARKING_LOT.md` — 12+ deferred items with Claude's take + trigger condition

**Do not reopen any of these phases. They are shipped and working. The migration is a different axis of work.**

---

## 5. Supabase — what's actually there

Project ref: `jdegznovgysxyweknewh` · region `us-east-2` · Postgres 17 · created 2026-04-09.

**Use the Supabase MCP tools.** Do not inspect by inference. Query directly:

```
mcp__cd86b542-9086-477c-ad3f-0b619cd45df8__list_tables
mcp__cd86b542-9086-477c-ad3f-0b619cd45df8__list_migrations
mcp__cd86b542-9086-477c-ad3f-0b619cd45df8__execute_sql
```

### Tables that exist (28), with row counts as of 2026-04-21

**Operational tables (actively written):**
| Table | Rows | Notes |
|---|---|---|
| `pages` | 5,929 | page registry |
| `page_snapshots` | 595 | HTML snapshot extractions |
| `page_issues` | 7 | guardrail-class issues |
| `guardrail_alerts` | 5 | current active guardrails |
| `scan_findings` | 63 | **DRIFT: JSON has 80 pending, DB has 63** — dual-write is lossy |
| `changelog_entries` | 327 | changelog — includes new `source_rec_id` fields? verify |
| `change_contracts` | 85 | change-family experiment contracts |
| `change_outcomes` | 20 | natural-control outcome records |
| `change_patterns` | 7 | learned patterns |
| `attribution_decisions` | 28 | operator truth labels on events |
| `candidate_links` | 142 | attribution-candidate proposals |
| `page_visibility` | 16 | per-page citation materialization |

**Bulk data (populated by imports):**
| Table | Rows | Notes |
|---|---|---|
| `daily_metric_snapshots` | 24,085 | per-day per-topic metric series |
| `prompt_answer_observations` | 11,996 | AI answer observations (matches JSON exactly) |
| `answer_texts` | 11,996 | raw answer bodies (the 38MB JSON equivalent) |
| `results` | 1,467 | citation results |
| `tracked_prompts` | 100 |  |
| `tracked_entities` | 40 | brand + competitor universe |

**Config / small:**
| Table | Rows | Notes |
|---|---|---|
| `business_config` | 1 | tenant profile |
| `competitor_config` | 12 | competitor monitoring |
| `opportunities` | 1 |  |
| `observation_runs` | 25 | scan run metadata |
| `import_runs` | 3 | CSV import run metadata |
| `citation_evidence_index` | 1 | one big JSON doc |
| `answer_intelligence_index` | 1 | one big JSON doc |
| `triage_rules` | 10 | learned triage rules |
| `confidence_calibration` | 0 | empty, learned calibration (stub) |
| `competitors` | 0 | deprecated maybe |

### Row Level Security status

**All 28 tables have `rls_enabled: false`.** Acceptable for single-user dogfood **IF** the app is behind auth middleware and no public routes query the anon-keyed client. This is a blocker for public hosting without login. Either:
- (a) keep RLS off, gate everything behind Supabase Auth middleware, use the service-role key server-side only
- (b) enable RLS per-table with a single "authenticated user" policy

(a) is simpler for v1 and acceptable given single-user scope.

### What's NOT in Supabase yet (still JSON-only)

These stores were never added to dual-write. They must either get tables added or get computed-on-demand:

- `recommendation-responses.json` — **critical path** for the operator loop
- `url-change-outcomes.json` — URL-level Z-score verdicts (critical for Today rendering)
- `exit-gates.json` — Settings sign-offs (low priority)
- `change-events.json` + `event-attributions.json` + `site-movement-events.json` — Phase 0 event model (used by `/changes/truth`, behind flag)
- `classified-events.json` — attributor cache
- `shared-brain.json` — cross-tenant pattern aggregation (currently not read at render)
- `natural-control-results.json` — Phase 2B natural-controls output
- `co-mention-matrix.json` — competitor co-citation matrix
- `competitor-monitoring.json` — competitor crawl state
- `competitor-page-evidence.json`
- `url-change-patterns.json`
- `source-pattern-evidence.json`
- `outcome-store.json` (legacy; may be deprecated)
- `answer-snapshots.json`
- `action-states.json`
- `scan-settings.json`
- `import-runs.json` (note: table exists with 3 rows but JSON may drift)
- `url-daily-citations.json` (74K)
- `page-snapshots-prev.json` (used by scan-diff; might merge into `page_snapshots` with a version column)

**Full audit recommended before building any migration.** See §7.

---

## 6. Code architecture — every place state is read/written

### The persistence layer

```
src/lib/persistence/
├── json-store.ts                 readStore() / writeStore() — the JSON API
├── cold-store.ts                 CSV-specific reads (Profound data)
├── csv-parser.ts                 CSV parse helpers
├── dotdata-json.ts               .data path resolution
├── dual-write.ts                 syncChangelogEntries(), syncPageSnapshots(),
│                                 syncScanFindings(), etc. — current "fire and
│                                 forget" dual-write layer
├── supabase.ts                   Supabase client bootstrap
└── repositories/
    ├── file-backend.ts           Implements repository interface against JSON
    ├── supabase-backend.ts       Implements repository interface against DB
    ├── key-mapper.ts             Field name mappings (camelCase JSON ↔ snake_case DB)
    ├── types.ts                  Repository interface types
    └── index.ts                  Factory: returns backend based on DATA_SOURCE env
```

**Repository abstraction exists** but the `readStore`/`writeStore` direct-JSON path is used in 243 call sites across the codebase. The repository is only used by some domain code. Full DB-first mode requires either:
- (a) replacing all `readStore`/`writeStore` call sites with repository calls
- (b) rewriting `readStore`/`writeStore` internally to delegate to the repository (which delegates to Supabase or file backend based on `DATA_SOURCE`)

**(b) is the pragmatic path.** 1 file change instead of 243. Verify (b) is already partially done — inspect `src/lib/persistence/json-store.ts` first.

### Key store files (callsite counts grep'd 2026-04-21)

| Store file | Backed by | Touchpoints | Notes |
|---|---|---|---|
| `changelog/actions.ts` | JSON + dual-write | 5 writeStore calls | Already dual-writing |
| `scanning/findings-store.ts` | JSON + dual-write | 3 writeStore, 1 readStore | Already dual-writing, DRIFT |
| `product/recommendation-response-store.ts` | JSON only | 1 readStore (module-level), 1 writeStore | **Critical gap — no dual-write** |
| `attribution/url-change-outcome.ts` | JSON only | module-level readStore | **Critical gap — no dual-write** |
| `attribution/change-outcome-store.ts` | JSON only | readStore + writeStore | Gap |
| `scanning/orchestrate-scan.ts` | Dual-write | syncPageSnapshots, syncGuardrailAlerts, syncObservationRuns | Active scan pipeline |
| `pages/page-snapshot-diff-store.ts` | JSON | — | Diff history |
| `learning/change-patterns.ts` | JSON + dual-write | Already synced |
| `learning/confidence-calibration.ts` | JSON + dual-write | Already synced |
| `learning/triage-rules.ts` | JSON + dual-write | Already synced |
| `tenants/store.ts` | JSON only | Explicitly NOT tenant-scoped | Multi-tenant scaffold |

### Dual-write function inventory (grep `syncFoo`)

Open `src/lib/persistence/dual-write.ts`. Every exported `sync*` function is a store that dual-writes. Anything without a counterpart is JSON-only.

### Heavy module-level reads (cold start risk)

Module-level `readStore()` calls at import time. These run on every serverless cold start:

```
src/domains/product/recommendation-response-store.ts:44
src/domains/product/outcome-store.ts:25
src/domains/attribution/url-change-outcome.ts:88
src/domains/answer-snapshots/store.ts:16
src/domains/tenants/store.ts:21
src/lib/seed-data.server.ts (multiple — top-level await)
```

On Vercel serverless, cold-start latency = sum of all these reads. If they hit the DB, that's 20+ queries per cold start. Needs batching or lazy reads.

**Mitigation strategy:** convert all module-level `readStore()` exports to functions that read lazily per-request. Known tech-debt flagged in `HANDOFF_VERIFIED_STATE.md` ("Module-cached import data" MEDIUM severity).

### Scan pipeline (CLI-only today)

```
scripts/scan-owned-pages.ts
  ├── reads .data/page-snapshots.json (previous)
  ├── reads sitemap.xml (live crawl)
  ├── fetches each page (cheerio extract)
  ├── diffs new vs previous snapshots
  ├── classifies guardrails
  ├── generates findings (detect-findings.ts)
  ├── writes .data/page-snapshots.json (new)
  ├── writes .data/scan-findings.json (append pending findings)
  └── dual-writes via syncPageSnapshots + syncGuardrailAlerts + syncObservationRuns
```

Uses `puppeteer-core` (in dependencies). On Vercel you cannot run puppeteer on Hobby. Needs either:
- Fetch-only mode (cheerio is already in use — puppeteer may be unused)
- Vercel Pro + bundled Chrome
- External worker (Railway, Fly)

**Verify puppeteer is actually used.** Grep for `puppeteer` in `scripts/` and `src/`. If unused, drop the dep.

### Rec engine (per-request cost)

`src/app/(shell)/today-data.ts` — 1,800+ lines. Every Today render runs:
- Scanner (`keyword-gap-scanner.ts`) over all owned pages
- Router (`page-job-fit.ts`) over every finding
- Recommendation engine (`recommendation-engine.ts`) — 1,800 lines
- Evidence-basis classifier
- Section-presence classifier (new 2026-04-20)
- URL-level Z-score reads
- Shared-brain read (passive today)

5-7s per render in dev. Production build is faster but still ~1-2s. On Vercel this should be cacheable per scan-run (invalidate when a scan completes).

---

## 7. Storage inventory — what must move

### Already in Supabase (both JSON + DB exist, drift possible)

- changelog_entries (327 rows, JSON present)
- page_snapshots (595 rows, JSON present — 396KB)
- scan_findings (63 rows vs 80 JSON — **drift**)
- pages (5,929 rows, JSON present — 4.7MB)
- daily_metric_snapshots (24,085 rows, JSON present — 14MB)
- prompt_answer_observations (11,996 rows, JSON present — 15MB)
- answer_texts (11,996 rows, JSON present — 38MB)
- results (1,467 rows, JSON present — 1MB)
- tracked_prompts (100 rows)
- tracked_entities (40 rows)
- business_config (1 row)
- citation_evidence_index (1 row — 4.6MB JSON)
- answer_intelligence_index (1 row — 1.8MB JSON)
- change_contracts (85 rows)
- change_outcomes (20 rows)
- change_patterns (7 rows)
- triage_rules (10 rows)
- attribution_decisions (28 rows)
- candidate_links (142 rows)
- page_issues (7 rows)
- page_visibility (16 rows)
- observation_runs (25 rows)
- import_runs (3 rows)

### Needs a new table (operational loop-critical)

- `recommendation_responses` — critical. Operator acceptances live here. Schema: `rec_id`, `status`, `responded_at`, `defer_until`, `target_page_url`, `pattern_id`, `tenant_id`. ~8 fields.
- `url_change_outcomes` — Z-score verdicts. Drives Today's hurting/helping cards. Schema large (20+ fields — see `src/domains/attribution/url-change-outcome.ts`).
- `change_events` + `event_attributions` + `site_movement_events` — Phase 0 event model, behind `BEACON_EVENT_TRUTH_PREVIEW=1` flag. Low urgency (not on Today critical path).
- `exit_gates` — Settings sign-offs. Trivial.
- `action_states` — per-finding action states.
- `scan_settings` — already env-flagged probably.

### Belongs in Supabase Storage (blob, not rows)

- Profound CSV historical: **41MB** + 12MB + 10MB + 9MB + 5MB + 3.7MB + 2.6MB (≈83MB total)
- Any future raw HTML dump per scan (not currently stored)
- Export artifacts

### Can be DROPPED from JSON (already in DB)

Once `DATA_SOURCE=supabase` is live and verified:
- answer-texts.json (38MB) — DB has 11,996 rows already
- prompt-answer-observations.json (15MB)
- daily-metric-snapshots.json (14MB)
- pages.json (4.7MB)
- citation-evidence-index.json (4.6MB) — regenerable
- answer-intelligence-index.json (1.8MB) — regenerable

Net reduction: ~80MB off local disk. More importantly, no longer loaded in-memory at module import.

### Compute-on-demand (don't store)

- citation_evidence_index — rebuild from results + pages in a post-import worker
- answer_intelligence_index — rebuild from observations + citations in a post-import worker
- shared-brain — currently passive, rebuild on demand

---

## 8. Five blocker questions — ask the operator FIRST

Do not write code until these are answered. Paste these verbatim in the new chat:

1. **Supabase project reuse.** Use the existing `beacon` project (ref `jdegznovgysxyweknewh`, has 28 tables with Ritz data)? Or start a fresh project? Answer changes whether we migrate data or start clean.

2. **Scan trigger preference.** On the hosted URL: cron-only nightly scan, manual "Scan now" button that hits a serverless endpoint, or both? (Recommend: both — manual for dogfood iteration, cron for overnight.)

3. **Auth.** Supabase Auth magic link, one user (you), or something else already in play? (Recommend: magic link, single user.)

4. **Domain.** `beacon-<name>.vercel.app` free Vercel subdomain fine, or a custom domain from day 1?

5. **Vercel plan.** Hobby (free, 60-second function timeout) enough for v1, or should we start on Pro ($20/mo, 300-second limit)? Answer depends on scan function latency. Ritz is ~30 pages; cheerio scan should finish under 60s but it's close. If you're on Pro already, default to Pro.

---

## 9. Phased migration plan

### Phase 0 — preflight (read + audit, no code)

1. Read this entire doc
2. Read `docs/HANDOFF_VERIFIED_STATE.md` (overall system state)
3. Read `docs/VERIFICATION_LOG.md` § 2026-04-21 entries (recent fixes)
4. Read `docs/CUSTOMER_ONE_TRACKER.md` (shipped phases)
5. Read `.cursor/rules/core.mdc` + repo `CLAUDE.md` (project instructions)
6. Use Supabase MCP: `list_tables` (verbose=true) on every table to inspect schemas
7. Use `list_migrations` to see schema history
8. Grep `readStore\|writeStore` in src/, compare to `syncFoo` dual-write inventory
9. Inspect `src/lib/persistence/json-store.ts` — verify whether it already delegates to repository abstraction based on `DATA_SOURCE`
10. Ask the 5 blocker questions

**Stopping condition:** you can describe every persistent store, which are dual-written, which are JSON-only, which have drift, and have the operator's answers.

### Phase 1a — flip DATA_SOURCE=supabase locally

**Goal:** run Beacon entirely from Supabase on your laptop. No hosting yet, but `.data/*.json` is no longer read.

Steps:
1. Verify `DATA_SOURCE=supabase` is honored by `readStore()` (if not, fix `json-store.ts` first so the flip is centralized).
2. Set `DATA_SOURCE=supabase` in `.env.local`.
3. Run `npm run dev`.
4. Open `/` — fix every error that surfaces. Each error = a store that reads JSON directly.
5. Run `npm run typecheck && npm run test` — must stay green.
6. Scan once: `npm run data:scan`. Verify it writes to Supabase (not just JSON). Findings count in `scan_findings` table should increase.
7. Confirm one finding through the UI. Verify `changelog_entries` table gains a row + `recommendation_responses` (new table) gains a row.

**Priority order for gap fills (Phase 1a):**
1. Add `recommendation_responses` table + migration + dual-write + backend reader. Without this, the operator loop is broken.
2. Add `url_change_outcomes` table + migration + dual-write + backend reader. Without this, Today's hurting/helping cards don't render.
3. Reconcile `scan_findings` drift (63 DB vs 80 JSON). Either backfill or mark JSON-extra findings as stale.

**Stopping condition:** you can open `/`, click Confirm on a pending finding, and see the row appear in Supabase via MCP `execute_sql`. Full vitest green.

### Phase 1b — kill module-level JSON reads

**Goal:** no `readStore()` call runs at module import. Every one becomes lazy (per-request).

Grep `readStore` at module level in `src/domains/**/*.ts` (roughly 20 sites). Convert each to a function-scoped call. Pattern:

```typescript
// BEFORE (module-level, runs at import):
export const recommendationResponses: RecommendationResponse[] =
  readStore<RecommendationResponse>(STORE_NAME);

// AFTER (lazy, runs per-request):
let _cached: RecommendationResponse[] | null = null;
export function getRecommendationResponses(): RecommendationResponse[] {
  if (_cached === null) {
    _cached = readStore<RecommendationResponse>(STORE_NAME);
  }
  return _cached;
}
export function invalidateRecommendationResponsesCache(): void {
  _cached = null;
}
```

**Every consumer that currently imports the const must switch to the function.** Find via grep. Add cache invalidation at the end of any `persistFoo()` call.

**Stopping condition:** no `readStore(` appears at module-level scope in any src file. All consumers use functions. Tests pass.

### Phase 2 — minimal auth + workspace scoping

**Goal:** `/` redirects to `/login` if not authenticated. Magic link email flow. Single user hardcoded to Ritz tenant.

Steps:
1. Enable Supabase Auth in the project (magic link email provider).
2. Add `middleware.ts` at repo root using `@supabase/ssr` for Next.js App Router. Redirects unauthenticated requests away from non-`/login` routes.
3. Add `/login/page.tsx` — email input → `supabase.auth.signInWithOtp`.
4. Add `/auth/callback/route.ts` — exchange code for session.
5. Set `BEACON_TENANT=<your-user-uuid-or-"ritz">` env var for tenant scoping.
6. Every Supabase query already includes `tenant_id` filters — audit to confirm. See existing `src/domains/tenants/`.
7. Verify 7 pre-existing tenant-isolation test failures — either fix them now or formally park them in `IDEAS_PARKING_LOT.md`. Don't ship with known bugs unexplained.

**Stopping condition:** can't hit `/` without being logged in. Can log in with magic link. After login, Today renders correctly.

### Phase 3 — Vercel deploy

**Goal:** `git push main` → Beacon live at a URL behind login.

Steps:
1. Create private GitHub repo. `git remote add origin <url>`. `git push -u origin main`.
2. Create Vercel project, connect the GitHub repo. Framework: Next.js (autodetected).
3. Env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; don't prefix with `NEXT_PUBLIC_`)
   - `DATA_SOURCE=supabase`
   - `BEACON_TENANT=<your-tenant-id>`
   - Any feature flags currently in `.env.local`
4. Protect preview deployments with Vercel Password Protection (Pro feature) or Vercel Access (Hobby: none — preview URLs are public unless protected).
5. Deploy.
6. Smoke test the live URL:
   - Login flow works
   - Today renders
   - Confirm a finding — verify DB row appears
   - Accept a rec — verify `recommendation_responses` row
7. Set up domain (Vercel settings → custom domain or default `.vercel.app`).

**Stopping condition:** you can open the live URL on your phone, login, see Today, click Confirm, and the change persists.

### Phase 4 — scan on Vercel

**Goal:** trigger scan from the hosted URL. No more laptop-CLI.

Options (pick based on scan duration):

**(a) Manual button → serverless function.** Add `/api/scan/run/route.ts`. Dynamic. Max 60s (Hobby) / 300s (Pro). For Ritz's ~30 pages, probably fine on Hobby. Button on Today → hits endpoint → streams progress → DB writes. No queue.

**(b) Vercel Cron.** `vercel.json` cron config → nightly at 3am → `/api/cron/scan`. Same function.

**(c) External worker (Railway).** $5/mo. Overkill unless scan hits the 300s wall.

Recommended: (a) + (b) on the same function. Button AND cron trigger.

**Stopping condition:** click "Scan now" on Today, scanner runs server-side, findings appear in DB, Today refreshes with new banner count.

### Phase 5 — blob migration to Supabase Storage

**Goal:** big CSV files and answer_text backups move off `.data/` into object storage.

Steps:
1. Create a bucket in Supabase Storage: `beacon-artifacts`.
2. Upload the Profound CSV files. Tag by date range.
3. Update any code that reads these — replace with signed-URL reads.
4. Delete from `.data/` after verification.
5. Add `.data/` to `.gitignore` (already is — verified).

**Stopping condition:** `.data/` on your laptop is either empty or contains only ephemeral cache (should be empty). Hosted Beacon never touches `.data/`.

### Phase 6 — later (don't do yet)

- Multi-tenant UI
- Workers / queues
- Multiple workspaces
- Audit log table
- Admin dashboard

---

## 10. Vercel-specific gotchas

- **Serverless functions are READ-ONLY filesystem.** No `fs.writeFileSync` in prod. Every `writeStore()` must go through Supabase dual-write (which exists). **Verify no code path is JSON-write-only.**
- **Cold starts matter.** Every module-level `readStore()` or `await` runs on cold start. Phase 1b addresses this.
- **Max function duration.** Hobby 60s, Pro 300s. Scan function is the tight constraint.
- **Edge runtime not usable here.** Beacon uses `server-only`, Node APIs (cheerio), and Supabase server client — stick with Node serverless runtime.
- **Environment variables.** `NEXT_PUBLIC_*` → client bundle; everything else server-only. Don't leak `SUPABASE_SERVICE_ROLE_KEY`.
- **Revalidation / caching.** Beacon heavily uses `revalidatePath("/", "layout")` — works on Vercel.
- **Middleware runs on Edge runtime** by default. Supabase SSR auth middleware works on Edge. Fine.
- **Preview deployments are public by default on Hobby.** For a dogfood app, upgrade to Pro for password-protected previews, or use Vercel Password Protection.
- **Next.js 16 + React 19** are both still pretty new. Check Vercel status if builds break.

---

## 11. Known risks (flagged upfront)

1. **Dual-write rot.** Fields added in the last 2 weeks (evidenceBasis, placementMode, movedFromPath, source_rec_id, source_pattern_id, h3_list, body_paragraph_sample, card_texts, schema_entity_names) may not exist in Supabase schema. `list_migrations` via MCP will show what's in DB. Missing columns = migration needed.

2. **7 pre-existing tenant-isolation test failures.** Documented in `HANDOFF_VERIFIED_STATE.md`. They've been there ~10 days. Either fix or formally park before hosting.

3. **`puppeteer-core` in dependencies.** If used anywhere in server code, it breaks on Vercel Hobby. Grep `puppeteer` in `src/` and `scripts/`. If unused, drop the dep.

4. **`scan-findings` JSON↔DB drift.** 80 JSON pending vs 63 DB rows. Reconcile before going live — either backfill the missing 17 or mark them as stale.

5. **Module-level `readStore` × 20 sites.** Cold start disaster on Vercel. Phase 1b.

6. **`answer-texts` 38MB.** Currently loaded in-memory at module import. Must become a per-request DB query or a paginated iterator.

7. **No remote Git.** Need a GitHub repo before Vercel can deploy.

8. **`.env.local` not tracked (gitignored).** Fine for secrets, but the new agent may not know what env vars are needed. They're listed in §3 of this doc — that's the full list.

9. **RLS is off on every table.** Acceptable for single-user dogfood behind auth. Document this limitation; add RLS before customer 2.

10. **Session state.** Beacon has no user sessions today (single-user assumption). Auth will introduce session cookies — make sure everything that currently assumes "no session" still works.

---

## 12. Discipline rules for the implementation agent

- **Do Phase 0 (audit) before any Phase 1 work.** No exceptions.
- **One phase per implementation pass.** Stop at stopping conditions.
- **Typecheck + vitest green before moving to next phase.**
- **Don't push to main until a phase is complete and tested.**
- **Don't deploy to Vercel with known JSON writes on the hot path.**
- **If Supabase migrations are needed, use `mcp__cd86b542-...__apply_migration` with a descriptive snake_case name.**
- **Don't use `execute_sql` for DDL — it's for data only. DDL goes through `apply_migration`.**
- **If a phase reveals a scope-blowing issue, stop and write a narrow plan. Don't freelance.**
- **When in doubt, ask the operator. They prefer narrow questions to speculation.**

---

## 13. File references (so the new agent doesn't re-grep)

**Docs to read first:**
- `docs/HANDOFF_VERIFIED_STATE.md` — current system state
- `docs/VERIFICATION_LOG.md` — full history (long; skim recent entries)
- `docs/CUSTOMER_ONE_TRACKER.md` — shipped phases
- `docs/IDEAS_PARKING_LOT.md` — deferred items
- `docs/architecture.md` — system map
- `CLAUDE.md` (repo root) — project instructions
- `.cursor/rules/core.mdc` — Cursor rules (aligned with CLAUDE.md)

**Code to inspect:**
- `src/lib/persistence/json-store.ts` — readStore/writeStore implementation. **Inspect first.** If it already branches on `DATA_SOURCE`, Phase 1a is mostly flipping a flag.
- `src/lib/persistence/dual-write.ts` — sync function inventory
- `src/lib/persistence/repositories/supabase-backend.ts` — current DB implementation
- `src/lib/persistence/repositories/key-mapper.ts` — field name mappings (camelCase ↔ snake_case)
- `scripts/backfill-to-supabase.ts` — existing JSON → DB push
- `scripts/bootstrap-from-supabase.ts` — existing DB → JSON pull
- `scripts/scan-owned-pages.ts` — scan pipeline (to be serverless-ized)
- `src/domains/scanning/orchestrate-scan.ts` — the in-process scan runner
- `src/app/(shell)/today-data.ts` — Today SSR heavy-weight
- `src/domains/product/recommendation-response-store.ts` — needs DB backing
- `src/domains/attribution/url-change-outcome.ts` — needs DB backing
- `src/domains/scanning/types.ts` — finding types (recent Fix 1 additions)
- `src/domains/changelog/types.ts` — ChangelogEntry shape (recent Fix 2 additions)

**Supabase project:**
- ID: `jdegznovgysxyweknewh`
- Region: `us-east-2`
- Organization: `arfmnsqyahetgleaqzwf`

---

## 14. What to do in the first 30 minutes

1. Read this doc completely (5 min)
2. Read `docs/HANDOFF_VERIFIED_STATE.md` (5 min)
3. Inspect `src/lib/persistence/json-store.ts` (2 min) — does it already branch on DATA_SOURCE?
4. Run `mcp__cd86b542-...__list_tables` with `verbose: true` — see actual column shapes (5 min)
5. Run `mcp__cd86b542-...__list_migrations` — see schema history (1 min)
6. Grep `readStore\b.*STORE_NAME` across `src/domains/` to find module-level reads (2 min)
7. Ask operator the 5 blocker questions (wait for answer)
8. Based on answers, write a narrow Phase 1a plan (10 min)

**Do not start writing code until the blocker questions are answered.**

---

## 15. The first message to send in the new chat

Paste this verbatim as the first user message in the new Opus chat:

> Read `/Users/armeen/beacon/docs/MIGRATION_HANDOFF_VERCEL_SUPABASE.md` end-to-end. Then read `docs/HANDOFF_VERIFIED_STATE.md`, `docs/CUSTOMER_ONE_TRACKER.md`, and `CLAUDE.md`. Then use the Supabase MCP to `list_tables` (verbose=true) and `list_migrations` on project `jdegznovgysxyweknewh`. Then inspect `src/lib/persistence/json-store.ts` and `src/lib/persistence/dual-write.ts`.
>
> Do not start writing code. Do the full Phase 0 preflight, then ask me the 5 blocker questions. I want to hear back with:
> 1. The actual gap inventory (which stores are JSON-only vs dual-written vs DB-primary)
> 2. Whether `json-store.ts` already branches on `DATA_SOURCE=supabase` or needs to be changed
> 3. Any drift or schema mismatch you found
> 4. Whether the 7 pre-existing tenant-isolation test failures are relevant to this migration
> 5. The 5 blocker questions answered to me
>
> Then propose the narrow Phase 1a plan. Don't ship anything until I approve.

---

## 16. Final word

The migration is real work but not mysterious. ~40% is already done (Supabase project, dual-write, repository abstraction, bootstrap script, DATA_SOURCE env var all exist). The remaining 60% is finding-and-fixing-JSON-reads + auth + scan-as-serverless + Vercel deploy.

Don't treat this as a rewrite. Treat it as a flip of `DATA_SOURCE=supabase`, then a series of targeted fixes to the stores that weren't dual-written yet. Each phase has a stopping condition. Stop when you hit it.

The operator is customer-one. They will open the URL on their phone tonight. Don't ship theater.

End of handoff.

# Beacon — Start Here

> **Active plan:** `/Users/armeen/.claude/plans/jazzy-tumbling-stroustrup.md` — the CX0-CX11 MAX implementation plan. Reference spec: Part 14 of `/Users/armeen/.claude/plans/rippling-munching-pnueli.md`.

> **PURPOSE:** This is the entry point for anyone (human or AI) working on Beacon.
> Read this file first. It tells you what Beacon is, where everything stands, what works, what's broken, and where to go next.
>
> **NOT FOR:** Execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), deep history (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-15
**Branch:** `main`
**Build:** `npm run typecheck` ✓ · `npm run test` 507/507 ✓
**Operator loop fix (2026-04-15):** Fixed `createChangelogEntry` data loss (was in-memory only, now persists to disk + Supabase). Supabase dual-write now throws when `DATA_SOURCE=supabase` (was silent fire-and-forget). Auto-experiment creation on every changelog entry + finding confirmation — tracks citations, mentions, visibility with daily timeline snapshots. Recommendation engine: final dedup (one rec per URL), extended hard suppression (all page-targeting types), extraction_certainty on all snapshot recs, learning pattern integration (success rate in rationale), "why now" temporal context. Recovered 10 accepted findings from April 14 — linked to existing changelog entries, 5 backfilled experiments created. 6 total experiments.
**State reconciliation (2026-04-15):** Full truth-layer fix. (1) Scan findings now auto-link to matching changelog entries by URL+type instead of sitting as unresolved pending items. (2) Recommendation engine hard-suppresses strengthen_structure recs when changelog already covers FAQ/schema work (checks `signal_type` + description keywords). (3) Import orchestrator switched to `materializePerChangeOutcomes` for learning-ready outcomes. (4) Changes scorecard shows "imported"/"scan" provenance labels. (5) Supabase findings cleaned: 0 pending (was 30). (6) 237 outcomes, 27 patterns (13 high-confidence). Today is clean: no false findings.
**System audit fix (2026-04-14):** Fixed 3 hard bugs: (1) `detect-findings.ts:norm()` now strips protocol+domain so changelog paths match scan URLs — `unexpected_change` and `deploy_mismatch` cross-reference now works for 207 path-only changelog entries; (2) `findings-store.ts:addFindings()` deduplicates guardrail findings by type+URL, replacing pending entries instead of stacking oscillation noise; (3) April 13-14 Profound CSVs imported. All 23 stale findings resolved (13 rejected as noise/false positives, 10 confirmed). `normUrl()` helper added to findings-store for consistent path normalization. Tests updated.
**Phase 12: Learning System (2026-04-14):** 4 learning loops implemented — change pattern recognition (4 patterns), triage rule learning (4 rules), confidence calibration (insufficient data, correctly null), page response profiling (enriches page_visibility). All passive — stored but not consumed by UI. 28 Supabase tables total.
**Phase 11: Relationship Materialization (2026-04-14):** Beacon now stores explicit relationships between changes, pages, and outcomes. `change_outcomes` (10 rows) materializes before/after metric deltas per changelog entry. `page_visibility` (13 rows) materializes per-page citation totals, topics, and trend direction. Findings enriched with `metricMovementDetected` and `signalStrength` (0-100 composite). All materialized from existing data — no new raw data, no route changes. Ready for learning/intelligence layers.
**Phase 10: Portability & Recovery (2026-04-14):** Beacon can now fully reconstruct itself from Supabase alone. Created `scripts/bootstrap-from-supabase.ts` — reads all 23 Supabase tables, writes 49 `.data/*.json` files. Added 3 new tables (`tracked_prompts`, `tracked_entities`, `answer_texts`) with dual-write. Added 5 database indexes for query performance. Verified: deleted `.data/`, bootstrapped, all routes render correctly, scan runs successfully with findings.
**Scoreboard upgrade (2026-04-13):** KPI cards rewritten to business language ("Times AI recommended you", "How often AI mentions you", "Your pages AI sends people to"). Added week-over-week deltas: citations and mention rate now show `+N%` / `-N%` vs last week with green/red coloring. Topic trends relabeled: "rising" → "growing", "declining" → "slipping". Meta lines show "vs last week" context when delta data exists. Data pipeline computes this-week vs last-week buckets from results time series in `today-data.ts`.
**Phase 5: Competitor Monitoring (2026-04-13):** Sitemap-based competitor monitoring — crawls XML sitemaps for 5 configured competitors, diffs page lists to detect new/removed/updated pages, generates contextual alerts (topic inference from URL paths for builder site patterns). Wired into morning brief: alerts appear as "Competitor activity" section between change impact and action cards. CLI script `scripts/crawl-competitor-sitemaps.ts` with `--dry-run` flag. Initial baseline crawl completed: Flegel's (4,746 pages), PAB (6 pages), SV Custom Homes (0 entries), 2 competitors unreachable. Domain: `src/domains/competitor-monitoring/` (types, sitemap-crawler, detect-changes, store). Also added `writeDotDataJson` to persistence layer for non-array object storage. 30 new tests (sitemap parsing, change detection, alert generation, store).
**Phase 3: Attribution Memory (2026-04-13):** Today page now shows **Change Impact** section above action cards — up to 2 memory insights with mini sparklines showing before/after trends. Computed from 85 changelog entries × 22K daily metric snapshots; 11 insights generated from real data, top 2 shown. Example: "20 days ago you updated Luxury Home Builder Bay Area — mentions up 16%" with green trend line + vertical change-date marker. Engine: `src/domains/attribution/memory.ts` — per-topic before/after window comparison with minimum data gates (3 days before, 5 days after, 3+ observations per window). Direction: improving (≥15%), declining (≤-15%), stable. Platform breakdown shows which AI platforms moved. Also fixed: `investigate` rec type relative URL bug — changelog entries with relative paths now normalized via `absoluteUrlForPath`.
**Morning Brief + Change Detection (2026-04-13):** Phase 1 complete: Today page now renders **morning brief** as primary content — citation trend sparkline (2,992 citations, ↑157%) + 3 prioritized action cards with copy/email. Each card has operator-language rationale, concrete step checklists, and AI context from answer intelligence. Phase 2: **Change detection** — `confirmFindingAsChange` server action auto-creates changelog entries from confirmed scan findings; `ChangeReview` component renders on Today when content-type changes are detected (title, H1, meta, FAQ, schema, content changes). Scan trigger already exists via `TodayScanStrip`.
**Product reorientation Phase 1 + cleanup (2026-04-13):** Command Center layout — Today is now a two-panel grid (`2fr_3fr`): **left** = visibility scoreboard (3 KPI cards + compact platform text + health strip), **right** = action queue (primary + secondary action cards + findings count strip). **Nav expanded to 7 items:** Today, Pages, Changes, Market, Local, Topics, Settings. **Data imported:** all April 7-12 CSVs processed (100K+ citations, 11K observations, 20K benchmark snapshots). **Cleanup:** removed donut chart (low density), consolidated stale warnings to health strip only (removed DataFreshnessStrip from shell + warning box from action queue), improved KPI card visual weight (larger numbers, delta top-right), improved action card hierarchy (larger headline, subtler coloring).
**Track 1.2:** Daily ritual perfection — Phases 1–3 complete (2026-04-12): layout + Inbox Zero/digest + Today keyboard path (A / J/K, finding focus, primary `autoFocus` when safe) + **one decision card** (now cut — replaced by action queue). **Stale visibility gate:** hard demotion + findings warning unchanged. **Import copy (2026-04-12):** “latest visibility export / decision layer” framing — not workbook-first.
**Track 1.3:** Replication engine refinement — Phases 1–2 complete (2026-04-12): language/hierarchy + queue structure/experiment linkage/vague suppression
**Track 1.2 / 1.3 / 1.4l exit gates (persistence):** Settings → **Sign-offs** `/settings/exit-gates` + `.data/exit-gates.json` — **`daily_ritual`**, **`replication`**, **`local_layer`** all **`passed`** (operator notes **2026-04-13**); internal sign-off only; does not affect metrics, scores, freshness states, or proof. Settings layout hint hidden when all three gates are `passed`.
**Tier 1 dogfood + vault closure:** `docs/TIER_1_DOGFOOD_WEEK_LOG.md` — expanded **one-row-per-day** schema (Today / Replicate / /local, confusion, copy risk, action, verdict) + strict **human-only** rule (no fabricated weeks). **2026-04-13 static validation** remains on file. **2026-04-14:** Formal **vault Tier 1 closure verification failed** — log still has **no** consecutive operator daily rows (template only); **Tier 1 is not closed** per `master_execution_plan.md`. When the log is complete, re-run verification before updating vault docs. **2026-04-13:** One **honesty** dogfood row added (no live session — operator must replace for real evidence); see `TIER_1_DOGFOOD_WEEK_LOG.md`. **Micro-steps:** same file → **“Operator: smallest step-by-step”** (no log “import”; optional Settings → Import for data).
**Tier 1.1i:** Coverage escalation — **expanded (2026-04-13):** five-state model (`fresh` / `aging` / `stale` / `critical` / `partial`) in `coverage-state.ts` only; aging = crawl age in `(0.7×T, T]` for `T=3`; critical = missing crawl when flagged or age `> 2T`; Today digest + findings attention strip + `shouldShowTodayAllClear`; Market/Changes use `latestWebsiteCrawlRun()` crawl age; methodology `#coverage-states`
**Tier 1.1j:** Proof layer **final trust pass (2026-04-13)** — methodology: “How to read it” + “Beacon does not know” across core metrics; FAQ (coverage labels, continuous updates, every review); standardized review phrases + connector disclosures; overview five-pillar list. Product: `beacon-proof-copy.ts` (`BEACON_LOCAL_SURFACE_FOOTNOTE`, Layer-2 bullets), `local-presence.ts` footnotes + Market review lines, Today `HowWeKnowPanel` + coverage → `#coverage-states`, Market **partial** coverage warning, Connectors page/client, `/local` stored-review wording, `local-operator/surface.ts` data gaps. Checklist refresh: `docs/TIER_1_1J_EXIT_GATE_CHECKLIST.md`.
**Proof layer:** Layer-2 collapsed disclosures on Market + Changes Outcomes (2026-04-12): `<details>` “How this works” / “How verdicts work” + links to `/settings/methodology#citation-share` and `#verdicts`; copy from `beacon-proof-copy.ts`
**Track 1.4:** Local listings / reviews — Phase 1 + **Phases 2B–4** (2026-04-12/13); **1.4d (spec):** `docs/TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md`; **1.4e connectors (2026-04-13):** `docs/TIER_1_4E_REVIEW_CONNECTORS_SPEC.md` + `/settings/connectors` — **Google:** OAuth + **multi-location picker** (fetch → select → persist `selected_location_id` on token) + on-demand Sync now → GBP v4 reviews for selected location only → strict map → `mergeUpsertLocalReviews`; sync blocked until location selected. **Yelp:** server-stored Fusion API key + Sync now → Fusion business + reviews → `mapYelpReviewToLocalReview` → same merge; ids `yelp:…`, import run `connector:yelp`. `last_synced_at` per provider; local-presence freshness = max(import run, Google sync, Yelp sync). No auto-sync. `/local` + manual import unchanged.
**Track 1.4f–g (NAP + surfacing):** NAP consistency expanded to 4 states (`complete` / `incomplete` / `inconsistent` / `unknown`); centralized in `napState` on `LocalPresenceSnapshot`; inconsistency detects conflicting `listing_name` on imported reviews vs configured name. Today attention uses 4-state NAP (inconsistent fact line). Market strip shows NAP state with tone coloring. `/local` shows explicit label + factual explanation. Methodology `#nap-consistency`. No new connectors, scoring formulas, or ranking claims.
**Track 1.4 (listing completeness — operator slice, 2026-04-13):** Read-only **GBP field coverage** style audit on `LocalPresenceSnapshot.listingCompleteness` — present/missing for name (config or Google selected location label), address, phone, website (domain), category (config industry); **hours** not in v1 (no stored hours signal). Coverage labels `strong` / `partial` / `weak` from present-count thresholds only (not a score). `/local` **Listing completeness** section; Today one factual line when `weak` and NAP does not dominate; Market strip optional **Listing completeness:** phrase; methodology `#listing-completeness`. Tests: `listing-completeness.test.ts` + updated attention/market/local smokes.
**Track 1.4l (Local layer exit gate — 2026-04-13):** **`local_layer`** in Sign-offs with static operator checklist + same status/note actions as other gates; methodology `#exit-gates` boundary text expanded. **Operator sign-off (2026-04-13):** **`local_layer`** = **`passed`** in `.data/exit-gates.json` after checklist review; `/local` page header copy tightened to read-only framing (no live-directory implication).
**Track 1.4 — Per-source last sync (`/local`):** `LocalPresenceSnapshot.lastSync` — `google` / `yelp` from connector `last_synced_at`; `manual` from latest non-connector `ImportRun` (`entity_type: reviews`, `imported_count > 0`). **Data freshness** section on `/local` (always three rows + disclosure); methodology `#review-source-timestamps`. Pure projection — no merged timestamp, no new thresholds.
**Methodology (connectors + freshness):** `/settings/methodology` — `#review-connectors` documents **shipped** Google + Yelp (on-demand); `#review-monitoring-v1`, `#local-reviews`, boundaries, and FAQ aligned with manual + connectors, per-source timestamps, no auto-sync, no SLA language. **2026-04-13:** FAQ “connection breaks” + **`/local`** “How this works” / empty-state copy aligned with shipped connectors (no “not syncing yet” drift); tier specs `TIER_1_4D` / `TIER_1_4E` docstrings match.
**Track 1.5:** Milestone polish (2026-04-12): magnitude classification (major/minor), same-key-same-day dedupe, weekly noise cap (3+ minors → suppress on Today), enriched Today teaser (subtitle + relative date + magnitude-aware styling), Changes list collapsed (5 visible, rest behind expand). Exit gate 1.5g verified: ATH truthful, deduped, linked to proof
**Answer Intelligence (2026-04-13):** Built-time index from 9,596 AI answer observations + 84K citations → `answer-intelligence-index.json` (~1.3MB, 146ms build). Types in `src/domains/answer-intelligence/types.ts`; build in `build-index.ts`; store in `store.ts`; repository wired in file + supabase backends. Import pipeline builds index after citation-evidence-index. **Quality gates:** `NON_COMPETITOR_DOMAINS` blocklist (30 directory/platform/media domains) filters co-citation + co-appearing; brand descriptors require `source_count ≥ 2` + `length ≥ 25` + no competitor-name fragments; answerContext requires ≥ 2 signal points; Market "Who replaces you" requires ≥ 50 appearances + ≥ 100 total answers. **Product surfaces:** recommendation engine enriches recs with `answerContext` (mention rate, position, competitor, trend — gated); Today primary action card renders "From AI answers" block; HowWeKnowPanel shows AI answer analysis (mention rate, declining/rising topics); Market page shows "Who replaces you" section (real competitors only, sorted by absent count) + per-topic absence breakdown.
**Native ingestion prep (2026-04-12 / 13):** `docs/NATIVE_INGESTION_READINESS_AUDIT.md` — integrity/utilization/architecture/benchmark/scale; **workbook import removed**; Profound **`writeLegacyBridge`** **dual-writes** when `DUAL_WRITE=true`. **2026-04-13:** Profound CSV discovery is **header-based** (no filename prefixes); **merge-safe** ingest for prompts, raw rows, answer texts, citations per date, benchmarks, changelog — partial-week CSVs no longer require replacing the canonical monolith file.

---

## What Beacon Is

Beacon is a **daily AI visibility operating system** for local businesses. One operator opens it each morning to answer:

- What changed on my site?
- What is true about my visibility?
- What matters right now?
- What should I do next?
- Where is competition beating me?

**Stack:** Next.js 16 (App Router), React 19, TypeScript strict, `.data/*.json` file persistence + Supabase dual-write (23 tables). Bootstrap from cloud: `npx tsx scripts/bootstrap-from-supabase.ts`. Single-user, premium, self-hosted.

**Not:** a generic SEO dashboard, a crawler, a CRM, an agency platform, a science project.

---

## Current System State

### What is genuinely working

| Area | Score | Evidence |
|------|-------|----------|
| Domain architecture | 76/100 | 31 well-bounded domains, strict types, consistent patterns |
| Scan pipeline | 75/100 | Live crawl → snapshot diff → 15 finding types → priority scoring → changelog cross-reference. Guardrail dedup prevents oscillation noise. 7 dedicated tests |
| Attribution engine | 75/100 | Event detection → candidate discovery → triage → scoring → operator verification. Golden tests |
| Proof layer | 78/100 | Confidence badges, evidence tiers, trust sources, freshness dots. Honest about uncertainty |
| Pages route | 75/100 | Page truth + fix briefs + verification workflow. Strongest route |
| Changes route | 70/100 | Scorecard + verdicts + replication. Core "what worked" view |
| Market route | 62/100 | Real competitive intelligence (rankings, topic signals, battlecards). Data-dependent |
| Navigation | Clean | 6 items: Today, Pages, Market, Local, Changes, Settings. Today: **A** → primary CTA, **J/K** → findings; command palette |
| Build health | Solid | Zero type errors, 306 tests pass, production build succeeds |
| Copy/wording | 75/100 | Operator-focused, honest, avoids jargon |

### What is broken or risky

| Problem | Severity | Impact |
|---------|----------|--------|
| **Error boundaries** | DONE | `(shell)/error.tsx` + `settings/error.tsx` implemented and runtime-verified (2026-04-12) |
| **Loading states** | DONE (Phase 0B) | `(shell)/loading.tsx`, `(shell)/pages/loading.tsx`, `(shell)/changes/loading.tsx` — shell + Pages + Changes Suspense fallbacks |
| **Today scan blocks render** | DONE (1A-1–6) | RSC never awaits scan; `ScanStatusBanner` triggers + polls from client; `router.refresh()` on complete. **Phase 5-9:** stale-running guard. **2026-04-14:** domain inference + env injection + preload; **E2E:** full scan **35** pages **success** on **ritzbuilders.com**; CLI updates **`scan-state.json`** on completion (`writeIdleScanStateFromLastResult`); `npm run data:scan` includes domain preload |
| **Demo data not labeled** | MITIGATED (2A) | `DemoBannerGate` + `isDemoMode` when no import runs; sticky banner with import CTA (Phase 2A-3) |
| **Empty states missing** | LOW (2B done) | Import empty states on main routes; **2B-5:** `shouldShowTodayAllClear` returns false when `isDemoMode` (no false “all clear” on sample data) |
| **Module-cached import data** | MEDIUM | `seed-data.server.ts` top-level await → stale in long-running production process |
| **Settings fragmented** | DONE (Phase 3) | Route consolidation + smoke **3-8** verified **2026-04-12**: Import / Config / Data tabs only; Health direct URL; **`/import`**, **`/setup`**, **`/results`** → **404** |
| **Today section count** | DONE (1.2) | Track 1.2 Phase 1: primary action promoted to #1 slot, findings collapsed, proof/system moved to bottom, morning-order text removed, milestone/replication compacted |
| **Render-time side effects** | DONE (1C) | `persistOutcomes()`, `updateExperimentCitations()`/`persistExperiments()`, and `syncMilestonesFromWorkspace()` all moved to post-import; 1C-3 audit confirmed zero writes in render path |
| **Test coverage narrow** | LOW | 460 tests (domain + lib + `exit-gates-store` + local-presence + NAP 4-state + listing completeness + per-source `lastSync` + GBP/Yelp map/sync + GBP location picker + Tier 1.1i coverage + components + **route smokes** + `today-next-line` + `today-one-decision` + **scan-site-domain** + Profound **csv-discovery** / **merge-ingest**); Vitest `fileParallelism: false` + 30s timeout stabilizes heavy dynamic imports; no full E2E |

### Overall scores (from 2026-04-11 audit)

| Composite | Score |
|-----------|-------|
| Product intelligence | 75/100 |
| Operator experience | 45/100 |
| Production safety | 25/100 |
| **Overall** | **53/100** |
| **Launch readiness (now)** | **38/100** |
| **Launch readiness (after safety fixes)** | **72/100** |

---

## Current Phase & Next Actions

**Status:** **Launch Phases 0–5 COMPLETE. Tier 1.1 + 1.1i COMPLETE. Track 1.2 Phases 1–3 COMPLETE** (+ Today stale-visibility hard gate). **Track 1.3 Phases 1–2 COMPLETE. Track 1.4** through listing completeness **+ Sign-offs all `passed`.** **Tier 1 vault closure:** static validation + protocol logged (**2026-04-13**); **calendar dogfood week** — operator completes `docs/TIER_1_DOGFOOD_WEEK_LOG.md` table then pastes **Final Tier 1 note** in that file. Gate: typecheck ✓, 328/328 tests ✓, build ✓.

**Immediate next 3 actions:**

1. **Operator:** Run the 2-week native test — open Today daily, copy morning brief actions to devs, import fresh Profound CSVs, run scans to detect changes, confirm detected changes into changelog. Run `npx tsx scripts/crawl-competitor-sitemaps.ts` periodically to track competitor page changes.
2. **Phase 4: Native Prompt Execution** — build platform adapters (Perplexity, ChatGPT, Gemini) to replace Profound CSV imports with nightly API-based prompt execution. Start with Perplexity (best citation quality).
3. **Competitor monitoring enhancement** — add competitor alert detail view, link alerts to answer intelligence topics for counter-move suggestions, add Settings UI for managing monitored competitors.


**Full execution plan:** See `NEXT_PHASE_EXECUTION_PLAN.md` — launch phases complete; active roadmap is **Tier 1** tracks **1.1 → 1.5** (see `master_execution_plan.md` §"Tiered product stack").

---

## Key Numbers *(snapshot / example — from one imported dataset + repo layout; re-run diagnostics on your `.data` if these must be exact)*

| Entity | Count |
|--------|-------|
| Results (imported) | 1,179 |
| Changes (imported) | 85 |
| Opportunities | 0 |
| Outcome events detected | 45 |
| Attribution candidates | 202 |
| Auto-resolved events | 13/45 (29%) |
| Domain modules | 31 |
| App routes (build) | 29 |
| Vitest tests | 460 |
| Viz components | 19 |

---

## Doc Reading Order

| Order | File | What it tells you |
|-------|------|-------------------|
| 1 | **This file** (`HANDOFF_VERIFIED_STATE.md`) | Current state, what works, what's broken, next steps |
| 2 | **`architecture.md`** | How the system fits together: routes, domains, data flow, persistence |
| 3 | **`NEXT_PHASE_EXECUTION_PLAN.md`** | What to do next: phased plan, micro-steps, cursor prompts |
| 4 | **`VERIFICATION_LOG.md`** | Proof of past work: dated entries with before/after metrics |
| 5 | **`master_execution_plan.md`** | Deep context vault: all history, all ideas, full backlog |
| 6 | **`TIER_1_DOGFOOD_WEEK_LOG.md`** | Tier 1 dogfood protocol + daily log + vault closure note (when filled) |
| 7 | **`SCAN_TRUTH_REFACTOR_PLAN.md`** | Vertical deep dive: scan orchestration refactor spec |

---

## Where Everything Lives

### Documentation

```
docs/
  HANDOFF_VERIFIED_STATE.md     ← YOU ARE HERE (entry point)
  NEXT_PHASE_EXECUTION_PLAN.md  ← active execution plan
  VERIFICATION_LOG.md           ← proof + history log
  TIER_1_DOGFOOD_WEEK_LOG.md    ← Tier 1 dogfood protocol + operator log (vault closure)
  architecture.md               ← system map
  master_execution_plan.md      ← full context vault (history + ideas + backlog)
  SCAN_TRUTH_REFACTOR_PLAN.md   ← scan refactor spec (completed)
  TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md  ← local review import contract
  TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md           ← review monitoring v1 scope (1.4d)
  TIER_1_4E_REVIEW_CONNECTORS_SPEC.md             ← connector sub-spec extending 1.4d (1.4e)
  NATIVE_INGESTION_READINESS_AUDIT.md             ← Profound bridge → API/Supabase: integrity, utilization, pipeline risks, open questions
  archive/
    audits/                     ← 9 audit files from 2026-04-11 comprehensive audit
    handoffs/                   ← archived handoff snapshots
    completed-specs/            ← completed spec documents
    product/                    ← historical PRD
    research/
      profound-integration/     ← Profound CSV field notes, parsing risks, source map
```

**Repo root:** `CLAUDE.md` — portable agent rules for Claude Code / CLI; keep in sync with `.cursor/rules/core.mdc` if you use both tools.

### Code

```
src/
  app/(shell)/           ← All routes (Today, Pages, Market, Changes, Settings, etc.)
  domains/               ← 31 domain modules (attribution, scanning, pages, competitors, product, etc.)
  components/            ← UI components (shell, viz, data, display, form, today, replication)
  lib/                   ← Shared utilities (persistence, import, data-adapters, view-models, tenant)
  adapters/              ← External data adapters (Profound)
  storage/               ← Canonical persistence layer
  derivations/           ← Pure computation functions
scripts/                 ← CLI tools (scan, registry, sampling, parity)
tests/                   ← Vitest tests (domains + lib)
.data/                   ← Runtime data (gitignored)
```

### Key Config

| File | What |
|------|------|
| `.env.local` | `DATA_SOURCE`, `DUAL_WRITE`, `BEACON_TENANT` |
| `.cursor/rules/core.mdc` | Always-on Cursor rules for Beacon |
| `src/lib/navigation.ts` | 5-item nav definition |
| `src/lib/business-config.ts` | Business profile (name, domain, services, locations) |
| `src/lib/tenant.ts` | Optional multi-tenant file isolation |

---

## Rules for Future Work

1. **Read this file first** before starting any task.
2. **Do not create new planning docs.** Use the existing 6 files. Ideas go in `master_execution_plan.md`. Steps go in `NEXT_PHASE_EXECUTION_PLAN.md`. Proof goes in `VERIFICATION_LOG.md`.
3. **Do not duplicate context.** Each doc has one job (see reading order above). If you're not sure where something goes, it goes in the vault (`master_execution_plan.md`).
4. **Update this file** when the system state materially changes (new phase completed, major bug fixed, scores change).
5. **Archive, don't delete.** Old specs → `docs/archive/completed-specs/`. Old handoffs → `docs/archive/handoffs/`.

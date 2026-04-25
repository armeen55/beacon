# Beacon — Start Here

> ⚠️ **STALE — last updated 2026-04-17.** Most of the content below describes
> pre-pivot (Profound-era) state. Since 2026-04-22 Beacon has shipped the
> native-polling pipeline (Perplexity + OpenAI adapters, hosted `/api/poll/run`,
> GitHub Actions daily cron, chunked retry dedupe) and the "Replace Profound in
> 2 weeks" Phase v4 is now active. Trust these sources over anything below:
>
> - **Active plan:** `/Users/armeen/.claude/plans/you-are-taking-over-floofy-giraffe.md`
> - **What actually shipped 04-22 onward:** `docs/VERIFICATION_LOG.md` (2026-04-24 entry covers Phase v4 Commits 1–4 and the ground-truth surface audit)
> - **Schema v2 design:** `docs/OBSERVATION_SCHEMA_V2.md`
> - **Which surfaces silently lie and which are trustworthy:** `docs/TRUTH_SURFACE_AUDIT_2026-04-24.md`
>
> The legacy "Active plan" reference below (jazzy-tumbling-stroustrup) is no
> longer in play. Everything in this file that predates 2026-04-22 should be
> read as history, not current state.

> **Active plan (legacy, superseded 2026-04-24):** `/Users/armeen/.claude/plans/jazzy-tumbling-stroustrup.md` — the CX0-CX11 MAX implementation plan. Reference spec: Part 14 of `/Users/armeen/.claude/plans/rippling-munching-pnueli.md`.

> **PURPOSE:** This is the entry point for anyone (human or AI) working on Beacon.
> Read this file first. It tells you what Beacon is, where everything stands, what works, what's broken, and where to go next.
>
> **NOT FOR:** Execution steps (→ `NEXT_PHASE_EXECUTION_PLAN.md`), system diagrams (→ `architecture.md`), deep history (→ `master_execution_plan.md`), verification proof (→ `VERIFICATION_LOG.md`).

**Last updated:** 2026-04-17 (Phase 7 Part 1b-v2 Step 2 — keyword-gap scanner v3 LIVE on Today)
**Branch:** `main`
**Build:** `npm run typecheck` ✓ · `npm run test` 1000/1007 ✓ (same 7 pre-existing tenant-isolation failures, no regression)

**Phase 7 Part 1b-v2 Step 2 — COMPLETE (2026-04-17).** The keyword-gap scanner, silenced since Apr 19 when we caught it mining AI answer boilerplate ("Track Record" appeared in 28.7% of all answers), is now live on Today. V3 mines concepts from each observation's `search_queries` field (AI's internal retrieval queries, not output vocabulary). Tier-aware pipeline:
- Tier 1 (saturation_miss) uses raw bigram/trigram concepts — surfaced labels like "Custom Homes", "Luxury Home".
- Tier 2 (gap) applies concept expansion from example queries to produce longer readable phrases — "Home Renovation Contractors Menlo Park", "Modernizing Older Homes Without Expanding".
- Tier 3 (positive) computed but deliberately not surfaced.
- Readability gate rejects 2-3 word fragments starting with plural nouns (e.g., "Builders Bay Area" is filtered out).
- Cities excluded via knownLocations; competitors excluded via dynamic top-40 non-brand mentions.
- Top 3 cards visible on live Today page: "Position 'Custom Homes' on /locations/los-altos" (Tier 1), "Position 'Luxury Home' on /locations/cupertino-custom-home-builder" (Tier 1), 1 gap rec on /locations/menlo-park.

Details in `docs/VERIFICATION_LOG.md` 2026-04-17 entry (Phase 7 Part 1b-v2 Step 2).

**Phase 1 SCHEMA-EXPERIMENT ATTRIBUTION — COMPLETE (2026-04-17):** Missing-schema detector surfaces as Today ActionCard before the change; manual confirm stamps structured schema-diff fields after the change; 5-rung matching ladder attributes at exact specificity. Auto-promote OFF by default (`BEACON_AUTO_PROMOTE_SCHEMA=1` to flip, no scan-side wire-up shipped). 127 new tests, Phase 0 acceptance still 8/8. Details: `docs/VERIFICATION_LOG.md` 2026-04-17 entry.

**Dogfeed Night 1 — COMPLETE (2026-04-17 evening).** Three schema experiments shipped and confirmed with structured fields:
- `/locations/palo-alto` → schema_added · types_added=[BreadcrumbList, HomeAndConstructionBusiness, WebPage] · visible_copy_changed=false
- `/our-process` → schema_added · types_added=[HowTo] · visible_copy_changed=false
- `/explore-projects/riverside-way` → schema_added · types_added=[Article, BreadcrumbList] · visible_copy_changed=false

All three will match at `exact` specificity with c_scope=1.0 when attribution runs over the next 14 days. 10 active experiments now being watched. Tonight's cycle also caught a real production regression (helper temporarily broke SSR on palo-alto while removing a duplicate FAQPage JSON-LD block) — scanner flagged it, operator sent it back for fix, SSR restored. 8 state-transition artifact findings from the bug cycle were bulk-dismissed; no pending content-change findings remain.

**UX hardening shipped tonight:**
- Auto-link feature flag (`src/lib/flags.ts:isFindingAutoLinkEnabled`) — **OFF by default**. Previously the scanner auto-linked every finding to any changelog entry within 30 days whose description contained a matching keyword, which silently collapsed brand-new experiments into old generic entries. Now every finding stays `pending` until operator explicitly confirms/dismisses. Flip `BEACON_AUTO_LINK_FINDINGS=1` to restore legacy behavior (not recommended during dogfeed).
- "Review changes" banner moved from buried to directly below the Visibility line on Today. `ChangeReview` card now renders inline beneath the banner with `id="change-review-section"` scroll anchor so the button actually works.
- Sidebar nav badges rewired: **Today** = pending content-change findings (matches the banner's count exactly), **Pages** = unique pages with bug-class findings (`schema_invalid` + `faq_without_schema` + `robots_txt_blocked` + `deploy_mismatch`), **Changes** = active experiments being watched. Was previously: stale legacy counts from pre-Phase-0 stores, stuck for a week.
- Shared module `src/domains/scanning/content-change-types.ts` — single source of truth for CONTENT_CHANGE_TYPES + BUG_FINDING_TYPES used by both the Today banner and the sidebar badge.

**New CLI:** `scripts/regen-findings.ts` — regenerates scan-findings against the current page-snapshots without re-fetching the site. Needed because `scripts/scan-owned-pages.ts` only writes snapshots, not findings. Use after a CLI scan to feed the detection pipeline.

**Known rough edges left for tomorrow (not blocking dogfeed):**
- `/pages` route copy is pre-Phase-0 legacy ("Same crawl basis as Today: consecutive HTML snapshots and optional guardrails. Observation links appear only when the run is indexed.") — academic disclosure language, should be rewritten
- `/briefs` route is a dead end — UI placeholder for a "proposed briefs" flow that never got wired up
- Brain-action recommender pulls from legacy url-change-outcomes; still shows "Investigate h1 regression" stale recs
- Duplicate-schema detector would help — scanner already sees `faq_schema_block_count > 1` but doesn't emit a finding for it

**Daily-1% operating cadence (chosen 2026-04-17):**
Operator dogfeeds one isolated change per night. Between deploys, fixes one piece of legacy per day — delete code but keep functionality. Goal: 14-night pattern brain that moves Beacon from "collection of shipped phases" to "native AEO tracker for local builders/architects/contractors." Every day: spot one thing that feels off on Today or one of the nav routes, clean it up (code delete preferred over rewrite), verify nothing broke via typecheck + scan. Document in VERIFICATION_LOG.

**Phase 0 TRUTH VALIDATION — COMPLETE (2026-04-16):** Hierarchical event attribution proven against Ritz data. 62 new tests. Seven-section acceptance report via `npx tsx scripts/validate-ritz-truth.ts` passes all 8 criteria — Apr 7–12 data_bad flagged, 4 target spikes detected (±1 day), 299/299 changelog rows covered, `/luxury-home-builder-bay-area` compound_launch → `landed_fast` (23 rows → 1 sample per pattern-sample-integrity check), `/locations/menlo-park` corrected from `hurting` (old URL store, polluted by bug-window zeros) to `helping` (new event store, data_bad skipped), Apr 10 performance_batch + Apr 2 metadata_publication distinguished as separate events. **Zero production surface changes** — `/changes`, Today, and `src/domains/attribution/url-verdict.ts` all untouched; new stores sit alongside legacy ones. Details: `docs/VERIFICATION_LOG.md` 2026-04-16 Phase 0 entry; source plan: `/Users/armeen/.claude/plans/dreamy-beaming-sphinx.md`.

**Phase 0.5 EVENT-LEVEL TRUTH SIDE-BY-SIDE — COMPLETE (2026-04-16):** First feature-flag helper in the repo (`src/lib/flags.ts` · `isEventTruthPreviewEnabled()` · reads `BEACON_EVENT_TRUTH_PREVIEW=1`, server-side, off by default). New route `/changes/truth` — server component reads `change-events` + `event-attributions` + `url-change-outcomes` + `imported-changes` + `site-movement-events`, joins events → children → legacy verdicts → movements, renders each event as a side-by-side row (NEW attribution + confidence_source pill · OLD legacy verdict counts · divergence badge). Expand drills into the narrative + every child row's legacy verdict. `/changes` gains one conditional top-right link when the flag is on. Verified both flag states against the live dev server: flag-off → `/changes/truth` 404s and `/changes` has no link; flag-on → luxury compound_launch shows `landed_fast` measured vs. 23× `nothing_yet` old, menlo Apr 7 event shows `too_early` vs. 6× `hurting` (the Phase 0 headline correction surfaced), `data_bad` narrative reaches the UI. `.env.local` restored to its pre-verification state after the run. Source plan: `/Users/armeen/.claude/plans/shimmering-flickering-hopper.md`.

**Next best action:** Keep the flag off for now — let the event model run silently alongside production for a full re-scan cycle before deciding whether to flip even this read-only preview on for daily use. When ready, turn the flag on via `.env.local`, walk through the divergences (especially the menlo correction), and only then consider whether the event model should influence any Today recommendation or scoring signal.

**Master launch plan active:** `/Users/armeen/.claude/plans/dreamy-beaming-sphinx.md` — "Truth → Brain → Shape → Trust → Live". 7 phases, 6–10 weeks to launch, 14-day personal dogfood, then 3 test subjects. Launch scope: Today + Changes + Settings/Import only. Single-tenant per customer at launch; auth layered in Phase 6.

**Phase 0 TRUTH — COMPLETE (2026-04-16):**
- ✅ 0.1 `src/domains/product/url-citation-history.ts` — per-URL daily citation time series aggregated from `.data/citations-by-date/*.json` via existing `cold-store.getCitationsForDate`. Path-only URL normalization — `/locations/palo-alto` and `https://ritzbuilders.com/locations/palo-alto/` map to the same key. Joins prompt-answer-observations for platform breakdown. Pure function, 7 unit tests.
- ✅ 0.2 `src/domains/attribution/url-verdict.ts` + `url-verdict.test.ts` (15/15 passing) — adaptive Z-score verdict engine. Formula: μ_pre / σ_pre (Poisson-floored at 1) over 14d baseline, μ_post over post-window (max 30d), z = (μ_post − μ_pre) / (σ_pre/√N), sustain-check against last 7d. Verdicts: `helping` / `hurting` / `nothing_yet` / `too_early` / `not_enough_data`. Every verdict carries `explanation.math` (all intermediate values) and `explanation.summary` (plain-English narrative).
- ✅ 0.3 `/changes/page.tsx` now builds `urlHistory` once per page load and computes `UrlVerdict` per row. Legacy `computeScorecard` data still computed for drill-down topic/platform breakdown; no longer drives the headline verdict. New at-a-glance strip shows helping / hurting / too-early counts derived from the new engine. Tracks 300 live changes (post-dedupe).
- ✅ 0.4 `scorecard-client.tsx` rewritten. Kill: Score/Match/Lift/Events/Linked/Next-step columns. New row = `[date] [change] [verdict pill] [delta%] ▸ expand`. Click expand → "Explain this verdict" panel rendering full Z-score math (μ_pre, σ_pre, μ_post, z, sustain up/down) alongside topic + platform drill-down from legacy scorecard data. Verdict filter chips (All / Helping / Hurting / Nothing yet / Too early / No baseline / Site-wide) replace the old outcome-category tabs.
- ✅ 0.6 Archived 16 frozen docs → `docs/archive/completed-specs/`. Moved 12 dead CSV/XLSX (~125MB) → `.data/archive/`.
- **Current honest distribution on Ritz data (300 changes):** 0 Helping (nothing hit the z≥2 + sustain-5/7 bar with current data coverage), 12 Hurting, 56 Nothing yet, 12 Too early, 155 No baseline (URL not cited enough pre-change), 65 Site-wide. User can see which URLs moved and click any row to see the full math. Zero hand-tuned verdicts.

**Phase 0 descoped (needs dedicated pass):**
- 0.5 `KNOWN_TOPICS` + `GEO_CONTAINMENT` removal — audit showed 5-domain blast radius (`pages/classify.ts`, `visibility-events/attribute.ts`, `attribution/compute.ts`, `attribution/memory.ts`, `attribution/config.ts`). Needs a soft-migration via accessor function reading from `tracked-prompts.json` before removal. Moved to Phase 1 work.

**Changes page rebuild — Phase 1 (2026-04-16):** `/changes` is now a single list sorted newest-first. Tabs (Outcomes / Attribution / Replicate) and the Records & Verification section were deleted — the page was rendering 4 competing views across 3 stores, reading as "10 different changelogs". Fix: one list, `timestamp desc` default sort on `ScorecardTable`, default verdict filter set to "all" so freshly-confirmed `too_early` entries land at the top instead of being hidden. New at-a-glance strip shows total count + latest-change recency + experiment-watch count. **Dedupe review flow** added at `/changes/dedupe`: `src/domains/changelog/dedupe.ts` extracts edit-type tokens (`title_change`, `page_created`, `schema_added`, etc.) from `change_description`, matches CSV-summary entries to PDF-granular keepers by URL + ≤3-day window + token-subset rule, and surfaces probable duplicate pairs for operator review — 38 pairs found in current data. Archive is a soft-delete (`ChangelogEntry.archived`, `archived_reason`, `archived_at`) with automatic once-per-day backup of `.data/imported-changes.json`. **Confirm flow upgrade:** `confirmFindingAsChange` now auto-stamps a `hypothesis` + `hypothesis_source: "inferred"` from the detected edit type — operator can overwrite on the detail page via new `HypothesisEditor` client component which calls new server action `updateChangelogHypothesis`. Null-URL entries render with "Site-wide infra" label. Scan-detected entries display a `scan · auto-caught` amber badge. Domain additions: `src/domains/changelog/dedupe.ts` (pure functions) + `dedupe.test.ts` (11 tests), `src/domains/changelog/actions.ts` gains `softDeleteChangelogEntry` / `restoreChangelogEntry` / `updateChangelogHypothesis`. UI: `src/app/(shell)/changes/page.tsx` slimmed from 741 → 246 lines, `changes-tab-shell.tsx` deleted, `src/app/(shell)/changes/dedupe/{page,dedupe-client,actions}.tsx` created, `src/app/(shell)/changes/[id]/hypothesis-editor.tsx` created. Verified end-to-end: server-rendered `/changes` has today's `cl-mo1p4hvf6kuklr` (Whole-Home Remodel title rename, `scan_detection`) at the top of the table, `auto-caught` badge present, dedupe banner shows "38 possible duplicates", `/changes/dedupe` renders "Pair 1 of 38" with keeper/summary cards.
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

**Sprint 6A.1 progress (2026-04-24):** Phases 1–7 COMPLETE.
- P1 migrations (page_element_inventory + recommended_edits + llm_rejections + changelog action_type/target_element_key)
- P2 ActionType registry, P3 ElementType registry, P4 element_key helpers, P5 13 active extractors + dispatcher
- P6 — extractor wired into `verify-action.ts` + `scripts/scan-owned-pages.ts` + `orchestrate-scan.ts` dual-write block. Idempotent on `(source_snapshot_id, element_key)`.
- P7 — `buildSpecificEditEvidencePacket` pure builder ships at `src/domains/recommendations/specific-edit-evidence.ts`. Top-level `clusterId | clusterLabel | clusterKind`. 16-char sha256 evidenceHash. allowedTargetUrls owned-only + sentinel. Strict serializability + no-route-render-generation guard.
- P8 — `SpecificEditProvider` interface + 3 implementations at `src/domains/recommendations/specific-edit-provider.ts` + `providers/{deterministic,openai,anthropic,index}.ts`. Deterministic shell returned empty bundle; openai + anthropic stubs throw `not_implemented (Sprint 6A.2)`. No SDK deps added.
- **P9 (today)** — Deterministic generators wired. New folder `providers/generators/` with `edit-title.ts`, `add-h2-section.ts`, `add-faq.ts`, `_text-utils.ts`, plus 34-test `generators.test.ts`. Each generator is pure. Hard invariants: targetUrl ⊆ allowedTargetUrls, actionType ⊆ allowedActionTypes, element-key shape correct (existing key for `edit_title`; `<type>[new]:<hash>` for additive actions), JSON-serializable, no input mutation, deterministic, no Ritz hardcoding (asserted in both output AND source). `runDeterministicGenerators(packet)` aggregates all 3 in stable order; `deterministicProvider.generate(packet)` returns the populated bundle with `totalCostUsd: 0`. **1949 passing** (+34).
- **Next Sprint 6A.1 step:** Phase 6A.1.10 — output validation layer. Pure function `validateSpecificEdit(edit, packet) → { ok: true } | { ok: false; reason: string }`. Rejects hallucinated `targetUrl` (not in `allowedTargetUrls`), hallucinated `targetElement.elementKey` (not in inventory + not `<type>[new]:<hash>`), action types not in `allowedActionTypes`, and element-type/action-type domain violations from the registry. Deterministic output is implicitly valid so the layer is a no-op for it; the layer matters for LLM providers in Sprint 6A.2. Errors land in `llm_rejections` (Phase 6A.1.10's persistence step).


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

# Beacon Verified State — 2026-04-07 (attribution); product through 2026-04-10 (visual terminal + docs checkpoint)

**Legacy handoff tag:** `beacon-handoff-20260407-1900` on branch `checkpoint/beacon-new-chat-reset-20260407-1900`  
**Doc checkpoint (2026-04-10):** Intelligence Phases 24–31C, abstraction layers, and route visual saturation reflected in this file + `master_execution_plan.md`, `NEXT_PHASE_EXECUTION_PLAN.md`, `architecture.md`, `VERIFICATION_LOG.md`. **Git docs checkpoint:** one commit on this branch with subject `docs: checkpoint Phase 31C visual saturation and abstraction layers` — locate with `git log -1 --oneline -- docs/`.

Working branch: `work/attribution-precision-20260407` (or current feature branch)

**Phase 5 (2026-04-09):** Change Impact Engine shipped — see `src/domains/attribution/change-impact.ts`, `/changes`, `/changes/[id]`. Counts below are from the 2026-04-07 handoff snapshot unless you re-run diagnostics.

## Entity Counts (imported data)

| Entity | Count |
|--------|-------|
| Results | 1,179 |
| Changes | 85 |
| Opportunities | 0 |
| Events detected | 45 |
| Candidates generated | 202 |

## Attribution System Status

| Component | Status | Notes |
|-----------|--------|-------|
| 6-factor scoring (platform, topic, url, geo, temporal, sourceCategory) | Working | All factors compute correctly |
| Platform-aware temporal windows | Working | PLATFORM_MAX_DAYS per platform |
| Topic semantic matching | Working | City extraction, jaccard, known-topic list |
| Geo containment | Working | Metro → city hierarchy |
| Signal-platform map | Working | Maps signal_type to expected platforms |
| Source-category platform weights | Working | Maps asset_type to platform relevance |
| Visibility vs attribution partitioning | Working | Shield/Bay Area topics → visibility-only |
| Outcome event detection | Working | 14 first_appearance, 15 regained, 16 surge |
| Triage (auto-resolve / needs-review / suppress) | Working | 6 auto-resolved, 39 need review |
| Review queue UI | Working | Full decision flow with lock/reject |
| Event resolution tracking | Working | CandidateLinks + EventDecisions persisted |
| Judgment summaries | Working | Natural-language what-happened + confidence |
| Evidence tier classification | WIRED | classifyEvidenceTier flows through discoverCandidates with page registry |
| Evidence tier scoring caps | WIRED | EVIDENCE_TIER_BONUS/CAP applied via adjustScore; exact +8, weak cap 55 |
| Page registry | WIRED | pages.json loaded into Map<url, PageEntity> for snapshot_verified lookups |
| Citation evidence index | WIRED | page_to_topics from citation-evidence-index.json used for topic support |
| Citation topic bonus | WIRED | +12 bonus for content-matching candidates on cited pages |
| Page discovery | EXISTS, NOT LIVE | discover.ts, classify.ts — batch-built, not live consumers |
| Evidence tier in UI | WIRED | Displayed in MatchFactors across review queue, attribution card, results |
| **Change impact engine** | **WIRED (Phase 5)** | `change-impact.ts`: per-change impact confidence, direction, why, next action; UI on `/changes` and `/changes/[id]` |
| Scorecard → impact | WIRED | `computeScorecard` unchanged; `enrichWithImpact` layers on top |
| **URL matching** | **FIXED (Phase 6)** | `matchUrl` uses `normalizePageUrl` + `canonicalizeOwnedUrl`; url factor no longer 100% unknown |
| **Decline event detection** | **WIRED (Phase 6)** | `visibility_lost` + `mention_decline` in events.ts; `isNegativeEvent` helper; scorecard assigns `negative` verdict |
| **Today impact surface** | **WIRED (Phase 7)** | Top 5 impact signals from `enrichWithImpact` on `/` landing page |
| **Recommendation engine** | **WIRED (Phase 8)** | `computeRecommendations`: proven changes x structural gaps -> ranked replicate/strengthen/investigate moves |
| **Priority engine** | **WIRED (Phase 9)** | `rankAndSelect`: 6-dimension scoring (0-100), bucket classification, single primary action selection; Today "DO THIS NOW" replaces passive suggestions with enforced execution focus |
| **Change detail actions** | **WIRED (Phase 10)** | `/changes/[id]` runs recommendation engine; "Apply this pattern" (replicate recs) + "Strengthen this entry" (evidence nudges) surfaced inline on the detail page |
| **Recommendation tracker** | **WIRED (Phase 11)** | `computeTrackRecord`: retroactive matching of changes to recommendation patterns; per-pattern success rate feeds into priority engine scoring (+10/-5); "Beacon recommended" badge on `/changes/[id]`; track record summary on Today |
| **Changes list intelligence** | **WIRED (Phase 12)** | `/changes` scorecard: "Beacon" badge + "N replicable" badge per row; "Beacon recommended" toggle filter; "Impact" sortable column; impact snapshot strip shows Beacon-recommended count + total replication targets |
| **Recommendation response** | **WIRED (Phase 13)** | `recommendation-response-store.ts`: explicit accept/dismiss/defer per recommendation; dismissed filtered before ranking; deferred suppressed 7 days; Today page shows Accept/Not now/Dismiss buttons on primary action + secondary opportunities; "Accepted" badge |
| **Daily surface compression** | **WIRED (Phase 14)** | Visibility summary strip (total citations, per-platform breakdown, trend %, freshness indicator); navigation compressed to 2 groups (5 primary + 5 advanced); impact signals reduced to 3 as "What changed"; work queue + system details collapsed by default |
| **Import simplification** | **WIRED (Phase 15)** | Coverage strip (counts, dates, freshness), drag-and-drop upload, delta-aware result (new vs updated), return-to-Today CTA, advanced sections collapsed |
| **Page intelligence surface** | **WIRED (Phase 16)** | Summary strip (winning/needs-action/cited counts + structure warnings); health card (status badge, citations, platforms, FAQ/schema, next action); structure health in list items; evidence internals in progressive disclosure |
| **Competitive clarity surface** | **WIRED (Phase 17)** + **visual saturation (31C)** | KPI strip (`KpiCard`); ranked list + share bars; topic signals with bars on thinnest share; co-mention / source trust / local pressure sections with charts + toggles; next moves; settings collapsed |
| **Track record enhancement** | **WIRED (Phase 18)** | `SignalTier` (explicit/inferred) on outcomes; `computeTrackRecord` accepts responses+recs; per-pattern `explicitAccepted`/`explicitDismissed`; priority engine: acceptance bonus (+2/+4), dismissal penalty (-3/-7); Today shows explicit counts |
| **Multi-dim recommendation expansion** | **WIRED (Phase 19)** | 7 rec types (was 3): +strengthen_structure, +improve_internal_links, +refresh_content, +competitive_displacement; evidence-gated with per-type caps; priority engine + outcome gen for all; Today accent colors for all types |
| **Trust layer + evidence explainability** | **WIRED (Phase 20)** | DO THIS NOW evidence block (evidence basis, confidence reason, freshness, watch-after); secondary rec evidence lines; page status reason on health card |
| **Adjacent opportunity expansion** | **WIRED (Phase 21)** | 9 rec types (was 7): +cross_page_pattern (requires different page type, shared terms), +topic_cluster_gap (missing content type for cited topic); anti-spam by design; capped; priority + outcomes + accents for both |
| **Experiment loop / watchlist** | **WIRED (Phase 22)** | `experiment-store.ts` + server actions; "Start testing" on accepted recs; watchlist on Today with status/citations/delta/watch-after; auto-outcome detection from citation data; `.data/experiments.json` persistence |
| **Nightly usage hardening** | **WIRED (Phase 23)** | Combined "Accept & test" one-click flow; button hierarchy fixed (no dismiss after accept); experiments capture target page + citation baseline; post-import mentions watchlist refresh |
| **Product premiumization** | **SHIPPED (Pass)** | Nav: Topics→Opportunities, Draft ideas removed; Today: raw score removed, evidence compressed, rec labels cleaned; Pages: description removed, action labels simplified; Changes/Competitors/Topics/Import: titles+descriptions cleaned; "Gap ledger"→"Opportunities" |

## Score Distribution (baseline — pre-pruning)

| Metric | Value |
|--------|-------|
| Min score | 35 |
| Q25 | 52.5 |
| Median | 57.5 |
| Q75 | 62.5 |
| Max | 95 |
| Mean | 59.0 |
| Auto-resolved | 6/45 (13%) |
| Needs review | 39/45 (87%) |
| Avg candidates/event | 4.49 |

## Factor Hit Rates (across 202 candidates)

| Factor | Strong | Partial | None | Unknown |
|--------|--------|---------|------|---------|
| platform | 52% | 45% | 2% | 0% |
| topic | 40% | 0% | 60% | 0% |
| url | 0% | 0% | 0% | 100% | ← **Fixed in Phase 6** (normalizePageUrl wired into matchUrl) |
| geo | 40% | 60% | 0% | 0% |
| temporal | 55% | 18% | 27% | 0% |
| sourceCategory | 50% | 44% | 0% | 7% |

## Problems Identified and Resolved (Phase 2)

| Problem | Status |
|---------|--------|
| 60% of candidates have topic=none | MITIGATED — no-content score cap at 45 |
| ~~100% url=unknown~~ | **FIXED Phase 6** — `matchUrl` now normalizes via `normalizePageUrl` + `canonicalizeOwnedUrl` |
| hasMeaningfulSignal too loose | FIXED — requires both geo+sourceCategory |
| Measurement entries as candidates | FIXED — pre-score exclusion |
| Opaque URLs not penalized | FIXED — evidence tier classifies as weak |
| Evidence tiers not flowing through | FIXED — wired into discoverCandidates |
| No hard-negative rules | FIXED — temporal/platform miss + no content = killed |
| Topic clusters block auto-resolve | FIXED — topic-cluster triage rule |

## Post-Phase-2 Attribution Metrics

| Metric | Value |
|--------|-------|
| Auto-resolved | 13/45 (29%) |
| Needs-review events | 32 |
| Needs-review candidates | 98 |
| Suppressed | 74 |
| Contributing | 15 |
| Max score | 85 (evidence-capped) |
| Mean score | 53.3 |

## Post-Phase-4 Attribution Metrics

| Metric | Value |
|--------|-------|
| Auto-resolved | 13/45 (29%) |
| Needs-review events | 32 |
| Needs-review candidates | 77 |
| Suppressed | 95 |
| Contributing | 15 |
| Max score | 100 (capped) |
| Mean score | 58.7 |
| Evidence tier exact | 14/85 changes (16%), 77/200 candidates (39%) |
| Evidence tier probable | 39/85 changes (46%), 74/200 candidates (37%) |
| Evidence tier weak | 32/85 changes (38%), 49/200 candidates (25%) |
| Citation-supported candidates | 71/200 (36%) |
| Citation-supported + no-topic | 15 (pages cited for topic but vague description) |
| Pages in registry | 5,297 (42 owned) |
| Citation page-topics | 5,253 pages with topic data |

## Product presentation — planned UI/UX shell overhaul (2026-04-09)

| Item | Status | Notes |
|------|--------|--------|
| Master UI/UX research audit | **Documented only** | Full phased plan appended to `master_execution_plan.md` + `NEXT_PHASE_EXECUTION_PLAN.md`; **no code shipped** in this pass |
| Shell Phases A–H | **Complete (this overhaul)** | **A–H** shipped (2026-04-10): includes watchlist / experiments **Follow-through** polish on Today |
| Intelligence / persistence | **Unchanged** | Explicit non-goal: do not modify attribution, rec/priority engines, stores, or import backends during shell phases unless fixing a display-only defect |

**Operator note:** Product Premiumization Pass (copy/navigation tweaks) remains **shipped**; this entry records the **next** layer: structural UI/UX and IA work.

### Shell Phase A — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Sidebar chrome recede (tokens, labels, border) | **Shipped** |
| Global border softening (`--border` token) | **Shipped** |
| Uppercase tracking-wider/widest purge (~153 instances) | **Shipped** |
| Typography floor bump (9px section labels → 11px) | **Shipped** |
| PageHeader title hierarchy (text-base → text-lg) | **Shipped** |
| StatCard de-admin (drop uppercase, softer border) | **Shipped** |
| Header border softening + breadcrumb bug fix | **Shipped** |
| Command palette / layout stale "Gap ledger" → "Opportunities" | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase B — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| “Advanced” group split → “Data” + “System” | **Shipped** |
| Shortcuts realigned: `G P` Pages, `G C` Changes, `G X` Competitors, `G I` Import | **Shipped** |
| Duplicate shortcuts removed (`G S`, `G H`) | **Shipped** |
| Ghost shortcut removed (`G E` for hidden `/expansion`) | **Shipped** |
| Help panel labels updated to short product names | **Shipped** |
| “Sample history” → “History” across page titles & strings (~10 instances) | **Shipped** |
| “Diagnostics (analyst)” → “Diagnostics” | **Shipped** |
| Stale “Gap ledger” / “Website” labels cleaned from remaining surfaces | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase C — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Primary action card: prose flow, consolidated metadata | **Shipped** |
| CTA hierarchy: dominant button + text-link secondaries | **Shipped** |
| Track record reframed as momentum (no raw %, no dismissed) | **Shipped** |
| Watchlist: proper heading, tighter cards, reordered fields | **Shipped** |
| "What changed" cleaned (raised type, removed redundant link) | **Shipped** |
| Collapsed sections: consistent text-[11px] treatment | **Shipped** |
| Visibility strip: removed date range, cleaner freshness | **Shipped** |
| Fallback action card: jargon removed | **Shipped** |
| Stale "Website" vocabulary cleaned from queue strings | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase D — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Pages summary strip + filter tabs productized | **Shipped** |
| List rows: readability, structure chips, status labels | **Shipped** |
| Detail panel: brief layout, Next step, headings, CTAs | **Shipped** |
| Evidence / scanner detail under disclosure | **Shipped** |
| Status vocabulary + server statusReason cleanup | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase E — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Changes: strip + scorecard-before-records hierarchy | **Shipped** |
| Scorecard: outcome mix disclosure, refine row, calmer table + columns | **Shipped** |
| Scorecard: compact rows, softer linked chips, long description disclosure | **Shipped** |
| Records UI: action-first bar, scan-check explainer collapsed | **Shipped** |
| Contract cards: compact header, verification summary line, detail disclosure | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase F1 — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Competitors: at-a-glance strip + ahead count, calmer footnote | **Shipped** |
| Ranked threats: list-first table, less per-row card chrome | **Shipped** |
| Removed duplicate “your position” KPI under list | **Shipped** |
| Next moves elevated + divided list (not boxed rows) | **Shipped** |
| Topic signals: one frame, three columns (lead / pressure / thin share) | **Shipped** |
| Universe & data setup disclosure + entity list rhythm | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase F2 — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Opportunities route: PageHeader + at-a-glance + workspace disclosure | **Shipped** |
| Topics list: plain gap headlines, calmer column title | **Shipped** |
| Detail: suggested next step first; evidence in disclosure | **Shipped** |
| Detail: full plan / competitors / activity in second disclosure | **Shipped** |
| Copy: fewer internal labels (ObservationRun, Rank, Asset response, etc.) | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase F3 — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Review route: PageHeader + at-a-glance strip | **Shipped** |
| Queue: Open items, calmer rows, softer decisionability labels | **Shipped** |
| Panel: judgment-first + ordering disclosure; Save decision CTA | **Shipped** |
| Candidates: match factors in disclosure; leading match label | **Shipped** |
| Confidence: Confident / Balanced / Tentative; Platform cause label | **Shipped** |
| Resolved / auto-cleared sections toned | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase G1 — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Import: PageHeader + measurement copy; **At a glance**; History/Today links; calmer upload + success; advanced paths label; **Import log** vs History | **Shipped** |
| History (`results-client`): PageHeader + brief; **At a glance**; Import/Today links; runs/stamps + competitor context in disclosures; calmer scope callout; stat labels + table row wording | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase G2 — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Diagnostics: PageHeader + system-brief description; **At a glance** StatCards; Today/Review/History/Import links; scope callout; disclosures for inventory, breakdown tables, cluster/pattern/expansion tables, imported row IDs, stored-ID scoring bundle, distribution/calibration, truth-set, factor lift | **Shipped** |
| Operational blocks kept visible: recorded/open, event stats, event+Review drivers, linkage gaps, candidate linking summary, model gap stats + recommendations | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase G3 — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Expansion: PageHeader **Expansion backlog**; quarantine callout; operator links; **At a glance** StatCards + hypothesis-shape counts in disclosure; non-adjacent lists by model fit; adjacent-only **collapsed** section; row `<details>` for evidence/caveats; promote CTA copy props (**Stage draft…**) | **Shipped** |
| `promote-candidate.tsx`: optional `actionLabel` / `pendingLabel` / `successLabel` (defaults preserve prior copy) | **Shipped** |
| Intelligence / persistence | **Unchanged** |

### Shell Phase H — COMPLETE (2026-04-10)

| Item | Status |
|------|--------|
| Today `today-client.tsx`: **Follow-through** framing; **WatchlistExperimentCard** (status pills, citation readout, type + path, note); **watchAfter** + optional outcome controls in disclosures; remove link demoted inside disclosure | **Shipped** |
| Intelligence / persistence | **Unchanged** |

---

## Intelligence Expansion — Phase 24 Implementation Plan (2026-04-10)

### Phase 24 Component Status

| Component | Status | Key Files |
|-----------|--------|-----------|
| Perplexity API client | **Shipped** | `src/lib/querying/types.ts`, `src/lib/querying/perplexity-client.ts` |
| Answer snapshot domain | **Shipped** | `src/domains/answer-snapshots/types.ts`, `src/domains/answer-snapshots/store.ts` |
| Prompt library | **Shipped** | `src/domains/prompts/types.ts`, `src/domains/prompts/prompt-library.ts`, `src/domains/prompts/journey-stages.ts` |
| Co-mention computation | **Shipped** | `src/domains/competitors/co-mention-types.ts`, `src/domains/competitors/co-mention.ts` |
| Outcome store | **Shipped** | `src/domains/product/outcome-types.ts`, `src/domains/product/outcome-store.ts` |

### Phase 24 Wiring Status

| Component | Status | Key Files |
|-----------|--------|-----------|
| Sampling script | **Shipped** | `scripts/sample-visibility.ts` — `npm run data:sample` |
| Competitors co-mention section | **Shipped** | `src/app/(shell)/competitors/co-mention-section.tsx`, `src/app/(shell)/competitors/page.tsx` |
| Outcome backfill + Today wiring | **Shipped** | `src/app/(shell)/page.tsx`, `src/app/(shell)/today-client.tsx` |

### Phase 25 — Attribution Intelligence

| Component | Status | Key Files |
|-----------|--------|-----------|
| Citation genealogy | **Shipped** | `src/domains/attribution/genealogy-types.ts`, `src/domains/attribution/citation-genealogy.ts` |
| Citation decay | **Shipped** | `src/domains/attribution/decay-types.ts`, `src/domains/attribution/citation-decay.ts` |
| Source trust index | **Shipped** | `src/domains/competitors/source-trust-types.ts`, `src/domains/competitors/source-trust.ts` |
| Source trust UI | **Shipped** | `src/app/(shell)/competitors/source-trust-section.tsx` |
| Decay → Today wiring | **Shipped** | `src/app/(shell)/page.tsx` (nextCandidates decay alert) |
| Decay → rec engine | **Shipped** | `src/domains/product/recommendation-engine.ts` (`refresh_stale_citation` type) |

### Phase 26 — Entity + Representation Intelligence

| Component | Status | Key Files |
|-----------|--------|-----------|
| Entity types | **Shipped** | `src/domains/entity/types.ts` |
| Entity extraction | **Shipped** | `src/domains/entity/entity-extract.ts` |
| Discrepancy types | **Shipped** | `src/domains/entity/discrepancy-types.ts` |
| Discrepancy detection | **Shipped** | `src/domains/entity/discrepancy-detect.ts` |
| Diagnostics integration | **Shipped** | `src/app/(shell)/diagnostics/page.tsx` (entity + discrepancy section) |
| Today integration | **Shipped** | `src/app/(shell)/page.tsx` (notable discrepancy → nextCandidates) |

### Phase 27 — Geographic Intelligence

| Component | Status | Key Files |
|-----------|--------|-----------|
| Geo normalization | **Shipped** | `src/domains/geo/types.ts`, `src/domains/geo/normalize.ts` |
| Local coverage + gaps | **Shipped** | `src/domains/geo/coverage.ts` |
| Today geo signal | **Shipped** | `src/app/(shell)/page.tsx` (gap → nextCandidates) |
| Competitors local pressure | **Shipped** | `src/app/(shell)/competitors/local-pressure-section.tsx`, `page.tsx` |
| Diagnostics geo section | **Shipped** | `src/app/(shell)/diagnostics/page.tsx` (coverage table + gaps + concentration) |
| Heat map data shape | **Shipped** | `GeoHeatMap` type + `computeGeoHeatMap()` in coverage.ts |

### Phase 28 — Journey + Score + Extractability

| Component | Status | Key Files |
|-----------|--------|-----------|
| Journey coverage | **Shipped** | `src/domains/prompts/journey-coverage.ts` |
| Beacon Score types | **Shipped** | `src/domains/product/beacon-score-types.ts` |
| Beacon Score computation | **Shipped** | `src/domains/product/beacon-score.ts` |
| Extractability analysis | **Shipped** | `src/domains/pages/extractability.ts` |
| Diagnostics integration | **Shipped** | `src/app/(shell)/diagnostics/page.tsx` (journey + score + extractability sections) |
| Today integration | **Shipped** | `src/app/(shell)/page.tsx` (journey gap → nextCandidates) |

### Phase 29 — Competitive Intelligence

| Component | Status | Key Files |
|-----------|--------|-----------|
| Battlecard types | **Shipped** | `src/domains/competitors/battlecard-types.ts` |
| Battlecard computation | **Shipped** | `src/domains/competitors/battlecards.ts` |
| Battlecard UI | **Shipped** | `src/app/(shell)/competitors/battlecard-section.tsx` |
| Snippet types | **Shipped** | `src/domains/competitors/snippet-types.ts` |
| Snippet intelligence | **Shipped** | `src/domains/competitors/snippet-intel.ts` |
| Competitors integration | **Shipped** | `src/app/(shell)/competitors/page.tsx` (battlecards) |
| Diagnostics integration | **Shipped** | `src/app/(shell)/diagnostics/page.tsx` (content intelligence) |
| Today integration | **Shipped** | `src/app/(shell)/page.tsx` (extractability gap → nextCandidates) |

### Phase 30 — Advanced Intelligence Scaffolds

| Component | Status | Key Files |
|-----------|--------|-----------|
| Adversarial types + templates | **Shipped (scaffold)** | `src/domains/prompts/adversarial-types.ts`, `adversarial.ts` |
| What-if simulator types + engine | **Shipped (scaffold)** | `src/domains/product/whatif-types.ts`, `whatif-engine.ts` |
| Founder authority | **Shipped (scaffold)** | `src/domains/entity/founder-types.ts`, `founder-authority.ts` |
| Conversion path types + readiness | **Shipped (scaffold)** | `src/domains/product/conversion-path-types.ts`, `conversion-path.ts` |
| Training data pipeline | **Shipped (scaffold)** | `src/domains/product/training-data-types.ts`, `training-data.ts` |
| Diagnostics readiness section | **Shipped** | `src/app/(shell)/diagnostics/page.tsx` (advanced readiness) |

### Phase 31 — Visual Intelligence Layer + Pulse + Reports

| Component | Status | Key Files |
|-----------|--------|-----------|
| ScoreRail | **Shipped** | `src/components/viz/score-rail.tsx` |
| StackedBar | **Shipped** | `src/components/viz/stacked-bar.tsx` |
| RankLadder | **Shipped** | `src/components/viz/rank-ladder.tsx` |
| DeltaStrip | **Shipped** | `src/components/viz/delta-strip.tsx` |
| PlatformSplit | **Shipped** | `src/components/viz/platform-split.tsx` |
| CoverageTrellis | **Shipped** | `src/components/viz/coverage-trellis.tsx` |
| ThreatMeter | **Shipped** | `src/components/viz/threat-meter.tsx` |
| ConfidenceBadge | **Shipped** | `src/components/viz/confidence-badge.tsx` |
| Report generator | **Shipped** | `src/domains/product/report-types.ts`, `report-generator.ts` |
| Pulse system | **Shipped** | `src/domains/product/pulse-types.ts`, `pulse.ts` |
| Today visual upgrade | **Shipped** | `src/app/(shell)/today-client.tsx` (PlatformSplit + momentum bars + KPI strip + impact ConfidenceBadge) |
| Diagnostics visuals | **Shipped** | `src/app/(shell)/diagnostics/page.tsx` (ScoreRail + CoverageTrellis + DonutRing + PulseBanner + StackedBar where noted) |
| Battlecard visuals | **Shipped** | `src/app/(shell)/competitors/battlecard-section.tsx` (ThreatMeter + dimension bars) |

### Phase 31B — Maximum Visual Expansion

| Component | Status | Key Files |
|-----------|--------|-----------|
| AreaChart | **Shipped** | `src/components/viz/area-chart.tsx` |
| KpiCard | **Shipped** | `src/components/viz/kpi-card.tsx` |
| ComparisonBar | **Shipped** | `src/components/viz/comparison-bar.tsx` |
| RadialScore | **Shipped** | `src/components/viz/radial-score.tsx` |
| ViewToggle | **Shipped** | `src/components/viz/view-toggle.tsx` |
| FilterChips | **Shipped** | `src/components/viz/filter-chips.tsx` |
| VizSection / ChartTableSection | **Shipped** | `src/components/viz/viz-section.tsx` |
| BeaconScoreVisual (bars↔radial) | **Shipped** | `src/app/(shell)/diagnostics/beacon-score-visual.tsx` |
| Today KPI grid upgrade | **Shipped** | `src/app/(shell)/today-client.tsx` |
| Today confidence badges | **Shipped** | `src/app/(shell)/today-client.tsx` |

### Phase 31C — Route visual saturation (major routes)

| Surface | Status | Key files / behavior |
|---------|--------|----------------------|
| Competitors overview | **Shipped** | `competitors/page.tsx` — `KpiCard` strip; leaderboard inline share bars; topic “thinnest share” bars |
| Co-mention | **Shipped** | `co-mention-section.tsx` — `FilterChips`, `ViewToggle` (table/chart), `MiniBarChart`, row strength bars |
| Source trust | **Shipped** | `source-trust-section.tsx` — per-source citation proportion bars |
| Local pressure | **Shipped** | `local-pressure-section.tsx` — `ComparisonBar`, `ViewToggle` (chart/table) |
| Pages | **Shipped** | `pages-client.tsx` — summary `KpiCard` grid + `DonutRing` status mix |
| History (`/results`) | **Shipped** | `results-client.tsx` — `KpiCard` strip; `PlatformSplit` + `DonutRing` when multi-platform / trust counts exist |
| Today system details | **Shipped** | `today-client.tsx` — crawl + visibility metrics as `KpiCard` grids; secondary opportunities `ConfidenceBadge` |
| Diagnostics polish | **Shipped** | `diagnostics/page.tsx` — `StatBlock` visual parity with KPI tiles; `StackedBar` for cluster status mix + verdict distribution |

**Visual layer inventory:** **19** `.tsx` components in `src/components/viz/` **plus** `chart-types.ts` (interfaces only).

### Abstraction Refactor — Visual + Data Swappability

| Layer | Status | Key Files |
|-------|--------|-----------|
| Chart prop interfaces | **Shipped** | `src/components/viz/chart-types.ts` |
| View models (5 domains) | **Shipped** | `src/lib/view-models/*.ts` |
| Data adapter interfaces | **Shipped** | `src/lib/data-adapters/types.ts` |
| Profound adapter (current) | **Shipped** | `src/lib/data-adapters/profound-adapter.ts` |
| Adapter entry point | **Shipped** | `src/lib/data-adapters/index.ts` |

**Swap points:**
- Visual engine: replace `src/components/viz/*.tsx` implementations — consumers use `chart-types.ts` interfaces
- Data source: create `native-adapter.ts` implementing `BeaconDataAdapters` — change import in `data-adapters/index.ts`
- View models: `src/lib/view-models/*.ts` stay constant regardless of data or visual engine

Full implementation map: see `master_execution_plan.md` Phase 24+ section and `architecture.md` Intelligence Expansion section.

---

## Product Truth + Usability Stabilization (2026-04-11)

| Area | Status | Summary |
|------|--------|---------|
| Crawl truth in Pages detail | **Shipped** | Title, meta description, H1, canonical, FAQ, schema, word count, links, HTTP status, robots — all visible in "What the crawl saw" panel |
| Diff rendering | **Shipped** | "Changed since last crawl" section with labeled chips when diff exists |
| Stale data warnings | **Shipped** | Prominent banners on Today (crawl >14d, visibility >7d, mismatch) and Pages (crawl >14d, 0 crawled) |
| Today data sources | **Shipped** | Always-visible crawl + visibility status cards (replace hidden "System details") |
| Product copy cleanup | **Shipped** | "ObservationRun on file" → plain language; "heuristic" → "match score"; "Hypothesis" → "Expected outcome"; History explainer simplified |
| `PageSnapshotSummary` | **Expanded** | Added `metaDescription`, `canonicalUrl`, `httpStatus` from extractor |

See `VERIFICATION_LOG.md` for full stabilization entry.

# Beacon Verified State — 2026-04-07 (attribution); product update 2026-04-09 (Phase 5)

Checkpoint: `beacon-handoff-20260407-1900` on branch `checkpoint/beacon-new-chat-reset-20260407-1900`
Working branch: `work/attribution-precision-20260407`

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
| **Competitive clarity surface** | **WIRED (Phase 17)** | Summary strip (AI share %, citations, competitor count); ranked competitor list with "Ahead of you" badges; competitive gap visualization (strongest vs biggest losses by topic); weakest areas; next moves; settings collapsed |
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
| Shell Phases A–H | **Queued** | Design system → nav/IA → Today → Pages → Changes → Competitors/Topics/Review → Import/History/Diagnostics/Expansion → watchlist polish |
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

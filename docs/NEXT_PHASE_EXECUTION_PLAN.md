# Beacon Execution Plan — 2026-04-07

## Phase 2: Candidate Pruning + Evidence Tier Wiring — COMPLETE

Auto-resolved: 6 → 13 (+117%). Review candidates: ~196 → 98 (-50%).
See VERIFICATION_LOG.md for full before/after table.

## Phase 4: Page Evidence Foundations — COMPLETE

### What was done
1. Fixed domain mismatch: `rfritz.com` → `ritzbuilders.com` in evidence-tier.ts (bug: snapshot_verified could never be true)
2. Wired page registry: pages.json loaded into candidates.ts for evidence tier verification
3. Evidence tiers now reach "exact" — 14/85 changes, 77/200 candidates
4. Citation evidence index wired: page_to_topics lookup gives +12 bonus to content-matching candidates on cited pages
5. Evidence tier displayed in all UI MatchFactors callsites (review queue, attribution card, results)
6. Score-snapshot enhanced with page registry, citation evidence metrics

### Key findings
- 71/200 candidates (36%) have citation topic support
- 15 candidates target pages cited for the event's topic but have vague changelog descriptions (no topic match)
- These 15 represent the biggest near-term precision opportunity: better changelog quality would let them auto-resolve
- Citation bonus only applies to content-matching candidates to avoid disrupting triage

### Files changed
- `src/domains/pages/evidence-tier.ts` — configurable owned domain, default ritzbuilders.com
- `src/domains/attribution/candidates.ts` — page registry, citation topic index, citation bonus in adjustScore
- `src/components/display/match-factors.tsx` — evidence tier display with tier labels/colors
- `src/components/data/attribution-card.tsx` — pass evidence tier to MatchFactors
- `src/components/data/candidate-review.tsx` — pass evidence tier to MatchFactors (3 callsites)
- `src/app/(shell)/results/[id]/page.tsx` — pass evidence tier to MatchFactors
- `scripts/score-snapshot.ts` — page registry, citation evidence metrics

## Phase 5 — Change Impact Engine — COMPLETE (2026-04-09)

Shipped:
- `src/domains/attribution/change-impact.ts` — impact confidence (high/medium/low), direction (positive/negative/mixed/none), **why** explanation, **next action** per change
- Types: `ChangeImpact`, `ImpactConfidence`, `ImpactDirection`; `ChangeVerdict` includes `negative`
- `/changes` + `/changes/[id]` — operator-facing impact UI (summary strip, badges, "What to do" column, detail assessment block)
- Builds on existing `computeScorecard` — no persistence or attribution scoring changes

---

## Phase 6 — Measurement Honesty (URL + Decline) — COMPLETE (2026-04-09)

Shipped:
- **URL normalization** in `matchUrl` (`compute.ts`): uses `normalizePageUrl` + `canonicalizeOwnedUrl`. URL factor now produces `strong`/`partial`/`none` instead of always `unknown`.
- **Decline event detection** in `events.ts`: `visibility_lost` + `mention_decline`. `isNegativeEvent` helper exported.
- **Scorecard negative verdict**: all-negative-events + primary → `negative` verdict.
- **Impact Engine**: direction uses event type system; why explanation distinguishes negative events.
- **UI labels**: `/review` + `/changes/[id]` display new event types.

---

## Phase 7 — Today Decision Surface — COMPLETE (2026-04-09)

Shipped:
- Today page (`/`) now surfaces **top 5 change impact signals** from the Impact Engine directly on the operator landing page.
- `page.tsx` calls `enrichWithImpact`, sorts by verdict priority + confidence + score, filters out `too_early` / `pending` / zero-event rows.
- `TodayClient` renders "Change impact signals" section: verdict dot, asset name, confidence badge, next-action text, score, event count, link to detail.
- Validated/negative changes get colored card borders (green/red) for instant visual scan.

---

## Phase 8 — Recommendation Engine — COMPLETE (2026-04-09)

Shipped:
- **`src/domains/product/recommendation-engine.ts`** — synthesizes proven impact + structural patterns + playbook briefs into ranked, actionable recommendations. Three recommendation types:
  - **replicate**: Apply a proven change pattern to a page with the same structural gap (e.g., "Add FAQ+Schema to /roofing-boulder — proven by validated FAQ addition to /roofing-denver")
  - **strengthen**: Improve a weak changelog entry that has linked events but weak evidence (suggests specific topic/URL to add)
  - **investigate**: Flag changes with negative impact for regression review
- **Today page wiring**: `computeRecommendations` called in `page.tsx`, top 5 passed to `TodayClient`
- **"Next best move" upgrade**: When the top recommendation is high-confidence + replicate, it becomes the proactive "Next best move" — system shifts from reactive (fix/triage) to evidence-based
- **UI**: "Recommended moves" section on Today between impact signals and work queue; type-colored cards (green/yellow/red), confidence badge, evidence summary
- No persistence, no scoring changes, no new stores. Pure synthesis of existing data.

---

## Phase 9 — Priority Engine — COMPLETE (2026-04-09)

Shipped:
- **`src/domains/product/priority-engine.ts`** — 6-dimension scoring model (impact confidence, evidence strength, pattern strength, replication potential, type urgency, recency) produces a 0-100 `priorityScore` per recommendation
- **Priority buckets**: CRITICAL (>=72), HIGH_LEVERAGE (>=50), OPPORTUNISTIC (>=25), NOISE (<25 — filtered out)
- **Single primary action selection**: `rankAndSelect()` picks THE one thing to do; all others become secondary
- **Expected outcome generation**: per-type explanation of what happens if the operator acts (visibility improvement for replicate, evidence upgrade for strengthen, loss prevention for investigate)
- **Today page "DO THIS NOW"**: replaces "Next best move" with a dominant, visually enforced primary action card — priority score, bucket label, "Why", "Expected outcome", bold CTA
- **Secondary collapsible**: remaining recommendations collapse into "Other opportunities (N)" toggle
- **Fallback**: when no primary action exists (all noise), gracefully falls back to existing next-best-move logic
- No persistence, no scoring formula changes, no new stores.

---

## Phase 10 — Changes Detail Action Generation — COMPLETE (2026-04-09)

Shipped:
- **`/changes/[id]`** now runs the full recommendation engine and surfaces change-specific actions inline:
  - **"Apply this pattern"**: validated/partial + positive changes show specific target pages with the same structural gap (replicate recs filtered by `sourceChangeId`)
  - **"Strengthen this entry"**: weak-evidence changes with linked events get specific gap nudges (missing URL/topic/hypothesis)
- Imports added: `enrichWithImpact`, `pageSnapshots`, `citationEvidenceIndex`, `allPages`, `rolloutExecutions`, `persistedPatternEvidence`, `minePatterns`, `generateBriefs`, `computeRecommendations`
- Render: "Apply this pattern" green-bordered section with per-page rows (headline, citation count, link to Website); "Strengthen this entry" yellow-bordered section with gap rationale
- No new modules, no persistence, no scoring changes. Pure surfacing of existing intelligence on an existing page.

---

---

## Phase 11 — Recommendation Feedback Loop — COMPLETE (2026-04-09)

Shipped:
- **`src/domains/product/recommendation-tracker.ts`** — retroactive matching of changes to recommendation patterns:
  - For each change, finds if a prior proven change for the same structural pattern existed on a different page — meaning Beacon would have generated a "replicate" recommendation
  - Match confidence: `likely` (same URL path structure) / `possible` (pattern match only)
  - Per-pattern track record: actedOn, validated, partial, inconclusive, noImpact, negative, tooEarly, successRate
  - Aggregate: overall recommendation performance across all patterns
- **Priority engine enhanced**: 7th scoring dimension — pattern track record (-5 to +10 bonus). Patterns with >=70% success rate get +10; poor patterns with negatives get -5. Only activates when pattern has >=2 acted-on changes (avoids noise).
- **Today page**: "Beacon track record" summary line showing N recommendations acted on, M validated, success rate %
- **Changes detail**: "Beacon recommended" badge on changes that match a recommendation pattern, showing match confidence and pattern name
- No new persistence, no new stores. Pure computation from existing scorecard + pattern data.

---

## Phase 12 — Changes List Intelligence Surface — COMPLETE (2026-04-09)

Shipped:
- **`/changes/page.tsx`** — full pattern mining + track record pipeline, per-change intelligence map (`beaconRecommended`, `replicationCount`)
- **`scorecard-client.tsx`** — "Beacon" badge, "N replicable" badge, "Beacon recommended" toggle filter, "Impact" sortable column
- Impact snapshot strip: Beacon-recommended count + total replication targets
- No new modules, no persistence, no scoring changes. Pure surfacing of existing intelligence on the changes list.

---

## Phase 13 — Recommendation Response — COMPLETE (2026-04-09)

Shipped:
- **`src/domains/product/recommendation-response-store.ts`** — new persistence store for explicit operator responses (accept/dismiss/defer) to recommendations
- **`src/app/(shell)/recommendation-actions.ts`** — server action `respondToRecommendation(recId, status)`
- **Today page**: dismissed recs filtered before ranking; deferred recs suppressed for 7 days; Accept/Not now/Dismiss buttons on primary action + secondary opportunities; accepted status badge displayed
- No changes to recommendation engine, priority engine, recommendation tracker, or attribution scoring.

---

## Phase 14 — Daily Surface Compression + Visibility Story — COMPLETE (2026-04-09)

**What shipped:**
- Visibility summary strip on Today: total citations with trend %, per-platform breakdown (ChatGPT/Perplexity/Google AIO/Gemini/Claude), data freshness indicator with stale-data warning (>7d triggers orange "Import fresh data" link)
- Navigation compressed: Primary group (Today, Pages, Changes, Competitors, Topics), Advanced group (Review, Import, Sample history, Diagnostics, Draft ideas). Removed Work and Experimental groups. Competitors promoted to primary nav.
- Impact signals reduced from 5 to 3 ("What changed" — the top 3 by verdict/confidence)
- Work queue collapsed by default (toggle to expand)
- System details (crawl observation, visibility sample, attribution, verified fixes) collapsed by default behind "System details" toggle
- Today page layout reordered: Visibility strip → DO THIS NOW → Track record → What changed → Other opportunities → Work queue (collapsed) → System details (collapsed)

**What was NOT touched:** Attribution engine, recommendation engine, priority engine, recommendation tracker, recommendation response store, Supabase schema, import pipeline, persistence, changes pages, pages surface, all domain modules.

---

## Phase 15 — Import Simplification + Freshness Loop — COMPLETE (2026-04-09)

**What shipped:**
- Coverage strip at top of Import page: result count, change count, date range, platform count, data freshness, last import time
- Drag-and-drop upload zone for .xlsx exports with clear messaging ("Beacon will import only new data")
- Delta-aware import result: new vs. updated counts for results and changes, post-import date range
- Post-import CTA is "Back to Today" (was Review Queue / Diagnostics)
- Advanced sections collapsed: Profound CSV, Manual paste, Reset, Import history all behind "Advanced import options" toggle
- Page title simplified from "Import Historical Data" to "Import"
- `getDataCoverage()` server action returns current counts, dates, platforms, last import time
- `WorkbookImportResult.delta` field tracks `results_new`, `results_updated`, `changes_new`, `changes_updated`, `date_range_after`

**What was NOT touched:** Import engine logic, workbook parser, Profound import pipeline, persistence, Supabase schema, attribution, all domain modules.

---

## Phase 16 — Page Intelligence Surface — COMPLETE (2026-04-09)

**What shipped:**
- Page health summary strip: total pages, winning (green), needs action (red), building (blue), cited count + total citations, structure warnings (pages missing FAQ/schema)
- Page health card at top of detail panel: prominent status badge, citation count + platforms, structure health (FAQ/Schema), next action block
- Structure health in list items: "no FAQ" / "no schema" warnings visible without expanding
- Evidence internals moved into progressive disclosure
- Page title simplified: "Pages" / "Page-level AI visibility health and actions"
- 7 previously unused server vars now wired through (resolved 7 lint warnings)

**What was NOT touched:** Page computation logic, attribution, recommendations, priority engine, import, Supabase, persistence, all domain modules. All fix/playbook/wave/verify functionality preserved in progressive disclosure.

---

## Phase 17 — Competitive Clarity Surface — COMPLETE (2026-04-09)

**What shipped:**
- Competitive summary strip: your AI share %, your citation count, tracked competitor count
- Top competitors ranked by citations: each with citation count, share %, "Ahead of you" badge when applicable, link to detail
- Competitive gap visualization: "Where you are strongest" (green, bar charts by topic) vs "Biggest competitive gaps" (red, competitor % vs your %)
- Weakest areas card: topics where your share is lowest
- Next moves: derived action links from benchmark (fix pages, strengthen content, improve weak topics)
- No-data state: clear message with link to Import when citation evidence is missing
- Universe management CRUD and imported entities moved into collapsed "Competitor settings"
- Wired `computeMarketBenchmark` from `builder-benchmark.ts` — previously unused on this surface

**What was NOT touched:** Competitor detail page (`/competitors/[id]`), competitor domain modules, attribution, recommendations, priority engine, import, Supabase, persistence, all other surfaces.

---

## Phase 18 — Track Record Enhancement — COMPLETE (2026-04-09)

**What shipped:**
- `SignalTier` type (`"explicit" | "inferred"`) on `TrackedOutcome` — outcomes now distinguish between operator-confirmed and retroactively-inferred signals
- `computeTrackRecord` accepts optional `responses` + `recommendations` params — bridges rec IDs to pattern IDs, maps accepted rec target pages to explicit outcomes
- `PatternTrackRecord` gains `explicitAccepted` and `explicitDismissed` counts per pattern
- `TrackRecordSummary` gains `totalExplicitAccepted` and `totalExplicitDismissed` totals
- Priority engine scoring enhanced: explicit acceptance bonus (+2/+4 based on count), explicit dismissal penalty (-3/-7 based on count). Dismissal penalty applies even without 2-actedOn threshold.
- Today page wired: `recommendationResponses` + `allRecommendations` passed to `computeTrackRecord`; track record line shows "N accepted" / "N dismissed" alongside existing stats
- `/changes` and `/changes/[id]` continue working with minimal signature (new params are optional)

**What was NOT touched:** Recommendation engine, recommendation response store, import, Supabase, persistence, all surfaces except Today track record line.

---

## Phase 19 — Multi-Dimensional Recommendation Expansion — COMPLETE (2026-04-09)

**What shipped:**
- `RecommendationType` expanded from 3 types to 7: added `strengthen_structure`, `improve_internal_links`, `refresh_content`, `competitive_displacement`
- `computeRecommendations` accepts optional `pageSnapshots`, `citationCountMap`, `citationIndex` — generates recs from page structure, internal link counts, content depth, and competitive citation gaps
- Priority engine scores new types: competitive displacement (12), strengthen structure (10), refresh content (8), internal links (6)
- Expected outcome generation for all 4 new types
- Today client: 4 new accent colors in `REC_ACCENT` (structure/links = blue, refresh = yellow, competitive = red)
- Client types widened: `TodayRecommendation.type` and `TodayPrimaryAction.type` accept any rec type string
- Today page wires `pageSnapshots`, `citMap`, `citationEvidenceIndex` into recommendation engine

**Evidence thresholds (anti-spam):**
- `strengthen_structure`: page needs ≥10 citations AND missing FAQ or schema (max 3 recs)
- `improve_internal_links`: page needs ≥5 citations AND < 5 internal links (max 3 recs)
- `refresh_content`: page needs ≥20 citations AND thin content (< 800 words or < 2 H2s) (max 2 recs)
- `competitive_displacement`: topic needs ≥10 total citations, we must be present, competitor must have ≥2x our citations (max 3 recs)

**What was NOT touched:** Existing replicate/strengthen/investigate logic, recommendation tracker, response store, import, Supabase, persistence, all surfaces except Today (rec display).

---

## Phase 20 — In-App Trust Layer + Evidence Explainability — COMPLETE (2026-04-09)

**What shipped:**
- **DO THIS NOW evidence block**: structured evidence section showing: evidence basis, confidence level with reason (evidence tier + track record %), data freshness note, "after acting" watch guidance
- **Confidence reasons**: computed server-side from evidence tier, citation opportunity, pattern track record success rate
- **Watch-after guidance**: per-type post-action instructions (what to look for after acting)
- **Data freshness note**: "Based on data through [date]" on primary action
- **Secondary rec evidence**: inline evidence + confidence reason line visible without expanding
- **Pages status reason**: one-line explanation below health badge ("3 validated changes · 47 citations · FAQ · Schema" for Winning, etc.)
- Source evidence moved from buried button-row text to structured evidence block

**What was NOT touched:** Recommendation engine, priority engine, tracker, response store, import, Supabase, persistence, competitor surface, changes surfaces.

---

## Phase 21 — Topic-Similarity / Adjacent Opportunity Expansion — COMPLETE (2026-04-09)

**What shipped:**
- **`cross_page_pattern`** rec type: proven pattern on page type A → apply to different page type B with same gap + shared topic/term overlap. Requires DIFFERENT page types (cannot produce city-page spam). Max 3 recs.
- **`topic_cluster_gap`** rec type: topic with ≥15 owned citations but only transactional pages (service/city). Recommends guide/comparison content to capture informational intent. Max 2 recs.
- Priority engine: cross-page urgency 7, cluster gap urgency 5
- Expected outcome + watch-after guidance for both types
- Today client: accent colors (cross-page = green "Cross-page pattern", cluster gap = blue "Topic cluster")
- `allPages` wired into rec engine for page-type lookup

**Anti-spam design:**
- `cross_page_pattern` REQUIRES different page types (service→project, not service→service). Cannot clone city pages.
- `topic_cluster_gap` recommends MISSING content types (guide/comparison), not more of what exists.
- Both capped (3 + 2 max). Both require citation evidence thresholds.

**What was NOT touched:** Existing 7 rec types unchanged. Tracker, response store, import, Supabase, persistence unchanged. All surfaces except Today unchanged.

---

## Phase 22 — In-App Experiment Loop / Watchlist — COMPLETE (2026-04-09)

**What shipped:**
- **`experiment-store.ts`**: lightweight persistence for experiment objects (`testing` / `watching` / `promising` / `inconclusive` / `negative` / `dropped`)
- **`experiment-actions.ts`**: server actions for start, update status, update note
- **Start experiment flow**: "Start testing" button on accepted primary action → prompt for operator note → experiment created with citation baseline
- **Watchlist section on Today**: between track record and "What changed" — shows active experiments with: headline, operator note, status badge, days since start, citation delta (green +N / red -N), watch-after guidance, "Drop" action
- **Auto-outcome detection**: on each page load, experiments with target pages have their citation counts refreshed from current data. Status auto-updates: delta > 0 → "promising", delta < 0 → "negative", flat after 14d → "inconclusive", otherwise → "watching"
- **Persisted via json-store**: `.data/experiments.json`, same pattern as recommendation-responses

**What was NOT touched:** Recommendation engine, priority engine, tracker, response store, import, Supabase, all surfaces except Today.

---

## Phase 23 — Nightly Usage Hardening — COMPLETE (2026-04-09)

**What shipped:**
- **Combined "Accept & test" button**: one-click accepts rec + creates experiment with note prompt. Eliminates the 2-step Accept → Start testing flow.
- **Button hierarchy fixed**: Not accepted → "Accept & test" (primary) + "Accept only" + "Not now" + "Dismiss". Accepted → "Go →" + "Start testing" (if no experiment) + status badge. No more "Not now" / "Dismiss" showing after acceptance.
- **Experiments now capture target page + citation baseline**: `targetPageUrl`, `targetPagePath`, `baselineCitations` passed from recommendation data through to experiment creation.
- **Post-import watchlist messaging**: after successful import, "Your visibility story and watchlist experiments will refresh with the new data."

**What was NOT touched:** Recommendation engine, priority engine, tracker, experiment store model, all domain modules, persistence, Supabase.

---

## Product Premiumization Pass — COMPLETE (2026-04-09)

**What shipped:**
- **Navigation**: Topics→Opportunities, Sample history→History, Draft ideas removed from nav
- **Today**: raw priority score removed, "Do this now"→"Recommended action", evidence block compressed to single confidence line, rec type labels cleaned (e.g., "Proven pattern"→"Apply pattern", "Strengthen evidence"→"Strengthen", "Competitive gap"→"Close gap"), raw sample count removed from visibility strip
- **Pages**: verbose description removed, next-move labels cleaned ("Needs review"→"Review", "Needs stronger content"→"Strengthen", "Doing well"→"Strong")
- **Changes**: title "What You've Changed"→"Changes", verbose ops description removed
- **Competitors**: verbose description removed
- **Topics**: "Gap ledger"→"Opportunities"
- **Import**: verbose description removed

**What was NOT touched:** All intelligence logic, domain modules, persistence, recommendation engine, priority engine, tracker, experiments.

---

## Master UI/UX product shell overhaul — RESEARCH COMPLETE, IMPLEMENTATION QUEUED (2026-04-09)

**This is not shipped code.** A parallel audit + external pattern research pass produced a **documentation-only** roadmap. Implementation is intentionally sequenced in **`docs/master_execution_plan.md`** under **“Master UI/UX product shell overhaul — PLANNED.”**

### Why now
- **Brain is strong; shell still lags:** Today/Pages/Changes/Competitors/Topics/Review/Import still exhibit **console density**, **competing hierarchies**, **duplicate concepts** (strips + tables + pills), **internal vocabulary** surfacing verbatim, **IA drift** (labels vs URLs vs palette shortcuts), and **non-product interactions** (`prompt()`), despite the Product Premiumization Pass.
- **Best-in-class pattern direction** (sources in master plan): receding chrome (Linear), home/list/detail discipline (Stripe docs), progressive disclosure + modular complexity (Amplitude), command palette as training surface (Superhuman), “complexity under the hood” product philosophy (Ramp leadership interviews).

### Implementation tracks (Shell Phases A–H — execute in order)
| Shell phase | Focus |
|-------------|--------|
| **A** | Design system + global chrome (spacing, type floor, border discipline) |
| **B** | Navigation + IA + shortcuts + palette consistency |
| **C** | Today: single hero story, trust without overload, replace `prompt()`, CTA consolidation |
| **D** | Pages: list/detail productization, fewer nested disclosures, vocabulary alignment |
| **E** | Changes: section order, table scanability, contract card hierarchy |
| **F** | Competitors, Opportunities/Topics, Review: narrative deduplication, plain language |
| **G** | Import, History, Diagnostics, Expansion: advanced vs primary paths, confirm flows |
| **H** | Watchlist/experiments: full status UI, collapsed watch copy, row freshness |

### What must NOT be touched in shell work
Attribution scoring, candidate discovery, recommendation generation, priority selection, track record math, experiment outcome rules, Supabase/dual-write, import file formats — unless a **display bug** requires a typed field from the server.

### Success definition
- **Calm:** Sidebar and headers quieter than working content; reduced border/card stacking.
- **Obvious:** One primary intent per route above the fold; secondary lists collapsed or scoped.
- **Cohesive:** Predictable list/detail/filter/header patterns across primary nav.
- **Premium:** No 8–9px body text as default; evidence and limits honest but not defensive.

**Shell Phase A** — COMPLETE (2026-04-10). Next agent: start **Shell Phase B** (navigation + IA + shortcuts + palette consistency).

**Shell Phase C** — COMPLETE (2026-04-10). Today page hierarchy overhauled: primary action card sculpted (flowing prose, consolidated metadata, cleaner CTA hierarchy); track record reframed as momentum; watchlist tightened; section rhythm improved. Next: **Shell Phase D** (Pages list/detail).

**Shell Phase B** — COMPLETE (2026-04-10). Nav groups restructured ("Advanced" → "Data" + "System"); shortcuts realigned; "Sample history" vocabulary purged; stale labels fixed across all surfaces. Next: **Shell Phase C** (Today content overhaul).

---

## Proposed next (pick one track)

### **0 — Master UI/UX shell overhaul (Shell Phases A–H)** — in progress
- **Shell Phase A — COMPLETE (2026-04-10):** design system + chrome baseline shipped
- **Shell Phase B — COMPLETE (2026-04-10):** nav/IA alignment shipped
- **Shell Phase C — COMPLETE (2026-04-10):** Today content overhaul shipped
- Shell Phases D–H remain queued — next is **Shell Phase D** (Pages list/detail)

### A — Topic-similarity recommendations (keyword clustering)
- Cross-topic pattern matching via lightweight keyword similarity
- Requires topic embedding or clustering logic
- **Defer** until shell Phases A–C at minimum so new signals land in a calm surface

### E — Persistence / infra
- Items in `master_execution_plan.md` post-Phase 3E backlog

---

### Historical: remaining precision opportunities
- 15 citation-supported but no-topic candidates — addressed by "strengthen" recs (Phase 10)
- 1 opportunity in imported data → opportunity clustering mostly inactive

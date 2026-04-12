# Beacon Execution Plan — 2026-04-07

**Current status (2026-04-11):** Phases 2–23, Shell A–H, Intelligence **24–30**, **Phase 31** (viz + abstraction), **Product Stabilization** (crawl truth + usability), **Phase 32** (Daily Detection + Approval Loop), **Phase 32B** (Finding Triage + Workflow Consequences), and **Master Product Plan Phases 33–37** (product truth, Today simplification, verdict layer + Changes tabs, business config + import automation + competitor typing, multi-tenant paths + `/setup` wizard) are **shipped**. Phase 31 still has **partial** items (PDF export, notification badge queue, geo heat map Stage-2 UI). **Next:** drive the product from **real user feedback** (copy, guardrails, onboarding friction, tenant defaults); in parallel, optionally close Phase 31 gaps or advance the **intelligence execution** items below (this doc’s “Phase 33 — Native Querying…” onward — **not** the same numbering as Master Product Plan Phase 33, which is already complete).

**Tier stack (product-led nano-phases):** Research-spec execution slices **1.1a–2.3h** (proof layer, daily ritual, replication, local listings/reviews layer, milestones/ATH, then revenue bridge, weekly export, competitor attack) — see section **“Tiered product stack — research-led nano-phases”** at the **end of this file**.

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
| **F1** | Competitors list: threat-first hierarchy, table scan, topic frame, next moves |
| **F2** | Opportunities (`/topics`): plain-language framing, strip, disclosures, scan hierarchy |
| **F3** | Review: judgment-first layout, calmer queue, disclosures, decisive CTAs |
| **G1** | Import + History: measurement-layer framing, cross-links, calmer hierarchy, disclosures |
| **G2** | Diagnostics: specialist system brief, at-a-glance, disclosures, shell-aligned chrome |
| **G3** | Expansion: quarantined backlog framing, adjacent collapsed, non-imperative CTAs |
| **H** | Today watchlist: brief-style cards, status pills, disclosures, optional outcome controls |

### What must NOT be touched in shell work
Attribution scoring, candidate discovery, recommendation generation, priority selection, track record math, experiment outcome rules, Supabase/dual-write, import file formats — unless a **display bug** requires a typed field from the server.

### Success definition
- **Calm:** Sidebar and headers quieter than working content; reduced border/card stacking.
- **Obvious:** One primary intent per route above the fold; secondary lists collapsed or scoped.
- **Cohesive:** Predictable list/detail/filter/header patterns across primary nav.
- **Premium:** No 8–9px body text as default; evidence and limits honest but not defensive.

**Shell Phase A** — COMPLETE (2026-04-10). Next agent: start **Shell Phase B** (navigation + IA + shortcuts + palette consistency).

**Shell Phase C** — COMPLETE (2026-04-10). Today page hierarchy overhauled: primary action card sculpted (flowing prose, consolidated metadata, cleaner CTA hierarchy); track record reframed as momentum; watchlist tightened; section rhythm improved.
**Shell Phase D** — COMPLETE (2026-04-10). Pages list/detail productized: summary strip, row scanability, status vocabulary (Strong / Follow up / Low signal), detail brief layout, structure chips, CTAs, evidence collapsed under "Evidence & technical detail".
**Shell Phase E** — COMPLETE (2026-04-10). Changes list/ledger productized: at-a-glance strip + scorecard-first order; outcome mix disclosure; scanable scorecard table + softer linked-work chips + long-description disclosure; records section with action-first contract UI, scan-check explainer collapsed, compact cards + verification summary + detail disclosure.
**Shell Phase F1** — COMPLETE (2026-04-10). Competitors list premiumized: at-a-glance strip + ahead count; ranked threats as scannable table; duplicate KPI footnote removed; **Next moves** elevated; strongest/gaps/weakest merged into one **Topic signals** frame; universe disclosure pattern.
**Shell Phase F2** — COMPLETE (2026-04-10). Opportunities (`/topics`): PageHeader + strip; workspace disclosure; Topics list + plain gap headlines; suggested-next-step-first; dual disclosures for evidence vs full plan.
**Shell Phase F3** — COMPLETE (2026-04-10). Review specialist pass: PageHeader + strip; calmer **Open items** queue; judgment-first card + **Why Beacon ordered it here** disclosure; **Save decision** + confidence **Confident/Balanced/Tentative**; match factors per-row disclosure; resolved/auto-cleared presentation aligned with shell.
**Shell Phase G1** — COMPLETE (2026-04-10). Import + History coherence: measurement-layer headers and **At a glance** strips; Import ↔ History ↔ Today cross-links; calmer drop zone and success panels; **Import log** vs History timeline clarified; History brief framing, technical notes + competitor context in disclosures; calmer evidence-scope callout.
**Shell Phase G2** — COMPLETE (2026-04-10). Diagnostics specialist shell: **PageHeader** system brief; **At a glance**; cross-links to primary surfaces; **How to read** scope callout; **DisclosureBlock** for dense tables and stored-ID scoring depth; operational sections (**Event + Review drivers**, **Linkage gaps**, candidate summary, model recommendations) stay visible; calmer **StatBlock**/table chrome.
**Shell Phase G3** — COMPLETE (2026-04-10). Expansion quarantine: **Expansion backlog** PageHeader; quarantine callout; **At a glance** without celebrating adjacent counts; geography hypotheses **collapsed by default**; non-adjacent lists first; row-level disclosure for evidence/caveats; **Stage draft in Opportunities** CTA copy via `PromoteCandidateButton` props.
**Shell Phase H** — COMPLETE (2026-04-10). Today **Follow-through** / watchlist: section story + **`WatchlistExperimentCard`** (status pills, citation readout, disclosures for `watchAfter`, optional manual outcome + remove); connects experiment loop to nightly import truth without PM-tool chrome. **Master shell phases A–H** for this overhaul are complete; further work is normal product iteration outside this numbered shell pass.


**Shell Phase B** — COMPLETE (2026-04-10). Nav groups restructured ("Advanced" → "Data" + "System"); shortcuts realigned; "Sample history" vocabulary purged; stale labels fixed across all surfaces. Next: **Shell Phase C** (Today content overhaul).

---

## Proposed next (pick one track)

### **0 — Master UI/UX shell overhaul (Shell Phases A–H)** — COMPLETE (2026-04-10)
- **Shell Phase A — COMPLETE (2026-04-10):** design system + chrome baseline shipped
- **Shell Phase B — COMPLETE (2026-04-10):** nav/IA alignment shipped
- **Shell Phase C — COMPLETE (2026-04-10):** Today content overhaul shipped
- **Shell Phase D — COMPLETE (2026-04-10):** Pages list/detail productization shipped
- **Shell Phase E — COMPLETE (2026-04-10):** Changes scorecard + contract/record UI productization shipped
- **Shell Phase F1 — COMPLETE (2026-04-10):** Competitors page premiumization shipped
- **Shell Phase F2 — COMPLETE (2026-04-10):** Opportunities (`/topics`) shell productization shipped
- **Shell Phase F3 — COMPLETE (2026-04-10):** Review queue + judgment panel productization shipped
- **Shell Phase G1 — COMPLETE (2026-04-10):** Import + History measurement-layer productization shipped
- **Shell Phase G2 — COMPLETE (2026-04-10):** Diagnostics specialist / system surface productization shipped
- **Shell Phase G3 — COMPLETE (2026-04-10):** Expansion backlog quarantine / reframing shipped
- **Shell Phase H — COMPLETE (2026-04-10):** Today watchlist / experiments follow-through polish shipped

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

---

## Intelligence Expansion Roadmap — Phase 24 onward (2026-04-10)

**Context:** Shell overhaul (Phases A–H) COMPLETE. Persistence (Phases 0–3E) COMPLETE. Attribution + product intelligence (Phases 5–23) COMPLETE. All surfaces premium and nightly-usable.

**What follows:** Intelligence expansion — giving Beacon its own senses, deeper memory, and sharper reasoning. Features built in staged form: Stage 1 (Profound-backed), Stage 2 (Hybrid), Stage 3 (Native-powered).

---

### Phase 24 — Query Foundation + Co-mention + Outcome Unification

**Objective:** Build the three foundational systems that everything else depends on: native querying infrastructure, competitive co-mention intelligence, and unified outcome memory.

**Systems being built:**
1. **Perplexity API client** — `src/lib/querying/perplexity-client.ts`
2. **Answer snapshot storage** — `src/domains/answer-snapshots/types.ts`, store, server actions
3. **Prompt library** — `src/domains/prompts/prompt-library.ts` (formalize 100 tracked prompts)
4. **Co-mention computation** — `src/domains/competitors/co-mention.ts` (from existing citation cold store)
5. **Outcome store** — `src/domains/product/outcome-store.ts` (unify rec responses + experiments + verdicts)

**Features included (Stage 1):**
- Native LLM querying (1.1) — Perplexity MVP, script runner
- Prompt library (1.2) — formalized from Profound tracked prompts
- Co-mention graph (3.1) — computed from existing 85K citation rows
- Outcome database (6.1) — unified from existing scattered stores

**Data layer:** Stage 1 (Profound-backed) for co-mention and outcomes. Stage 2 entry point (hybrid) for querying.

**Dependencies:** Perplexity API key in `.env.local`. Existing cold store for citations. Existing recommendation/experiment stores.

**What is NOT included:** Multi-model querying, genealogy, entity resolution, geographic intelligence, any new UI routes, any visualization work.

**Success criteria:**
- `npm run data:sample-visibility` calls Perplexity, stores answers in `answer_snapshots`
- Co-mention matrix computed, top AI competitors identified
- Outcome store queryable with ≥85 historical entries from existing data
- Competitors page shows "AI-era competitors" section
- Today shows outcome-enriched track record
- `npm run check` passes

---

### Phase 25 — Citation Intelligence + Decay + Trust

**Objective:** Build citation-level intelligence: genealogy matching, decay detection, source trust scoring. All computable from existing data.

**Systems being built:**
1. **Citation genealogy engine** — `src/domains/attribution/citation-genealogy.ts`
2. **Citation decay model** — `src/domains/attribution/citation-decay.ts`
3. **Source trust index** — `src/domains/competitors/source-trust.ts`
4. **Recommendation engine extensions** — new rec types: `refresh_stale_citation`, `improve_source_trust`

**Features included (Stage 1):**
- Citation genealogy (2.1) — fuzzy matching against owned page content from snapshots
- Citation decay (2.2) — exponential decay from time-series citation data
- AI source trust index (3.2) — citation frequency by source domain per platform
- Steal the snippet (2.3) — Stage 1 competitor citation analysis

**Data layer:** Stage 1 (Profound-backed). Uses `citations-by-date/` cold store, `answer-texts.json` cold store, page snapshots.

**Dependencies:** Phase 24 complete (answer snapshots exist for hybrid mode). Existing cold stores.

**What is NOT included:** Multi-model comparison, entity extraction, geographic intelligence, visualization upgrades.

**Success criteria:**
- Genealogy matches found for ≥20% of owned citations
- Decay alerts generated for pages with declining citation trends
- Source trust ranking computed per platform
- At least one new recommendation type generated from these signals
- Pages detail shows genealogy evidence in disclosure
- Today shows decay alerts in "What changed"
- `npm run check` passes

---

### Phase 26 — Entity Foundation + Discrepancy Detection

**Objective:** Build the entity layer (EntityForge) and wire discrepancy detection between AI claims and business truth.

**Systems being built:**
1. **Business truth config** — `src/domains/entity/business-truth.ts`
2. **Entity store** — `src/domains/entity/entity-store.ts`
3. **AI says vs reality engine** — `src/domains/entity/discrepancy-engine.ts`
4. **Founder authority tracking** — `src/domains/entity/founder-tracking.ts`

**Features included (Stage 1):**
- Entity resolution / EntityForge (4.1) — internal consistency from page snapshots
- AI says vs reality (4.2) — page content vs business truth comparison
- Founder authority tracking (4.3) — name mention search in answer texts

**Data layer:** Stage 1 (Profound-backed for answer text search). Stage 2 entry (native answers for discrepancy detection).

**Dependencies:** Phase 25 (genealogy infrastructure for text matching). Business truth configuration (operator input).

**What is NOT included:** Cross-platform entity resolution, automated repair, external data sources.

**Success criteria:**
- Business truth configuration stored and retrievable
- Internal entity consistency flagged across owned pages
- Founder name mentions counted from existing answer texts
- Discrepancy warnings surface on Pages when detected
- `npm run check` passes

---

### Phase 27 — Geographic + Local Intelligence

**Objective:** Build the local wedge: city-normalized visibility, geographic coverage analysis, neighborhood pulse scaffold.

**Systems being built:**
1. **City normalization** — `src/domains/geography/city-normalize.ts`
2. **Geographic coverage** — `src/domains/geography/geographic-coverage.ts`
3. **Neighborhood pulse scaffold** — `src/domains/geography/neighborhood-pulse.ts`

**Features included (Stage 1):**
- Geographic heat map (5.1) — city-normalized coverage table (not map visualization yet)
- Neighborhood pulse (5.2) — scaffold with geographic prompt patterns

**Data layer:** Stage 1 (Profound-backed). Uses existing `city` field on Results + geo factor hierarchy.

**Dependencies:** Phase 24 (prompt library for geographic prompt tagging).

**What is NOT included:** Map visualization (Phase 31), external community data sources, multi-region support.

**Success criteria:**
- City normalization produces consistent taxonomy from existing Results
- Geographic coverage table shows citation density by normalized city
- Geographic gaps flagged (service pages without citations)
- Opportunities shows geographic coverage section
- `npm run check` passes

---

### Phase 28 — Journey + Structured Data + Beacon Score

**Objective:** Build the journey mapping framework, structured data intelligence, and Beacon Score composite metric.

**Systems being built:**
1. **Journey taxonomy** — `src/domains/prompts/journey-stages.ts`
2. **llms.txt generator** — `src/domains/pages/llms-txt.ts`
3. **Beacon Score engine** — `src/domains/product/beacon-score.ts`
4. **Conversion path scaffold** — types and empty store only

**Features included (Stage 1):**
- Custom journey (7.1) — journey stage tagging + coverage analysis
- llms.txt / structured data (8.1) — recommendations + draft generation
- Beacon Score (10.1) — composite metric with transparent dimensions
- Conversion path (7.2) — scaffold (types + empty state)

**Data layer:** Stage 1 (Profound-backed).

**Dependencies:** Phase 24 (outcome store for Beacon Score dimension), Phase 25 (decay data for score dimension).

**What is NOT included:** Journey simulation, conversion tracking (no data), auto-deployment.

**Success criteria:**
- 100 prompts tagged with journey stages
- Journey coverage gaps identified
- llms.txt draft generated for top-cited pages
- Beacon Score computed with dimension breakdown
- Today shows Beacon Score with transparency
- `npm run check` passes

---

### Phase 29 — Competitive Expansion + Battlecards

**Objective:** Deepen competitive intelligence with battlecards, overlap analysis, per-model intelligence, and prompt mining.

**Systems being built:**
1. **AEO battlecards** — `src/domains/competitors/battlecard-engine.ts`
2. **Traditional vs AI overlap** — `src/domains/attribution/visibility-overlap.ts`
3. **Per-model intelligence** — `src/domains/attribution/per-model-intelligence.ts`
4. **Prompt mining engine** — `src/domains/prompts/prompt-miner.ts`

**Features included (Stage 1):**
- AEO battlecards (3.3) — auto-generated from existing competitive data
- Traditional vs AI overlap (3.4) — from imported metric types
- Per-model optimization (10.2) — per-platform citation profiles
- Real prompt mining (1.3) — combinatorial expansion from existing data

**Data layer:** Stage 1 (Profound-backed).

**Dependencies:** Phase 24 (co-mention for battlecards), Phase 25 (trust index for per-model).

**What is NOT included:** GSC API integration, model-specific recommendations (needs multi-model native data).

**Success criteria:**
- Battlecards generated for top 3 competitors
- Overlap analysis computed for pages with both metric types
- Per-platform citation profile computed
- Prompt corpus expanded to 300+ candidates
- `npm run check` passes

---

### Phase 30 — Advanced Intelligence + Scaffolds

**Objective:** Build adversarial testing scaffold, what-if simulator, and remaining scaffold systems.

**Systems being built:**
1. **Adversarial prompt scaffold** — `src/domains/prompts/adversarial-prompts.ts`
2. **What-if simulator** — `src/domains/product/what-if-simulator.ts`
3. **Visual readiness scaffold** — `src/domains/pages/visual-readiness.ts`
4. **Video citation layer scaffold** — `src/domains/pages/video-citations.ts`
5. **Review-to-AI mapping scaffold** — `src/domains/entity/review-signals.ts`
6. **Content syndication scaffold** — `src/domains/pages/content-syndication.ts`

**Features included (Stage 1):**
- Adversarial prompt stress (10.4) — template prompts + cold-store analysis
- What-if simulator (6.2) — historical outcome summary (≥20 threshold)
- Visual readiness (8.2) — image metadata extraction scaffold
- Video citation layer (8.3) — YouTube URL flagging
- Review-to-AI mapping (10.7) — review platform citation flagging
- Content syndication (10.8) — syndication source identification

**Data layer:** Stage 1 (Profound-backed + scaffold).

**Dependencies:** Phase 24 (outcome store for what-if), Phase 25 (citation data for video/review).

**What is NOT included:** Automated adversarial testing, prediction models, external API integrations.

**Success criteria:**
- Adversarial prompt templates defined in prompt library
- What-if shows historical summary when data sufficient
- Visual readiness indicators on page health
- Video citation counts available
- `npm run check` passes

---

### Phase 31 — Visualization + Reporting + Notifications

**Objective:** Build the premium visualization layer, report generator, and notification system.

**Status (2026-04-10 checkpoint):** **Largely shipped** for visualization + abstraction; **partial** for reporting/notifications/geo Stage-2 items below.

**Shipped**
- **Visual primitives** — `src/components/viz/*` (19 components + `chart-types.ts` contracts). Inline SVG/CSS, interactive hovers, `ViewToggle` / `FilterChips` patterns.
- **Pulse** — `src/domains/product/pulse.ts` + Diagnostics banner (severity-sorted signals).
- **Report generator (data layer)** — `src/domains/product/report-generator.ts` + types (structured JSON payloads; not operator PDF export).
- **Beacon Score visual** — `beacon-score-visual.tsx` (bars ↔ radial).
- **Route saturation** — Today, Pages, Competitors (main + co-mention / source trust / local pressure), History (`/results`), Diagnostics (StatBlock alignment + `StackedBar` for cluster + verdict readouts). See `architecture.md` navigation bullets and `VERIFICATION_LOG.md` (Phase 31B + 31C entries).
- **Swappability** — `src/lib/view-models/*`, `src/lib/data-adapters/*` (`getAdapters()` / `createProfoundAdapters()`).

**Partial / not yet as originally spec’d**
- **PDF export** — not shipped from Today (no Puppeteer PDF path in product UI).
- **In-app notification queue + Today badge** — `notifications` domain scaffold exists in roadmap; not wired as a first-class unread badge in nav per original success criteria.
- **Geographic heat map (Stage 2)** — `HeatGrid` + `computeGeoHeatMap()` data shape exist; Competitors/Diagnostics still table-forward where geo is shown (no full-screen choropleth).
- **Sparklines on every surface** — `KpiCard` can host `Sparkline` when time series exist; not all routes pass series data.

**Systems originally listed (reality vs plan):**
- Sparklines live under **`src/components/viz/sparkline.tsx`** (not `src/components/data/`).
- Report generator lives under **`src/domains/product/report-generator.ts`** (not `src/lib/report-generator.ts`).

**Dependencies:** Phase 27 (geo data for future heat map), Phases 24–30 (intelligence inputs).

**Recommended next focus:** Close Phase 31 gaps *or* treat remaining items as Phase 31 follow-ups and start **Phase 32** (Ask Beacon + blueprints) once priorities are chosen — see `master_execution_plan.md` § “Intelligence expansion + visual terminal”.

---

### Phase 32 — Ask Beacon + Industry Blueprints + Training Pipeline

**Objective:** Build the conversational intelligence layer, industry documentation, and training data scaffold.

**Systems being built:**
1. **Ask Beacon** — `src/domains/product/ask-beacon.ts` + command palette integration
2. **Industry blueprints** — `src/domains/product/industry-blueprint.ts`
3. **Training data pipeline scaffold** — `src/domains/pages/training-data.ts`

**Features included:**
- Ask Beacon (10.6) — query pattern matching + structured data lookup
- Industry blueprints (10.5) — home-services blueprint from Beacon data
- Training data pipeline (10.3) — crawl access tracking scaffold

**Data layer:** All existing computed data.

**Dependencies:** Phase 24-30 (all intelligence layers for Ask Beacon to query).

**What is NOT included:** LLM-powered natural language parsing (Stage 2+), multi-vertical blueprints, Common Crawl analysis.

**Success criteria:**
- Command palette accepts Beacon queries with canned patterns
- Home-services blueprint generated from outcome data
- Crawl access status tracked per page
- `npm run check` passes

---

## Master Product Plan — Phases 33–37 (COMPLETE, 2026-04-11)

These **product-track** phases are **done**. They are numbered for the Master Product Plan / execution handoff, **separate** from the intelligence-roadmap section headers below (e.g. “Phase 33 — Native Querying” is still **future** work).

| Phase | Name | Outcome |
|-------|------|--------|
| **33** | Product truth stabilization | “Since last scan” always on Today (incl. “All clear”); `detectedAt` on rows; crawl→**scan** copy; Pages recommendation guard + diff “no changes”; normalized URLs in server lookups; dead `onVerify` removed |
| **34** | Today simplification | Three blocks: findings inbox → top recommendation → system status; KPIs/momentum/experiments/what-changed/secondary opportunities/work queue in one **“Visibility, momentum & queue”** disclosure; **Since last scan** always on (**All clear** or pending counts) |
| **35** | Pages + Changes verdict layer | Ship status on Pages; outcome tabs on Changes; History ↔ Changes cross-navigation |
| **36** | Business abstraction + launch prep | `business-config.ts`, config-driven extractor, `postImportSetup()`, competitor type badges |
| **37** | First external users (infra) | `BEACON_TENANT`, `.data/tenants/{slug}/`, `/setup` + actions + System nav |

**Verification:** `npm run typecheck`, `npm run build`, `npm test` — **34 tests** at checkpoint (see `VERIFICATION_LOG.md`).

**Status:** Product-track Phases **33–37** are **closed**. **Next** is continued iteration from **real external-user feedback** (copy, guardrails, onboarding friction, tenant defaults), with Phase 31 partials and intelligence execution (native multi-model, etc.) as normal backlog — not gating the shipped operator loop above.

---

### Phase 33 — Native Querying Expansion (Multi-Model)

**Roadmap numbering:** This is the **intelligence execution** Phase 33 (native APIs). **Master Product Plan Phase 33** (truth stabilization) is already **shipped** — see table above.

**Objective:** Expand native querying to ChatGPT and Gemini. All Stage 1 features begin upgrading to Stage 2 (hybrid).

**Systems being built:**
1. **ChatGPT API client** — `src/lib/querying/chatgpt-client.ts`
2. **Gemini API client** — `src/lib/querying/gemini-client.ts`
3. **Answer diff engine** — `src/domains/answer-snapshots/answer-diff.ts`
4. **Multi-model comparison** — `src/domains/attribution/model-comparison.ts`

**Features upgrading to Stage 2:**
- All genealogy, trust, co-mention, per-model features gain multi-model data
- Adversarial testing gains native sampling capability
- AI says vs reality gains fresh answer text comparison

**Dependencies:** API keys for ChatGPT and Gemini. Phase 24 (answer snapshot infrastructure).

**Success criteria:**
- Three models sampled nightly
- Answer diffs computed across sampling runs
- Per-model citation comparison available
- Stage 2 features using hybrid data
- `npm run check` passes

---

### Phase 34 — Full Native Intelligence (Stage 3 Upgrades)

**Roadmap numbering:** This is **intelligence execution** Phase 34. **Master Product Plan Phase 34** (Today simplification) is already **shipped** — see "Master Product Plan — Phases 33–37" above.

**Objective:** All features reach Stage 3 (native-powered) where applicable.

**Features reaching Stage 3:**
- Citation genealogy with real-time matching
- AI says vs reality with automated discrepancy alerts
- Per-model optimization with empirical recommendations
- Co-mention with temporal drift detection
- What-if simulator with predictive capability (if outcome volume sufficient)
- Ask Beacon with LLM-powered natural language parsing
- Adversarial testing as automated suite

**Dependencies:** Phases 24-33 complete. 60+ days of native sampling data. 200+ outcomes in outcome store.

**Success criteria:**
- Profound dependency effectively eliminated for daily use
- All intelligence layers running on owned data
- Beacon Score includes all planned dimensions
- `npm run check` passes

---

## Tiered product stack — research-led nano-phases (1.1a–2.3h)

**Purpose:** Executable **mini-prompt** slices (each completable in one focused session). Each row is **research-led first** (questions + spec), then implementation. **Numbering is independent** of historical “Phase 2–37” above.

**Priority law:** Finish **Tier 1** tracks **1.1 → 1.5** in order unless **Depends on** explicitly allows parallel work. **Tier 2** (2.1–2.3) starts only when Tier 1 exit criteria are met (see end of §1.5).

**Tier 1 — must build now:** Proof layer · Daily ritual perfection · Replication engine · Listings/reviews local layer · Milestones/ATH.  
**Tier 2 — after Tier 1:** Revenue bridge · Weekly export/proof summary · Stronger competitor attack.

---

### Track 1.1 — Proof layer

**1.1a — Signal taxonomy audit**  
- **Context:** Beacon blends crawl, import, synthetic wrappers, and heuristics.  
- **Research questions:** What signal classes exist today? Which are “observed” vs “inferred”? Where is provenance stored vs missing?  
- **Deliverable:** Markdown matrix: signal → source artifact → UI surfaces → user-facing claim allowed.  
- **Done when:** Matrix reviewed; “forbidden claims” list exists.  
- **Depends on:** none.

**1.1b — Competitor trust patterns (desk research)**  
- **Context:** AEO/GEO vendors vary in methodology transparency.  
- **Research questions:** How do Peec, Profound, SE Visible, Writesonic describe sampling? What disclaimers are common?  
- **Deliverable:** 1-page “industry bar” + list of patterns to adopt or avoid.  
- **Done when:** Doc linked from 1.1a matrix footnotes.  
- **Depends on:** 1.1a.

**1.1c — In-product methodology shell (IA)**  
- **Context:** Proof must be reachable without burying Today.  
- **Research questions:** Where do operators look when they doubt a number? (Settings vs Today vs per-card.)  
- **Deliverable:** Wireframe notes: entry points, depth (summary → detail), cross-links.  
- **Done when:** Agreed IA for “How we know this” for Tier-1 surfaces.  
- **Depends on:** 1.1a.

**1.1d — Prompt bank governance spec**  
- **Context:** Prompt-derived visibility is easy to attack.  
- **Research questions:** Versioning? Who edits? Retention? Per-tenant? Audit log fields?  
- **Deliverable:** Spec: `PromptSet` lifecycle, diff, rollback, display rules.  
- **Done when:** Spec + API shape (even if file-backed v1).  
- **Depends on:** 1.1a.

**1.1e — Confidence & uncertainty copy deck**  
- **Context:** Operators punish false precision.  
- **Research questions:** Which strings currently imply certainty? What’s the replacement lexicon (likely / observed / insufficient sample)?  
- **Deliverable:** Copy table: before → after, by surface (Today, Market, Changes).  
- **Done when:** Stakeholder pass on 10 highest-traffic strings.  
- **Depends on:** 1.1a.

**1.1f — Lineage fields (minimal schema)**  
- **Context:** Evidence needs machine-readable lineage for UI + export.  
- **Research questions:** Minimum fields: `source`, `observed_at`, `sample_id`, `coverage_note` — enough?  
- **Deliverable:** Type definitions + which entities get lineage first (findings, verdicts, chart points).  
- **Done when:** Schema merged as plan; first consumer chosen.  
- **Depends on:** 1.1d.

**1.1g — Wire lineage into top finding types**  
- **Context:** Findings are the trust-critical path.  
- **Research questions:** Which finding codes account for 80% of user decisions?  
- **Deliverable:** Implementation plan per finding family + test cases.  
- **Done when:** Each chosen family lists lineage in UI.  
- **Depends on:** 1.1f.

**1.1h — “Adversarial owner” FAQ**  
- **Context:** Skeptical owners ask the same 12 questions.  
- **Research questions:** What breaks trust fastest? (stale crawl, single prompt, etc.)  
- **Deliverable:** FAQ + short answers grounded in 1.1a matrix.  
- **Done when:** FAQ reachable from methodology shell (1.1c).  
- **Depends on:** 1.1c, 1.1e.

**1.1i — Stale / partial coverage escalation rules**  
- **Context:** Silent failure is worse than empty data.  
- **Research questions:** What thresholds? What’s blocking vs warning?  
- **Deliverable:** State machine: fresh → degrading → stale → action required.  
- **Done when:** Rules mapped to UI + copy (ties 1.2).  
- **Depends on:** 1.1a.

**1.1j — Proof layer exit gate**  
- **Deliverable:** Checklist: every Tier-1 surface has methodology link + lineage on primary claims + no forbidden strings.  
- **Done when:** Checklist signed off for ship.  
- **Depends on:** 1.1g, 1.1h, 1.1i.

---

### Track 1.2 — Daily ritual perfection

**1.2a — Ritual user journey map**  
- **Research questions:** Morning minutes available? Who skips days? What triggers return?  
- **Deliverable:** Journey: trigger → open → triage → assign → done → weekly proof.  
- **Done when:** Map approved.  
- **Depends on:** none.

**1.2b — “Inbox zero” definition for Beacon**  
- **Research questions:** What counts as “done for today” beyond findings? (imports, attribution, scans.)  
- **Deliverable:** Single definition + priority order when multiple queues non-empty.  
- **Done when:** Product agrees one stack rank.  
- **Depends on:** 1.2a.

**1.2c — Digest channel spec (email / SMS / Slack)**  
- **Research questions:** Which channel for which ICP? Frequency caps? Quiet days?  
- **Deliverable:** v1 channel matrix + payload outline (“3 actions”).  
- **Done when:** Legal/privacy notes captured (even if “later”).  
- **Depends on:** 1.2b.

**1.2d — Notification payload copy templates**  
- **Deliverable:** 5 template variants (critical, stale, win, nudge, all-clear).  
- **Done when:** Templates reviewed against proof layer (1.1e).  
- **Depends on:** 1.1e, 1.2c.

**1.2e — Assignment + ownership model**  
- **Research questions:** Single assignee vs team? Snooze reasons?  
- **Deliverable:** State + fields + UI placement (Today vs Pages).  
- **Done when:** Spec + empty states.  
- **Depends on:** 1.2b.

**1.2f — Mobile / job-site use case**  
- **Research questions:** What can be done on phone in 60s? What must wait for desktop?  
- **Deliverable:** Must-have mobile actions list vs deferred.  
- **Done when:** Scoped for v1.  
- **Depends on:** 1.2a.

**1.2g — Ritual metrics (instrumentation plan)**  
- **Deliverable:** Events: `ritual_opened`, `primary_action_*`, `digest_sent`, `time_to_clear`.  
- **Done when:** Event names + properties documented.  
- **Depends on:** 1.2b.

**1.2h — Daily ritual exit gate**  
- **Deliverable:** Checklist: digest + clear done-state + escalation + assignment + mobile scope.  
- **Done when:** Signed off.  
- **Depends on:** 1.2c–1.2g, 1.1j (proof strings in ritual).

**1.2i — Keyboard / power-user path**  
- **Deliverable:** Shortcuts spec for triage (align with command palette).  
- **Done when:** Documented; conflicts resolved.  
- **Depends on:** 1.2e.

---

### Track 1.3 — Replication engine

**1.3a — “Winner” definition v2**  
- **Research questions:** Validated vs partial vs operator-confirmed — which counts as replication seed?  
- **Deliverable:** Decision tree + exclusions (e.g. one-off news).  
- **Done when:** Agreed with Changes/attribution owners.  
- **Depends on:** none.

**1.3b — Pattern library gap analysis**  
- **Context:** `minePatterns` / briefs / track record exist.  
- **Research questions:** What patterns are under-detected for local? (FAQ, LocalBusiness, service area, etc.)  
- **Deliverable:** Prioritized pattern backlog.  
- **Done when:** Top 10 patterns ranked.  
- **Depends on:** 1.3a.

**1.3c — Replication queue IA**  
- **Research questions:** Queue lives on Changes vs Today vs both?  
- **Deliverable:** Wireflow: pick winner → select targets → confirm → track experiment.  
- **Done when:** Approved flow.  
- **Depends on:** 1.3b.

**1.3d — Target selection rules**  
- **Deliverable:** Rules: same metro, same service, citation gap, not already shipped.  
- **Done when:** Pseudocode + edge cases.  
- **Depends on:** 1.3b.

**1.3e — Batch size & operator cognitive cap**  
- **Research questions:** Max simultaneous replications before noise?  
- **Deliverable:** Default cap + “show more”.  
- **Done when:** Product number chosen.  
- **Depends on:** 1.3c.

**1.3f — Experiment linkage spec**  
- **Deliverable:** How replication enqueue ties to `experiment-store` + success criteria.  
- **Done when:** One end-to-end example written on paper.  
- **Depends on:** 1.3c.

**1.3g — Replication metrics**  
- **Deliverable:** KPIs: suggested → accepted → shipped → validated rate.  
- **Done when:** Dashboard spec (even if internal first).  
- **Depends on:** 1.3f.

**1.3h — Replication engine exit gate**  
- **Deliverable:** Checklist: queue visible, one-click enqueue, tracking, proof strings.  
- **Done when:** Signed off.  
- **Depends on:** 1.3d–1.3g, 1.1j.

---

### Track 1.4 — Listings / reviews first-class local layer

**1.4a — Scope boundary doc (not Yext)**  
- **Research questions:** Read vs write? GBP only first? Listings without full CRM?  
- **Deliverable:** “In / out” table vs BrightLocal/Moz.  
- **Done when:** Exec sign-off on boundary.  
- **Depends on:** none.

**1.4b — GBP data model (read path v1)**  
- **Deliverable:** Fields needed for health: hours, categories, attributes, posts cadence, Q&A.  
- **Done when:** API/source choice documented (manual import vs connector).  
- **Depends on:** 1.4a.

**1.4c — Listings health score methodology**  
- **Research questions:** Which mismatches matter for AI local answers?  
- **Deliverable:** Score components + weights + disclaimers.  
- **Done when:** Aligns with proof layer (1.1).  
- **Depends on:** 1.4b, 1.1b.

**1.4d — Review monitoring v1 scope**  
- **Deliverable:** Sites v1 (Google + one optional); SLA for “new review”.  
- **Done when:** Scope frozen.  
- **Depends on:** 1.4a.

**1.4e — Review response workflow**  
- **Research questions:** AI draft + human approve vs templates only?  
- **Deliverable:** Workflow + liability note.  
- **Done when:** Legal/comms sign-off pattern.  
- **Depends on:** 1.4d.

**1.4f — Today / Market surfacing rules**  
- **Deliverable:** When listings/reviews appear on Today vs Settings vs Market.  
- **Done when:** IA doc.  
- **Depends on:** 1.4c, 1.4d.

**1.4g — NAP consistency checks (lightweight)**  
- **Deliverable:** Compare GBP vs site footer vs schema; diff UI spec.  
- **Done when:** Rules + false-positive handling.  
- **Depends on:** 1.4b.

**1.4h — Competitive context for reviews**  
- **Deliverable:** “vs local pack competitors” framing research (data availability).  
- **Done when:** Feasibility verdict.  
- **Depends on:** 1.4d.

**1.4i — Import / connector fallback**  
- **Deliverable:** If no API: CSV/manual refresh cadence for GBP metrics.  
- **Done when:** Operator comms drafted.  
- **Depends on:** 1.4b.

**1.4j — Local layer privacy & retention**  
- **Deliverable:** Retention policy for review text, PII in logs.  
- **Done when:** Checklist for ship.  
- **Depends on:** 1.4d.

**1.4k — Permissions (future multi-user)**  
- **Deliverable:** Who can respond to reviews vs view financials.  
- **Done when:** Roles stub for v1 single-user.  
- **Depends on:** 1.4e.

**1.4l — Local layer exit gate**  
- **Deliverable:** v1 ship: health card + review alert + methodology links + boundary visible.  
- **Done when:** Signed off.  
- **Depends on:** 1.4f–1.4j, 1.1j.

---

### Track 1.5 — Milestones / all-time-high (ATH) system

**1.5a — ATH metric catalog**  
- **Research questions:** Which metrics motivate local owners without lying? (citations, share, rank, mentions.)  
- **Deliverable:** Allowed ATH dimensions + anti-gaming rules.  
- **Depends on:** 1.1a.

**1.5b — Rolling vs calendar windows for records**  
- **Deliverable:** Define window for “best week ever” vs ATH.  
- **Done when:** Spec avoids overlap with Today chart windows.  
- **Depends on:** 1.5a.

**1.5c — Milestone event types**  
- **Deliverable:** Enum: first_time_top3, ATH_citations, streak_7d, etc. + trigger conditions.  
- **Done when:** Backend plan matches UI slots.  
- **Depends on:** 1.5a, 1.5b.

**1.5d — Celebration UX (proportionality)**  
- **Research questions:** When is celebration annoying?  
- **Deliverable:** Intensity rules + “share” optional.  
- **Depends on:** 1.5c.

**1.5e — History store for milestones**  
- **Deliverable:** Persistence shape + dedupe (same ATH daily).  
- **Depends on:** 1.5c.

**1.5f — Today surfacing of milestones**  
- **Deliverable:** Placement + max noise per week.  
- **Depends on:** 1.5d, 1.2 (ritual).

**1.5g — Milestones exit gate**  
- **Deliverable:** Checklist: ATH truthful, deduped, linked to proof.  
- **Done when:** Signed off.  
- **Depends on:** 1.5e, 1.5f, 1.1j.

---

### Tier 1 completion criterion

Tier 1 is **closed** when **1.1j, 1.2h, 1.3h, 1.4l, 1.5g** are all signed off and one **internal dogfood week** completes without P0 trust regressions.

---

### Track 2.1 — Revenue bridge / business-signal layer

**2.1a — Signal inventory beyond visibility**  
- **Deliverable:** Calls, forms, LSA, GBP actions — which exist for ICP?  
- **Depends on:** Tier 1 closed.

**2.1b — Integration priority matrix**  
- **Deliverable:** Build vs partner; effort vs impact chart.  
- **Depends on:** 2.1a.

**2.1c — Identity graph (visitor ↔ AI visibility)**  
- **Research questions:** Match rates realistic?  
- **Deliverable:** Honest feasibility tier (A/B/C).  
- **Depends on:** 2.1a.

**2.1d — Metric definitions for “AI-assisted revenue”**  
- **Deliverable:** Definitions that legal/marketing can defend.  
- **Depends on:** 2.1c.

**2.1e — UI: where revenue story lives**  
- **Deliverable:** Changes vs Today vs new “Outcomes” — placement.  
- **Depends on:** 2.1d.

**2.1f — v1 minimum lovable bridge**  
- **Deliverable:** Pick **one** signal (e.g. call clicks from GBP) for first bridge.  
- **Depends on:** 2.1b.

**2.1g — Revenue bridge exit gate**  
- **Deliverable:** One defended metric live + methodology.  
- **Depends on:** 2.1f, 1.1j.

---

### Track 2.2 — Weekly export / proof summary

**2.2a — Audience variants (owner vs agency client)**  
- **Deliverable:** Two outline templates.  
- **Depends on:** Tier 1 closed.

**2.2b — Data inclusion rules**  
- **Deliverable:** What proof objects export (screenshots? links? tables?).  
- **Depends on:** 1.1g, 2.2a.

**2.2c — PDF / deck layout spec**  
- **Deliverable:** Branding, page count cap, white-label fields.  
- **Depends on:** 2.2b.

**2.2d — Generation pipeline**  
- **Deliverable:** Server job vs on-demand; caching; failure modes.  
- **Depends on:** 2.2c.

**2.2e — Weekly cadence + email attachment**  
- **Deliverable:** Cron spec + unsubscribe.  
- **Depends on:** 2.2d.

**2.2f — Weekly export exit gate**  
- **Deliverable:** One real client packet generated from prod-like data.  
- **Depends on:** 2.2e, 1.1j.

---

### Track 2.3 — Stronger competitor attack system

**2.3a — “Attack” semantics research**  
- **Deliverable:** Ethical framing; avoid war metaphors in regulated verticals.  
- **Depends on:** Tier 1 closed.

**2.3b — Countermove taxonomy**  
- **Deliverable:** Map threat types → allowed actions (content, schema, PR, local).  
- **Depends on:** 2.3a.

**2.3c — One-click strategy spec**  
- **Research questions:** What does button do? (enqueue replication? open brief? schedule scan?)  
- **Deliverable:** Flow per competitor row.  
- **Depends on:** 1.3c, 2.3b.

**2.3d — Evidence pack for “why they win”**  
- **Deliverable:** Which artifacts prove topic-level gap.  
- **Depends on:** 1.1, citation index.

**2.3e — Competitive narrative QA**  
- **Deliverable:** 10 synthetic cases; expected output.  
- **Depends on:** 2.3d.

**2.3f — Market UI density review**  
- **Deliverable:** Reduce to top-N threats + progressive disclosure.  
- **Depends on:** 2.3e.

**2.3g — Attack system metrics**  
- **Deliverable:** Usage: strategies run → shipped → outcome.  
- **Depends on:** 2.3c.

**2.3h — Competitor attack exit gate**  
- **Deliverable:** One-click path live for ≥1 strategy class + proof.  
- **Depends on:** 2.3c–2.3g, 1.1j.

---

### Tier 2 completion criterion

Tier 2 is **closed** when **2.1g, 2.2f, 2.3h** are signed off and **one agency pilot** can run a week without manual spreadsheet side-channel.

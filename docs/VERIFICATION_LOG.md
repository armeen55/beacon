# Beacon Verification Log

## 2026-04-07 — New Chat Takeover

### Phase 0: Safety Checkpoint
- Branch: `checkpoint/beacon-new-chat-reset-20260407-1900`
- Commit: `2e4ddb0` — 100 files, 5820 insertions, 2916 deletions
- Tag: `beacon-handoff-20260407-1900`
- Working branch: `work/attribution-precision-20260407`
- No secrets exposed, `.data` and `.env*` gitignored

### Phase 1: Repo Truth Audit
- **Baseline score-snapshot run**: 45 events, 202 candidates, 6 auto-resolved, 39 needs-review
- **Score range**: 35–95, mean 59.0
- **Critical finding**: 60% of candidates have topic=none — overgeneration from broad changes
- **Critical finding**: evidence tiers exist but are not wired into live candidate flow
- **Critical finding**: hasMeaningfulSignal too loose — single structural factor sufficient
- **Verified**: all prior-chat claims about attribution factor repair are real
- **Verified**: review queue is fully operational on imported data
- **False**: evidence tiers affect live scoring (they don't — evidenceMeta never passed)

### Phase 2: Candidate Pruning + Evidence Tier Wiring
- Status: COMPLETE
- Files changed:
  - `src/domains/attribution/candidates.ts` — pre-score pruning, evidence tier wiring, no-content score cap, hard negatives
  - `src/domains/attribution/compute.ts` — exported EVIDENCE_TIER_BONUS/CAP
  - `src/domains/attribution/triage.ts` — topic-cluster auto-resolve rule
  - `scripts/score-snapshot.ts` — enhanced reporting with triage breakdown

#### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Auto-resolved events | 6/45 | 13/45 | +117% |
| Needs-review events | 39 | 32 | -18% |
| Needs-review candidates | ~196 | 98 | -50% |
| Suppressed candidates | ~0 | 74 | new |
| Contributing candidates | ~0 | 15 | new |
| Max score | 95 | 85 | evidence cap |
| Mean score | 59.0 | 53.3 | content cap |
| Measurement leaks | yes | no | eliminated |
| Evidence tier in live scoring | no | yes | wired |

#### What the numbers mean
- Auto-resolve more than doubled: 13 events now have clear, topic-matching primaries
- Review workload halved: 98 candidates to review instead of ~196
- 74 candidates properly suppressed (not shown to operator)
- 15 candidates marked as contributing (useful context, not blocking)
- Non-topic candidates capped at 45 so they can't crowd out real matches
- Evidence tiers now flow into attribution — probable capped at 85, weak at 55

#### What remains after Phase 2
- 32 events still need review (genuinely ambiguous or no topic match)
- URL matching is 100% unknown (data gap, not logic gap)
- 0 opportunities in imported data → opportunity clustering inactive
- Evidence tier "exact" unreachable without page registry

### Build Verification (Phase 2)
- `npx next build` passes clean
- TypeScript: no errors
- All pages compile and generate successfully

---

## 2026-04-07 — Phase 4: Page Evidence Foundations

### What was implemented
1. **Domain fix**: `evidence-tier.ts` defaulted to `rfritz.com` — changed to `ritzbuilders.com` and made configurable
2. **Page registry wiring**: `candidates.ts` loads `pages.json` into `Map<url, PageEntity>` for `classifyEvidenceTier` snapshot_verified lookups
3. **Citation evidence integration**: `candidates.ts` loads `page_to_topics` from `citation-evidence-index.json` and applies +12 score bonus to content-matching candidates whose pages are cited for the event's topic
4. **Evidence tier UI**: `MatchFactors` component now renders evidence tier label with color across all 6 callsites
5. **Score-snapshot enhanced**: now uses page registry for tier distribution; reports citation support metrics

### Before/After Results

| Metric | Post-Phase-2 | Post-Phase-4 | Change |
|--------|-------------|-------------|--------|
| Auto-resolved events | 13/45 | 13/45 | maintained |
| Needs-review events | 32 | 32 | maintained |
| Needs-review candidates | 98 | 77 | -21% |
| Suppressed candidates | 74 | 95 | +28% |
| Max score | 85 | 100 | evidence tier exact unlocked |
| Mean score | 53.3 | 58.7 | +10% |
| Evidence tier "exact" reachable | no | yes (14 changes, 77 candidates) | FIXED |
| Citation evidence in scoring | no | yes (71 candidates supported) | NEW |
| Evidence tier in UI | no | yes (all callsites) | NEW |

### New Diagnostics
- **Citation-supported candidates**: 71/200 (36%) — their pages are cited for the event's topic
- **Citation-supported + no-topic**: 15 candidates — pages cited but changelog descriptions too vague for topic match
- **Evidence tier distribution (changes)**: exact 16%, probable 46%, weak 38%
- **Evidence tier distribution (candidates)**: exact 39%, probable 37%, weak 25%
- **Pages in registry**: 5,297 (42 owned)
- **Citation page-topics entries**: 5,253

### What this means
- Evidence tiers are now fully operational in the live attribution flow
- The "exact" tier is achievable and correctly requires both structural URL and page registry match
- Citation evidence provides a new topic-adjacent signal without disrupting triage stability
- The 15 citation-supported but no-topic candidates identify the biggest near-term changelog quality opportunity
- Suppressed candidates increased from 74 to 95 due to better scoring separation

### Build Verification (Phase 4)
- `npx next build` passes clean
- TypeScript: no errors
- All pages compile and generate successfully
- `score-snapshot.ts` runs successfully with page registry and citation evidence

---

## 2026-04-09 — Phase 5: Change Impact Engine

### What shipped
- **`src/domains/attribution/change-impact.ts`** — derives per-change **impact confidence** (high/medium/low), **direction** (positive/negative/mixed/none from outcome event mention context), **why** (multi-sentence explanation), **next action** (operator recommendation) from existing `ScorecardRow` data
- **Types** — `ChangeImpact`, `ImpactConfidence`, `ImpactDirection`; `ChangeVerdict` extended with `negative` (badge + filters; scorecard does not yet emit it until decline events exist)
- **UI** — `/changes`: impact snapshot strip, confidence badge, “What to do” column; `/changes/[id]`: Impact assessment section

### Constraints honored
- No persistence or schema changes; no changes to attribution scoring weights or `computeScorecard` verdict logic

### Build verification (Phase 5)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes build

---

## 2026-04-09 — Phase 6: Measurement Honesty (URL + Decline)

### What shipped
- **URL normalization** in `matchUrl` (`compute.ts`): `normalizePageUrl` + `canonicalizeOwnedUrl` replace raw string comparison. Handles path-only, full URLs, legacy domains, UTM strip, www/m prefix.
- **Decline event detection** in `events.ts`: `visibility_lost` (mentions → 0 after gap) and `mention_decline` (sharp rate drop). Symmetric to existing positive events.
- **Scorecard negative verdict** (`scorecard.ts`): when all linked events are negative + change is primary → `negative`
- **Impact Engine** (`change-impact.ts`): direction uses event type system; explanation distinguishes negative from positive
- **UI labels**: review + changes detail pages display new event types with danger styling

### Constraints honored
- No persistence changes, no new tables, no scoring weight changes
- Existing positive event detection unchanged
- Build, tests, parity all pass

### Build verification (Phase 6)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes build

---

## 2026-04-09 — Phase 7: Today Decision Surface

### What shipped
- **Today page (`/`)** now renders top 5 change impact signals from `enrichWithImpact`
- Server component (`page.tsx`): sorts by verdict priority + confidence + score, filters out `too_early`/`pending`/zero-event rows
- Client component (`today-client.tsx`): `TodayImpactItem` type; "Change impact signals" section with verdict dots, confidence badges, next-action text, score/event counts
- Validated/negative changes get colored borders for instant triage

### Constraints honored
- No persistence changes. No new data computation — reuses existing `enrichWithImpact`. No changes to scorecard or attribution logic.

### Build verification (Phase 7)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes build

---

## 2026-04-09 — Phase 8: Recommendation Engine

### What shipped
- **`src/domains/product/recommendation-engine.ts`** — synthesis engine connecting proven impact to structural page gaps
- Three recommendation types: **replicate** (apply proven pattern to similar page), **strengthen** (improve weak changelog entry), **investigate** (flag negative impact regression)
- Pattern matching: proven change URL -> mined pattern source pages -> playbook briefs for other pages with same gap
- "Strengthen" nudges identify specific gaps (no URL, no topic, no hypothesis) and suggest the topic from linked events
- Fallback: top playbook briefs when no proven patterns exist

### Today page integration
- `page.tsx` calls `computeRecommendations`, passes top 5 to client
- High-confidence replicate recommendation becomes first "Next best move" candidate (proactive, not reactive)
- `today-client.tsx` renders "Recommended moves" section with type-colored cards, confidence badges, evidence summaries

### Constraints honored
- No persistence changes, no new stores, no scoring formula changes
- Pure synthesis of existing data: scorecard, impact rows, mined patterns, playbook briefs
- No changes to attribution logic, evidence tiers, or triage

### Build verification (Phase 8)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 9: Priority Engine

### What shipped
- **`src/domains/product/priority-engine.ts`** — 6-dimension scoring (impact confidence, evidence strength, pattern strength, replication potential, type urgency, recency) producing 0-100 priority score per recommendation
- Four buckets: CRITICAL (>=72), HIGH_LEVERAGE (>=50), OPPORTUNISTIC (>=25), NOISE (<25, filtered)
- `rankAndSelect()` picks single primary action + ranked secondary list
- Per-action expected outcome text (visibility improvement / evidence upgrade / loss prevention)

### Today page enforcement
- "DO THIS NOW" block replaces "Next best move" when primary action exists
- Visually dominant: bold border colored by bucket, priority score badge, "Why" + "Expected outcome" sections, bold CTA
- Secondary recommendations collapse into "Other opportunities (N)" toggle — reduces decision paralysis
- Graceful fallback: when no primary action qualifies, existing next-best-move logic renders unchanged

### Also modified
- `src/domains/product/recommendation-engine.ts` — added `patternId` and `citationOpportunity` to `BeaconRecommendation` for priority context

### Constraints honored
- No persistence changes, no new stores, no scoring formula changes
- No changes to attribution logic, evidence tiers, or triage
- Existing recommendation engine logic unchanged; priority engine is a pure post-processing layer

### Build verification (Phase 9)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 10: Changes Detail Action Generation

### What shipped
- **`/changes/[id]`** now runs the full recommendation engine and surfaces change-specific actions inline
- Validated/partial + positive changes: **"Apply this pattern"** section listing specific target pages (up to 6) with the same structural gap, citation counts, and deep links to Website
- Weak-evidence changes with linked events: **"Strengthen this entry"** section showing specific missing fields (URL, topic, hypothesis) and suggested topic from event data
- Full pipeline: `enrichWithImpact` → citation map → `minePatterns` → `generateBriefs` → `computeRecommendations` → filter by `sourceChangeId`

### Constraints honored
- No new modules, no new types, no new stores, no scoring formula changes
- Today page unchanged, Changes list unchanged, recommendation engine unchanged
- Pure surfacing of existing intelligence on an existing page

### Build verification (Phase 10)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 11: Recommendation Feedback Loop

### What shipped
- **`src/domains/product/recommendation-tracker.ts`** — retroactive matching of changes to recommendation patterns
- Core logic: if proven change A for pattern P existed before change B (same pattern, different page), then B was likely fulfilling a Beacon recommendation
- Per-pattern track record with success rate: (validated + partial) / (total - tooEarly - pending)
- `wasChangeRecommended()` helper for per-change lookups

### Priority engine reinforcement
- 7th scoring dimension: pattern track record (-5 to +10 bonus)
- Patterns with >=70% historical success rate get +10 boost; poor patterns with negatives get -5 penalty
- Minimum 2 acted-on changes required to activate (prevents noise)

### Surface integration
- Today page: "Beacon track record" line showing N acted on, M validated, success rate %
- `/changes/[id]`: "Beacon recommended" badge with match confidence and pattern name

### Constraints honored
- No new persistence, no new stores, no new tables
- Recommendation engine logic unchanged
- Attribution scoring unchanged
- Pure computation from existing scorecard + pattern data

### Build verification (Phase 11)
- `npm run check`, `npm run test`, `npm run data:parity` — pass; 17/17 routes, 26/26 tests, 15/15 parity

---

## 2026-04-09 — Phase 12: Changes List Intelligence Surface

### What shipped
- **`/changes/page.tsx`** — server-side enrichment: pattern mining + brief generation + track record computation + per-change intelligence map
- **`scorecard-client.tsx`** — "Beacon" badge (with confidence qualifier), "N replicable" badge, "Beacon recommended" toggle filter, "Impact" sortable column
- Impact snapshot strip: Beacon-recommended count + total replication targets

### What was NOT touched
- Recommendation engine, priority engine, recommendation tracker: all unchanged
- Attribution scoring unchanged
- Today page unchanged
- Change detail page unchanged
- No new modules, no new domain types, no new stores or persistence

### Constraints honored
- No new persistence, no new stores, no new tables
- Pure surfacing of existing intelligence computations on the changes list page
- Existing table structure preserved; new badges are additive, not replacing existing columns

### Build verification (Phase 12)
- `npm run check` — pass (tsc --noEmit clean)
- Lints: clean on both modified files

---

## 2026-04-09 — Phase 13: Recommendation Response

### What shipped
- **`src/domains/product/recommendation-response-store.ts`** — new json-store persistence for operator responses to recommendations
  - Types: `RecommendationResponse`, `RecommendationResponseStatus` (accepted/dismissed/deferred)
  - `recordResponse()`: upserts response, sets 7-day deferUntil for deferred
  - `isRecSuppressed()`: returns true for dismissed or not-yet-due deferred
  - `getResponse()`: lookup by recId
- **`src/app/(shell)/recommendation-actions.ts`** — server action `respondToRecommendation(recId, status)`
- **Today page** (`page.tsx`): filters suppressed recs before `rankAndSelect`; adds `id` + `responseStatus` to serialized primary action and secondary recs; passes `onRespondToRec` callback to client
- **Today client** (`today-client.tsx`): Accept/Not now/Dismiss buttons on primary action; Accept/Not now/Dismiss buttons on secondary opportunities; "Accepted" badge; action message feedback

### What was NOT touched
- Recommendation engine: unchanged
- Priority engine scoring: unchanged
- Recommendation tracker retroactive matching: unchanged
- Attribution scoring: unchanged
- Changes list page: unchanged
- Change detail page: unchanged
- No Supabase schema changes

### Constraints honored
- One new json-store (`recommendation-responses`) — minimal persistence, follows existing pattern
- All response logic is additive; no existing behavior modified
- Dismissed/deferred filtering happens before ranking, not inside the engine

### Build verification (Phase 13)
- `npm run check` — pass (tsc --noEmit clean)
- Lints: clean on all 4 modified/new files

---

## Phase 14 — Daily Surface Compression + Visibility Story (2026-04-09)

### What shipped
- **Visibility summary strip**: total citations with trend %, per-platform breakdown, data freshness indicator with stale-data warning
- **Navigation compression**: 2 groups (5 primary, 5 advanced). Competitors promoted. Work + Experimental groups removed.
- **Impact signals reduced** from 5 to 3, renamed "What changed"
- **Work queue collapsed** by default
- **System details collapsed** by default (crawl, visibility sample, attribution, verified fixes)
- **Today layout reordered**: Visibility strip → DO THIS NOW → Track record → What changed → Other opportunities → Work queue (collapsed) → System details (collapsed)

### What was NOT touched
- Attribution engine, recommendation engine, priority engine unchanged
- Supabase schema unchanged
- Import pipeline unchanged
- All domain modules unchanged
- Changes / Pages / Competitors surfaces unchanged
- No new persistence, no new modules, no new stores

### Constraints honored
- Zero new infrastructure
- Zero new data systems
- Pure surface-level restructuring using existing computed data
- All existing intelligence preserved, just better hierarchied

### Build verification (Phase 14)
- `npm run check` — pass (0 errors, 71 warnings — all pre-existing)
- Build: 17/17 static pages generated

---

## Phase 15 — Import Simplification + Freshness Loop (2026-04-09)

### What shipped
- **Coverage strip** on Import page: result count, change count, date range, freshness
- **Drag-and-drop upload zone** with clear delta messaging
- **Delta-aware result**: new vs updated counts for results + changes, post-import date range
- **Return-to-Today CTA** (was "Open Review Queue")
- **Advanced sections collapsed**: Profound CSV, Manual paste, Reset, History behind toggle
- **Page title**: "Import" (was "Import Historical Data")
- **New server action**: `getDataCoverage()` for coverage data
- **Enhanced type**: `WorkbookImportResult.delta` for new-vs-updated tracking

### What was NOT touched
- Import engine, workbook parser, Profound pipeline unchanged
- Attribution, recommendation, priority engines unchanged
- Supabase schema unchanged
- All domain modules unchanged
- Today, Changes, Pages surfaces unchanged

### Constraints honored
- Zero new infrastructure
- Zero new data systems or persistence
- Existing import behavior preserved; UX-only restructuring + delta tracking addition

### Build verification (Phase 15)
- `npm run check` — pass (0 errors, 71 pre-existing warnings)
- Build: 17/17 static pages generated

---

## Phase 16 — Page Intelligence Surface (2026-04-09)

### What shipped
- **Summary strip**: total pages, winning (green), needs action (red), building (blue), cited count + total citations, structure warnings (pages missing FAQ/schema)
- **Health card** at top of detail panel: status badge, citation count + platforms, FAQ/Schema health, next action block
- **Structure health in list items**: "no FAQ" / "no schema" visible in page list
- **Evidence internals** moved into "Show details" progressive disclosure
- **Page title**: "Pages" / "Page-level AI visibility health and actions"
- **7 lint warnings resolved**: previously unused summary stat variables now consumed

### What was NOT touched
- Page computation logic (770-line server) unchanged
- Attribution, recommendation, priority engines unchanged
- Import pipeline unchanged
- Supabase schema unchanged
- All domain modules unchanged
- Fix brief, playbook brief, wave, verification functionality preserved

### Constraints honored
- Zero new infrastructure or persistence
- Pure rendering restructure of existing computed data
- All existing functionality preserved in progressive disclosure

### Build verification (Phase 16)
- `npm run check` — pass (0 errors, 64 warnings — down from 71, 7 resolved)
- Build: 17/17 static pages generated

---

## Phase 17 — Competitive Clarity Surface (2026-04-09)

### What shipped
- **Competitive summary strip**: AI share %, citation count, tracked competitor count
- **Ranked competitor list**: sorted by citations, "Ahead of you" badges, links to detail
- **Competitive gap visualization**: "Where you are strongest" (green bars) vs "Biggest competitive gaps" (red bars)
- **Weakest areas card**: topics with lowest share
- **Next moves**: action links derived from benchmark
- **Settings collapsed**: universe CRUD + imported entities behind toggle
- Wired `computeMarketBenchmark` from `builder-benchmark.ts` (previously unused on this surface)

### What was NOT touched
- Competitor detail page (`/competitors/[id]`) unchanged
- Competitor domain modules (16 files) unchanged
- Attribution, recommendation, priority engines unchanged
- Import pipeline unchanged
- Supabase schema unchanged
- All other surfaces unchanged

### Constraints honored
- Zero new infrastructure or persistence
- Reused existing `computeMarketBenchmark` computation (zero new scoring logic)
- Configuration/management functionality preserved in collapsed settings

### Build verification (Phase 17)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 18 — Track Record Enhancement (2026-04-09)

### What shipped
- **`SignalTier`** type on `TrackedOutcome`: `"explicit"` (operator accepted the rec for this page) vs `"inferred"` (retroactive pattern matching)
- **`computeTrackRecord` enhanced**: accepts optional `responses` + `recommendations`; bridges rec IDs to pattern IDs; maps accepted target pages to explicit outcomes
- **`PatternTrackRecord` enhanced**: `explicitAccepted`, `explicitDismissed` per pattern
- **`TrackRecordSummary` enhanced**: `totalExplicitAccepted`, `totalExplicitDismissed`
- **Priority engine enhanced**: explicit acceptance bonus (+2/+4), explicit dismissal penalty (-3/-7), dismissal penalty applies without actedOn threshold
- **Today surface**: track record line shows accepted/dismissed counts

### Signal flow
1. Accept/dismiss on Today → recommendation-response-store (already existed)
2. `computeTrackRecord` receives responses + recommendations (new)
3. Accepted recs bridged to patterns via recId → patternId (new)
4. Outcomes on accepted target pages tagged `signalTier: "explicit"` (new)
5. Per-pattern explicit counts flow into priority scoring (new)
6. Dismissed patterns penalized in priority scoring (new)

### What was NOT touched
- Recommendation engine unchanged
- Recommendation response store unchanged
- Import pipeline unchanged
- Supabase schema unchanged
- All surfaces except Today track record line unchanged
- `/changes` and `/changes/[id]` continue working with optional params

### Constraints honored
- Zero new infrastructure or persistence
- New tracker params are optional — backward compatible
- Explicit signals strengthen existing loop, no new scoring system

### Build verification (Phase 18)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 19 — Multi-Dimensional Recommendation Expansion (2026-04-09)

### What shipped
- **4 new recommendation types**: `strengthen_structure` (cited pages missing FAQ/schema), `improve_internal_links` (cited pages with <5 links), `refresh_content` (cited but thin content), `competitive_displacement` (topics where competitors have ≥2x our share)
- **Evidence-gated generation**: each type requires citation minimums + structural gaps; capped at 2-3 per type
- **Priority engine**: new urgency weights (competitive: 12, structure: 10, refresh: 8, links: 6)
- **Expected outcome generation** for all 4 new types
- **Today accent colors**: structure/links = blue, refresh = yellow, competitive = red
- **Client types widened**: `type` field accepts any rec type string (forward-compatible)
- **Today server**: wires `pageSnapshots`, `citMap`, `citationEvidenceIndex` into rec engine

### Anti-spam design
- Recommendations require real evidence (citations + gaps), not templated cloning
- Each type capped to max 2-3 recs
- City/service expansion remains one class among seven
- Refinement types prioritized over net-new page creation

### What was NOT touched
- Existing replicate/strengthen/investigate logic unchanged
- Recommendation tracker unchanged
- Response store unchanged
- Import, Supabase, persistence unchanged
- All surfaces except Today (rec display + accent colors)

### Constraints honored
- Zero new infrastructure or persistence
- New rec inputs are optional — backward compatible for `/changes/[id]` callsite
- All new logic is evidence-grounded and capped

### Build verification (Phase 19)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 20 — In-App Trust Layer + Evidence Explainability (2026-04-09)

### What shipped
- **DO THIS NOW evidence block**: evidence basis, confidence level + reason, data freshness, "after acting" watch guidance
- **Confidence reasons**: computed from evidence tier, citation count, pattern track record success rate
- **Watch-after guidance**: per-type instructions for post-action monitoring
- **Data freshness**: "Based on data through [date]" displayed on primary action
- **Secondary rec evidence**: inline evidence + confidence reason
- **Pages status reason**: `statusReason` explains why a page is Winning/Building/Unresolved/Dormant

### What was NOT touched
- Recommendation engine, priority engine unchanged
- Tracker, response store unchanged
- Import, Supabase, persistence unchanged
- Competitor surface, changes surfaces unchanged

### Constraints honored
- Zero new infrastructure or persistence
- Trust primitives derived entirely from existing computed data
- Progressive disclosure maintained — summary first, evidence on demand

### Build verification (Phase 20)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 21 — Topic-Similarity / Adjacent Opportunity Expansion (2026-04-09)

### What shipped
- **`cross_page_pattern`**: proven structural pattern on page type A → apply to different page type B with shared topic/term overlap. REQUIRES different page types (anti-spam).
- **`topic_cluster_gap`**: topic with ≥15 owned citations but only transactional pages → recommends guide/comparison content.
- **Priority engine**: cross-page urgency 7, cluster gap urgency 5
- **Expected outcome + watch-after** for both types
- **Today accent colors**: cross-page = green, cluster gap = blue
- **`allPages`** wired into recommendation engine

### Anti-spam design
- `cross_page_pattern` requires DIFFERENT page types — cannot produce city→city clones
- `topic_cluster_gap` recommends MISSING content types, not more of what exists
- Capped at 3 + 2 recs. Citation evidence thresholds enforced.
- Recommendation system now spans 9 types across structure, links, content, competitive, adjacency, and cluster dimensions

### What was NOT touched
- Existing 7 rec types unchanged
- Tracker, response store unchanged
- Import, Supabase, persistence unchanged
- All surfaces except Today unchanged

### Constraints honored
- Zero new infrastructure or persistence
- New rec input (`allPages`) is optional — backward compatible
- Adjacency derived from existing page registry + snapshot terms + citation index

### Build verification (Phase 21)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 22 — In-App Experiment Loop / Watchlist (2026-04-09)

### What shipped
- **`experiment-store.ts`**: `Experiment` type with `testing`/`watching`/`promising`/`inconclusive`/`negative`/`dropped` statuses; `startExperiment`, `updateExperimentCitations` (auto-status), `updateExperimentStatus`, `updateExperimentNote`
- **`experiment-actions.ts`**: server actions for start, update status, update note
- **"Start testing" button**: appears on accepted DO THIS NOW → prompt for operator note → experiment created with citation baseline
- **Watchlist section on Today**: active experiments showing headline, note, status badge, days elapsed, citation delta, watch-after, "Drop" action
- **Auto-outcome detection**: on page load, experiments refresh citation counts; status auto-updates based on delta + time
- **Store**: `.data/experiments.json` via json-store

### Experiment lifecycle
1. Accept rec on Today → "Start testing" button appears
2. Click → enter note → experiment created with citation baseline
3. Watchlist shows on Today between track record and "What changed"
4. On next page load after import: citations auto-refresh, status auto-updates
5. Operator can manually drop experiments

### What was NOT touched
- Recommendation engine, priority engine unchanged
- Tracker, response store unchanged
- Import, Supabase unchanged
- All surfaces except Today unchanged

### Constraints honored
- One new json-store (`experiments`) — follows existing pattern
- Lightweight experiment model — not project management
- Auto-outcome uses existing citation data — no new computation
- "Too early" / "inconclusive" are honest statuses

### Build verification (Phase 22)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Phase 23 — Nightly Usage Hardening (2026-04-09)

### What shipped
- **Combined "Accept & test"**: one-click accepts rec + prompts for note + creates experiment with target data
- **Button hierarchy fixed**: not-accepted state shows Accept & test / Accept only / Not now / Dismiss. Accepted state shows Go → / Start testing / status badge. No dismiss after accept.
- **Target data flows through**: `targetPageUrl`, `targetPagePath`, `baselineCitations` serialized from recommendation data into experiment creation
- **Post-import messaging**: "Your visibility story and watchlist experiments will refresh with the new data"

### Friction points resolved
1. Two-step Accept → Start testing → one combined "Accept & test"
2. "Do it now →" as first CTA → "Accept & test" is now primary
3. "Not now" / "Dismiss" visible after accepting → hidden
4. Experiments started with null target → now captures real page + citations
5. Post-import silent about watchlist → now mentions refresh

### What was NOT touched
- Recommendation engine, priority engine unchanged
- Experiment store model unchanged
- Tracker, response store unchanged
- Import pipeline, Supabase, persistence unchanged
- All surfaces except Today + Import post-import unchanged

### Constraints honored
- Zero new infrastructure or persistence
- Pure friction reduction — no new systems
- All changes are button/flow/messaging improvements

### Build verification (Phase 23)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## QA Hardening Pass (2026-04-09)

### Bug fixed
- **`recHref` routing bug**: function only checked `r.type === "replicate"` before using `targetPageUrl`. All Phase 19/21 rec types (`strengthen_structure`, `improve_internal_links`, `refresh_content`, `cross_page_pattern`) have `targetPageUrl` but are not type `"replicate"`, so "Go →" / "Continue →" linked to wrong destination (generic `/pages` or source change instead of target page). Fixed: check `targetPageUrl` first regardless of type; added `/competitors` fallback for competitive/cluster recs.

### Build verification (QA pass)
- `npm run check` — pass (0 errors, 64 warnings)
- Build: 17/17 static pages generated

---

## Product Premiumization Pass (2026-04-09)

### What shipped
- **Navigation**: Topics→Opportunities, Sample history→History, Draft ideas removed from nav (page still accessible via URL)
- **Today primary action**: raw priority score removed; "Do this now"→"Recommended action"; evidence block compressed from 4 labeled rows to 1 inline confidence line; raw sample count removed from visibility strip
- **Rec type labels**: "Proven pattern"→"Apply pattern", "Strengthen evidence"→"Strengthen", "Competitive gap"→"Close gap", "Cross-page pattern"→"Apply pattern", "Topic cluster"→"Expand"
- **Pages**: verbose description removed; next-move labels: "Doing well"→"Strong", "Needs review"→"Review", "Needs stronger content"→"Strengthen"
- **Changes**: title "What You've Changed"→"Changes"; ops description removed
- **Competitors**: description removed
- **Topics**: "Gap ledger"→"Opportunities"
- **Import**: description removed

### What was NOT touched
- All intelligence logic, domain modules unchanged
- Recommendation engine, priority engine, tracker unchanged
- Experiment store, response store unchanged
- Persistence, Supabase unchanged

### Build verification (Premiumization pass)
- `npm run typecheck` — pass (0 errors)
- Build: 17/17 static pages generated

---

## Master UI/UX research audit + product presentation roadmap (2026-04-09)

### What shipped
- **Documentation only:** Appended **Master UI/UX product shell overhaul — PLANNED** to `docs/master_execution_plan.md` (Shell Phases A–H: design system, nav/IA, Today, Pages, Changes, Competitors/Topics/Review, Import/History/Diagnostics/Expansion, watchlist polish; external reference links; explicit non-goals).
- **Execution pointer:** Updated `docs/NEXT_PHASE_EXECUTION_PLAN.md` with **Master UI/UX product shell overhaul — RESEARCH COMPLETE, IMPLEMENTATION QUEUED** and set **Track 0 (Shell A–H)** as recommended next work before new intelligence tracks.
- **Verified state:** `docs/HANDOFF_VERIFIED_STATE.md` — new row block clarifying research-only status and queued shell phases.
- **Architecture:** `docs/architecture.md` — **Product Direction** nav bullets corrected to match shipped labels (Opportunities, History); added **Presentation layer (planned)** subsection pointing to Shell Phases A–H.

### What was NOT touched
- **Zero application code** (no components, styles, or routes modified).
- No new markdown files.
- Attribution, recommendation, priority, tracker, experiments, import backends, persistence — **unchanged**.

### Constraints honored
- Research + planning pass only; stop point explicit for handoff to implementation agent.
- External claims tied to cited sources (Linear, Stripe, Amplitude, Superhuman, Ramp/Fast Company, etc.).

### Build verification (this pass)
- N/A — docs-only; no `npm run check` required for scope.

---

## Shell Phase A — Design System + Chrome Baseline (2026-04-10)

### What shipped
- **Sidebar chrome recede:** `--sidebar` token darkened slightly (0.985→0.978 light, 0.205→0.175 dark); `--sidebar-foreground` muted (0.145→0.371 light, 0.985→0.708 dark); `--sidebar-border` softened to match `--border-subtle`; group labels changed from `uppercase tracking-widest` to sentence-case `tracking-normal`; inactive items use `text-sidebar-foreground` instead of `text-muted-foreground`; outer border uses `border-sidebar-border`
- **Global border softening:** `--border` lightened from `oklch(0.922)` to `oklch(0.935)` — every `border-border` in the app is now calmer
- **Uppercase purge:** Removed `uppercase tracking-wider` and `uppercase tracking-widest` from **all** route files and shared components (~153 instances across 27 files). Section labels now use sentence-case with normal tracking
- **Typography floor:** `text-[9px] font-semibold` → `text-[11px] font-medium` and `text-[9px] font-bold` → `text-[11px] font-semibold` on Today page (9 instances). Shared components (StatCard, FormField, command palette) labels bumped to `text-xs`/`text-[11px]` from `text-[9px]`–`text-[11px]` with admin modifiers removed
- **PageHeader hierarchy:** title from `text-base` (16px) to `text-lg` (18px); description from `text-[13px]` to `text-sm`; bottom margin from `mb-6` to `mb-8`. Inline `<h2>` titles on Pages and Topics routes matched to `text-lg`
- **StatCard de-admin:** label changed from `text-[11px] font-medium uppercase tracking-wider` to `text-xs text-muted-foreground`; border softened from `border-border` to `border-border/60`; radius from `rounded-md` to `rounded-lg`
- **Header chrome:** bottom border softened with `border-border/50`; stale breadcrumb "Gap ledger"→"Opportunities", "Gap detail"→"Opportunity detail"
- **Vocabulary cleanup:** Layout palette group "Gap ledger"→"Opportunities"; command palette GROUP_ORDER updated to match

### Files changed
- `src/app/globals.css` — sidebar tokens, border tokens
- `src/components/shell/app-sidebar.tsx` — sidebar chrome, labels, borders, semantic colors
- `src/components/shell/app-header.tsx` — border, breadcrumb labels
- `src/components/shell/command-palette.tsx` — group label styling, GROUP_ORDER
- `src/components/data/page-header.tsx` — title size, spacing
- `src/components/data/stat-card.tsx` — label, border
- `src/components/forms/form-controls.tsx` — label
- `src/components/data/entity-link-card.tsx` — label
- `src/components/data/attribution-card.tsx` — label
- `src/components/data/candidate-review.tsx` — labels
- `src/components/data/competitive-landscape.tsx` — label
- `src/app/(shell)/layout.tsx` — palette group name
- `src/app/(shell)/today-client.tsx` — uppercase purge + type floor
- `src/app/(shell)/pages/page.tsx` — title size
- `src/app/(shell)/pages/pages-client.tsx` — uppercase purge
- `src/app/(shell)/changes/page.tsx` — uppercase purge
- `src/app/(shell)/changes/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/changes/scorecard-client.tsx` — uppercase purge
- `src/app/(shell)/changes/change-contract-client.tsx` — uppercase purge
- `src/app/(shell)/competitors/page.tsx` — uppercase purge
- `src/app/(shell)/competitors/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/topics/page.tsx` — title size
- `src/app/(shell)/topics/topics-client.tsx` — uppercase purge + Gap ledger rename
- `src/app/(shell)/topics/opportunity/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/import/page.tsx` — uppercase purge
- `src/app/(shell)/diagnostics/page.tsx` — uppercase purge
- `src/app/(shell)/results/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/review/review-queue-client.tsx` — uppercase purge
- `src/app/(shell)/briefs/proposed/page.tsx` — uppercase purge
- `src/app/(shell)/briefs/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/expansion/page.tsx` — uppercase purge
- `src/app/(shell)/observations/[id]/page.tsx` — uppercase purge
- `src/app/(shell)/actions/actions-client.tsx` — uppercase purge

### What was NOT touched
- Attribution, recommendation, priority, tracker, experiment stores — **unchanged**
- Import pipeline, Supabase, persistence — **unchanged**
- Page-specific content, copy, or information architecture — deferred to Shell Phases B–H
- Navigation grouping / item naming / route URLs — deferred to Shell Phase B
- Today hero structure, CTA consolidation — deferred to Shell Phase C

### Build verification (Shell Phase A)
- `npm run typecheck` — pass (0 errors)
- `npm run build` — pass, 17/17 static pages generated

---

## Shell Phase B — Navigation + IA Alignment (2026-04-10)

### Shipped
1. **Nav group restructure**: “Advanced” → “Data” (Import, Review, History) + “System” (Diagnostics)
2. **Shortcut realignment**: `G P` Pages, `G C` Changes, `G X` Competitors, `G I` Import; removed duplicates (`G S`, `G H`) and ghost (`G E`)
3. **Help panel**: Labels updated to short product names; duplicate/stale entries removed
4. **Page title alignment**: “Sample history” → “History”; “Diagnostics (analyst)” → “Diagnostics”
5. **Vocabulary cleanup**: “Sample history” purged from ~10 user-facing strings; “Gap ledger” → “Opportunities” in remaining surfaces; “Your Website” → “Pages”; “daily workflow” replaces stale references

### Files changed
- `src/lib/navigation.ts` — group structure + labels
- `src/components/shell/app-sidebar.tsx` — NAV_SHORTCUTS
- `src/components/shell/command-palette.tsx` — keyboard routes + help panel
- `src/app/(shell)/layout.tsx` — NAV_SHORTCUTS for palette items
- `src/app/(shell)/results/results-client.tsx` — page title + description
- `src/app/(shell)/diagnostics/page.tsx` — page title + description
- `src/app/(shell)/expansion/page.tsx` — empty-state copy
- `src/app/(shell)/page.tsx` — link label
- `src/app/(shell)/observations/[id]/page.tsx` — link labels (2 instances)
- `src/lib/today-summary.ts` — fallback evidence text
- `src/lib/import/actions.ts` — scope_label strings (2 instances)
- `src/domains/competitors/universe-drift-copy.ts` — user-facing copy
- `src/domains/observations/visibility-read.ts` — scope_label strings (2 instances)

### What was NOT touched
- Attribution, recommendation, priority, tracker, experiment stores — **unchanged**
- Import pipeline, persistence — **unchanged**
- Page-specific content restructuring — deferred to Shell Phases C–H
- Today hero structure — deferred to Shell Phase C

### Build verification (Shell Phase B)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass, all static pages generated
- Linter — 0 errors on modified files

---

## Shell Phase C — Today Content Overhaul (2026-04-10)

### Shipped
1. **Primary action card sculpted**: Removed "Why"/"Expected outcome" labeled blocks; rationale flows as natural prose with inline expected outcome; confidence/freshness/watch-after consolidated into two compact support lines instead of three separate micro-blocks
2. **CTA hierarchy simplified**: "Accept & test" is the dominant button; "Accept only", "Not now", and "Dismiss" are now text links instead of bordered buttons — reduces visual competition
3. **Track record reframed as momentum**: Dropped raw "% success" and dismissed count; shows "N accepted · N acted on · N confirmed positive" — reinforcing, not evaluative
4. **Watchlist tightened**: Proper `text-xs font-semibold` section heading; cards use lighter borders (`border-border/60`); operator note moved below metrics; watch-after text removed from cards (already shown in action card)
5. **"What changed" cleaned**: Asset names raised to `text-[13px]`; default border lightened to `border-border/60`; redundant "All changes →" link removed (nav provides this)
6. **Collapsed sections unified**: All three disclosure toggles (Other opportunities, Work queue, System details) now use consistent `text-[11px] font-medium` with `text-[9px]` triangle
7. **Visibility strip streamlined**: Date range removed (freshness link covers recency); "trend" label dropped from trend indicator; border softened to `border-border/60`
8. **Fallback action card cleaned**: Removed "evidence scope" label and "ObservationRun" link jargon; simplified to headline + evidence text + Go button
9. **Stale vocabulary**: "Website" → "Pages" in queue detail strings (3 instances)

### Files changed
- `src/app/(shell)/today-client.tsx` — all Today hierarchy/structure/CTA/section changes
- `src/app/(shell)/page.tsx` — stale "Website" vocabulary in queue item strings

### What was NOT touched
- `rankAndSelect`, `computeRecommendations`, priority engine — **unchanged**
- Experiment store, track record computation — **unchanged**
- Attribution, import, persistence — **unchanged**
- Other page surfaces (Pages, Changes, Competitors) — deferred to Shell Phases D–H

### Build verification (Shell Phase C)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass, all static pages generated
- Linter — 0 errors on modified files

---

## Shell Phase D — Pages list/detail productization (2026-04-10)

### Shipped
1. **Summary strip**: Larger type, softer border, “strong / need work / mentions”, structure line as neutral copy (without Q&A / without structured data, crawled count)
2. **Toolbar**: “Refresh crawl”, “View run”, filter pills (Needs work · Strong · Active · All) with inverted primary
3. **List**: Wider column, 13px titles, open-item count without uppercase, muted chips for missing Q&A/schema
4. **Detail**: Brief-style header; mention count chip; Q&A + structured data pills; consolidated “Next step”; “Why it matters” / “Recommended move” / “Opportunity”
5. **Actions**: Foreground “Hand off to dev”, “Mark live”, “Verify fix”; “Log in Changes →”
6. **Disclosure**: Renamed “Evidence & technical detail”; duplicate next-move footer removed from expanded area
7. **Fix brief blocks** (inside disclosure): Target / Live page, softer “Intent mismatch”, “Next move” callout
8. **Server**: `statusReason` without “needs review”; dormant copy; Pages subtitle

### Files changed
- `src/app/(shell)/pages/page.tsx`
- `src/app/(shell)/pages/pages-client.tsx`

### Not touched
- Page store, snapshots, guardrails computation, issue/playbook server actions

### Build
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase E — Changes scorecard + contract productization (2026-04-10)

### Shipped
1. **Route** (`changes/page.tsx`): Outcome-first header copy; **At a glance** strip; scorecard above **Records & verification** block.
2. **Scorecard** (`scorecard-client.tsx`): Default-closed **Outcome mix** (verdict counts; avoids duplicating “confirmed in Review” vs page strip); **Refine** controls; shorter column labels; denser rows; softened **Linked** role presentation; long descriptions expandable; **Beacon picks only** filter label.
3. **Records** (`change-contract-client.tsx`): Primary actions first; **How scan check works** collapsed; per-contract compact header with inline **Run check** / re-check; colored one-line verification summary when results exist; goals + line-by-line checks under **Context & check detail**; calmer planned-checks list.

### Files changed
- `src/app/(shell)/changes/page.tsx`
- `src/app/(shell)/changes/scorecard-client.tsx`
- `src/app/(shell)/changes/change-contract-client.tsx`

### Not touched
- Scorecard / impact computation, attribution, recommendations, priority engine, experiments, persistence, change `[id]` detail page (deferred)

### Build verification (Shell Phase E)
- `npx tsc --noEmit` — pass
- `npm run build` — pass (17 routes)

---

## Shell Phase F1 — Competitors page premiumization (2026-04-10)

### Shipped
1. **Header + strip:** Page subtitle; **At a glance** with share, citations, ranking size, count **ahead on raw citations**; observation footnote without repeating list KPIs.
2. **Threats:** **Who leads in citations** as unified table (header row + rows); softer ahead signal; mobile-friendly inline metrics; removed post-list “Your position …” duplicate.
3. **Next moves:** Section moved **above** topic readout; single `divide-y` list with **Open** affordance.
4. **Topic signals:** One **Topic signals** section replacing three separate tinted cards — columns **Where you lead** / **Highest pressure** / **Thinnest share** with shared frame copy.
5. **Settings:** **Universe & data setup** disclosure (chevron); imported entities as divided rows.

### Files changed
- `src/app/(shell)/competitors/page.tsx`

### Not touched
- `computeMarketBenchmark`, citation stores, competitor detail `[id]`, Topics, Review, `competitors-manage-client` behavior (layout copy only via parent)

### Build verification (Shell Phase F1)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase F2 — Opportunities (`/topics`) productization (2026-04-10)

### Shipped
1. **`topics/page.tsx`:** `PageHeader` with product subtitle; **At a glance** strip (topic count, visibility shifts, open Review load, quick wins); competitor-universe / sample framing in collapsible **Workspace & competitor list context**.
2. **`topics-client.tsx`:** Left column **Topics**; per-row gap class shown with **PRODUCT_GAP_HEADLINE** plain labels; detail header uses same map; **Suggested next step** section leads with `evidenceLine` + primary CTA + **Copy plan text**; **How Beacon knows** disclosure (dimensions, provenance, crawl/import links with human labels); **Beacon suggests** one-line rationale; **Full plan, competitors & activity** disclosure contains prior “show details” panels; section chrome renamed (e.g. Strength, Citation winners, Content shape, Execution plan); footer activity line clarified.

### Files changed
- `src/app/(shell)/topics/page.tsx`
- `src/app/(shell)/topics/topics-client.tsx`

### Not touched
- Frontier / gap-ledger computation, package actions, `/topics/opportunity/[id]`, Review

### Build verification (Shell Phase F2)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase F3 — Review specialist productization (2026-04-10)

### Shipped
1. **`review/page.tsx`:** `PageHeader` with specialist framing; **At a glance** (awaiting, quick clears, locked total).
2. **`review-queue-client.tsx`:** Queue title **Open items**, softer borders/labels (**Likely clear / Needs your read / Tight race**); judgment card with **Why Beacon ordered it here** `<details>` (internal reason + score separation); attribution question reframed; lighter primary panel border; candidate cards split so **Match factors** are optional per row; **Leading match**; confidence **Confident / Balanced / Tentative**; **Save decision** primary button; **Platform** quick cause + keyboard help; **Open full result** link; resolved **Locked in Review**; auto-cleared disclosure chevron.

### Files changed
- `src/app/(shell)/review/page.tsx`
- `src/app/(shell)/review/review-queue-client.tsx`

### Not touched
- `computeDecisionability` logic (same strings, new placement), `lockDecision`, triage/scoring domain modules

### Build verification (Shell Phase F3)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase G1 — Import + History measurement coherence (2026-04-10)

### Shipped
1. **`import/page.tsx`:** `PageHeader` with measurement-layer description; short paragraph linking **Import → History → Today**; **At a glance** coverage strip + **Open History** affordance; calmer dashed upload border; post-import success with **Today** + **View History**; advanced section labeled **Advanced paths**; bottom **Import log** with explicit pointer to History for the timeline; Profound CSV and manual success blocks link History as well as Today.
2. **`results/results-client.tsx`:** `PageHeader` reframed as measurement brief; **At a glance** strip (counts, primary run, crawl); **Import** / **Today** cross-links; stale warning visible when applicable; **Runs, stamps & technical notes** and **Competitor sample context** in `<details>`; calmer evidence-scope inset (not warning styling); shorter **StatCard** labels; table first column **Sample row**.

### Files changed
- `src/app/(shell)/import/page.tsx`
- `src/app/(shell)/results/results-client.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- Import server actions, workbook/Profound parsers, `getDataCoverage`, results/history computation, persistence, Diagnostics, Expansion routes

### Build verification (Shell Phase G1)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase G2 — Diagnostics specialist shell (2026-04-10)

### Shipped
1. **`diagnostics/page.tsx`:** **PageHeader** reframed as system specialist brief (purposeful, not dismissive); paragraph linking **Today**, **Review**, **History**, **Import**; **At a glance** strip (`StatCard`: changes, snapshots, outcome events, Review pending); **How to read system metrics** callout; **Recorded / Open** cards with shell-aligned borders; **`DisclosureBlock`** helper for collapsible depth — entity inventory; event type + “changes with evidence” tables; cluster list + status mix; pattern table; expansion candidate sample table; imported change IDs on rows; bundled **stored-ID pair scoring** (confidence, factors, inflation, verdicts, temporal); candidate per-result distribution + score calibration; truth-set evaluation; model factor-lift table; **Event + Review drivers**, **Linkage gaps**, candidate linking headline stats, and **Model gaps & recommendations** (including recommendation list) remain prominent for operational scan.
2. **Chrome:** `StatBlock` uses `border-border/60` / `bg-card`; tables use softer borders; reduced `uppercase` on status/confidence chips where inline; section titles sentence case.

### Files changed
- `src/app/(shell)/diagnostics/page.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- `computeDiagnostics`, `computeCandidateDiagnostics`, `computeModelReport`, stores, Expansion route logic

### Build verification (Shell Phase G2)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase G3 — Expansion quarantine / reframing (2026-04-10)

### Shipped
1. **`expansion/page.tsx`:** **PageHeader** title **Expansion backlog** + explicit non-recommendation framing; operator links to **Today**, **Opportunities** (`/topics`), **Review**, **Import**; **Quarantined surface** callout; **At a glance** `StatCard` row (no adjacent count in hero strip); **Counts by hypothesis shape** `<details>`; backlog sections for **non-adjacent** candidates by model fit + **Pattern gaps**; **low** fit in collapsed section; **all adjacent** in default-closed `<details>` with misuse-risk copy; per-card `<details>` for reasoning, evidence, caveats, pattern, query; expansion-only type strings (**· hypothesis**); methodology in `<details>`; inactive experiment state uses same PageHeader pattern.
2. **`promote-candidate.tsx`:** Optional `actionLabel`, `pendingLabel`, `successLabel` (defaults unchanged for other callers).

### Files changed
- `src/app/(shell)/expansion/page.tsx`
- `src/components/data/promote-candidate.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- `computeOpportunityCandidates`, selectors, `promoteToOpportunity` server behavior

### Build verification (Shell Phase G3)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Shell Phase H — Today watchlist / experiments polish (2026-04-10)

### Shipped
1. **`today-client.tsx`:** **Follow-through** section label + **Experiments on your watchlist** heading and short loop copy; **`WatchlistExperimentCard`** — status as **rounded pill** with human-readable labels; **Day N of watch** + started date; headline + **rec type** label (`REC_ACCENT`) + path (readable, not mono); **Citation readout** block (latest vs baseline, delta, or waiting-for-import); operator note as **Your note**; **`watchAfter`** inside collapsible **What Beacon is watching for**; **Adjust outcome (optional)** `<details>` with buttons for **testing / watching / promising / inconclusive / negative** (calls existing `onUpdateExperiment`) + note that imports may still auto-update status from citations; **Remove from watchlist** replaces inline **Drop**.

### Files changed
- `src/app/(shell)/today-client.tsx`
- `docs/master_execution_plan.md`, `docs/NEXT_PHASE_EXECUTION_PLAN.md`, `docs/HANDOFF_VERIFIED_STATE.md`, `docs/architecture.md`, `docs/VERIFICATION_LOG.md` (append-only phase notes)

### Not touched
- `experiment-store.ts`, `updateExperimentCitations` rules, `experiment-actions.ts`, serialization on `page.tsx`

### Build verification (Shell Phase H)
- `npx tsc --noEmit` — pass
- `npm run build` — pass

---

## Intelligence Expansion — Master Plan Created (2026-04-10)

### What was done
- **Full product plan** written into `docs/master_execution_plan.md`: 10 feature clusters, 30+ features, each with Stage 1/2/3 definitions, upgrade path map
- **Phased execution roadmap** written into `docs/NEXT_PHASE_EXECUTION_PLAN.md`: Phases 24–34 with objectives, dependencies, success criteria
- **Architecture extensions** written into `docs/architecture.md`: 12 new data models, connection graph, persistence pattern, native querying architecture
- **Implementation plan** written into `docs/HANDOFF_VERIFIED_STATE.md`: Phase 24 file-level implementation map

### Feature clusters planned
1. Query Intelligence (native querying, prompt library, prompt mining)
2. Attribution / Genealogy (citation genealogy, citation decay, steal the snippet)
3. Competitive Intelligence (co-mention graph, AI source trust, AEO battlecards, traditional vs AI overlap)
4. Entity / Trust Layer (EntityForge, AI says vs reality, founder authority)
5. Local / Geographic (geographic heat map, neighborhood pulse)
6. Outcome / Learning (outcome database, what-if simulator)
7. Journey / Conversion (custom journey, conversion path scaffold)
8. Structured Data / Delivery (llms.txt, visual readiness, video citation)
9. Visualization / Reporting (election-night viz, share generator, AI pulse notifications)
10. Authority / Founder (Beacon Score, per-model intelligence, training pipeline, adversarial testing, blueprints, Ask Beacon, review mapping, content syndication)

### Execution starting
- **Phase 24** begins immediately: Perplexity client, answer snapshots, prompt library, co-mention graph, outcome store

---

## Phase 24 — Query Foundation + Co-mention + Outcome (2026-04-10)

### Phase 24 — Module 1: Query Foundation — SHIPPED

**Files created:**
- `src/lib/querying/types.ts` — `AnswerSnapshot`, `QueryClient` interface, `SamplingRunConfig`, `CitationRef` types
- `src/lib/querying/perplexity-client.ts` — Perplexity API client: auth, rate limit, response parsing, citation extraction, entity mention extraction
- `src/domains/answer-snapshots/types.ts` — `AnswerSnapshot` domain type re-export
- `src/domains/answer-snapshots/store.ts` — json-store persistence: `appendSnapshot`, `getSnapshotsByPrompt`, `getLatestSnapshots`, `getSnapshotSummary`
- `src/domains/prompts/types.ts` — `LibraryPrompt`, `JourneyStage`, `PromptSource` types
- `src/domains/prompts/journey-stages.ts` — Journey stage auto-classification from prompt text (awareness/consideration/comparison/decision/support/adversarial)
- `src/domains/prompts/prompt-library.ts` — Managed prompt corpus store: `getActivePrompts`, `addPrompt`, `initFromTrackedPrompts`, `getLibrarySummary`

### Phase 24 — Module 3: Co-mention Graph — SHIPPED

**Files created:**
- `src/domains/competitors/co-mention-types.ts` — `CoMentionEntry`, `CoMentionMatrix` types
- `src/domains/competitors/co-mention.ts` — `computeCoMentionMatrix()` from citation cold store, `getAICompetitors()`, `getTopCoMentions()`, cached matrix persistence

### Phase 24 — Module 4: Outcome Store — SHIPPED

**Files created:**
- `src/domains/product/outcome-types.ts` — `OutcomeRecord`, `OutcomeActionType`, `OutcomeSummary` types
- `src/domains/product/outcome-store.ts` — Unified outcome persistence: `recordOutcome`, `resolveOutcome`, `getOutcomesByActionType/Pattern/Page`, `computeOutcomeSummary`, `backfillFromExistingData` (idempotent backfill from rec responses + experiments + scorecard verdicts)

### Build verification (Phase 24 — foundation modules)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all routes)
- `npm test` — pass (26/26 tests)
- No existing files modified
- No routes touched
- No intelligence logic changed

---

## Phase 24 — Wiring (operational integration)

**Date:** 2026-04-10

### Task 1: Sampling Script — SHIPPED

**Files created:**
- `scripts/sample-visibility.ts` — Operational script that loads prompt library (auto-seeds from Profound if empty), calls Perplexity for each active prompt, stores answer snapshots. Supports `--dry-run`, `--limit N`, graceful per-prompt failure, summary totals.

**Files modified:**
- `package.json` — Added `data:sample` npm script

**Verification:**
- Dry-run tested: `npm run data:sample -- --dry-run --limit 3` — 100 prompts auto-seeded from Profound, 3 previewed
- Script compiles and runs cleanly via `npx tsx`

### Task 2: Competitors Co-mention Section — SHIPPED

**Files created:**
- `src/app/(shell)/competitors/co-mention-section.tsx` — Client component: progressive disclosure "AI-era competitors" section showing co-mention domains, strength, discovered/known status

**Files modified:**
- `src/app/(shell)/competitors/page.tsx` — Added co-mention computation (lazy, cached), imported and rendered `CoMentionSection` behind existing benchmark block

### Task 3: Outcome Backfill + Today Wiring — SHIPPED

**Files modified:**
- `src/app/(shell)/page.tsx` — Added idempotent outcome backfill from recommendation responses, experiments, and scorecard verdicts; computes `outcomeSummary`; passes enriched track record to `TodayClient`
- `src/app/(shell)/today-client.tsx` — Extended `TodayTrackRecord` type with `outcomeTotal`, `outcomePositiveRate`, `outcomeAvgDelta`; renders outcome intelligence quietly below existing track record line

### Build verification (Phase 24 — wiring)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- `npm run data:sample -- --dry-run --limit 3` — pass

---

## Phase 25 — Attribution Intelligence (genealogy, decay, trust, rec wiring)

**Date:** 2026-04-10

### Task 1: Citation Genealogy Foundation — SHIPPED

**Files created:**
- `src/domains/attribution/genealogy-types.ts` — `GenealogyMatch`, `GenealogyConfidence`, `PageGenealogyResult` types
- `src/domains/attribution/citation-genealogy.ts` — `computePageGenealogy()`, `computeFullGenealogy()`, `summarizeGenealogy()`. Matches owned citations to page snapshots via URL exact, URL path, title overlap, heading overlap, FAQ overlap. Confidence tiers: high/medium/low/unknown. Never overclaims.

**Confidence limitations:**
- Stage 1 relies on URL matching and structural content overlap (titles, headings, FAQs) from page snapshots
- Does NOT have full page body text for deep content matching
- Does NOT attempt competitor-content genealogy
- Content-based matching limited to URL path tokens vs snapshot metadata
- When no confident match exists, reports "unknown" — does not fabricate

### Task 2: Citation Decay Intelligence — SHIPPED

**Files created:**
- `src/domains/attribution/decay-types.ts` — `CitationDecayResult`, `DecayConfig`, `DecayStatus` types
- `src/domains/attribution/citation-decay.ts` — `computeCitationDecay()` from citation cold store date shards, `getDecayAlerts()`, `summarizeDecay()`. Splits date range into halves, compares owned citation counts per page. Status: stable / soft_decline / meaningful_decline / insufficient_history.

**Files modified:**
- `src/app/(shell)/page.tsx` — Computes decay, passes `decayAlerts` into Today's `nextCandidates` for calm display

**Confidence limitations:**
- Trend detection only, not prediction
- Binary period comparison (earlier half vs recent half) — not a rolling window
- Pages with < 5 citations flagged as insufficient_history
- Does not account for seasonal variation or import timing differences

### Task 3: Source Trust Index — SHIPPED

**Files created:**
- `src/domains/competitors/source-trust-types.ts` — `SourceTrustEntry`, `PlatformTrustProfile`, `SourceTrustIndex` types
- `src/domains/competitors/source-trust.ts` — `computeSourceTrustIndex()` from citation cold store, `summarizeTrustIndex()`. Per-platform domain frequency with owned rank and share.
- `src/app/(shell)/competitors/source-trust-section.tsx` — Client component: progressive disclosure "Source reliance by platform" section with expandable per-platform cards

**Files modified:**
- `src/app/(shell)/competitors/page.tsx` — Computes trust index and renders `SourceTrustSection`

**Confidence limitations:**
- Reflects observed citation frequency, not confirmed algorithmic preference
- Label: "frequently cited by" — not "trusted by"
- Dependent on imported Profound citation data coverage
- Platform attribution relies on prompt-answer-observation joins

### Task 4: Recommendation Wiring — SHIPPED

**Files modified:**
- `src/domains/product/recommendation-engine.ts` — Added `refresh_stale_citation` recommendation type. Only fires for pages with meaningful_decline AND ≥3 recent citations. Added `decayResults` optional parameter.
- `src/app/(shell)/page.tsx` — Passes decay results to recommendation engine
- `src/app/(shell)/today-client.tsx` — Added `refresh_stale_citation` to rec type styling map

**Anti-spam posture:**
- Maximum 2 decay-based recs per computation
- Only fires on meaningful_decline (≥30% drop), not soft
- Requires minimum 3 current-period citations (avoids noise on thin data)
- Skips pages that already have a rec from another source
- Confidence capped at "medium" even for severe drops

### Build verification (Phase 25)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 26 — Entity + Representation Intelligence

**Date:** 2026-04-10

### Task 1: Entity Foundation — SHIPPED

**Files created:**
- `src/domains/entity/types.ts` — `BeaconEntity`, `BeaconEntityType` (brand/person/location/service), `EntitySource`, `EntityIndex`
- `src/domains/entity/entity-extract.ts` — `extractEntities()` from page snapshots (location_terms, service_terms) + site config (brand) + PAO mentions (competitor brands from AI answers). `getOwnedEntities()`, `getExternalBrands()`, `summarizeEntities()`

**Data sources used:**
- Site config → brand name (owned)
- Page snapshots → 14 locations, 13 services (owned)
- Prompt-answer-observations → 1,821 unique mentions (brand entities from 9,596 AI answers)

**Scope limitations:**
- No full knowledge graph
- No cross-platform identity stitching
- No person/founder extraction yet (requires configuration — placeholder type exists)
- No complex entity resolution — simple canonical name deduplication only

### Task 2: AI Says vs Reality — SHIPPED

**Files created:**
- `src/domains/entity/discrepancy-types.ts` — `Discrepancy`, `DiscrepancyType`, `DiscrepancySeverity`, `DiscrepancyReport`
- `src/domains/entity/discrepancy-detect.ts` — `detectDiscrepancies()` from entity index + PAO data + cold store answer texts

**Detection types (conservative):**
- `location_not_in_owned` — AI mentions a location not in owned page data
- `service_not_in_owned` — AI mentions a service not in owned page data
- `brand_omitted` — owned brand absent from ≥15% of relevant AI answers
- `competitor_overrepresented` — competitor appears ≥3× more than owned brand

**Safety measures:**
- Minimum 20 answers required before any analysis runs
- Minimum 3 occurrences per location/service before flagging
- Language: "possible discrepancy", "may be missing" — never "wrong" or "hallucinated"
- Two severity levels: notable (high evidence) and minor (lower evidence)
- Two confidence levels: moderate (≥8 evidence points or ≥100 answers) and limited

### Task 3: Integration — SHIPPED

**Diagnostics (deep view):**
- `src/app/(shell)/diagnostics/page.tsx` — New "Entity & representation intelligence" section at bottom of page with:
  - Entity summary stats (total, owned, locations, services)
  - External brands disclosure (competitor brands found in AI answers)
  - Discrepancy report disclosure with severity-coded cards
  - Calm, structured — no alarm language

**Today (quiet signal):**
- `src/app/(shell)/page.tsx` — Adds notable discrepancies to `nextCandidates` only if notable-severity discrepancies exist. Links to /diagnostics for investigation. Does not appear if data is thin or no notable signals.

**What is NOT surfaced:**
- Minor discrepancies do not appear on Today (only in Diagnostics)
- No new routes created
- No new nav items
- No warning banners or alert systems
- Signals only appear when meaningful

### Build verification (Phase 26)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 27 — Geographic Intelligence

**Date:** 2026-04-10

### Task 1: Geographic Normalization Foundation — SHIPPED

**Files created:**
- `src/domains/geo/types.ts` — `NormalizedCity`, `CityCoverage`, `GeoCoverageIndex`, `GeoConcentration`, `GeoGap`, `GeoHeatEntry`, `GeoHeatMap` types
- `src/domains/geo/normalize.ts` — Deterministic city normalization with alias mapping, metro/sub-region assignment, confidence labeling. ~50 Bay Area cities + region terms. `normalizeCity()`, `normalizeCities()`, `isRegionTerm()`, `getMetro()`

### Task 2: Local Coverage + Gap Intelligence — SHIPPED

**Files created:**
- `src/domains/geo/coverage.ts` — `computeGeoCoverage()` from pages + citation rollups + prompts. Computes per-city owned/competitor pages and citations, share %, coverage status (strong/moderate/weak/absent). `computeConcentration()` with HHI-based assessment. `computeGaps()` for markets with competitor presence and limited owned visibility. `computeGeoHeatMap()` for future heat map data. `summarizeGeoCoverage()` for compact display.

**Data used:**
- Page registry: 5,288 pages across ~50 unique cities (33 owned pages city-tagged, rest competitor)
- Citation evidence index: per-page-and-topic rollups joined to city via page registry
- Prompt library: 5 cities (active prompts)

### Task 3: Geographic Surfacing — SHIPPED

**Today:**
- `src/app/(shell)/page.tsx` — Computes geo coverage, adds gap alert to nextCandidates if markets have competitor presence with limited owned visibility. Links to /diagnostics.

**Competitors:**
- `src/app/(shell)/competitors/page.tsx` — Computes competitor pressure cities, renders `LocalPressureSection`
- `src/app/(shell)/competitors/local-pressure-section.tsx` — Progressive disclosure "Local competitive pressure" showing gap cities with competitor page counts, owned page counts, and status

**Diagnostics:**
- `src/app/(shell)/diagnostics/page.tsx` — Full "Geographic coverage" section with stat cards (markets tracked, strong coverage, gaps, concentration), concentration explanation, expandable city table with owned/competitor pages/citations/share/status, and gap disclosure with per-city explanations

### Task 4: Heat Map Groundwork — SHIPPED

- `GeoHeatEntry` and `GeoHeatMap` types defined in `src/domains/geo/types.ts`
- `computeGeoHeatMap()` function in `src/domains/geo/coverage.ts` produces sorted city-level heat data with strength classification
- No visual heat map built — data shape ready for future integration

### Confidence limitations
- City normalization is hardcoded for Bay Area — extensible but not auto-discovering
- Region terms (bay area, silicon valley) are excluded from city-level analysis to avoid double-counting
- Coverage status thresholds are heuristic (strong ≥50 citations, moderate ≥10, weak <10, absent = 0)
- Concentration HHI is computed only from cities with owned citations — thin coverage may skew
- Gap detection requires ≥5 competitor pages — avoids noise from scattered data
- No geocoding or distance-based proximity — purely name-based matching

### Build verification (Phase 27)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 28 — Journey + Score + Extractability

**Date:** 2026-04-10

### Task 1: Journey Intelligence Foundation — SHIPPED

**Files created:**
- `src/domains/prompts/journey-coverage.ts` — `computeJourneyCoverage()` from prompt library. Computes per-stage prompt counts, pct, status (strong/moderate/weak/absent). Identifies strongest stage, weakest covered stage, absent core stages. Concentration warning if >80% in one stage. Summary assessment string.

**Current data reality:** 92 consideration, 8 comparison, 0 in awareness/decision/support/adversarial. This is a real gap that the system correctly surfaces.

### Task 2: Beacon Score Foundation — SHIPPED

**Files created:**
- `src/domains/product/beacon-score-types.ts` — `ScoreDimension`, `DimensionStatus`, `BeaconScoreResult` types
- `src/domains/product/beacon-score.ts` — `computeBeaconScore()` with 6 independent dimensions: visibility strength (log-scaled citations), coverage breadth (topics + cities + stages), consistency (decay stability rate), competitive position (owned share), representation quality (discrepancy count), local strength (geo presence rate - gap penalty)

**Score integrity:**
- Each dimension independently computed with explicit sufficiency checks
- `insufficient` status produces `null` value — no fake numbers
- Composite only produced when ≥4/6 dimensions are sufficient
- `partial` composite when 3+ dimensions have values but <4 sufficient
- `unavailable` when <3 dimensions have any data
- Summary string always explains the state honestly

### Task 3: Structured Data / Extractability Layer — SHIPPED

**Files created:**
- `src/domains/pages/extractability.ts` — `analyzeExtractability()` per page: 6 factors (FAQ, schema, H2 structure, meta description, word count, direct answers) with weighted scoring. Grade: good/fair/needs_work/poor. Per-page suggestions tied to actual content gaps. `analyzeAllExtractability()` prioritizes high-citation low-score pages. `generateLlmsTxtDraft()` produces draft llms.txt from snapshot data. `summarizeExtractability()` for aggregate stats.

### Task 4: Integration — SHIPPED

**Diagnostics (deep view):**
- Journey stage section: 4 core stage stat cards, assessment summary, missing stage warning
- Beacon Score section: composite display (only if available), dimension breakdown with progress bars, sufficiency labels
- Extractability section: aggregate stats, expandable page-by-page analysis with graded suggestions

**Today (quiet signals):**
- Journey gap: shows absent stages as next-move candidate only when ≥10 active prompts and absent core stages exist
- No score shown on Today (not stable enough yet — composite depends on data sufficiency)

**Pages:**
- No per-page extractability indicator added yet — extractability analysis available in Diagnostics; per-page integration deferred to avoid clutter

### Build verification (Phase 28)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 29 — Competitive Intelligence (battlecards, snippets, signals)

**Date:** 2026-04-10

### Task 1: Competitive Battlecards — SHIPPED

**Files created:**
- `src/domains/competitors/battlecard-types.ts` — `CompetitorBattlecard`, `DimensionComparison`, `BattlecardDimension`, `BattlecardIndex`
- `src/domains/competitors/battlecards.ts` — `computeBattlecards()` from citation index + co-mention + trust index + geo coverage. 5 comparison dimensions: citation share, topic pressure, co-mention frequency, geographic presence, platform reliance. Threat assessment: high/moderate/low. Max 8 cards, min 10 citations to qualify.

**Files created (UI):**
- `src/app/(shell)/competitors/battlecard-section.tsx` — Progressive disclosure "Competitive comparison" section with expandable per-competitor cards showing dimension-by-dimension advantage bars and pressure topics.

### Task 2: Snippet Intelligence — SHIPPED

**Files created:**
- `src/domains/competitors/snippet-types.ts` — `SnippetSignal`, `SnippetSignalType`, `SnippetIntelligence`
- `src/domains/competitors/snippet-intel.ts` — `computeSnippetIntelligence()` from owned extractability + citation index. 4 signal types: owned extractable patterns, extractability gaps, competitor citation context, strengthening opportunities. All signals labeled "grounded" or "inferred."

### Task 3: Stronger Competitive Signals — SHIPPED

Integrated into battlecards and snippet intelligence:
- Strongest competitor by citation count + multi-dimensional comparison
- Competitor pressure by topic (topics where competitor leads)
- Competitor pressure by city (markets with weak owned presence)
- Competitor citation context (topics where competitors dominate 3:1+)
- Extractability comparison (owned page structure vs competitor citation patterns)

### Task 4: Integration — SHIPPED

**Competitors:**
- `src/app/(shell)/competitors/page.tsx` — Computes battlecards from citation index + co-mention + trust + geo. Renders `BattlecardSection` behind progressive disclosure after local pressure.

**Diagnostics:**
- `src/app/(shell)/diagnostics/page.tsx` — New "Content intelligence" section with grounded + inferred snippet signals in separate disclosures.

**Today:**
- `src/app/(shell)/page.tsx` — High-priority extractability gaps added to nextCandidates. Only fires when snippet intelligence finds high-priority signals.

### Confidence limitations
- Battlecard dimensions are computed from imported Profound data — not native answer capture
- Snippet intelligence does NOT scrape competitor pages or extract exact copied text
- "Inferred" signals are labeled as such — reasoned from citation patterns, not directly provable
- Geographic pressure in battlecards uses shared geo gap data — not per-competitor city breakdowns
- Platform reliance shows only the most relevant platform per competitor to avoid noise
- Topic pressure thresholds require ≥5 competitor citations and competitor lead to qualify

### Build verification (Phase 29)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 30 — Advanced Intelligence Scaffolds

**Date:** 2026-04-10

### Task 1: Adversarial Prompt Stress Foundation — SHIPPED

**Files created:**
- `src/domains/prompts/adversarial-types.ts` — `AdversarialCategory` (6 types), `AdversarialPromptTemplate`, `AdversarialReadiness`
- `src/domains/prompts/adversarial.ts` — `seedAdversarialTemplates()` generates 10 templates across 6 categories (negative framing, skeptical comparison, omission pressure, trust challenge, cost scrutiny, alternative suggestion). `assessAdversarialReadiness()` checks library state. No adversarial testing has been performed — scaffold only.

### Task 2: What-If Simulator Foundation — SHIPPED

**Files created:**
- `src/domains/product/whatif-types.ts` — `SimulationActionType` (9 types), `SimulationInput`, `HistoricalEvidence`, `SimulationResult`, `WhatIfReadiness`
- `src/domains/product/whatif-engine.ts` — `computeEvidence()` maps outcome records to action types. `simulateAction()` only reports direction when ≥5 historical outcomes exist. `assessWhatIfReadiness()` checks overall data sufficiency. No fake forecasts — reports "insufficient data" honestly.

### Task 3: Founder Authority Starter — SHIPPED

**Files created:**
- `src/domains/entity/founder-types.ts` — `FounderPresenceStatus` (4 states), `FounderProfile`, `FounderAuthorityResult`
- `src/domains/entity/founder-authority.ts` — `assessFounderAuthority()` checks configured founders (`BEACON_FOUNDER_NAMES` env var) against PAO mention data. Distinguishes: not configured, configured but not observed, observed lightly (<5), observed repeatedly (≥5). No authority scores invented.

### Task 4: Conversion-Path Placeholder — SHIPPED

**Files created:**
- `src/domains/product/conversion-path-types.ts` — `ConversionPathStage` (5 stages: prompt → answer → citation → visit → conversion), `ConversionPathEntry`, `ConversionPathSummary`
- `src/domains/product/conversion-path.ts` — `assessConversionPathReadiness()` honestly reports which stages Beacon can observe (1-3) vs which require external integration (4-5). No fake funnel data.

### Task 5: Training-Data Pipeline Scaffold — SHIPPED

**Files created:**
- `src/domains/product/training-data-types.ts` — `ContentVisibilityChannel` (6 channels), `ChannelReadiness`, `TrainingDataReadiness`
- `src/domains/product/training-data.ts` — `assessTrainingDataReadiness()` checks website pages, structured data, llms.txt, sitemap, social profiles, directory listings. Reports active/partial/missing/unknown per channel. Does not claim to know what models have ingested.

### Integration — SHIPPED

**Diagnostics:**
- `src/app/(shell)/diagnostics/page.tsx` — New "Advanced intelligence readiness" section showing scaffold status for all 5 systems. Each item shows label, readiness status (color-coded), and honest assessment. Founder detail disclosure when configured.

**Today:** No new signals from scaffolds (correct — these are foundations, not active intelligence yet).

### Build verification (Phase 30)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 31 — Visual Intelligence Layer + Pulse + Report Foundation

**Date:** 2026-04-10

### Visual Primitive Components — SHIPPED (10 components)

**Files created:**
- `src/components/viz/score-rail.tsx` — Multi-segment score visualization with composite header. Handles insufficient/partial states with hatched patterns. Hover-interactive per-segment detail. Color-coded thresholds.
- `src/components/viz/stacked-bar.tsx` — Proportional stacked segments per row. Hover reveals segment detail with percentage. Supports custom colors and totals.
- `src/components/viz/rank-ladder.tsx` — Ranked entity list with proportional bars, badges, owned highlighting, hover metadata. Expandable beyond initial visible count.
- `src/components/viz/delta-strip.tsx` — Previous→current change visualization with delta and percentage annotations. Color-coded positive/negative.
- `src/components/viz/platform-split.tsx` — Proportional color strip for platform distribution with interactive legend. Platform-aware colors (emerald=ChatGPT, blue=AI Overviews, violet=Perplexity). Supports owned-position display.
- `src/components/viz/coverage-trellis.tsx` — Small-multiples grid for geographic or categorical coverage. Status-colored chips (strong/moderate/weak/absent) with hover metadata. Built-in legend.
- `src/components/viz/threat-meter.tsx` — 5-segment threat level indicator for competitive cards. Compact mode for inline use.
- `src/components/viz/confidence-badge.tsx` — Reusable confidence/status badge for grounded/inferred/insufficient/partial states.
- (Previously built) `src/components/viz/sparkline.tsx`, `mini-bar-chart.tsx`, `donut-ring.tsx`, `heat-grid.tsx`

### Route Visual Upgrades — SHIPPED

**Today (`today-client.tsx`):**
- Visibility summary upgraded with `PlatformSplit` proportional strip — replaces text-only platform listing
- Track record section replaced with visual `MiniBarChart` showing accepted/acted-on/validated/outcomes bars with hover metadata
- Momentum header with avg citation delta highlight

**Diagnostics (`diagnostics/page.tsx`):**
- Pulse banner at top — aggregated signal summary from all intelligence layers with severity badges and linked events
- Journey stage section now uses `DonutRing` + `MiniBarChart` side-by-side for stage distribution
- Beacon Score section now uses `ScoreRail` — full dimension visualization with insufficient-data hatched patterns
- Geographic section enhanced with `MiniBarChart` for city citations and `CoverageTrellis` for market-at-a-glance grid

**Competitors (`competitors/battlecard-section.tsx`):**
- Battlecard threat badges replaced with `ThreatMeter` visual indicator
- Dimension comparison bars now show proportional owned-vs-competitor fill bars with percentage breakdown

### Report Generator Foundation — SHIPPED

**Files created:**
- `src/domains/product/report-types.ts` — `BeaconReport`, `ReportSection` types
- `src/domains/product/report-generator.ts` — `generateVisibilityReport()`, `generateCompetitiveReport()`, `serializeReport()` for JSON export

### Pulse / Notification Foundation — SHIPPED

**Files created:**
- `src/domains/product/pulse-types.ts` — `PulseEvent`, `PulseEventType` (7 types), `PulseSeverity`, `PulseSummary`
- `src/domains/product/pulse.ts` — `computePulse()` aggregates decay alerts, discrepancies, geo gaps, journey gaps, extractability gaps, and sampling freshness into deduplicated severity-sorted pulse events

### Build verification (Phase 31)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors on all created/modified files

---

## Phase 31B — Maximum Visual Expansion

**Date:** 2026-04-10

### New Visual Primitives — SHIPPED (7 new, 17 total)

| Component | Type | Interaction |
|-----------|------|-------------|
| `AreaChart` | Multi-series area/stacked area with grid | Crosshair hover, series readout, gradient fills |
| `KpiCard` | KPI metric with optional sparkline + delta | Hover border, trend-aware color |
| `ComparisonBar` | Owned-vs-competitor proportional bars | Hover expand, metadata reveal |
| `RadialScore` | Radar/radial polygon for multi-dimensional scores | Hover per-dimension with slide-in detail |
| `ViewToggle` | Segmented control for view mode switching | Pill transition, size variants |
| `FilterChips` | Toggle chip system for multi-select filters | Active/inactive state, label prefix |
| `VizSection` / `ChartTableSection` | Section wrappers with toggle controls | Collapsible, chart↔table toggle built in |

### Route Visual Upgrades — SHIPPED

**Today:**
- KPI grid: 4 `KpiCard` cells (Citations with delta, Mentions, Platforms, Snapshots) replacing single text hero
- Platform distribution: dedicated bordered section with `PlatformSplit`
- Track record: visual `MiniBarChart` momentum bars
- Impact signals: `ConfidenceBadge` replacing text confidence labels

**Diagnostics:**
- Beacon Score: toggleable `Bars` ↔ `Radial` view via `BeaconScoreVisual` client component with `ViewToggle`
- RadialScore shows polygon visualization of all 6 score dimensions
- ScoreRail shows bar visualization with insufficient-data hatching
- Journey stages: `DonutRing` + `MiniBarChart` side-by-side
- Geographic: `CoverageTrellis` grid + `MiniBarChart` city citations
- Pulse banner with severity-coded event links

**Competitors:**
- Battlecard `ThreatMeter` visual indicators
- Dimension comparison proportional fill bars

### Build verification (Phase 31B)
- `npx tsc --noEmit` — pass (0 errors)
- `npm run build` — pass (all 22 routes, static + dynamic)
- `npm test` — pass (26/26 tests)
- 0 lint errors

---

## Abstraction Refactor — Visual + Data Swappability

**Date:** 2026-04-10

### 1. Standardized Chart Prop Interfaces — SHIPPED

**File created:** `src/components/viz/chart-types.ts`

Defines canonical prop interfaces for every chart type: `BarChartProps`, `AreaChartProps`, `DonutChartProps`, `ScoreViewProps`, `ComparisonProps`, `KpiProps`, `CoverageCell`, `RankEntryProps`, `HeatCellProps`, `ThreatLevel`, `ConfidenceLevel`, plus shared primitives (`ChartPoint`, `ChartSeries`).

Any future chart library (Visx, Recharts, D3) implements these same interfaces — consumers don't change.

### 2. Domain View-Model Adapters — SHIPPED

**Files created:** `src/lib/view-models/` (6 files)
- `visibility-vm.ts` — `visibilityKpis()`, `platformDonut()`, `platformBars()`
- `score-vm.ts` — `scoreView()`, `scoreDimensions()`
- `geo-vm.ts` — `geoKpis()`, `cityCoverageCells()`, `cityCitationBars()`, `cityComparisonBars()`
- `journey-vm.ts` — `journeyDonut()`, `journeyBars()`
- `competitors-vm.ts` — `coMentionBars()`, `trustRankEntries()`, `battlecardComparisons()`
- `index.ts` — barrel export

Each function takes domain computation output → returns chart-ready props conforming to `chart-types.ts` interfaces. Routes pass these to any chart implementation.

### 3. Data Source Adapter Interfaces — SHIPPED

**Files created:** `src/lib/data-adapters/` (3 files)
- `types.ts` — 10 adapter interfaces: `VisibilityAdapter`, `GeoAdapter`, `JourneyAdapter`, `ScoreAdapter`, `CompetitiveAdapter`, `EntityAdapter`, `AttributionAdapter`, `OutcomeAdapter`, `SnippetAdapter`, `PulseAdapter` + `BeaconDataAdapters` bundle
- `profound-adapter.ts` — Current implementation: `createProfoundAdapters()` delegates to existing stores with lazy computation caching
- `index.ts` — `getAdapters()` entry point (the swap point)

To swap data sources: create `native-adapter.ts` implementing same interfaces, change the import in `index.ts`.

### Architecture properties established
- **Visual swappability:** Chart components receive standardized props → replace SVG implementations with any library without touching routes or domain logic
- **Data swappability:** Routes call `getAdapters()` → adapters abstract whether source is Profound, native querying, or hybrid → domain computations stay the same
- **View-model separation:** No business logic in chart components, no data shaping in routes → view-model functions handle all transformation
- **Lazy computation:** Adapters cache expensive computations (geo, decay, entity, co-mention) so multiple consumers don't recompute

### Zero regression
- All existing visuals unchanged
- All existing routes unchanged
- All existing data flows unchanged
- `tsc --noEmit` — pass
- `npm run build` — pass (all 22 routes)
- `npm test` — pass (26/26 tests)
- 0 lint errors

---

## 2026-04-10 — Phase 31C: Route visual saturation + documentation checkpoint

### What shipped (UI only; same domain inputs)

| Route / area | Change |
|--------------|--------|
| **Competitors** | `page.tsx`: `KpiCard` strip replaces text-only “At a glance”; leaderboard rows: inline share bar; topic “Thinnest share” uses bar + percent like other columns. |
| **Co-mention** | `co-mention-section.tsx`: `FilterChips` (All / Known / Discovered); `ViewToggle` Table vs Chart; chart mode `MiniBarChart`; table rows: co-mention strength bar scaled to column max. |
| **Local pressure** | `local-pressure-section.tsx`: default chart view `ComparisonBar` (your pages vs competitor pages); `ViewToggle` Chart vs Table. |
| **Source trust** | `source-trust-section.tsx`: expanded source rows include proportional citation bar (owned / comp / neutral coloring). |
| **Pages** | `pages-client.tsx`: top summary → four `KpiCard` + optional `DonutRing` for portfolio status mix (strong / building / follow up / low signal). |
| **History** | `results-client.tsx`: “At a glance” → four `KpiCard`; below: `PlatformSplit` when multiple platforms; `DonutRing` for review-locked vs auto-cleared vs pending when counts exist. |
| **Today** | `today-client.tsx`: system details — crawl block and visibility sample block use `KpiCard` grids; secondary opportunities use `ConfidenceBadge` for confidence. |
| **Diagnostics** | `page.tsx`: `StatBlock` styling aligned with KPI visual language; cluster disclosure “By status” uses `StackedBar`; “Model outcome labels” uses `StackedBar` instead of per-row `Bar` only. |

### Documentation (this checkpoint)

Updated only: `docs/master_execution_plan.md` (new § under surface spec: Phases 24–31C + abstraction), `docs/NEXT_PHASE_EXECUTION_PLAN.md` (Phase 31 shipped vs partial), `docs/HANDOFF_VERIFIED_STATE.md` (31C table + primitive count), `docs/architecture.md` (nav bullets, Phase 31 component table, presentation + swap layers), `docs/VERIFICATION_LOG.md` (this entry).

### Build verification (Phase 31C + docs)

- `npx tsc --noEmit` — pass
- `npm run build` — pass (22 routes)
- `npm test` — pass (26/26)
- No new markdown files created

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

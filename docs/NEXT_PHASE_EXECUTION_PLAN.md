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

## Proposed next (pick one track)

### A — Topic-similarity recommendations
- Cross-topic pattern matching (e.g., "denver roofing" worked → suggest "boulder roofing")
- Requires lightweight topic embedding or keyword clustering

### B — Native visibility sampling
- Replace Profound import with direct Perplexity API sampling
- Fresh data = better attribution = better recommendations = better track records

### C — Track record deterministic enhancement
- Feed explicit acceptance signals from recommendation-response-store into recommendation-tracker to produce higher-confidence track record entries
- Explicitly accepted + later validated = stronger pattern reinforcement than retroactive matching alone

### D — Persistence / infra
- Items in `master_execution_plan.md` post-Phase 3E backlog

---

### Historical: remaining precision opportunities
- 15 citation-supported but no-topic candidates — addressed by "strengthen" recs (Phase 10)
- 1 opportunity in imported data → opportunity clustering mostly inactive

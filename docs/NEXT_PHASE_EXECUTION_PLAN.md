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

## Proposed next (pick one track)

### A — Execution feedback loop
- Track when operator acts on the primary action (new changelog entry matches recommendation target)
- Measure whether recommended changes produce outcome events
- Feed back into priority scoring weights

### B — Changes detail integration
- Show recommendations on `/changes/[id]` ("Based on this change, do X to these pages")
- Show quality nudges on weak-evidence changes inline

### C — Topic-similarity recommendations
- Cross-topic pattern matching (e.g., "denver roofing" worked → suggest "boulder roofing")
- Requires lightweight topic embedding or keyword clustering

### D — Persistence / infra
- Items in `master_execution_plan.md` post-Phase 3E backlog

### E — Native visibility sampling
- Replace Profound import with direct Perplexity API sampling
- Fresh data = better attribution = better recommendations

---

### Historical: remaining precision opportunities
- 15 citation-supported but no-topic candidates — partially addressed by "strengthen" recs
- 1 opportunity in imported data → opportunity clustering mostly inactive

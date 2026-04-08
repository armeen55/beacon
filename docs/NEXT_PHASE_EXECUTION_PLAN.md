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

## Immediate Next: Phase 5 — Change Scorecard Foundation

### Prerequisites (met)
- Attribution precision at 29% auto-resolve (up from 13%)
- Evidence tiers flowing through scoring
- Citation evidence integrated
- Review queue operational

### What to build
- Per-change impact summary: which events followed, which platform/topic moved
- Confidence level per change
- Verdict: validated / partial / inconclusive / no_impact / too_early
- Start from `ChangeVerdictData` type (already exists in attribution/types.ts)
- Do not over-design — start with data model and operator need

### Remaining precision opportunities (before scorecard)
- URL matching: still 100% unknown — would need URL normalization + page registry lookup
- 15 citation-supported but no-topic candidates — changelog quality improvement
- Page discovery (discover.ts) runs as batch — could feed richer page context
- 0 opportunities in data → opportunity clustering inactive

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
- Types: `ChangeImpact`, `ImpactConfidence`, `ImpactDirection`; `ChangeVerdict` includes `negative` (for future decline wiring)
- `/changes` + `/changes/[id]` — operator-facing impact UI (summary strip, badges, “What to do” column, detail assessment block)
- Builds on existing `computeScorecard` — no persistence or attribution scoring changes

---

## Proposed next (pick one track)

### A — Verdict quality + measurement honesty
- Detect **decline / regression** outcome events (or use result deltas) so `negative` verdict and direction are data-backed, not only type-level
- **URL normalization** + page registry lookup → lift `url` match from unknown
- Changelog quality playbook (the 15 citation-supported + no-topic cases)

### B — Opportunity → Change recommendations
- When `opportunities` data exists, surface “do this change next” from gap ledger / frontier output tied to attribution patterns

### C — Persistence / infra (only when intentional)
- Items in `master_execution_plan.md` → **Post–Phase 3E backlog** (topics freshness, import-orchestrator policy, supplementary Postgres, etc.)

### D — Product depth on Changes
- Sort/filter by impact confidence; export or “top 5 actions this week” strip for operators

---

### Historical: remaining precision opportunities (still true)
- URL matching: still largely unknown without normalization + registry
- 15 citation-supported but no-topic candidates — changelog quality
- Page discovery (discover.ts) batch context could feed richer signals
- 0 opportunities in imported data → opportunity clustering inactive

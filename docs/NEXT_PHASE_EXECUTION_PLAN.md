# Beacon Execution Plan — 2026-04-07

## Phase 2: Candidate Pruning + Evidence Tier Wiring — COMPLETE

Auto-resolved: 6 → 13 (+117%). Review candidates: ~196 → 98 (-50%).
See VERIFICATION_LOG.md for full before/after table.

## Immediate Next: Phase 4 — Page Evidence Foundations

## After Phase 2 (if stable)

### Phase 3: Verify + Measure
Run score-snapshot, compare before/after, commit if improved.

### Phase 4: Page Evidence Foundations (NEXT)
- Page discovery (`pages/discover.ts`) and classification exist but have no live consumers
- Citation evidence index (`pages/citation-index.ts`) is built but not wired
- Evidence tiers now flow through scoring — next step is to build page registry
  so evidence tier can reach "exact" (currently impossible without snapshot verification)
- Consider: page inventory for the review queue (show which owned pages are relevant)
- Do NOT build page extraction / crawling yet — focus on using existing data

### Phase 5: Change Scorecard Foundation
- Per-change impact summary: what moved, what didn't, confidence
- Only after attribution precision is trustworthy

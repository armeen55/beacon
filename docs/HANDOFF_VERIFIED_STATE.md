# Beacon Verified State — 2026-04-07

Checkpoint: `beacon-handoff-20260407-1900` on branch `checkpoint/beacon-new-chat-reset-20260407-1900`
Working branch: `work/attribution-precision-20260407`

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
| Evidence tier classification | EXISTS, NOT WIRED | classifyEvidenceTier in pages/evidence-tier.ts |
| Evidence tier scoring caps | EXISTS, NOT WIRED | EVIDENCE_TIER_BONUS/CAP in compute.ts — no callers pass evidenceMeta |
| Page discovery | EXISTS, NOT WIRED | discover.ts, classify.ts — no live consumers |
| Citation evidence index | EXISTS, NOT WIRED | citation-index.ts — no live consumers |

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
| url | 0% | 0% | 0% | 100% |
| geo | 40% | 60% | 0% | 0% |
| temporal | 55% | 18% | 27% | 0% |
| sourceCategory | 50% | 44% | 0% | 7% |

## Problems Identified and Resolved (Phase 2)

| Problem | Status |
|---------|--------|
| 60% of candidates have topic=none | MITIGATED — no-content score cap at 45 |
| 100% url=unknown | ACKNOWLEDGED — data gap, not logic gap |
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

# Beacon Signal Taxonomy — Tier 1.1a

> **PURPOSE:** Foundation document for the Proof layer. Maps every signal class Beacon uses to make operator-facing claims — what each signal actually proves, where it appears, and what must never be said.
>
> **NOT FOR:** Implementation (→ 1.1f–1.1g), competitor trust research (→ 1.1b), methodology shell IA (→ 1.1c).

**Produced:** 2026-04-12  
**Audited files:** `src/lib/beacon-proof-copy.ts`, `src/lib/today-proof-context.ts`, `src/lib/today-proof-serialize.ts`, `src/components/today/how-we-know-panel.tsx`, `src/components/display/confidence-badge.tsx`, `src/domains/results/visibility-provenance.ts`, `src/domains/attribution/types.ts`, `src/domains/attribution/compute.ts`, `src/domains/attribution/scorecard.ts`, `src/domains/attribution/triage.ts`, `src/domains/attribution/change-impact.ts`, `src/domains/attribution/decay-types.ts`, `src/domains/scanning/types.ts`, `src/domains/scanning/detect-findings.ts`, `src/domains/scanning/scan-state.ts`, `src/domains/pages/types.ts`, `src/domains/pages/guardrails.ts`, `src/domains/pages/builder-benchmark.ts`, `src/domains/pages/issues.ts`, `src/domains/pages/citation-evidence-store.ts`, `src/domains/competitors/co-mention-types.ts`, `src/domains/competitors/source-trust.ts`, `src/domains/competitors/battlecards.ts`, `src/domains/competitors/discover.ts`, `src/domains/milestones/types.ts`, `src/domains/product/recommendation-engine.ts`, `src/domains/product/priority-engine.ts`, `src/domains/entity/discrepancy-types.ts`, `src/domains/local-operator/types.ts`, `src/domains/geo/types.ts`, `src/lib/constants.ts`, `src/lib/today-ritual.ts`, `src/lib/today-summary.ts`

---

## Summary

| Metric | Value |
|--------|-------|
| **Signal classes identified** | 14 |
| **Highest-risk claim areas** | Attribution confidence ("Likely caused by"), Market share percentages, Recommendation priority scores |
| **Key ambiguity zones** | Citation sample representativeness (not a census), temporal-correlation-as-causation in attribution, hardcoded competitor name map in benchmark, geo coverage computed from prompts not search volume |

### Three problems the Proof layer (1.1b–1.1j) must resolve

1. **Attribution labels imply causation.** "Likely caused by" (high confidence badge) rests on temporal + topic correlation from a non-exhaustive prompt sample. No A/B test or holdout exists. The label must carry a qualifier or be downgraded to "Strongest correlate."
2. **Market share is share-of-sample, not share-of-market.** `ownedAppearanceRate` is computed from imported citation rows. The UI shows "Your AI Share: X%" with no denominator disclosure. Operators can reasonably interpret this as total market share.
3. **Recommendation "confidence: high" conflates evidence strength with outcome certainty.** The priority engine blends pattern strength, evidence tier, and replication potential into a composite score. The resulting "high confidence" label on a recommendation card suggests the outcome is certain, when it only means the input evidence is strong.

---

## Signal Taxonomy Matrix

### 1. Crawl Findings

| Column | Value |
|--------|-------|
| **Signal class** | Crawl findings (scan-detected HTML changes) |
| **Source artifact** | Two consecutive `PageSnapshot` objects from `.data/page-snapshots.json`, diffed by `diffSnapshots()` |
| **How computed** | `generateFindings()` in `src/domains/scanning/detect-findings.ts` compares current vs previous snapshot per URL. Each diff dimension (title, meta, h1, canonical, FAQ, schema, content, links) produces a typed finding. Priority score elevated by citation count and homepage status |
| **UI surface(s)** | Today → "Since last scan" findings list (`TodayFindings`); Pages → per-page scan verdict & crawl snapshot |
| **User-facing claim** | "Title changed", "Meta description changed", "New issue detected", etc. with severity (high/medium/low) and priority (critical/important/minor/informational) |
| **Allowed claim boundary** | What literally changed in crawled HTML between two snapshots. Factual diff of public page source |
| **Forbidden claim(s)** | ❌ "This change affected your rankings" — findings describe HTML changes, not ranking outcomes. ❌ "Google/AI saw this change" — crawl timing ≠ index timing |
| **Notes** | 15 finding types defined in `FindingType`. `provenanceSummary` is hardcoded: "Compared consecutive full-site HTML snapshots in this crawl batch." The `citationCount` field on a finding is used for priority scoring, not as proof of impact |

### 2. Guardrail Alerts

| Column | Value |
|--------|-------|
| **Signal class** | Page guardrail alerts (structural health checks) |
| **Source artifact** | `PageSnapshot` + optional `PageSnapshotDiff`, computed by `classifyGuardrails()` in `src/domains/pages/guardrails.ts` |
| **How computed** | Deterministic rules on snapshot fields: noindex check, canonical mismatch, HTTP status, FAQ/schema regression, thin content, missing h1/title. Citation count used as a weight (≥50 triggers "high citation" warnings) |
| **UI surface(s)** | Pages → per-page issue cards and status badges; Today → "New issue detected" / "Issue resolved" findings |
| **User-facing claim** | "Page has noindex", "Canonical URL mismatch", "Lost 2 FAQs", "Only 150 words with 80 citations" |
| **Allowed claim boundary** | Structural observations about the crawled HTML at fetch time. Health warnings based on simple heuristics |
| **Forbidden claim(s)** | ❌ "This issue is hurting your AI visibility" — guardrails describe HTML structure, not ranking impact. ❌ "Adding FAQs will fix your citations" — structural suggestion, not causal promise |
| **Notes** | Severities: `critical`, `regression`, `warning`, `improvement`, `info`. The "weak_structure_high_citations" warning (≥50 cit, no FAQ/schema) is the closest to an impact claim but frames as a gap, not a guarantee |

### 3. Imported Visibility Measurements (Results)

| Column | Value |
|--------|-------|
| **Signal class** | Imported result rows (citation/mention observations from external tools) |
| **Source artifact** | `Result` entities from `.data/results.json` or Supabase `results` table. Originally from Profound CSV/workbook import |
| **How computed** | Raw imported rows. Each row has `platform`, `topic`, `url`, `metric_type`, `metric_value`, `observed_at`, optional `source_system`, `import_batch_id`, `visibility_observation_run_id` |
| **UI surface(s)** | Settings → Data (raw rows); Today → "How we know" panel (row count, sample date range); indirect: feeds citation evidence index, attribution, market benchmark |
| **User-facing claim** | "1,179 results in sample", "through [date]", row-level visibility and citation details |
| **Allowed claim boundary** | What the external measurement tool reported. Beacon relays and aggregates; it did not perform the observation |
| **Forbidden claim(s)** | ❌ "Beacon measured your AI visibility" — Beacon imports; the tool (Profound etc.) measured. ❌ "Complete picture of your visibility" — imported sample, not exhaustive census |
| **Notes** | `resultVisibilityRowLegacyUnstamped()` flags rows missing an observation run id (pre-provenance imports). `visibilitySynthetic` flag on proof context warns when demo/synthetic rows are in play. The sample can lag behind the latest crawl (`visibilityStaleVsCrawl`) |

### 4. Citation Evidence Index

| Column | Value |
|--------|-------|
| **Signal class** | Aggregated citation evidence (per page × topic rollups) |
| **Source artifact** | `CitationEvidenceIndex` from `.data/citation-evidence-index.json`, built from imported results during import |
| **How computed** | Groups result rows by page URL + topic. Counts total citations, owned vs competitor vs directory. Produces `by_page_and_topic` rollups and `by_topic` summaries. `built_at` timestamp records index freshness |
| **UI surface(s)** | Market → competitive rankings and share numbers; Pages → citation counts per page; Today → "How we know" panel (citation index built date); Attribution → evidence tier computation |
| **User-facing claim** | Citation counts, topic-level share percentages, "X citations across Y observations" |
| **Allowed claim boundary** | Aggregated counts from the imported sample. Relative share within the sample, not market-wide share |
| **Forbidden claim(s)** | ❌ "Your market share is X%" (without qualifier) — it's share-of-sample. ❌ "You have X total AI citations" — only within the imported prompt set |
| **Notes** | This is the most dangerous signal for false precision. The `trackedCitationObservations` count is the denominator, but it is only shown as "meta" text under KPI cards, not prominently. `built_at` can be stale vs latest crawl — the `visibilityStaleVsCrawl` flag catches this |

### 5. Attribution Scoring

| Column | Value |
|--------|-------|
| **Signal class** | Attribution confidence and causal links between changes and visibility outcomes |
| **Source artifact** | Computed by `src/domains/attribution/compute.ts` from `ChangelogEntry` + `Result` pairs. Stored via `CandidateLink` entities |
| **How computed** | Multi-factor scoring: `platform` match, `topic` match (semantic + city extraction), `url` match, `geo` containment, `temporal` distance, `sourceCategory` match. Each factor → `MatchStrength` (strong/partial/none/unknown). Composite score → confidence threshold: ≥70 = high, ≥50 = medium, ≥30 = low, else uncertain. Role: primary/contributing/supporting |
| **UI surface(s)** | Changes → Scorecard (verdict per change); Changes → Attribution tab (candidate links); Today → "How we know" panel (methodology text); `ConfidenceBadge` component |
| **User-facing claim** | "Likely caused by" (high), "Possibly related to" (medium), "Weak connection" (low), "Unclear link" (uncertain) |
| **Allowed claim boundary** | Temporal + topic + URL correlation between a site change and a visibility shift in the imported sample. Best-fit association, not causal proof |
| **Forbidden claim(s)** | ❌ "This change caused your visibility to increase" — correlation only; no holdout, no A/B test. ❌ "Confirmed impact" (unless operator-confirmed via EventDecision) |
| **Notes** | The `beacon-proof-copy.ts` already states: "It shows correlation and best-fit causes, not proof of causation." However, `ConfidenceBadge` label "Likely caused by" for `high` confidence directly implies causation in the UI. This is the #1 trust-critical gap. Evidence tiers (`exact`, `probable`, `weak`, `inferred`) add nuance but are not always surfaced alongside the badge |

### 6. Change Verdicts & Impact

| Column | Value |
|--------|-------|
| **Signal class** | Per-change verdicts and impact assessments on the scorecard |
| **Source artifact** | `ScorecardRow` from `src/domains/attribution/scorecard.ts`, enriched by `computeChangeImpact()` in `change-impact.ts` |
| **How computed** | Verdict: `validated` (operator-confirmed or strong multi-event evidence), `partial`, `inconclusive`, `no_impact`, `negative`, `too_early` (< 14 days), `pending`. Impact confidence: depends on operator confirmations, primary/contributing event count, evidence tier. Direction: positive/negative/mixed/none from event attribution directions |
| **UI surface(s)** | Changes → Scorecard row verdicts, impact badges, "Why" explanations; Changes → Detail page |
| **User-facing claim** | "Validated", "Partial", "Too early to tell", impact direction arrows |
| **Allowed claim boundary** | Assessment based on available attribution evidence. "Validated" means multiple evidence signals align; "too_early" honestly defers judgment |
| **Forbidden claim(s)** | ❌ "Proven ROI" — verdicts reflect evidence alignment, not business-outcome proof. ❌ "This definitely worked" — even "validated" relies on correlation |
| **Notes** | `TrustSource` enum (`operator_confirmed`, `auto_cleared`, `system_primary`, `contributing`, `candidate`, `operator_rejected`) adds important nuance. Operator confirmations are the strongest signal but are still correlational judgments. The `whyExplanation` and `nextAction` strings are generated — their certainty level should match the confidence tier |

### 7. Market Benchmark (Competitive Rankings)

| Column | Value |
|--------|-------|
| **Signal class** | Competitive market position: share, rankings, topic signals |
| **Source artifact** | `MarketBenchmark` from `src/domains/pages/builder-benchmark.ts`, computed from `CitationEvidenceIndex` |
| **How computed** | Aggregates citation counts by domain across topics. `ownedAppearanceRate` = owned citations / total citations × 100. Top competitors filtered (excludes directories like Houzz, Yelp). Per-topic breakdowns: strongest areas, weakest areas, biggest losses. Hardcoded `COMP_NAMES` map for display names |
| **UI surface(s)** | Market → "Your AI Share" KPI, "Your Citations" KPI, "Competitors Tracked", "Ahead of You", topic signals grid, growth opportunities |
| **User-facing claim** | "Your AI Share: X%", "Ahead of You: N", topic-level "You lead" / "Highest pressure" / "Thinnest share" |
| **Allowed claim boundary** | Relative position within the imported citation sample. Directional indicator, not market census |
| **Forbidden claim(s)** | ❌ "Your market share is X%" (unqualified) — share of imported sample only. ❌ "You are #N in the market" — ranking within tracked competitors, not all competitors. ❌ "Competitors beat you" (without scope qualifier) |
| **Notes** | `COMP_NAMES` is hardcoded to specific domains — this doesn't scale and embeds business-specific assumptions. The "Ahead of You" count is meaningful within the sample but can mislead if the sample is small. `trackedCitationObservations` as the observation count is shown in KPI meta text but not prominently enough to prevent misinterpretation |

### 8. Competitor Intelligence (Co-mention, Source Trust, Battlecards, Discovery)

| Column | Value |
|--------|-------|
| **Signal class** | Competitive environment analysis: who co-appears, which sources are relied on, structured comparisons, newly discovered domains |
| **Source artifact** | `CoMentionMatrix` (co-occurrence in AI answers), `SourceTrustIndex` (domain frequency per platform), `BattlecardIndex` (structured comparisons), `DiscoveryResult` (new competitive domains) |
| **How computed** | **Co-mention:** counts co-appearances of owned + competitor domains in the same AI answer from cold-store citation data. **Source trust:** frequency of domain appearance per platform (explicitly documented: "Does NOT claim to know internal model weights"). **Battlecards:** multi-dimension comparison (citations, topics, geo, trust) between owned and each competitor. **Discovery:** surfaces domains in citations not in configured universe |
| **UI surface(s)** | Market → Co-Mention section, Source Trust section, Battlecard section, Discovered Competitors section, Local Pressure section |
| **User-facing claim** | Co-mention strength percentages, "frequently cited by [platform]", per-competitor dimension comparisons, "They beat you in N topics" |
| **Allowed claim boundary** | Patterns observed in the imported citation corpus. Frequency-based, not causal. "Frequently cited" means appears often in sampled answers, not that the AI "trusts" a source |
| **Forbidden claim(s)** | ❌ "ChatGPT trusts [source] more" — frequency ≠ trust or preference. ❌ "This competitor is your biggest threat" (unqualified) — within sample only. ❌ "AI platforms prefer [domain]" — observation of citation frequency, not platform intent |
| **Notes** | `source-trust.ts` has excellent internal documentation: "the label is deliberately conservative: 'frequently cited by' / 'commonly relied on.'" This is a model for other signal classes. Battlecards are factual comparisons but the "suggestedMove" field on discovered domains generates strategic advice that may overstate certainty |

### 9. Geo Coverage

| Column | Value |
|--------|-------|
| **Signal class** | Geographic coverage analysis: city-level presence, gaps, concentration |
| **Source artifact** | `GeoCoverageIndex` from `src/domains/geo/coverage.ts`, computed from page entities, citation rollups, and active prompts |
| **How computed** | Maps pages and citations to cities via `NormalizedCity` matching. Coverage status per city: strong/moderate/weak/absent based on owned page + citation counts vs competitors. `GeoConcentration` (HHI-based) assesses geographic diversity. Gaps identified where competitors dominate |
| **UI surface(s)** | Market → Local Pressure section (cities where competitors outpace); indirect: feeds battlecard geo dimension and local operator surface |
| **User-facing claim** | "Competitor dominated in [city]", "Absent in [city]", concentration assessment (healthy/concentrated) |
| **Allowed claim boundary** | Coverage patterns within the imported prompt set and citation corpus. Cities are derived from prompt topics, not from actual search volume or demand data |
| **Forbidden claim(s)** | ❌ "You have no presence in [city]" (unqualified) — no presence in the sample; actual presence may exist outside tracked prompts. ❌ "Demand is highest in [city]" — prompt frequency ≠ market demand |
| **Notes** | `GeoConfidence` type (high/medium/low) exists on `NormalizedCity` but is not prominently surfaced in the UI. The HHI-based concentration metric is a reasonable heuristic but rests on the sample's geographic prompt distribution, not actual market demand |

### 10. Recommendations & Priority Scoring

| Column | Value |
|--------|-------|
| **Signal class** | Recommended next actions with priority scores |
| **Source artifact** | `BeaconRecommendation` from `src/domains/product/recommendation-engine.ts`, scored by `PrioritizedAction` in `priority-engine.ts` |
| **How computed** | Connects attribution-backed impact to page gaps and patterns. Types: replicate, strengthen, investigate, refresh, competitive displacement, etc. Priority score (0-100 composite): impact confidence (0-25), evidence strength (0-20), pattern strength (0-15), replication potential (0-15), type urgency (0-15), recency (0-10). Buckets: critical ≥72, high_leverage ≥50, opportunistic ≥25, noise <25 |
| **UI surface(s)** | Today → primary action card ("Top move"); Today → "How we know" panel (methodology for top move) |
| **User-facing claim** | "Your top move", action headline with rationale, confidence badge, "Accept & test" workflow |
| **Allowed claim boundary** | Prioritized suggestion grounded in available evidence. "Highest-leverage next step based on what we see," not a guaranteed outcome |
| **Forbidden claim(s)** | ❌ "This will improve your visibility" — suggestion, not guarantee. ❌ "High confidence" on a recommendation (without qualifier) — means strong input evidence, not certain outcome. ❌ "Guaranteed ROI" |
| **Notes** | `beacon-proof-copy.ts` correctly says: "It is a prioritized suggestion, not a guarantee of outcomes." The `expectedOutcome` field on `PrioritizedAction` generates forward-looking predictions that need careful hedging. Lineage bullets in `today-proof-serialize.ts` add useful traceability |

### 11. Milestones / All-Time Highs

| Column | Value |
|--------|-------|
| **Signal class** | Progress markers: peak metrics and new records |
| **Source artifact** | `MilestoneState` from `.data/milestone-state.json`, computed by `src/domains/milestones/compute.ts` from results + citation index |
| **How computed** | Tracks peak values for 9 milestone kinds (citation daily total, 7d surge, platform share peak, topic rank, page citation peak, corpus share peak, competitor lead peak). Events fire only when a peak is newly beaten after initial bootstrap |
| **UI surface(s)** | Today → milestone teaser; Market → "Competitive records" section; Changes → context |
| **User-facing claim** | "New all-time high: [metric]", peak values with `proofSummary` |
| **Allowed claim boundary** | New peak within the imported sample's history. "Best we've seen in your data" |
| **Forbidden claim(s)** | ❌ "All-time best performance" (unqualified) — best within the sample period, which may not cover full history. ❌ "You're winning" — a peak is directional progress, not competitive dominance |
| **Notes** | `proofSummary` field on each peak is a good practice — makes the evidence explicit. Milestone types correctly document themselves: "peaks are grounded in stored results + citation index." Bootstrap logic prevents false milestones on first import |

### 12. Entity Discrepancies

| Column | Value |
|--------|-------|
| **Signal class** | Mismatches between AI-generated answers and operator's actual business facts |
| **Source artifact** | `DiscrepancyReport` from `src/domains/entity/discrepancy-detect.ts`, computed from prompt-answer observations vs business config |
| **How computed** | Compares AI answer content against known business locations, services, and brand identity. Types: `location_not_in_owned`, `service_not_in_owned`, `brand_omitted`, `competitor_overrepresented`. Confidence: `moderate` or `limited` |
| **UI surface(s)** | Diagnostics page; indirect: feeds recommendation candidates |
| **User-facing claim** | "AI answers mention [city] but you don't have a page there", "Brand omitted in N answers" |
| **Allowed claim boundary** | Discrepancies observed between AI answer content and configured business profile. Sample-dependent |
| **Forbidden claim(s)** | ❌ "AI is getting your business wrong" (unqualified) — discrepancy in sampled answers; AI may produce different answers in different contexts. ❌ "Fix this to correct all AI models" |
| **Notes** | `data_note` field on the report is good practice for transparency. Confidence is correctly limited to `moderate`/`limited` (never `high`). `total_answers_checked` as denominator is important context |

### 13. Coverage & Freshness Signals

| Column | Value |
|--------|-------|
| **Signal class** | Data freshness, staleness warnings, coverage tone |
| **Source artifact** | `TodayProofContext` from `src/lib/today-proof-context.ts` + `DataFreshnessStrip` in shell layout. `ScanStateFile` from `src/domains/scanning/scan-state.ts` |
| **How computed** | `crawlAgeDays` from last crawl completion. `crawlStale` = >7 days. `visibilityStaleVsCrawl` = citation index older than last crawl. `CoverageTone`: ok/partial/degraded/critical based on age + staleness thresholds. Scan state: running (with stale detection at 5 min), success, partial, failed |
| **UI surface(s)** | Today → "How we know" panel (crawl date, visibility date, staleness warnings); shell → Data Freshness Strip (last import, last scan); Today → coverage/safety strip; `ScanStatusBanner` |
| **User-facing claim** | "Latest crawl: [date]", "Visibility sample through [date]", coverage tone colors (green/amber/red), "Previous scan appears to have crashed" |
| **Allowed claim boundary** | Factual timestamps and age calculations. Staleness thresholds are heuristic but clearly defined |
| **Forbidden claim(s)** | ❌ "Your data is current" when crawl is >7 days old. ❌ "Everything is up to date" when `visibilityStaleVsCrawl` is true |
| **Notes** | This class is well-implemented. `deriveCoverageTone()` has clear thresholds: >30 days = critical, >14 days + stale = degraded, visibility stale vs crawl = degraded, partial sample = partial. `visibilitySynthetic` flag explicitly warns about demo/synthetic data. The "all clear" on Today (`shouldShowTodayAllClear`) correctly refuses to show when demo mode or stale |

### 14. Local Operator Signals

| Column | Value |
|--------|-------|
| **Signal class** | Local business presence: listings health, review cadence, NAP drift |
| **Source artifact** | `LocalOperatorSurface` from `src/domains/local-operator/surface.ts`, built from optional `.data/local-operator-surface.json` import + geo gaps + citation decay |
| **How computed** | Combines optional imported listing data (`LocalOperatorImport`), computed geo gaps, and citation decay alerts. Presence signals with severity (info/watch/urgent). Review tasks with cadence. `dataSourceNote` explicitly states how the layer is backed |
| **UI surface(s)** | Today → urgent strip (when threshold met); Market → Local Operator Panel; Changes → outcomes hook |
| **User-facing claim** | "Unresponded reviews estimated: N", "NAP drift flags", "Phone mismatch on Yelp" |
| **Allowed claim boundary** | Relayed from operator-imported data or inferred from citation/geo gaps. Estimates and flags, not verified facts |
| **Forbidden claim(s)** | ❌ "Your listings are wrong" (without data) — may be inferred from gaps, not verified against live listings. ❌ "You have N bad reviews" — Beacon has no direct review feed |
| **Notes** | `LocalProof` type correctly distinguishes `observed` vs `inferred` vs `dataGaps` — excellent separation for trust. `stalenessNote` provides honest freshness context. `dataSourceNote` on the surface tells operators exactly what backs the data. This is a trust-model exemplar |

---

## Forbidden Claims List (Consolidated)

This is the single reference list of claims Beacon must never make without explicit qualification. Organized by risk severity.

### Critical (implies false causation or false precision)

| # | Forbidden claim | Why | Signal class |
|---|----------------|-----|--------------|
| F1 | "This change caused your visibility to increase/decrease" | Attribution is correlation-based; no A/B test or holdout | Attribution Scoring |
| F2 | "Your market share is X%" (unqualified) | Share of imported sample, not total market | Market Benchmark |
| F3 | "Beacon measured your AI visibility" | Beacon imports; the external tool measured | Imported Visibility |
| F4 | "This will improve your visibility" | Recommendations are suggestions, not guarantees | Recommendations |
| F5 | "Proven ROI from this change" | Even "validated" verdicts rest on correlation | Change Verdicts |
| F6 | "ChatGPT/Gemini trusts [source] more" | Frequency of citation ≠ trust or preference | Competitor Intelligence |

### High (overstates certainty or scope)

| # | Forbidden claim | Why | Signal class |
|---|----------------|-----|--------------|
| F7 | "Complete picture of your visibility" | Imported sample, not exhaustive census | Imported Visibility |
| F8 | "You are #N in the market" (unqualified) | Ranking within tracked competitors only | Market Benchmark |
| F9 | "Confirmed impact" (without operator confirmation) | System-only evidence is correlational | Attribution Scoring |
| F10 | "You have no presence in [city]" (unqualified) | No presence in sample; actual presence may exist | Geo Coverage |
| F11 | "All-time best performance" (unqualified) | Best within sample period only | Milestones |
| F12 | "AI is getting your business wrong" (unqualified) | Discrepancy in sampled answers only | Entity Discrepancies |

### Medium (misleading framing)

| # | Forbidden claim | Why | Signal class |
|---|----------------|-----|--------------|
| F13 | "This issue is hurting your AI visibility" | Guardrails describe HTML structure, not ranking impact | Guardrail Alerts |
| F14 | "Adding FAQs will fix your citations" | Structural suggestion, not causal promise | Guardrail Alerts |
| F15 | "Google/AI saw this change" | Crawl timing ≠ index timing | Crawl Findings |
| F16 | "Demand is highest in [city]" | Prompt frequency ≠ market demand | Geo Coverage |
| F17 | "High confidence" on a recommendation (without qualifier) | Strong input evidence ≠ certain outcome | Recommendations |
| F18 | "Your data is current" when crawl >7 days old | Staleness rules exist for a reason | Coverage & Freshness |
| F19 | "This competitor is your biggest threat" (unqualified) | Within sample only | Competitor Intelligence |

---

## Existing Trust Controls (What's Already Working)

Beacon already has meaningful trust infrastructure. These controls should be preserved and extended, not replaced:

| Control | Where | Assessment |
|---------|-------|------------|
| `BEACON_METHODOLOGY` static copy | `beacon-proof-copy.ts` | Good — explicitly states "correlation, not causation" for attribution. "Prioritized suggestion, not a guarantee" for recommendations |
| `HowWeKnowPanel` | `how-we-know-panel.tsx` | Good — shows crawl run ids, sample row counts, visibility dates, methodology text |
| `ConfidenceBadge` | `confidence-badge.tsx` | Mixed — labels ("Likely caused by") are too strong for the evidence. See F1 |
| `CoverageTone` | `today-proof-context.ts` | Good — clear thresholds with honest degradation signals |
| `visibilitySynthetic` flag | Proof context | Good — explicitly warns when demo/synthetic data is in play |
| `proofSummary` on milestones | `milestones/types.ts` | Good — makes evidence explicit for each peak |
| `dataSourceNote` on local operator | `local-operator/types.ts` | Excellent — explicitly states data backing |
| `LocalProof` observed/inferred/dataGaps | `local-operator/types.ts` | Excellent — model for all signal classes |
| Source trust documentation | `source-trust.ts` | Excellent — "Does NOT claim to know internal model weights or preferences" |
| `trackedCitationObservations` meta | `builder-benchmark.ts` | Partial — denominator shown in KPI meta but not prominent enough |

---

## Signal Provenance Map (for 1.1f lineage work)

Summary of what provenance metadata exists today vs what's missing:

| Signal class | Has source timestamp | Has run/batch id | Has sample size | Has staleness check | Lineage gap |
|-------------|---------------------|-----------------|----------------|--------------------|----|
| Crawl findings | ✓ `detectedAt` | ✓ `scanRunId` | — (per-page) | ✓ `crawlAgeDays` | No link to observation run in all cases |
| Guardrail alerts | ✓ (via snapshot `fetched_at`) | Partial `observation_run_id` | — | Via crawl staleness | Observation run id optional |
| Imported visibility | ✓ `observed_at` | Partial `import_batch_id` | ✓ `resultsRowCount` | ✓ `visibilityStaleVsCrawl` | `visibility_observation_run_id` often null for legacy imports |
| Citation evidence index | ✓ `built_at` | — | ✓ `total_citations_processed` | ✓ | No link to source import batch |
| Attribution scoring | ✓ `created_at` on link | — | — | ✓ `within_impact_window` | No explicit sample coverage note |
| Change verdicts | ✓ (via change `implemented_at`) | — | — | ✓ `too_early` (<14 days) | No link to attribution run id |
| Market benchmark | ✓ `createdAt` | ✓ `benchmarkId` | ✓ `trackedCitationObservations` | — | No explicit "sample size" warning when count is small |
| Competitor intelligence | ✓ `computed_at` | — | ✓ `total_answers_analyzed` | — | No explicit sample coverage note |
| Geo coverage | ✓ `computed_at` | — | — | — | No link to source prompts; no demand-data caveat |
| Recommendations | — | — | — | ✓ `dataFreshness` in lineage | No explicit source evidence run id |
| Milestones | ✓ `achievedAt` | — | — | ✓ bootstrap check | No link to source result rows |
| Entity discrepancies | ✓ `computed_at` | — | ✓ `total_answers_checked` | — | No link to observation dates |
| Coverage & freshness | ✓ all timestamps | ✓ run ids | ✓ row counts | ✓ all thresholds | Well-covered |
| Local operator | ✓ optional import timestamps | — | — | ✓ `stalenessNote` | Import-dependent; gaps when no import exists |

---

## Next Steps for 1.1b–1.1j

This matrix provides the foundation for:

- **1.1b** — Competitor trust patterns: use signal classes 7, 8 to compare Beacon's claims against industry norms
- **1.1c** — Methodology shell IA: use the UI surface column to map where "How we know" entry points are needed
- **1.1d** — Prompt bank governance: relates to signal class 4 (citation evidence) and 9 (geo coverage) — prompt set defines the sample boundary
- **1.1e** — Confidence & uncertainty copy deck: use the Forbidden Claims list and ConfidenceBadge gap (F1) as the starting point
- **1.1f** — Lineage fields: use the Signal Provenance Map to identify minimum schema additions
- **1.1g** — Wire lineage into top finding types: findings (class 1) and attribution (class 5) are the priority consumers
- **1.1h** — Adversarial FAQ: build from Forbidden Claims list — these are the questions skeptical operators will ask
- **1.1i** — Stale/partial escalation: extend Coverage & Freshness (class 13) state machine
- **1.1j** — Exit gate: checklist derived from this matrix — every class has methodology link + lineage + no forbidden strings

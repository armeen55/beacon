# Adversarial Owner FAQ — Tier 1.1h

> **PURPOSE:** The hardest questions a skeptical operator will ask about Beacon's numbers, answered honestly from Beacon's actual evidence boundaries. This is the proof-layer FAQ — not product help, not marketing copy.
>
> **Grounded in:** `TIER_1_1A_SIGNAL_TAXONOMY.md` (14 signal classes, 19 forbidden claims), `TIER_1_1B_COMPETITOR_TRUST_PATTERNS.md` (industry trust patterns), `TIER_1_1C_METHODOLOGY_SHELL_IA.md` (4-layer progressive disclosure), `TIER_1_1D_PROVENANCE_METADATA_SPEC.md` (21 provenance fields).
>
> **NOT FOR:** Product help docs, feature walkthroughs, onboarding copy, marketing. This FAQ exists so operators can challenge every number Beacon shows — and get a straight answer.

**Produced:** 2026-04-12

---

## 1. Purpose

### What this FAQ is for

This document answers the questions an operator asks when they stop trusting a number. Not "how do I use this feature" — but "why should I believe this number." Every answer is grounded in what Beacon actually knows from its data, not what it hopes the data means.

### Who it serves

A single operator who:
- is deciding whether to act on a Beacon recommendation
- is preparing to defend a Beacon number to a stakeholder, partner, or client
- has noticed something that looks wrong and wants to understand the system's limits
- is experienced enough to know that tools can overstate what they know

### How it differs from general help

- Help docs explain *how* to use Beacon. This FAQ explains *why you should or shouldn't trust what Beacon tells you*.
- Help docs assume good faith. This FAQ assumes skepticism.
- Help docs cover all features. This FAQ covers only the claims where Beacon is closest to the boundary between honest and misleading.

---

## 2. FAQ Design Principles

1. **No fake certainty.** If Beacon doesn't know something, the answer says so explicitly. "We don't know" is a valid answer.
2. **Answer from actual evidence, not aspiration.** Every answer references a specific signal class, data source, or computation from the 1.1a taxonomy. No hand-waving.
3. **Short answer first, proof reference second.** The first sentence gives the direct answer. The rest explains where the answer comes from and what could change it.
4. **Route to methodology when needed.** Deep questions point to `/settings/methodology` sections for full methodology disclosure. The FAQ is a starting point, not the full explanation.
5. **Admit the discipline's limits.** Some answers are constrained not by Beacon's implementation but by the fundamental limits of sampling-based AI visibility measurement. The FAQ says so when that's the case.

---

## 3. Core Adversarial Questions

### Q1. How do you know this actually changed?

**Short answer:** Beacon crawled your site at two points in time and compared the HTML. If a field differs between snapshots, it reports the diff.

**What Beacon actually knows:**
- The literal HTML content of your pages at the time of each crawl (signal class 1: Crawl Findings)
- Which specific fields changed: title, meta description, H1, canonical URL, FAQ count, schema markup, content length, internal links
- The exact timestamp of each crawl run (`detectedAt`, `scanRunId`)

**What Beacon does not know:**
- Whether Google, ChatGPT, or any AI model has seen or indexed this change yet — crawl timing ≠ index timing (forbidden claim F15)
- Whether the change was intentional or accidental
- Who made the change or why

**How Beacon derives this:**
`generateFindings()` in the scan pipeline compares consecutive `PageSnapshot` objects field-by-field. Each difference produces a typed finding with priority scoring. The finding includes a `provenanceSummary` ("Compared consecutive full-site HTML snapshots") and the scan batch `run_id`.

**Where the user can verify it in-product:**
- Today → "Since last scan" findings list (each finding shows the detected timestamp and, when available, a "View observation" link)
- Pages → per-page scan verdict and crawl snapshot diff

**Related signal classes:** 1 (Crawl Findings), 2 (Guardrail Alerts), 13 (Coverage & Freshness)

**If stale / partial coverage changes the answer:** Yes. If the crawl is >7 days old (`crawlStale`), the finding reflects what the site looked like then, not now. The `relativeAge` on each finding shows how old the observation is.

---

### Q2. How do you know this change caused anything?

**Short answer:** Beacon does not know that. It identifies the *strongest correlate* — the best-fit match between a site change and a visibility shift based on timing, topic overlap, URL alignment, and platform. This is correlation, not causation. No A/B test or holdout exists.

**What Beacon actually knows:**
- That a visibility shift (first appearance, mention surge, visibility regained, etc.) occurred at approximately the same time as a site change (signal class 5: Attribution Scoring)
- How closely the change and the shift match on topic, URL, platform, geography, and timing
- A composite score (0–100) and confidence tier (high ≥70, medium ≥50, low ≥30, uncertain <30)
- Whether the operator has manually confirmed the link via EventDecision (the strongest trust signal)

**What Beacon does not know:**
- Whether the change *caused* the visibility shift (forbidden claim F1)
- Whether something else entirely caused it (algorithm update, competitor action, seasonal demand)
- What the outcome would have been without the change (no holdout or control group)

**How Beacon derives this:**
`computeAttribution()` scores multi-factor match strength: platform, topic (semantic + city extraction), URL, geo, temporal distance, source category. Each factor yields a `MatchStrength` (strong/partial/none/unknown). The composite score determines the confidence tier. The `ConfidenceBadge` shows "Strongest correlate" (high) or "Possible correlate" (medium), never "Likely caused by."

**Where the user can verify it in-product:**
- Changes → Detail page → Attribution fit badge with `confidence_basis` explanation
- Changes → Detail page → Event Attribution cards with match factors breakdown
- Changes → Scorecard → per-row evidence tier and trust source

**Related signal classes:** 5 (Attribution Scoring), 6 (Change Verdicts & Impact)

**If stale / partial coverage changes the answer:** Yes. Attribution depends on the imported visibility sample. A small sample (`sample_quality_tier: limited`) means fewer potential matches and lower confidence. A stale sample means recent shifts won't appear.

> **Highest-risk FAQ.** This is the #1 trust-critical question. Maps to forbidden claim F1 and the attribution/causation trust risk identified in 1.1a.

---

### Q3. Why should I trust this percentage?

**Short answer:** Every percentage in Beacon is a share-of-sample, not a share-of-market. The denominator is always the number of tracked observations in your imported data, not the total number of AI queries in the world.

**What Beacon actually knows:**
- How many times your brand was cited in the imported observation set (signal class 4: Citation Evidence Index)
- The total number of observations in that set (`trackedCitationObservations`)
- Your share of that specific sample: `ownedAppearanceRate = owned citations / total citations × 100`

**What Beacon does not know:**
- Your share of all AI-generated answers globally (forbidden claim F2)
- How representative your prompt sample is of actual market demand
- What percentage of AI users ask questions relevant to your business

**How Beacon derives this:**
`MarketBenchmark` in `builder-benchmark.ts` aggregates citation counts by domain from the `CitationEvidenceIndex`. The percentage is a simple ratio with the imported observation count as the denominator.

**Where the user can verify it in-product:**
- Market → KPI strip: "Your Citation Share" shows the percentage with "of N observations" as meta text
- Market → scope line: "Directional — based on your tracked prompt sample, not a market census"
- Market → sample quality tier label (limited / moderate / strong)

**Related signal classes:** 4 (Citation Evidence Index), 7 (Market Benchmark)

**If stale / partial coverage changes the answer:** Yes. A limited sample (<200 observations) means the percentage is volatile — a few new citations can swing it significantly. The `sample_quality_tier` label warns when this is the case.

---

### Q4. Is this market share or just your own sample?

**Short answer:** It is your share within Beacon's imported sample. It is not market share in the traditional sense. No AI visibility tool can measure total market share because no one has access to all AI queries.

**What Beacon actually knows:**
- Your citation frequency within the tracked prompt set (signal class 7: Market Benchmark)
- How you compare to configured competitors within that same sample
- The size and recency of the sample (`trackedCitationObservations`, `sample_quality_tier`)

**What Beacon does not know:**
- The total number of AI-generated answers about your industry (forbidden claim F2)
- Whether your prompt set is representative of actual user behavior
- What happens in prompts, cities, or service categories you haven't tracked

**How Beacon derives this:**
The Market KPI "Your Citation Share" is computed from the citation evidence index, which is built from imported result rows. The UI uses "Citation Share" (not "Market Share") and includes a directional scope note. The sample quality tier interprets the observation count.

**Where the user can verify it in-product:**
- Market → "Your Citation Share" KPI with observation count
- Market → directional scope line
- Market → sample quality label

**Related signal classes:** 4 (Citation Evidence Index), 7 (Market Benchmark)

**If stale / partial coverage changes the answer:** Yes. If visibility data is older than the latest crawl (`visibilityStaleVsCrawl`), the percentages reflect an older state of AI responses.

---

### Q5. What if your data is stale?

**Short answer:** Beacon measures and displays staleness explicitly. When data is old, the UI tells you — through freshness strips, coverage tone warnings, and age indicators on every finding.

**What Beacon actually knows:**
- When the last crawl completed (`crawlCompletedAt`) and how many days ago that was (`crawlAgeDays`)
- When the last import happened (`lastImportAt`)
- Whether the visibility sample is older than the latest crawl (`visibilityStaleVsCrawl`)
- The overall coverage health: ok / partial / degraded / critical (signal class 13: Coverage & Freshness)

**What Beacon does not know:**
- What changed on your site or in AI responses between the last observation and now
- Whether the staleness affects a specific metric more than others

**How Beacon derives this:**
`deriveCoverageTone()` applies clear thresholds: >7 days = stale, >14 days + stale visibility = degraded, >30 days = critical. `DataFreshnessStrip` in the shell layout shows timestamps on every page. Each finding carries a `relativeAge` indicator ("2h ago", "3d ago").

**Where the user can verify it in-product:**
- Shell → Data Freshness Strip (always visible, shows last import and last scan)
- Today → coverage/safety strip with color-coded tone
- Findings → per-finding relative age line
- Market → sample quality tier (accounts for observation volume)

**Related signal classes:** 13 (Coverage & Freshness), 1 (Crawl Findings)

**If stale / partial coverage changes the answer:** This *is* the staleness answer. When `coverageTone` degrades, all other answers become less reliable — and the UI reflects that.

---

### Q6. How many prompts is this based on?

**Short answer:** The exact count is shown as the observation denominator on every percentage metric. The number depends on your imported data — it is not a fixed or guaranteed sample.

**What Beacon actually knows:**
- The total number of imported observation rows (`resultsRowCount` via `TodayProofContext`)
- The total citation observations for market metrics (`trackedCitationObservations`)
- The number of answers analyzed for co-mention analysis (`total_answers_analyzed`)
- The number of citations analyzed for source trust (`total_citations_analyzed`)

**What Beacon does not know:**
- Whether these prompts represent the queries real users actually ask (forbidden claim F7)
- What the margin of error is for your sample size — Beacon has no statistical model for this (unlike TSM GEO which publishes ±7% at 50 queries)
- How many prompts exist globally that are relevant to your business

**How Beacon derives this:**
Observation counts propagate from imported result rows. Each aggregate metric carries its own denominator. The `sample_quality_tier` helper interprets the count: <200 = limited, 200–1000 = moderate, >1000 = strong.

**Where the user can verify it in-product:**
- Market → observation count in KPI meta text
- Market → sample quality tier label
- Today → "How we know" panel (row count, sample date range)
- Settings → Data tab (raw imported rows)

**Related signal classes:** 3 (Imported Visibility), 4 (Citation Evidence Index), 7 (Market Benchmark)

**If stale / partial coverage changes the answer:** Yes. A limited sample means every individual observation has outsized influence on percentages. The sample quality tier warns when this is the case.

---

### Q7. What if the AI answered differently tomorrow?

**Short answer:** It probably will. AI responses are probabilistic — the same prompt can produce different answers on different days, sessions, or user contexts. Beacon shows patterns over time, not point-in-time guarantees.

**What Beacon actually knows:**
- What AI platforms responded during the observation window in the imported data (signal class 3: Imported Visibility)
- Trends across multiple observations (if the sample covers multiple dates)
- Whether visibility was gained, lost, or stable over the observation window

**What Beacon does not know:**
- What any AI model will say in the next response to the same prompt
- Whether an AI platform changed its algorithms, sources, or ranking between observations
- Whether your visibility will persist after the current observation window

**How Beacon derives this:**
Beacon imports observations from external tools (Profound, etc.) that queried AI platforms at specific times. These observations are snapshots, not continuous monitors. The `window_basis` on attribution surfaces shows the timespan of the data.

**Where the user can verify it in-product:**
- Today → "How we know" panel: sample date range and source
- Changes → observation window label on scorecard scope line
- Market → directional scope line ("not a market census")

**Related signal classes:** 3 (Imported Visibility), 13 (Coverage & Freshness)

**If stale / partial coverage changes the answer:** Yes. More frequent imports produce more reliable trend data. A single-day import is essentially one snapshot — no trend can be derived.

---

### Q8. Why is Beacon recommending this if it cannot guarantee outcomes?

**Short answer:** Beacon recommends the highest-leverage next step based on available evidence — not a guaranteed outcome. "Strong evidence" means the input signals are solid, not that the result is certain.

**What Beacon actually knows:**
- Which changes have correlated with positive visibility shifts in your data (signal class 5: Attribution)
- Which patterns (topic, URL, structure) are shared by successful changes (signal class 10: Recommendations)
- The priority score breakdown: impact confidence (0-25), evidence strength (0-20), pattern strength (0-15), replication potential (0-15), type urgency (0-15), recency (0-10)

**What Beacon does not know:**
- Whether following the recommendation will improve your visibility (forbidden claim F4)
- What other factors might counteract the recommended action
- Whether the pattern that worked before will work again in a different context

**How Beacon derives this:**
`recommendation-engine.ts` connects attribution-backed impact to page gaps and patterns. `priority-engine.ts` scores the composite priority. The "Strong evidence" label means input evidence is strong — `beacon-proof-copy.ts` explicitly states: "It is a prioritized suggestion, not a guarantee of outcomes."

**Where the user can verify it in-product:**
- Today → primary action card with "Basis" section showing lineage bullets
- Today → evidence-quality label ("Strong evidence" / "Moderate evidence" / "Early signal")

**Related signal classes:** 10 (Recommendations & Priority Scoring), 5 (Attribution Scoring)

**If stale / partial coverage changes the answer:** Yes. Recommendations based on stale or limited data should be treated as weaker signals. The `dataFreshness` lineage bullet in the Basis section shows how current the supporting data is.

> **Highest-risk FAQ.** Maps to forbidden claim F4 and the recommendation certainty trust risk identified in 1.1a.

---

### Q9. What does "Strongest correlate" actually mean?

**Short answer:** It means this change is the best-fit match for this visibility shift based on timing, topic overlap, URL alignment, and platform — scoring ≥70 out of 100. It does not mean Beacon proved causation.

**What Beacon actually knows:**
- The multi-factor match score between the change and the visibility event
- How closely they align on each factor: platform (strong/partial/none), topic match, URL match, temporal distance, geo containment
- The evidence tier: exact (URL matched in registry), probable, weak, or inferred
- Whether the operator confirmed the link (the only path to "Confirmed" status)

**What Beacon does not know:**
- Whether other unmeasured factors were the actual cause
- Whether the same visibility shift would have happened without the change
- The magnitude of the change's contribution vs other factors

**How Beacon derives this:**
The attribution `confidence_basis` string assembles: linked match count, topic count, platform count, evidence tier, days since change, and primary-role match strengths (topic fit, URL fit, temporal tightness). The observation window is appended when events span multiple days.

**Where the user can verify it in-product:**
- Changes → Detail → Attribution fit badge with explanation tooltip
- Changes → Detail → Event Attribution cards with individual match factor breakdown
- Changes → Detail → Evidence tier label

**Related signal classes:** 5 (Attribution Scoring), 6 (Change Verdicts & Impact)

**If stale / partial coverage changes the answer:** Yes. With fewer observations, there are fewer potential matches to evaluate. A "Strongest correlate" from a limited sample is weaker evidence than the same label from a robust sample.

---

### Q10. How do you know my competitor is really ahead of me?

**Short answer:** Beacon counts how often competitor domains appear in AI-generated answers within your imported sample. "Ahead of you" means they were cited more often than you in that sample — not that they outrank you in all AI conversations everywhere.

**What Beacon actually knows:**
- Citation frequency per competitor domain in the imported observation set (signal class 7: Market Benchmark)
- Co-mention patterns: how often competitors appear in the same AI answer as you (signal class 8: Competitor Intelligence)
- Per-topic breakdown: where they lead, where you lead

**What Beacon does not know:**
- Whether these competitors outperform you outside your tracked prompt set (forbidden claim F19)
- Whether the AI platforms "prefer" competitor content — citation frequency ≠ trust or preference (forbidden claim F6)
- What competitors are doing that you can't see (content changes, partnerships, etc.)

**How Beacon derives this:**
`MarketBenchmark` aggregates citation counts by domain from the `CitationEvidenceIndex`. The "Ahead of You" count is the number of configured competitors with more citations than you in the sample. `source-trust.ts` explicitly states: "Does NOT claim to know internal model weights or preferences."

**Where the user can verify it in-product:**
- Market → "Ahead of You" KPI with "of N tracked competitors" scope
- Market → competitive rankings table with per-competitor citation counts
- Market → Source Trust section (citation frequency labels, not "trust" claims)

**Related signal classes:** 7 (Market Benchmark), 8 (Competitor Intelligence)

**If stale / partial coverage changes the answer:** Yes. Competitive rankings from a limited or stale sample are directional at best. A small sample can make minor citation count differences look like large competitive gaps.

---

### Q11. What if Beacon is missing prompts / cities / services that matter to me?

**Short answer:** Then your data has blind spots. Beacon can only analyze prompts it has observations for. If a city, service, or query type isn't in your imported data, Beacon has nothing to say about it — and should not be treated as if it does.

**What Beacon actually knows:**
- Coverage patterns within the imported prompt set and citation corpus (signal class 9: Geo Coverage)
- Which cities, topics, and services appear in your data
- Where coverage is absent: cities where you have no observations, topics where no results exist

**What Beacon does not know:**
- What's happening in prompts, cities, or services you haven't tracked (forbidden claim F10)
- Whether the missing coverage represents significant market demand or irrelevant queries (forbidden claim F16: prompt frequency ≠ market demand)
- How to estimate what you're missing

**How Beacon derives this:**
`GeoCoverageIndex` maps pages and citations to cities via `NormalizedCity` matching. Coverage status per city (strong/moderate/weak/absent) is based on owned page + citation counts. But "absent" means absent in the sample, not absent in reality.

**Where the user can verify it in-product:**
- Market → Local Pressure section (cities where competitors outpace you — but only within tracked prompts)
- Settings → Data tab (raw imported rows — you can see what prompts and dates are covered)

**Related signal classes:** 9 (Geo Coverage), 3 (Imported Visibility)

**If stale / partial coverage changes the answer:** This *is* a partial coverage question. The directional scope line on Market explicitly warns: "based on your tracked prompt sample, not a market census."

---

### Q12. How should I interpret "sample quality: limited"?

**Short answer:** "Limited" means your observation count is below 200. At this level, percentages are volatile and competitive rankings are unreliable. Treat everything as a directional early signal, not a firm measurement.

**What Beacon actually knows:**
- The exact observation count behind the sample quality tier
- The thresholds: <200 = limited, 200–1000 = moderate, >1000 = strong
- That these thresholds are heuristic, not statistically derived

**What Beacon does not know:**
- What the margin of error is for your specific sample (Beacon has no statistical confidence model)
- Whether your sample is biased toward certain topics, platforms, or geographies
- How many more observations you need for your specific use case

**How Beacon derives this:**
`sampleQualityTierFromObservationCount()` in `src/lib/sample-quality-tier.ts` applies the threshold constants. The tier label is displayed on the Market KPI strip.

**Where the user can verify it in-product:**
- Market → sample quality tier label below the directional scope line
- Today → "How we know" panel (row count and date range)
- Settings → Data tab (row-level view of imported observations)

**Related signal classes:** 3 (Imported Visibility), 7 (Market Benchmark), 13 (Coverage & Freshness)

**If stale / partial coverage changes the answer:** Limited sample quality *is* partial coverage. Import more data to move from limited to moderate or strong.

---

### Q13. What does "Validated" on a change verdict actually mean?

**Short answer:** "Validated" means multiple evidence signals align — either you confirmed it manually, or the system found strong multi-event evidence with high evidence tier. It does not mean proven ROI.

**What Beacon actually knows:**
- The number and quality of attribution matches for this change (signal class 6: Change Verdicts)
- The trust source: operator-confirmed (strongest), auto-cleared, system primary, contributing, candidate
- The evidence tier: exact, probable, weak, inferred
- The impact direction: positive, negative, mixed, none

**What Beacon does not know:**
- The business revenue impact of this change (forbidden claim F5: "Proven ROI")
- Whether the visibility shift will persist
- Whether external factors contributed to the same shift

**How Beacon derives this:**
`computeScorecard()` + `computeChangeImpact()` evaluate each change against detected outcome events. Verdict thresholds: `validated` requires either operator confirmation with strong evidence, or ≥2 primary attributions with strong evidence. `too_early` is honestly assigned when a change is <14 days old.

**Where the user can verify it in-product:**
- Changes → Scorecard row with verdict badge, trust source indicator, evidence tier
- Changes → Detail page with full attribution breakdown
- Changes → Detail → Impact section with confidence, direction, and "Why" explanation

**Related signal classes:** 5 (Attribution Scoring), 6 (Change Verdicts & Impact)

**If stale / partial coverage changes the answer:** Yes. A "Validated" verdict from a limited sample rests on fewer data points. The observation window on the scorecard scope line shows the data span.

---

### Q14. Can I share these numbers with a client or stakeholder?

**Short answer:** Yes, but with the qualifiers. Every Beacon metric is sample-bound and directional. When sharing, include: what the sample size is, that percentages are share-of-sample not market share, that attribution shows correlation not causation, and the date range of the data.

**What Beacon actually knows:**
- All the evidence described in the relevant signal classes for the metric being shared
- The provenance chain: source system → import → citation index → computed metric

**What Beacon does not know:**
- Whether the stakeholder's interpretation will match Beacon's intended framing
- Whether the stakeholder will strip the qualifiers and present the numbers as absolute facts

**How Beacon derives this:**
The methodology destination (`/settings/methodology`) is designed to be the reference an operator points a stakeholder to. Per-metric methodology sections explain what each number means and doesn't mean.

**Where the user can verify it in-product:**
- `/settings/methodology` → per-section explanations (when implemented)
- Market → scope and denominator lines (shareable context)
- Changes → evidence tier and trust source labels

**Related signal classes:** All — this is a cross-cutting concern

**If stale / partial coverage changes the answer:** Yes. Sharing stale or limited-sample data without noting the freshness and sample quality is misleading.

---

### Q15. Why doesn't Beacon show me a confidence interval or margin of error?

**Short answer:** Because Beacon has no statistical model to back one. Showing a confidence interval would imply a rigor the system doesn't have. Instead, Beacon uses sample quality tiers (limited / moderate / strong) and evidence-quality labels as honest heuristics.

**What Beacon actually knows:**
- The sample size and observation count (denominator)
- Heuristic thresholds for sample quality

**What Beacon does not know:**
- The statistical confidence level of any metric
- The margin of error for any percentage
- Whether the sample is randomly distributed or systematically biased

**How Beacon derives this:**
Beacon deliberately chose heuristic tiers over statistical language (design principle from 1.1d: "No fake precision"). TSM GEO publishes ±7% at 50 queries using formal statistical methods. Beacon's imported data doesn't have the controlled sampling methodology to support equivalent claims.

**Where the user can verify it in-product:**
- Market → sample quality tier label
- `/settings/methodology` → "What Beacon does not claim" section (when implemented)

**Related signal classes:** 3 (Imported Visibility), 7 (Market Benchmark)

**If stale / partial coverage changes the answer:** Limited samples make heuristic tiers even more important — they're the only guard against overinterpreting volatile percentages.

---

### Q16. What if I see "Observed in latest crawl" but I changed the page since then?

**Short answer:** Beacon shows what it found at crawl time. If you changed the page after the last crawl, Beacon doesn't know about the change yet. Run a new scan to update.

**What Beacon actually knows:**
- The HTML content at the time of the last crawl (`detectedAt`, `scanRunId`)
- How old that observation is (`relativeAge`)

**What Beacon does not know:**
- What the page looks like right now if it changed after the crawl
- Whether a CMS, CDN cache, or deployment pipeline is serving different content than what was crawled

**How Beacon derives this:**
The `relativeAge` on each finding shows how old the observation is. The `DataFreshnessStrip` shows the last scan timestamp on every page.

**Where the user can verify it in-product:**
- Findings → per-finding provenance line with relative age
- Shell → Data Freshness Strip
- Settings → trigger a new scan from the Today surface

**Related signal classes:** 1 (Crawl Findings), 13 (Coverage & Freshness)

**If stale / partial coverage changes the answer:** This *is* a staleness question. A fresh crawl resolves it.

---

## 4. Answer Format Reference

Each FAQ entry above follows this structure:

| Section | What it contains |
|---------|-----------------|
| **Question** | The skeptical question, phrased as the operator would ask it |
| **Short answer** | 1–2 sentence direct answer — no hedging, no preamble |
| **What Beacon actually knows** | Specific data, fields, and observations that ground the answer |
| **What Beacon does not know** | Explicit boundaries — references forbidden claims from 1.1a where applicable |
| **How Beacon derives this** | The computation or data path, referencing specific files/functions from 1.1a taxonomy |
| **Where the user can verify it in-product** | Specific surfaces and UI elements the operator can check |
| **Related signal classes** | From the 14 signal classes in 1.1a |
| **If stale / partial coverage changes the answer** | How data quality affects this specific answer |

---

## 5. Highest-Risk FAQ Callouts

Three questions map directly to the three biggest trust risks identified in 1.1a:

### Risk 1: Attribution / causation

**Primary FAQ:** Q2 ("How do you know this change caused anything?")
**Supporting FAQs:** Q9 ("What does 'Strongest correlate' actually mean?"), Q13 ("What does 'Validated' mean?")
**Forbidden claims:** F1 (causal attribution), F5 (proven ROI), F9 (confirmed impact without operator)
**Mitigation already shipped:** `ConfidenceBadge` labels changed to "Strongest correlate" / "Possible correlate" (1.1e). `confidence_basis` string wired to explanation prop (1.1f). Observation window added (1.1g).

### Risk 2: Market denominator / scope

**Primary FAQ:** Q4 ("Is this market share or just your own sample?")
**Supporting FAQs:** Q3 ("Why should I trust this percentage?"), Q6 ("How many prompts is this based on?"), Q12 ("How should I interpret 'sample quality: limited'?")
**Forbidden claims:** F2 (unqualified market share), F7 (complete picture), F8 (unqualified market ranking)
**Mitigation already shipped:** KPI renamed to "Citation Share" (1.1e). Denominator shown in meta (1.1e). Directional scope line added (1.1e). `sample_quality_tier` displayed (1.1f).

### Risk 3: Recommendation certainty

**Primary FAQ:** Q8 ("Why is Beacon recommending this if it cannot guarantee outcomes?")
**Supporting FAQs:** Q15 ("Why no confidence interval?"), Q7 ("What if the AI answered differently tomorrow?")
**Forbidden claims:** F4 (will improve visibility), F17 (unqualified "high confidence")
**Mitigation already shipped:** Recommendation labels changed to "Strong evidence" / "Moderate evidence" / "Early signal" (1.1e). `beacon-proof-copy.ts` states: "prioritized suggestion, not a guarantee" (existing).

---

## 6. Methodology-Shell Mapping

Where each FAQ or FAQ family should be reachable in-product, mapped to the 1.1c entry-point system.

### Today surface

| FAQ(s) | Entry point | Layer | Implementation note |
|--------|------------|-------|---------------------|
| Q8 (recommendation certainty) | Primary action card → "Learn more" | L3 (surface entry) | Link from basis section footer to `/settings/methodology#recommendations` |
| Q5 (stale data) | Coverage/safety strip | L1 (inline) | Already shows coverage tone; link to Q5 content when degraded |
| Q7 (AI variability) | "How we know" panel footer | L3 (surface entry) | Link to `/settings/methodology#data-variability` |

### Changes surface

| FAQ(s) | Entry point | Layer | Implementation note |
|--------|------------|-------|---------------------|
| Q2, Q9 (attribution/causation) | Scorecard `<details>` methodology block | L2 (local disclosure) | Collapsed block above scorecard; links to Q2/Q9 in methodology destination |
| Q13 (validated meaning) | Per-row verdict badge | L1 (inline) | Tooltip or "?" icon linking to `/settings/methodology#verdicts` |
| Q2 (causation) | Detail page → attribution section footer | L3 (surface entry) | "How attribution works →" link |

### Market surface

| FAQ(s) | Entry point | Layer | Implementation note |
|--------|------------|-------|---------------------|
| Q3, Q4 (percentage/share) | KPI strip scope line | L1 (inline) | Already deployed: directional scope + denominator |
| Q10 (competitor ahead) | Rankings table scope note | L1 (inline) | Scope: "within your configured competitor universe" |
| Q6, Q12 (sample size/quality) | Sample quality tier label | L1 (inline) | Already deployed: tier label below scope line |
| Q11 (missing prompts/cities) | `<details>` methodology block below KPI strip | L2 (local disclosure) | Collapsed block; links to Q11 content |

### Findings (Today "Since last scan")

| FAQ(s) | Entry point | Layer | Implementation note |
|--------|------------|-------|---------------------|
| Q1 (how do you know it changed) | Per-finding provenance line | L1 (inline) | Already deployed: "Observed in latest crawl · Xd ago" |
| Q16 (changed since crawl) | Provenance line when finding is >1d old | L1 (inline) | Age already shown; no additional UI needed |

### `/settings/methodology` destination

| FAQ(s) | Section | Priority |
|--------|---------|----------|
| Q1, Q16 | "Site changes & findings" | P2 |
| Q2, Q9, Q13 | "Attribution" | P0 — highest traffic section |
| Q3, Q4, Q6, Q10, Q11, Q12 | "Visibility & citations" / "Competitive intelligence" | P0 |
| Q5, Q7 | "Freshness & coverage" / "Data variability" | P1 |
| Q8, Q15 | "Recommendations" | P1 |
| Q14 | "Sharing & defending numbers" (new section) | P2 |

---

## 7. Copy / Tone Guidance

### How this FAQ should sound

**Calm.** Not alarmed, not apologetic. The tone of someone who has done the work, knows the limits, and isn't afraid to say so.

**Precise.** Use specific numbers, field names, and threshold values. "Below 200 observations" not "a small number."

**Non-defensive.** Never phrase an answer as "but actually we do X." State what is known, state what is not, move on. No justifications.

**Anti-marketing.** Zero superlatives. No "industry-leading," no "best-in-class," no "comprehensive." If a sentence could appear in a sales deck, cut it.

**Proof-first.** Lead with what the data shows, then explain the limitation. Not: "We can't prove causation, but..." Instead: "Beacon identifies the strongest correlate. It does not prove causation."

### Words to use

- "Directional," "within your sample," "based on N observations," "strongest correlate," "possible correlate"
- "Beacon sees," "the data shows," "the imported sample includes"
- "Does not know," "cannot determine," "has no evidence for"
- "Treat as," "interpret as," "use as a starting point"

### Words to avoid

- "Market share" (without "citation" or "sample" qualifier)
- "Proven," "confirmed" (without operator confirmation qualifier)
- "Caused," "driven by," "resulted in"
- "Guaranteed," "certain," "definitely"
- "Comprehensive," "complete," "exhaustive"
- "Trust," "trusts" (when describing AI platform behavior — frequency ≠ trust)

---

## 8. Implementation Notes for Later

### FAQ entries that should become inline "Learn more" targets first (P0/P1)

These are the most likely moments of doubt — they should be reachable from the metric surface itself, not only from the methodology destination.

| FAQ | Where to link from | Priority |
|-----|-------------------|----------|
| Q2 (attribution/causation) | Changes detail → attribution section footer | P0 |
| Q3 (percentage trust) | Market → KPI strip → scope line | P0 |
| Q8 (recommendation certainty) | Today → primary action → basis footer | P1 |
| Q9 (strongest correlate) | Changes detail → ConfidenceBadge → tooltip/link | P1 |
| Q12 (sample quality limited) | Market → sample quality tier label | P1 |

### FAQ entries that can stay methodology-destination only (P2/P3)

These are important but less likely to be the moment of doubt — operators will find them when browsing methodology.

| FAQ | Why destination-only is acceptable |
|-----|-----------------------------------|
| Q1 (how changed) | Findings already show provenance inline; rarely doubted |
| Q5 (stale data) | Freshness strip and coverage tone already handle this inline |
| Q7 (AI variability) | Industry-level concern; not tied to a specific metric |
| Q10 (competitor ahead) | Rankings table already has scope notes |
| Q11 (missing prompts) | Scope line already warns; deep answer is educational |
| Q14 (sharing numbers) | Reference use case, not daily workflow |
| Q15 (no confidence interval) | Rare question; answer is philosophical |
| Q16 (changed since crawl) | Age indicator already answers this inline |

### What can wait until after 1.1i / 1.1j

| Item | Why it can wait |
|------|----------------|
| In-product FAQ UI (accordion, search, etc.) | 1.1i defines stale/partial escalation rules; FAQ may reference them. Build after escalation is stable |
| Deep-link anchors on methodology destination | Requires `/settings/methodology` route (1.1c follow-through). FAQ content is ready; wiring waits for the route |
| Dynamic FAQ answers (inserting live counts/dates) | Useful but adds implementation complexity. Static FAQ is sufficient for v1 |
| FAQ analytics / most-viewed tracking | Premature until the FAQ is actually surfaced to operators |
| Additional FAQ entries beyond these 16 | 16 covers the 3 highest-risk areas thoroughly. New entries should be driven by actual operator questions post-launch |

---

## Appendix: Forbidden Claims Cross-Reference

Every forbidden claim from 1.1a that is directly addressed by at least one FAQ entry.

| Forbidden claim | FAQ(s) that address it |
|-----------------|----------------------|
| F1 — "This change caused your visibility to increase" | Q2, Q9 |
| F2 — "Your market share is X%" (unqualified) | Q3, Q4 |
| F3 — "Beacon measured your AI visibility" | Q6 (clarifies Beacon imports, not measures) |
| F4 — "This will improve your visibility" | Q8 |
| F5 — "Proven ROI" | Q13 |
| F6 — "ChatGPT trusts [source] more" | Q10 |
| F7 — "Complete picture of your visibility" | Q3, Q6 |
| F8 — "You are #N in the market" (unqualified) | Q4, Q10 |
| F9 — "Confirmed impact" (without operator confirmation) | Q2, Q13 |
| F10 — "You have no presence in [city]" (unqualified) | Q11 |
| F15 — "Google/AI saw this change" | Q1, Q16 |
| F16 — "Demand is highest in [city]" | Q11 |
| F17 — "High confidence" (without qualifier) | Q8, Q15 |
| F19 — "This competitor is your biggest threat" (unqualified) | Q10 |

Forbidden claims F11 (all-time best unqualified), F12 (AI getting business wrong), F13 (issue hurting visibility), F14 (adding FAQs will fix citations), F18 (data is current when stale) are not directly addressed by a dedicated FAQ but are covered by the principles in Q5 (staleness), Q1 (findings scope), and the tone guidance in §7.

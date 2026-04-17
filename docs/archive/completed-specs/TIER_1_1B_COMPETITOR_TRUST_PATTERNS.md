# Competitor Trust Patterns — Tier 1.1b

> **PURPOSE:** Desk research memo comparing Beacon's methodology transparency, claim behavior, and trust language against comparable AEO/GEO visibility products. Informs the methodology shell IA (1.1c) and confidence/uncertainty copy deck (1.1e).
>
> **Grounded in:** `docs/TIER_1_1A_SIGNAL_TAXONOMY.md` — 14 signal classes, 19 forbidden claims, 3 highest-risk areas.

**Produced:** 2026-04-12  
**Sources:** Product docs, help centers, methodology pages, MSAs, blog posts, and third-party independent reviews (Discovered Labs, Cairrot, Aether, TSM GEO) for each product below.

---

## 1. Purpose and Scope

This memo establishes the "industry trust bar" for AI visibility products — what competitors disclose, what they disclaim, and which patterns Beacon should adopt or avoid. Focus areas are the three highest-risk claim zones from the 1.1a taxonomy:

1. **Attribution confidence** — "Likely caused by" (taxonomy F1)
2. **Market share wording** — unqualified "Your AI Share: X%" (taxonomy F2)
3. **Recommendation confidence** — "high confidence" conflating evidence with outcome (taxonomy F17)

---

## 2. Research Set

| Product | Company | What was reviewed |
|---------|---------|-------------------|
| **Peec AI** | Peec (EU) | Docs site (docs.peec.ai), Cairrot independent review, Discovered Labs review, feature pages |
| **Profound** | Cooper Square Technologies | Help center, blog, methodology pages, MSA (legal terms), API docs, Surfaced comparison review |
| **Writesonic GEO** | Writesonic (Y Combinator) | GEO docs, feature pages, blog, GetAirefs comparison review |
| **Otterly.ai** | OtterlyAI (Austria) | Blog (1M+ citation study, YouTube study), GlobeNewswire press releases, Discovered Labs review |
| **TSM GEO Framework** | TSM (methodology) | Measurement framework, sentinel query methodology, KPI hierarchy |
| **Aether AI** | Aether Agency (UK) | GEO reporting metrics guide, 12-metric framework |

---

## 3. Industry Trust Pattern Matrix

### Peec AI

| Dimension | Pattern |
|-----------|---------|
| **Sampling language** | "We run your prompts across AI platforms daily." Recommends 50–100 prompts for reliability. No explicit sample-size disclaimer in the UI itself, but docs acknowledge "AI responses naturally vary day to day" and use the phrase "patterns over time." |
| **Attribution language** | No causation claims. Peec explicitly stops at monitoring — independent reviews note "tells you what's happening but doesn't provide strong guidance on how to fix it." No "caused by" or "likely caused by" language. |
| **Market share / SoV** | "Visibility shows how often your brand gets mentioned across AI responses — think of it like market share in AI conversations." Uses the market-share metaphor openly but frames it as "like market share," not "is your market share." |
| **Confidence language** | None visible. No confidence badges, no "high/medium/low" certainty labels on metrics. |
| **Methodology visibility** | Strong. Dedicated docs page explaining UI scraping vs API, why responses vary, data collection methodology. Prominent "Technical approach" section. |
| **Explicit disclaimers** | "AI responses naturally vary day to day." Data starts from signup — "no retroactive visibility data." No formal in-product disclaimer beyond methodology docs. |
| **What they do well** | Methodological honesty about data collection. Clear about what they don't do (no execution, no causal claims). "Like market share" framing is appropriately hedged. |
| **What to avoid** | No in-product methodology link. Monitoring-only positioning means they never face the attribution trust problem Beacon faces. |

### Profound

| Dimension | Pattern |
|-----------|---------|
| **Sampling language** | "Visibility Score measures the percentage of mentions out of the total responses tracked." Denominators shown: "5 out of 10 responses." Blog references "680M+ citations analyzed." Docs show observation counts per metric. |
| **Attribution language** | No attribution system at all. Profound tracks visibility, not causation. Suggestions via "Opportunities" dashboard are action recommendations (outreach, content), not causal links. |
| **Market share / SoV** | "Share of voice measures the frequency of brand mentions in AI-generated answers in relation to competitors." Formula explicitly documented: mentions / total brand mentions. Help center provides the exact calculation. |
| **Confidence language** | No confidence tiers on metrics. Sentiment analysis uses positive/neutral/negative, but no "high confidence" or "likely" labels on visibility scores. |
| **Methodology visibility** | Mixed. Strong docs for metrics definitions (help center explains each formula). But MSA includes "Services and Service Content may include inaccurate or erroneous information" and "Customer is responsible for independently evaluating the Service Content" — these are legal disclaimers, not in-product honesty. |
| **Explicit disclaimers** | MSA: "not professional advice," "may include inaccurate or erroneous information," "independently evaluating." Blog: "ChatGPT's sources have only a 39% overlap with Google's sources." No in-UI disclaimers found. |
| **What they do well** | Denominator transparency (total responses tracked). Formula documentation. Citation category research openly shares limitations ("27 million citations" with methodology disclosed). |
| **What to avoid** | Disclaimers buried in MSA, not surfaced in-product. The gap between "marketing" claims ("#1 AI Search Visibility Platform") and legal disclaimers ("may include inaccurate information") is large. |

### Writesonic GEO

| Dimension | Pattern |
|-----------|---------|
| **Sampling language** | "120M+ proprietary AI chatbot conversations" used for prompt discovery (search volume). Tracking itself is prompt-based (user-configured). No explicit sample-size caveat per customer's prompt set. |
| **Attribution language** | No causal attribution system. "Action Center" provides content recommendations and outreach templates, framed as opportunities, not causal explanations. |
| **Market share / SoV** | "Market share: The percentage of overall AI visibility you hold compared to competitors." "Market position: Your ranking among competitors based on visibility." Both framed as within the tracked prompt set, but without explicit "within your prompt set" qualifier in the UI. |
| **Confidence language** | None visible. No confidence badges or certainty tiers on metrics. |
| **Methodology visibility** | Low. Docs explain what metrics mean but not how they're derived or what their limitations are. "The only platform with real prompt data" is a marketing claim without methodology disclosure. |
| **Explicit disclaimers** | None found in product docs or help center. Marketing copy is confident: "See exactly where you rank," "Know which of your own content AI actually cites." |
| **What they do well** | Unified tracking-to-action workflow reduces the trust gap between measurement and recommendation (recommendations are content actions, not causal claims). |
| **What to avoid** | Overconfident marketing copy ("See exactly where you rank") without any methodology caveat. "120M+ conversations" used as authority without explaining how that sample relates to any individual customer's metrics. |

### Otterly.ai

| Dimension | Pattern |
|-----------|---------|
| **Sampling language** | Strongest in the field. Research papers explicitly state sample sizes ("1+ million citations," "100+ million citation instances"), observation windows ("30-day period"), and geographic scope ("globally, across all languages, with no geographic filter applied"). |
| **Attribution language** | Exemplary hedging: "Correlation does not imply causation." YouTube study explicitly states "results are strongest for explaining repeated citation behavior, not for predicting initial citation eligibility." Uses Pearson r values with plain-language interpretation ("weak positive correlation," "modest"). |
| **Market share / SoV** | "For trend analysis, the directional trend is what counts. For competitive benchmarking, relative positioning is more reliable than absolute citation counts." Independent review: "directional, not absolute counts." |
| **Confidence language** | No confidence badges, but independent review recommends "manual spot-checks" and "GA4 traffic correlation" as validation, acknowledging "LLMs are probabilistic." |
| **Methodology visibility** | Best-in-class. Published research includes full methodology sections: dependent variables, statistical tests used (Pearson r), scope limitations, data collection method (web interfaces, not APIs). |
| **Explicit disclaimers** | "This study did not analyze raw API outputs; findings may not extend to API-level or enterprise deployments." "Scope limitation: Because the dataset includes only videos cited at least once during the observation window, results are strongest for explaining repeated citation behavior." Weekly refresh = "up to 7 days behind real-time." |
| **What they do well** | Separates "what we observed" from "what it means." Published scope limitations alongside findings. Statistical language is precise but accessible. |
| **What to avoid** | Research-heavy positioning doesn't always translate to in-product UX (methodology is in blog posts and press releases, not necessarily in-product). |

### TSM GEO Framework (methodology reference)

| Dimension | Pattern |
|-----------|---------|
| **Sampling language** | Explicit margin-of-error guidance: "~50 queries (±7% margin) → Detects ≥10-point monthly changes" up to "~150 queries (±4% margin)." "Margins are statistically derived for ACF at 95% confidence (p<0.05)." |
| **Attribution language** | "GEO operates in an attribution-limited environment." Explicitly recommends proxy methods (branded search lift, referral traffic) because "direct attribution for AI-driven conversions remains technically limited." |
| **Confidence language** | Uses "illustrative example" warnings: "The values below represent one hypothetical scenario. Your actual metrics will vary." |
| **Methodology visibility** | Full KPI hierarchy (4 tiers), sentinel query methodology, statistical confidence levels. |
| **What they do well** | Honest about the limits of the whole discipline. "Attribution-limited environment" is the most useful framing in the research set. |
| **What to avoid** | Too academic for a product UI — useful as a reference standard, not a direct UI pattern. |

### Aether AI (framework reference)

| Dimension | Pattern |
|-----------|---------|
| **Sampling language** | Published benchmark ranges with qualifying language: "early benchmarks suggest," "cross-industry average is 2.3%." |
| **Attribution language** | Describes an explicit attribution chain: "citations lead to referral traffic, referral traffic leads to enquiries, enquiries lead to revenue." Frames this as aspirational, not proven: "Attribution model refinement [will improve] as more AI referral traffic flows through." |
| **Confidence language** | "Citation Attribution Accuracy" defined as percentage of citations that accurately represent your brand — a quality metric, not a causation metric. |
| **What they do well** | The attribution chain is honest about being a proxy. "Connect visibility metrics to commercial outcomes" is framed as a goal, not a proven link. |
| **What to avoid** | Revenue projections from citation counts (e.g., "500 citations × 2.3% conversion × $X deal value") imply more precision than the data supports. |

---

## 4. Comparison to Beacon

### Where Beacon is already stronger

| Beacon advantage | Evidence |
|-----------------|----------|
| **In-product methodology disclosure** | `HowWeKnowPanel` shows crawl run ids, sample row counts, visibility dates, and methodology text directly in the Today/Pages UI. No competitor reviewed has an equivalent in-product methodology panel. Peec and Profound document methodology in docs/help centers only. |
| **Explicit correlation-not-causation language** | `BEACON_METHODOLOGY.attribution` states: "It shows correlation and best-fit causes, not proof of causation." No competitor needs this because none attempt attribution, but among products that link changes to outcomes, Beacon is the only one that ships a written caveat. |
| **Freshness and staleness signaling** | `CoverageTone` with clear thresholds (>7 days stale, >14 days degraded, >30 days critical), `visibilityStaleVsCrawl` flag, `DataFreshnessStrip` in shell layout. None of the research set shows comparable data freshness transparency. Otterly.ai mentions "up to 7 days behind real-time" but only in review content, not in-product. |
| **Observed vs inferred separation** | `LocalProof` type explicitly separates `observed`, `inferred`, and `dataGaps`. This is more transparent than any competitor's approach to local/listings data. |
| **Source trust documentation** | `source-trust.ts` header: "Does NOT claim to know internal model weights or preferences." Internal code documentation is excellent — the gap is that it doesn't reach the operator. |

### Where Beacon is weaker / riskier

| Beacon risk | Comparison |
|-------------|------------|
| **"Likely caused by" badge** | No competitor in the research set uses causal language on attribution badges. Beacon's `ConfidenceBadge` with "Likely caused by" (high) is unique in the market — and uniquely risky. Competitors either don't attempt attribution (Peec, Profound, Writesonic, Otterly) or explicitly disclaim it (TSM: "attribution-limited environment"). Beacon is the only product reviewed that ships a "Likely caused by" label. |
| **Market share without prominent denominator** | Peec hedges with "like market share in AI conversations." Profound shows the formula (mentions / total brand mentions). Beacon shows "Your AI Share: X%" with `trackedCitationObservations` in small meta text only — less prominent than Profound's help center documentation. |
| **No sample-size or margin-of-error disclosure** | TSM GEO publishes margin-of-error per query count (±7% at 50 queries, ±4% at 150). Otterly.ai publishes observation window and sample size in every study. Beacon has no equivalent — `resultsRowCount` is shown in the "How we know" panel but not interpreted (what does 1,179 rows mean for confidence?). |
| **"High confidence" on recommendations** | No competitor uses confidence tiers on action recommendations. Peec shows "prioritized recommendations" without confidence labels. Profound shows "opportunities" without certainty claims. Beacon's `BeaconRecommendation.confidence` = "high" on a recommended action is more exposed than any competitor. |
| **Methodology not linked from metric surfaces** | Competitors mostly don't have in-product methodology either — but Beacon already has `HowWeKnowPanel` and doesn't link it from the Market route, Changes scorecard, or recommendation cards. The infrastructure exists; the wiring is incomplete. |

### Where Beacon should adopt a clearer pattern

| Pattern to adopt | Source |
|-----------------|--------|
| **Denominator next to every percentage** | Profound (formula: "5 out of 10 responses = 50% visibility"). Beacon should show "X% of N tracked observations" rather than "X%." |
| **"Directional, not absolute" framing** | Otterly.ai independent review pattern: "For trend analysis, the directional trend is what counts." Beacon should adopt this for market benchmark KPIs. |
| **"Attribution-limited environment" framing** | TSM GEO. Beacon's attribution system is more sophisticated than any competitor's, but should frame its output in the context of a discipline-wide limitation, not as a solved problem. |
| **Scope-limitation statements on every computed signal** | Otterly.ai research papers. Every aggregated metric should carry a one-line scope note (e.g., "Based on N observations across M topics from your imported sample"). |
| **Margin-of-error or sample-quality indicator** | TSM sentinel query methodology. Even a simple "sample size: small / adequate / robust" indicator would exceed the industry bar. |

---

## 5. Recommended Trust Patterns to Adopt

### P1. Denominator disclosure on all percentage metrics (from Profound)

Every "X%" in the UI should be accompanied by its denominator, either inline ("18% of 1,179 observations") or as persistent meta text. The Market KPI strip is the highest priority. This directly addresses taxonomy forbidden claim F2.

### P2. "Directional trend" language on comparative metrics (from Otterly.ai)

Replace certainty-implying language with directional framing. Instead of "Your AI Share: 18%" alone, add a qualifier: "Directional — based on your tracked prompt sample, not a market census." This pattern is proven in the Otterly.ai ecosystem and matches the TSM framework's "attribution-limited environment" philosophy.

### P3. Downgrade ConfidenceBadge from causal to correlational (unique to Beacon)

No competitor uses "Likely caused by" because no competitor attempts attribution. Beacon should change:
- "Likely caused by" → "Strongest correlate" or "Best-fit match"
- "Possibly related to" → "Possible correlate"
- Keep "Weak connection" and "Unclear link" as-is

This is the single highest-leverage trust fix identified in the entire audit. It directly addresses taxonomy forbidden claim F1.

### P4. Scope line on every computed section (from Otterly.ai research methodology)

Each Market/Changes/Pages section that displays a computed aggregate should show a one-line scope note at the section level. Pattern: "Based on [N] citation observations across [M] topics from your imported sample." This exceeds the industry bar — no competitor does this in-product — but Beacon's `HowWeKnowPanel` proves operators will read it.

### P5. "Sample quality" indicator (from TSM GEO)

Add a simple signal next to `resultsRowCount` that interprets the number: "Small sample — treat as early signal" / "Adequate sample — trend data is reliable" / "Robust sample — directional comparisons are meaningful." Even Otterly.ai, with 100M+ citations, doesn't do this in-product — but TSM's framework proves the concept is sound.

---

## 6. Recommended Patterns to Avoid

### A1. Legal-only disclaimers (Profound anti-pattern)

Profound's trust language lives in the MSA ("may include inaccurate or erroneous information") and doesn't appear in-product. Marketing claims ("#1 AI Search Visibility Platform") exist in a different reality from legal disclaimers. Beacon should never rely on legal terms to carry trust — `HowWeKnowPanel` is the correct location.

### A2. Overconfident marketing copy (Writesonic anti-pattern)

"See exactly where you rank" and "Know which of your own content AI actually cites" imply a precision that sampling-based systems cannot deliver. Beacon's internal copy is better hedged, but some UI surfaces (KPI card labels, recommendation headlines) approach this territory.

### A3. Authority-by-sample-size without relevance (Writesonic anti-pattern)

"120M+ chatbot conversations" sounds impressive but has no explained relationship to any individual customer's metric quality. Beacon should never use imported row counts as authority signals without connecting them to what they mean for this operator's data.

### A4. Revenue projections from citation data (Aether anti-pattern)

"500 citations × 2.3% conversion × $X deal value = $Y revenue" creates a false precision chain. Beacon should never generate revenue projections from citation or attribution data unless grounded in the operator's actual conversion data.

### A5. Unqualified "market share" metaphor (industry-wide risk)

Even Peec's "like market share" hedge is borderline. The term "market share" carries a specific meaning (share of total addressable market) that no sampling-based AI visibility tool can deliver. Beacon should use "citation share" or "sample share" rather than "market share" or "AI share" without a qualifier.

---

## 7. Implications for 1.1c / 1.1e

### For 1.1c — Methodology shell IA

- **Entry points needed:** Market route (currently has no methodology link), Changes scorecard (attribution methodology not linked from verdict rows), recommendation cards (confidence label has no methodology link). Today's `HowWeKnowPanel` is the model.
- **Depth model:** Peec's docs have a good "Technical approach: UI scraping vs API access" section. Beacon needs an equivalent "How Beacon forms this number" per major metric class — not a single methodology page, but per-surface methodology accessible from the metric itself.
- **Scope notes:** Every aggregated section needs a one-line scope note (pattern P4). This is an IA decision — where do they live? Inline below the section header is the pattern from `HowWeKnowPanel`.

### For 1.1e — Confidence & uncertainty copy deck

- **Priority 1:** `ConfidenceBadge` labels. "Likely caused by" → "Strongest correlate" (P3). This is the single most impactful copy change in the system.
- **Priority 2:** Market KPI card labels. "Your AI Share" needs a denominator (P1) and directional qualifier (P2).
- **Priority 3:** Recommendation confidence. Remove or reframe `confidence: "high"` on `BeaconRecommendation` from implying outcome certainty to describing input evidence quality. Pattern: "Strong evidence behind this suggestion" rather than "High confidence."
- **Copy audit scope:** The 10 highest-traffic strings (taxonomy 1.1e spec) should be the KPI card labels, scorecard verdict labels, ConfidenceBadge labels, recommendation card headlines, and Today section headers.
- **Lexicon to adopt:** "Directional," "within your sample," "based on N observations," "strongest correlate," "best-fit match," "we see," "in your data." Replace: "your market share," "likely caused by," "high confidence," "confirmed" (without operator confirmation).

---

## 8. Conclusion — 5 Takeaways

1. **No competitor attempts attribution.** Beacon is alone in the market in linking changes to visibility outcomes. This is both the product's strongest differentiator and its highest trust risk. The "Likely caused by" label must be fixed before any competitor or sophisticated operator challenges it.

2. **Denominator transparency is the lowest-effort, highest-trust fix.** Profound documents its formulas. Otterly.ai publishes sample sizes. Beacon already has `resultsRowCount` and `trackedCitationObservations` but doesn't put them next to the percentages they define. Wiring this is a copy/UI change, not an architecture change.

3. **The industry bar for in-product methodology is low.** Beacon's `HowWeKnowPanel` already exceeds every competitor reviewed. The gap is that it's only on Today/Pages, not on Market or Changes. Extending it is incremental.

4. **"Directional, not absolute" is the safest framing for every metric.** TSM GEO, Otterly.ai, and even the Peec "like market share" hedge all converge on this. Beacon should adopt it as a system-wide copy principle for all computed aggregates.

5. **Beacon's internal code documentation is excellent; the gap is surfacing it.** `source-trust.ts` says "Does NOT claim to know internal model weights." `beacon-proof-copy.ts` says "correlation, not causation." `LocalProof` separates observed/inferred/gaps. This is better discipline than any competitor. The work is making it visible to the operator.

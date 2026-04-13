# Methodology Shell IA — Tier 1.1c

> **PURPOSE:** Information architecture for Beacon's in-product methodology shell — where "How we know this," denominators, scope notes, and trust-entry points should live across every Tier-1 surface.
>
> **Grounded in:** `TIER_1_1A_SIGNAL_TAXONOMY.md` (14 signal classes, 19 forbidden claims), `TIER_1_1B_COMPETITOR_TRUST_PATTERNS.md` (5 patterns to adopt, 5 to avoid).
>
> **NOT FOR:** Copy strings (→ 1.1e), lineage schema additions (→ 1.1f), stale/partial escalation rules (→ 1.1i), UI implementation (→ future).

**Produced:** 2026-04-12

---

## 1. Purpose and Design Principles

### What the methodology shell is for

The methodology shell is a layered system of trust-entry points that lets operators answer "How does Beacon know this?" at exactly the moment they doubt a number, without leaving the surface they're using.

It is the structural frame that holds all proof-layer UI: inline denominators, scope notes, "How we know" panels, and a dedicated methodology destination reachable from any surface.

### Design principles

1. **Progressive disclosure.** Trust information appears in layers of increasing depth. Most operators never need the deepest layer. The inline layer handles the common case.
2. **In-context, not centralized-only.** Every trust-critical metric must have a trust entry point on the same surface where the metric appears. A standalone methodology page is useful but must never be the only location.
3. **Calm by default, available on demand.** Scope notes and denominators should be visible but unobtrusive (muted text, meta rows). Methodology panels should be collapsed by default. Nothing should interrupt the morning workflow.
4. **No legalese.** Copy should be operator-language, not legal disclaimers (anti-pattern A1 from 1.1b). "Based on 1,179 observations," not "results may be inaccurate."
5. **No blanket repetition.** Not every card needs a methodology panel. The system defines which surfaces and metric types require disclosure, then applies them consistently.
6. **Extend what exists.** `HowWeKnowPanel` and `BEACON_METHODOLOGY` copy are the proven primitives. The shell extends their reach, not replaces them.

### What the methodology shell must not do

- Overwhelm Today's morning flow with disclaimers
- Duplicate the same methodology block on every card
- Become a legal/compliance page hidden from the product
- Require operators to read methodology before using the tool
- Add friction to the "scan → read → act" daily loop

---

## 2. User Trust Moments

These are the moments where an operator is most likely to doubt a Beacon claim — and what they need in that moment.

| Moment | Surface | What they doubt | What they need |
|--------|---------|----------------|----------------|
| **Seeing "Your AI Share: 18%"** | Market | "Is that my real market share?" | Denominator + scope qualifier: "18% of 1,179 tracked observations — directional, not a market census" |
| **Seeing "Likely caused by"** | Changes detail | "Did this change actually cause the visibility shift?" | Correlational framing: "Strongest correlate — not proven causation" + link to methodology |
| **Seeing "High confidence" on recommendation** | Today | "How confident should I actually be?" | Evidence-quality framing: "Strong evidence behind this suggestion" + basis bullets |
| **Seeing a scorecard verdict** | Changes | "How trustworthy is 'Validated'?" | Trust source label + evidence tier + link to attribution methodology |
| **Seeing stale data** | Any | "Is this data even current?" | Freshness strip with age + coverage tone (already working) |
| **Seeing competitor rankings** | Market | "Are these all my competitors?" | Scope note: "Within your configured competitor universe" + universe disclosure |
| **First import complete** | Today | "Can I trust these numbers yet?" | Sample quality indicator + "Based on your first import — trends improve with more data" |
| **Sharing results with stakeholders** | Any | "Can I defend this number?" | Methodology destination with per-metric explanations they can reference |

---

## 3. Entry-Point Map by Surface

### Current state (from codebase audit)

| Surface | Methodology block | Inline scope/trust | Trust gaps |
|---------|-------------------|--------------------|------------|
| **Today** | `HowWeKnowPanel` (inside `TodayVisibilitySnapshot`) | Morning order, coverage strip, system line, primary action "Basis" | Recommendation confidence label lacks qualifier |
| **Pages** | None (`HowWeKnowPanel` `variant="pages"` exists but is not rendered) | `pagesProofSubtitle()` one-liner in header | No per-page methodology; no `HowWeKnowPanel` wired |
| **Changes list** | None | Milestones `proofSummary`, replication Tier 1B disclaimer, attribution queue | No attribution methodology summary; no scope note on scorecard |
| **Change detail** | None | Trust labels, evidence tiers, impact badges, match factors | No link to methodology; "Likely caused by" label unqualified |
| **Market** | None | KPI meta text, table footnotes, universe `<details>` | No denominator on "Your AI Share"; no `HowWeKnowPanel`; no scope note |
| **Shell** | None | `DataFreshnessStrip` | Strip is operational only; no methodology link |

### Required entry points (new)

| Surface | Entry point needed | Priority | Type |
|---------|-------------------|----------|------|
| **Market** — KPI strip | Denominator on "Your AI Share" | P0 | Inline micro-proof |
| **Market** — KPI strip | Scope note below KPI row | P0 | Inline scope line |
| **Market** — section level | "How we know" disclosure (collapsed) | P1 | Local disclosure |
| **Changes detail** — confidence badge | Correlational label (replaces "Likely caused by") | P0 | Inline micro-proof |
| **Changes detail** — attribution section | Methodology link to destination | P1 | Surface entry |
| **Changes list** — scorecard header | Scope note for scorecard data | P1 | Inline scope line |
| **Today** — primary action | Evidence-quality qualifier on confidence | P0 | Inline micro-proof |
| **Today** — primary action | Basis section (exists; needs qualifier copy) | P2 | Already exists |
| **Pages** — route header | Wire `HowWeKnowPanel` `variant="pages"` | P2 | Local disclosure |
| **Shell** — freshness strip | Methodology link (icon/text) to destination | P2 | Surface entry |
| **All surfaces** — methodology destination | Dedicated methodology route or drawer | P1 | Destination |

---

## 4. IA Layers

The methodology shell uses four progressive-disclosure layers. Each layer is deeper and less frequently needed.

### Layer 1: Inline micro-proof

**What:** Denominators, qualifiers, and one-word trust signals that appear directly on or adjacent to the metric they describe.

**Pattern:** Muted text, same visual row as the metric. Always visible, never collapsed.

**Examples:**
- "18% of 1,179 observations" (Market KPI)
- "Strongest correlate" (Changes confidence badge — replaces "Likely caused by")
- "Strong evidence" (Today recommendation confidence — replaces "High confidence")
- "Directional — within your tracked sample" (Market scope qualifier)
- "3 topics · 47 observations" (per-row context on scorecard)

**Implementation notes:**
- This layer is primarily copy changes (1.1e) + minor component props.
- Market KPI cards already have a `meta` text slot — use it for denominators.
- `ConfidenceBadge` already has an `explanation` prop — use it for correlational qualifier.
- Primary action already shows `dataFreshness` — extend with evidence-quality qualifier.

### Layer 2: Local disclosure ("How we know this")

**What:** Collapsible `<details>` blocks at the section level that explain the methodology behind a group of metrics. Collapsed by default.

**Pattern:** `<details>` with summary text like "How Beacon forms these numbers" or "About this data." Positioned below the section header, above the section content.

**Existing model:** `HowWeKnowPanel` on Today.

**Where needed (new):**
- **Market** — below KPI strip, above competitive rankings table. Explains: what "AI Share" means, where citation data comes from, what the competitor universe is, what "directional" means.
- **Changes list** — above scorecard table. Explains: what attribution is, what verdicts mean, what confidence tiers represent, correlation vs causation.
- **Pages** — below route header (wire existing `HowWeKnowPanel` `variant="pages"`). Explains: what crawl data shows, what guardrails check, what citation counts represent.

**What this layer should NOT do:**
- Appear on every card or row inside the section
- Repeat the same text that's in the inline layer
- Replace the methodology destination for deep questions

### Layer 3: Surface-level methodology entry

**What:** A persistent but unobtrusive link from each major surface to the methodology destination. Not a full explanation — just a doorway.

**Pattern:** Small text link or icon-link at the bottom of a section or in the surface header. Copy: "How this works →" or methodology icon (e.g., ℹ️ or a small "?" circle).

**Where needed:**
- **Today** — already has `HowWeKnowPanel` which links to `/changes?tab=attribution`. Add a link to the methodology destination from the panel footer.
- **Market** — add link in the local disclosure footer: "Full methodology →"
- **Changes detail** — add link near the attribution section: "How attribution works →"
- **Changes list** — add link in the scorecard local disclosure footer
- **Pages** — add link in the `HowWeKnowPanel` footer (once wired)
- **Shell / DataFreshnessStrip** — add a small methodology icon-link

### Layer 4: Methodology destination

**What:** A dedicated place that explains Beacon's methodology for each major signal class. Reachable from any surface via Layer 3 links. This is where operators go when they need to defend a number or understand the full methodology.

**See Section 7 for routing/destination proposal.**

---

## 5. Per-Surface Recommendations

### Today

| Element | Current state | Recommendation | Layer | Priority |
|---------|--------------|----------------|-------|----------|
| `HowWeKnowPanel` | Exists, well-structured | Add footer link: "Full methodology →" to destination | L3 | P2 |
| Primary action — confidence label | Shows `"{confidence} confidence"` raw | Change to evidence-quality framing (1.1e copy): "Strong evidence" / "Moderate evidence" / "Early signal" | L1 | P0 |
| Primary action — basis | Shows `lineageBullets` | Keep as-is; already good Layer 2 pattern | L2 | — |
| Coverage / freshness strip | Shows crawl age, visibility age, partial/stale warnings | Keep as-is; add link to methodology destination if stale/degraded | L3 | P2 |
| `DataFreshnessStrip` (shell) | Shows import/scan timestamps | Add small methodology icon-link | L3 | P2 |

**What should stay hidden until expanded:** `HowWeKnowPanel` body (already collapsed). Basis bullets (already inside the primary action card). No new collapse-by-default elements needed on Today.

### Pages

| Element | Current state | Recommendation | Layer | Priority |
|---------|--------------|----------------|-------|----------|
| Route header | `pagesProofSubtitle()` one-liner | Keep subtitle; add `HowWeKnowPanel variant="pages"` below header | L2 | P2 |
| Per-page rows | Trust/evidence data available in props but not surfaced as methodology | No change needed — row-level trust is adequate. Add scope note to the page-list header: "N pages tracked · last crawl [date]" | L1 | P2 |
| Page detail (future) | N/A | Out of scope for v1 shell |  |  |

**What should stay hidden until expanded:** `HowWeKnowPanel` (collapsed by default, same as Today).

### Changes (list)

| Element | Current state | Recommendation | Layer | Priority |
|---------|--------------|----------------|-------|----------|
| Scorecard header | No scope note | Add scope line: "Verdicts based on [N] attribution matches across [M] changes" | L1 | P1 |
| Scorecard table | Per-row trust labels exist | Keep per-row trust; no additional inline needed | — | — |
| Above scorecard | No local disclosure | Add collapsed `<details>`: "How Beacon scores changes" — attribution methodology, verdict definitions, correlation-not-causation | L2 | P1 |
| Milestones | `proofSummary` per event | Keep — already good L1 pattern | — | — |
| Replication tab | Tier 1B disclaimer exists | Keep — already good L2 pattern | — | — |
| Attribution tab | "At a glance" review queue | Add link: "How attribution works →" to methodology destination | L3 | P2 |

**What should stay hidden until expanded:** New `<details>` block above scorecard (collapsed by default).

### Changes (detail)

| Element | Current state | Recommendation | Layer | Priority |
|---------|--------------|----------------|-------|----------|
| Confidence badge | Shows "Likely caused by" etc. | Replace labels via 1.1e copy change (P3 from 1.1b). Add `explanation` prop with correlational qualifier | L1 | **P0** |
| Impact section | `ImpactConfidenceBadge` + `DirectionBadge` | Keep; these are already appropriately labeled | — | — |
| Attribution events | `EventAttributionCard` with match factors | Keep; already strong L1 disclosure. Add footer link: "How attribution works →" | L3 | P2 |
| Evidence tier labels | `TIER_LABELS` with long descriptions | Keep — already good pattern | — | — |

**What should stay hidden until expanded:** Nothing new — existing disclosure pattern is adequate.

### Market

| Element | Current state | Recommendation | Layer | Priority |
|---------|--------------|----------------|-------|----------|
| KPI strip — "Your AI Share" | Shows X% with `trackedCitationObservations` as small meta | **Promote denominator**: "X% of N observations" as primary meta. Add directional qualifier: "Directional — within your tracked sample" | L1 | **P0** |
| KPI strip — "Your Citations" | Shows count with observation count meta | Keep; already has denominator | — | — |
| KPI strip — "Ahead of You" | Shows N with "On raw citation count" meta | Add scope: "of [M] tracked competitors" | L1 | P1 |
| Below KPI strip | Nothing | Add collapsed `<details>`: "How Beacon measures your market position" — explains citation sample, competitor universe, directional framing, what "AI Share" actually means | L2 | **P1** |
| Rankings table header | "Ordered by AI-visible citations..." footnote | Keep; already decent L1 scope note | — | — |
| Topic signals header | "Three lenses on the same topic model..." | Keep | — | — |
| Universe `<details>` | Exists (collapsed) — shows configured competitors | Keep; extend with methodology link footer: "Full methodology →" | L3 | P2 |
| Source trust section | `source-trust.ts` "Does NOT claim to know..." | This copy is code-only; surface in a section-level scope note: "Citation frequency, not platform preference" | L1 | P1 |
| Co-mention section | No scope note | Add scope line: "Co-appearances in [N] sampled AI answers" | L1 | P1 |

**What should stay hidden until expanded:** New `<details>` below KPI strip (collapsed). Universe `<details>` (already collapsed).

### Settings / Data

| Element | Current state | Recommendation | Layer | Priority |
|---------|--------------|----------------|-------|----------|
| Import page | Shows import history and row counts | Add methodology link in import success state: "Beacon uses this data to compute your visibility metrics. See how →" | L3 | P3 |
| Config page | Business config | No methodology needed | — | — |
| History/Data page | Raw result rows | Add scope note: "These are the imported observation rows that feed all Beacon metrics" | L1 | P3 |

---

## 6. Denominator / Scope-Note System

### Where denominator language must appear

Denominators are the single highest-impact trust fix (1.1b conclusion #2). Every percentage metric in Beacon must show its denominator.

| Metric | Current state | Required change | Format |
|--------|--------------|-----------------|--------|
| "Your AI Share: X%" | Meta text shows observation count (small) | Promote: "X% of N observations" | `{value}% of {count} observations` |
| Per-topic citation share | No denominator | Add: "X% of N topic observations" | Same pattern |
| Co-mention strength % | No denominator | Add: "in N sampled answers" | Inline after percentage |
| Recommendation confidence | Shows "high/medium/low" | Reframe: "Strong/Moderate/Early evidence" | Label change (1.1e) |
| Attribution confidence | Shows "Likely caused by" | Reframe: "Strongest correlate" | Label change (1.1e) |
| Scorecard verdict | Shows verdict label | Already has trust source; add observation count when available | Inline after verdict |

### Where sample/scope labels must appear

Scope labels explain the boundary of the data behind a section. They answer: "What data is this based on?"

| Location | Scope label pattern | Example |
|----------|-------------------|---------|
| Market KPI strip (below) | "Directional — based on your tracked prompt sample, not a market census." | Static text, muted, always visible |
| Scorecard header (Changes) | "Based on [N] attribution matches across [M] changes in your workspace." | Dynamic text with counts |
| Co-mention section header | "Co-appearances observed in [N] sampled AI answers." | Dynamic text with count |
| Source trust section header | "Citation frequency across tracked platforms — not a measure of platform preference." | Static text |
| Local pressure section | "Coverage patterns from [N] tracked prompts across [M] cities." | Dynamic text with counts |
| Pages route header | "[N] pages tracked · last crawl [date]" | Dynamic text |

### Where stale/partial coverage escalation must appear

Coverage escalation already works well on Today via `CoverageTone` and the coverage strip. The shell should extend this pattern:

| Condition | Where escalation appears | Current | Needed |
|-----------|------------------------|---------|--------|
| `crawlStale` (>7 days) | Today coverage strip | ✓ Working | Replicate warning on Pages header |
| `visibilityStaleVsCrawl` | Today coverage strip | ✓ Working | Add warning on Market KPI strip: "Visibility sample older than last crawl" |
| `visibilitySynthetic` | Today proof context | ✓ Working | Add warning on Market + Changes if synthetic |
| Small sample (<100 rows) | Nowhere | — | Add "Small sample — treat as early signal" indicator on Market KPI strip and Changes scorecard |
| No import | Today/Pages/Changes/Market | ✓ Demo banners | Keep as-is |

### Sample quality tiers

A simple 3-tier interpretation of `resultsRowCount` (thresholds to be tuned, these are starting points):

| Tier | Threshold | Label | Where shown |
|------|-----------|-------|-------------|
| Small | < 200 rows | "Early signal — trends improve with more data" | Market KPI meta, Changes scorecard header |
| Adequate | 200–1,000 rows | "Adequate sample — trend data is directional" | Market KPI meta (optional — can omit for clean default) |
| Robust | > 1,000 rows | "Robust sample — directional comparisons are meaningful" | Market KPI meta (optional) |

Show the tier label only when it's "Small" (degraded) or when the operator expands the Layer 2 disclosure. Don't add noise for adequate/robust samples unless requested.

---

## 7. Routing / Destination Proposal

### Decision: Settings subpage, not a standalone route

The methodology destination should live at **`/settings/methodology`** as a subpage within the existing Settings layout.

**Why not a standalone route:**
- Methodology is not a daily workflow — it's reference material. It belongs in Settings, where operators go for configuration and reference.
- Adding a 6th top-level nav item ("Methodology") would break the 5-item nav structure (Today, Pages, Market, Changes, Settings) and add clutter to the daily workflow.
- Settings already has a tab/subpage pattern (Import, Config, History). Methodology fits naturally.

**Why not a modal/drawer:**
- Methodology content is long enough (multiple signal classes) that a modal would feel cramped.
- Operators may want to reference methodology while looking at a metric on another surface — a drawer could work but adds implementation complexity for v1.
- A subpage is linkable (entry points from other surfaces can deep-link to sections).

**Why not inline-only (no destination):**
- Layer 2 disclosures on individual surfaces can't hold the full methodology for all 14 signal classes. Operators who want to "defend a number" need a single reference location.
- The methodology destination also serves as the anchor for the adversarial FAQ (1.1h).

### Methodology destination structure

**Route:** `/settings/methodology`

**Sections:**

1. **How Beacon works** — one-paragraph overview: imported visibility data + site crawls → attribution + competitive intelligence → prioritized recommendations. Not marketing copy — operational summary.

2. **Your data** — dynamic section showing:
   - Sample size: N result rows, through [date]
   - Source: [import source name]
   - Competitor universe: [N] configured competitors
   - Last crawl: [date]
   - Sample quality tier + interpretation
   - Coverage tone with explanation

3. **How each metric is computed** — one subsection per signal class group:
   - **Visibility & citations** (classes 3, 4): what "AI Share" means, what the denominator is, why it's directional, what "citation share" represents
   - **Site changes & findings** (classes 1, 2): what the crawl detects, what guardrails check, what severity means
   - **Attribution** (classes 5, 6): how changes are linked to outcomes, what confidence tiers mean, correlation vs causation, what "validated" requires
   - **Competitive intelligence** (classes 7, 8, 9): what the market benchmark measures, what co-mention means, what source trust does NOT claim, geo coverage basis
   - **Recommendations** (class 10): how priority scores work, what "strong evidence" means, why it's a suggestion not a guarantee
   - **Records & milestones** (class 11): what "all-time high" is scoped to
   - **Freshness & coverage** (class 13): what staleness thresholds are, what coverage tone means

4. **What Beacon does not claim** — plain-language version of the forbidden claims list (1.1a). Not the full 19 items — the top 6–8 most relevant, in operator language. E.g., "Beacon does not prove that a site change caused a visibility shift. It shows correlation — the strongest match between timing, topic, and URL."

5. **Glossary** (collapsed by default) — key terms: attribution, confidence tier, evidence tier, citation share, directional, coverage tone, verdict, trust source.

### Deep-linking

Each subsection should have a stable anchor (e.g., `/settings/methodology#attribution`, `/settings/methodology#market-share`) so Layer 3 links from other surfaces can point directly to the relevant section.

---

## 8. Out-of-Scope / Defer

| Item | Deferred to | Why |
|------|------------|-----|
| Actual copy strings for badges, scope notes, qualifiers | **1.1e** | This doc defines where copy goes; 1.1e defines what it says |
| Lineage metadata additions (run IDs, sample counts on attribution) | **1.1f** | IA assumes lineage data will be available; schema changes are separate |
| Adversarial FAQ content | **1.1h** | Methodology destination reserves a section; FAQ content is a separate task |
| Stale/partial escalation state machine changes | **1.1i** | IA defines where escalation surfaces; state logic is separate |
| `HowWeKnowPanel` component refactoring | **implementation** | The component works; IA defines where it should be wired |
| Per-row methodology on Pages or Changes | **Tier 2** | Row-level trust labels already exist; per-row methodology panels would add density |
| Methodology for Local Operator signals | **Tier 2** | Lower priority; `LocalProof` already has strong trust patterns |
| Entity discrepancy methodology | **Tier 2** | Diagnostics page is lower traffic |

---

## 9. Implementation Handoff Notes

### Components likely to be touched

| Component / file | Change type | Priority |
|-----------------|-------------|----------|
| `src/components/display/confidence-badge.tsx` | Label text change (copy) | P0 |
| `src/components/today/today-primary-action.tsx` | Confidence label framing change (copy) | P0 |
| `src/app/(shell)/competitors/page.tsx` | Add denominator to KPI meta, add scope line below KPI strip, add `<details>` methodology block | P0–P1 |
| `src/app/(shell)/changes/[id]/page.tsx` | Wire `explanation` prop on confidence badge; add methodology link | P1 |
| `src/app/(shell)/changes/page.tsx` | Add scope line on scorecard header; add `<details>` methodology block | P1 |
| `src/app/(shell)/pages/page.tsx` | Wire `HowWeKnowPanel variant="pages"` (component exists, just not rendered) | P2 |
| `src/components/today/how-we-know-panel.tsx` | Add footer link to `/settings/methodology` | P2 |
| `src/components/shell/data-freshness-strip.tsx` | Add methodology icon-link | P2 |
| `src/app/(shell)/settings/layout.tsx` | Add "Methodology" tab to Settings nav | P1 |
| `src/app/(shell)/settings/methodology/page.tsx` | New route (methodology destination) | P1 |
| `src/lib/beacon-proof-copy.ts` | Extend with per-section methodology copy | P1 |

### Minimum v1 shell

The smallest useful implementation that addresses the three highest-risk trust moments:

1. **ConfidenceBadge label change** — "Likely caused by" → "Strongest correlate" (copy change in one component). Addresses F1.
2. **Market KPI denominator** — promote `trackedCitationObservations` from meta to primary text on "Your AI Share" card. Add directional scope line below KPI strip. Addresses F2.
3. **Today recommendation qualifier** — change `"{confidence} confidence"` to evidence-quality framing. Addresses F17.
4. **Methodology destination** — create `/settings/methodology` with sections 1–4 from §7. Add "Methodology" tab in Settings nav.
5. **Layer 3 wiring** — add "How this works →" links from Market `<details>`, Changes attribution tab, and `HowWeKnowPanel` footer to `/settings/methodology` with section anchors.

Items 1–3 are copy changes (1.1e scope). Items 4–5 are the structural shell. Together they form the minimum v1.

### Implementation order (recommended)

1. **1.1e first** — copy changes (items 1–3) are the highest-leverage, lowest-risk fixes and can ship independently of the methodology destination.
2. **Methodology destination** (item 4) — create the route and populate with static content from `BEACON_METHODOLOGY` + new per-section copy.
3. **Layer 3 wiring** (item 5) — add links from surfaces to the methodology destination.
4. **Layer 2 disclosures** — add `<details>` blocks on Market and Changes (uses methodology destination for deep links).
5. **Pages HowWeKnowPanel** — wire the existing `variant="pages"` component.

### Data dependencies

The IA assumes the following data is available for dynamic scope notes. Items marked "available" exist today; "needed" require 1.1f lineage work:

| Data point | Status | Used in |
|-----------|--------|---------|
| `resultsRowCount` | Available (`TodayProofContext`) | Market KPI denominator, Changes scope line |
| `trackedCitationObservations` | Available (`MarketBenchmark`) | Market KPI denominator |
| `resultsThrough` | Available (`TodayProofContext`) | Market scope line |
| `crawlCompletedAt` | Available (`TodayProofContext`) | Pages header, freshness strip |
| `totalDomainsAnalyzed` | Available (`DiscoveryResult`) | Market discovery scope |
| `total_answers_analyzed` | Available (`CoMentionMatrix`) | Co-mention scope note |
| Attribution match count | **Needed** (1.1f) | Changes scorecard scope line |
| Topic count per signal | **Needed** (1.1f) | Market scope line, Changes scope line |
| Sample quality tier | **Needed** (derived from `resultsRowCount` + thresholds) | Market KPI meta, Changes header |

---

## Appendix: Mapping 1.1b Patterns to IA Layers

| 1.1b Pattern | IA Layer | Where applied |
|--------------|----------|---------------|
| **P1** — Denominator disclosure | L1 (inline micro-proof) | Market KPI strip, co-mention %, topic share % |
| **P2** — Directional framing | L1 (inline micro-proof) | Market scope line below KPI strip |
| **P3** — Correlational badge labels | L1 (inline micro-proof) | `ConfidenceBadge`, Today primary action confidence |
| **P4** — Scope line per section | L1 (inline scope line) | Market, Changes, Co-mention, Source trust, Local pressure |
| **P5** — Sample quality indicator | L1 (inline, conditional) | Market KPI meta (only shown for "Small" tier) |
| **A1** — No legal-only disclaimers | Design principle #4 | All layers use operator language, not legalese |
| **A2** — No overconfident copy | Design principle #3 | Badge labels, KPI labels, recommendation headlines |
| **A3** — No authority-by-sample-size | L1 denomination rules | Always connect count to meaning, not just show count |
| **A4** — No revenue projections | Out of scope | Beacon doesn't do this; keep it that way |
| **A5** — No unqualified "market share" | L1 + L2 | Market KPI label + scope line + methodology destination |

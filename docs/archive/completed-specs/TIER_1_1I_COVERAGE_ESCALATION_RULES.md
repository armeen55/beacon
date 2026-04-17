# Coverage Escalation Rules — Tier 1.1i

> **PURPOSE:** Defines how Beacon detects and escalates stale or incomplete data so operators never misread partial evidence as complete truth. Specifies discrete coverage states, trigger conditions, per-surface escalation behavior, and copy transformations.
>
> **Grounded in:** `TIER_1_1A_SIGNAL_TAXONOMY.md` (signal class 13 — Coverage & Freshness, forbidden claims F7/F18), `TIER_1_1C_METHODOLOGY_SHELL_IA.md` (§6 — denominator / scope-note system, stale/partial escalation table), `TIER_1_1D_PROVENANCE_METADATA_SPEC.md` (fields 5, 18–20), `TIER_1_1H_ADVERSARIAL_OWNER_FAQ.md` (Q5, Q6, Q7, Q12, Q16).
>
> **NOT FOR:** UI implementation, automated score reweighting, notification/alerting systems, prompt-bank governance. This is a rules specification — no app code changes.

**Produced:** 2026-04-12

---

## 1. Purpose

### Why coverage escalation is needed

Every metric Beacon displays is derived from two upstream signals: **crawled HTML** (site state) and **imported visibility observations** (AI citation data). Both go stale over time, and both can be incomplete. Without explicit escalation, an operator seeing "Your Citation Share: 18%" or "All clear" has no way to know whether that number is grounded in fresh, comprehensive data or in a week-old, 50-row sample.

### What risk it protects against

1. **False certainty from stale data.** An operator acts on a recommendation derived from observations that are no longer current. The AI landscape may have shifted since the last import. (Forbidden claim F18: "Your data is current" when crawl >7 days old.)
2. **Overinterpretation of thin samples.** A "Citation Share: 42%" from 80 observations is noise, not signal. Without escalation, it looks the same as 42% from 2,000 observations. (FAQ Q12: "How should I interpret 'sample quality: limited'?")
3. **Misread completeness.** "All clear" when the crawl is 3 weeks old means "nothing changed in 3-week-old data" — not "nothing needs attention." (FAQ Q5: "What if your data is stale?")
4. **Mixing fresh and stale signals.** A fresh crawl paired with a stale visibility sample produces findings that look current but competitive metrics that are outdated. The operator needs to know which layer is degraded.

---

## 2. Coverage State Model

Four discrete, non-overlapping states. Each is the **composite** assessment of all upstream signals — a single surface shows one coverage state at a time.

### State definitions

| State | Meaning | Color intent |
|-------|---------|-------------|
| **Fresh** | All upstream signals are current and sample is adequate or better. The operator can act on these numbers with normal confidence. | Green / default (no indicator) |
| **Aging** | At least one upstream signal is approaching staleness, or sample quality is limited. Numbers are still usable but the operator should import/scan soon. | Amber / subtle |
| **Stale** | At least one critical upstream signal is beyond its freshness window. Numbers should be treated as directional at best. Recommendations may not reflect current reality. | Orange / visible warning |
| **Critical** | Data is severely outdated or effectively absent. Metrics should not be relied upon for decisions. Some claims should be suppressed entirely. | Red / prominent |

### Relationship to existing `CoverageTone`

The existing `CoverageTone` type (`ok | partial | degraded | critical`) in `today-proof-context.ts` maps to this model:

| Existing `CoverageTone` | New coverage state | Notes |
|-------------------------|-------------------|-------|
| `ok` | **Fresh** | No change |
| `partial` | **Aging** | `partial` = synthetic visibility or missing citation index — data exists but is incomplete |
| `degraded` | **Stale** | `degraded` = crawl >14d + stale, or visibility stale vs crawl |
| `critical` | **Critical** | `critical` = crawl >30 days |

The new model extends `CoverageTone` with two additions:
1. An **Aging** state that captures "approaching stale" (crawl 3–7 days old, or sample quality limited) — currently these fall through to `ok`.
2. **Sample quality** as a coverage dimension (currently only handled by `sample_quality_tier` independently).

---

## 3. State Triggers

### Input signals (all existing or derivable)

| Signal | Source | Type | Notes |
|--------|--------|------|-------|
| `crawlAgeDays` | `TodayProofContext` | `number \| null` | Days since last completed crawl |
| `crawlStale` | `TodayProofContext` | `boolean` | True when crawl >14 days old (set in `today-data.ts`) |
| `visibilityStaleVsCrawl` | `TodayProofContext` | `boolean` | True when citation index older than last crawl |
| `visibilityPartialSample` | `TodayProofContext` | `boolean` | True when synthetic rows or missing citation index |
| `resultsRowCount` | `TodayProofContext` | `number` | Total imported observation rows |
| `trackedCitationObservations` | `MarketBenchmark` | `number` | Observation count for market metrics |
| `sample_quality_tier` | Derived | `"limited" \| "moderate" \| "strong"` | From `sampleQualityTierFromObservationCount()` |
| `lastImportAt` | Shell layout (import runs) | `string \| null` | Timestamp of most recent import |
| `isDemoMode` | Shell context | `boolean` | No import runs — sample/demo data only |

### Trigger rules

States are evaluated **top-down** — the first matching rule wins (highest severity takes precedence).

```
RULE 1 — Critical
IF   isDemoMode = true
  OR crawlAgeDays > 30
  OR (crawlAgeDays is null AND resultsRowCount = 0)
THEN state = Critical

RULE 2 — Stale
IF   crawlAgeDays > 14 AND crawlStale = true
  OR visibilityStaleVsCrawl = true AND crawlAgeDays > 7
  OR lastImportAt is > 30 days ago
THEN state = Stale

RULE 3 — Aging
IF   crawlAgeDays > 3 AND crawlAgeDays <= 14
  OR sample_quality_tier = "limited"
  OR visibilityPartialSample = true
  OR visibilityStaleVsCrawl = true AND crawlAgeDays <= 7
THEN state = Aging

RULE 4 — Fresh
OTHERWISE state = Fresh
```

### Threshold summary

| Threshold | Value | Justification |
|-----------|-------|---------------|
| Crawl age → Aging | >3 days | Daily scan is default (`preferredHour: 9`); 3 days means 2 missed scans |
| Crawl age → Stale | >14 days | Existing `crawlStale` threshold in `today-data.ts` |
| Crawl age → Critical | >30 days | Existing `deriveCoverageTone` critical threshold |
| Import age → Stale | >30 days | Import cadence is user-dependent; 30 days is generous |
| Sample → Aging | <200 observations | `SAMPLE_QUALITY_LIMITED_BELOW` constant |
| Visibility vs crawl → Stale | true + crawl >7d | Stale visibility is worse when crawl is also aging |
| Visibility vs crawl → Aging | true + crawl ≤7d | Fresh crawl compensates partially for stale visibility |
| Demo mode → Critical | always | Sample data should never be treated as actionable |

### Precedence

When multiple conditions match different states, the **highest severity** wins:

`Critical > Stale > Aging > Fresh`

This means a fresh crawl cannot mask a critically outdated import, and vice versa. The operator sees the worst-case signal.

---

## 4. Escalation Behavior by Surface

### Today

| Element | Fresh | Aging | Stale | Critical |
|---------|-------|-------|-------|----------|
| **Primary action card** | Normal display. "Strong evidence" / "Moderate evidence" / "Early signal" label as-is. | Normal display. If Aging due to `sample_quality_tier: limited`: append "(limited sample)" to evidence label. | Suppress confidence label. Replace with: "Based on stale data — import fresh observations before acting." | Suppress entire primary action card. Show: "Import current data to see recommendations." |
| **Findings ("Since last scan")** | Normal display. Findings are actionable. | Normal display. Add inline note: "Crawl is {N} days old — re-scan for current state." | Findings displayed but marked: "These findings are from a {N}-day-old crawl and may not reflect current site state." | Suppress findings interpretation. Show: "Last crawl is over 30 days old — run a scan to see current findings." |
| **All-clear logic** | `shouldShowTodayAllClear()` can return true (existing behavior). | `shouldShowTodayAllClear()` returns false (existing: `coverageTone !== "partial"` blocks it when Aging maps to partial). | Returns false (existing: `crawlStale` blocks it). | Returns false. |
| **"How we know" panel** | Normal display with row count, dates, methodology. | Normal display. Coverage strip shows amber. | Coverage strip shows orange/warning. Add: "Some metrics may not reflect current conditions." | Coverage strip shows red. Add: "Data is critically outdated. Import and scan before relying on any metric." |
| **Coverage/safety strip** | Green or default (hidden if no issues). | Amber strip: "Crawl is {N} days old" or "Limited sample — {count} observations." | Orange strip: "Data is stale — last crawl {N} days ago" or "Visibility sample outdated vs latest crawl." | Red strip: "Data is critically outdated" or "No real data — import to begin." |

### Market

| Element | Fresh | Aging | Stale | Critical |
|---------|-------|-------|-------|----------|
| **Citation Share KPI** | "X% of N observations" with scope line. | "X% of N observations" + sample quality tier label ("limited"). Scope line gains: "· treat as early signal." | "X% of N observations" + warning: "Based on stale data — percentages may not reflect current AI responses." | Suppress percentage. Show: "Import current data to see your citation share." |
| **"Ahead of You" KPI** | "N of M tracked competitors." | Unchanged (competitive position is relative within sample regardless). | Add: "Competitive rankings are based on stale data." | Suppress. |
| **Directional scope line** | "Directional — based on your tracked prompt sample, not a market census." | Append: "Limited sample." | Replace with: "Stale data — last observation {date}. Import fresh data before acting on these numbers." | Replace with: "No current data available." |
| **Sample quality tier** | Show label if moderate (optional). Hide if strong. | Always show. "Sample quality: limited" when applicable. | Always show. Append: "· data is stale." | Not shown (KPIs suppressed). |
| **Co-mention / Source Trust sections** | Normal display with "in N sampled answers." | Unchanged (denominator visible). | Add section-level warning: "Based on stale observation data." | Suppress sections or show: "Import data to see competitive intelligence." |

### Changes

| Element | Fresh | Aging | Stale | Critical |
|---------|-------|-------|-------|----------|
| **Scorecard scope line** | "Based on N linked matches across M topics. · Window: dates." | Add: "· limited sample" if `sample_quality_tier` is limited. | Replace with: "Attribution data is based on stale observations — import fresh data for reliable verdicts." | Suppress scorecard. Show: "Import current data to see your changes workspace." |
| **Attribution confidence labels** | "Strongest correlate" / "Possible correlate" as-is. | Unchanged (labels are already correlational, not causal). If limited sample: `confidence_basis` notes "limited sample." | Downgrade display: "Correlate (stale data)" — append staleness qualifier to confidence label. | Suppress attribution labels. |
| **Verdicts** | Normal display. | Unchanged. | Add per-row note: "Verdict based on stale data." | Suppress. |
| **Observation window label** | "Window: Mar 1 – Apr 5 (35d)." | Unchanged. | Append: "· observations may be outdated." | Not shown. |
| **ConfidenceBadge explanation** | Full `buildAttributionConfidenceBasis()` output. | Append "· limited sample" if applicable. | Append "· stale data — treat as directional only." | Badge suppressed. |

### Findings (component level)

| Element | Fresh | Aging | Stale | Critical |
|---------|-------|-------|-------|----------|
| **Per-finding provenance line** | "Observed in latest crawl · 2h ago." | "Observed in latest crawl · 4d ago" (age is self-evident). | "Observed in latest crawl · 18d ago — this finding may be outdated." | "Last crawl over 30 days ago — finding reliability is very low." |
| **Finding actionability** | Fully actionable. Accept / Reject / Ignore enabled. | Fully actionable. | Actionable but with warning: "This finding is based on a stale crawl. Re-scan to confirm before acting." | Accept / Reject still available but prefaced with: "These findings are from severely outdated data." |
| **Basis block** | Normal: "Basis: Compared consecutive full-site HTML snapshots." | Unchanged. | Append: "Crawl data is stale ({N} days old)." | Append: "Crawl data is critically outdated." |

---

## 5. Escalation Levels

Three levels of UI intensity, mapped to coverage states.

| Level | Visual treatment | When used |
|-------|-----------------|-----------|
| **Inline note** | Muted text (text-muted-foreground/60), appended to existing scope/denominator lines. No border, no background. | **Aging** — subtle qualifier. Operator notices it if they look; doesn't interrupt workflow. |
| **Warning strip** | Bordered strip or highlighted line (amber/orange background, visible border). Appears at section level above the affected content. | **Stale** — visible warning. Operator cannot miss it but content is still shown. |
| **Suppression / gate** | Content hidden or replaced with an import/scan CTA. Red accent if any content shown. | **Critical** — content is unreliable enough that showing it without intervention is misleading. |

### State → level mapping

| Coverage state | Escalation level | Reasoning |
|----------------|-----------------|-----------|
| **Fresh** | None | No escalation needed |
| **Aging** | **Inline note** | Data is usable but operator should be aware of the limitation |
| **Stale** | **Warning strip** | Data is questionable — operator should not act without awareness |
| **Critical** | **Suppression / gate** | Data is unreliable enough that displaying it as-is risks false conclusions |

---

## 6. Copy Transformation Rules

Concrete transformations for each escalation level on the most important copy strings.

### Confidence / evidence labels

| Normal (Fresh) | Aging | Stale | Critical |
|----------------|-------|-------|----------|
| "Strong evidence" | "Strong evidence (limited sample)" | "Based on stale data" | Suppressed |
| "Moderate evidence" | "Moderate evidence (limited sample)" | "Based on stale data" | Suppressed |
| "Early signal" | "Early signal (limited sample)" | "Based on stale data" | Suppressed |
| "Strongest correlate" | Unchanged | "Correlate (stale data)" | Suppressed |
| "Possible correlate" | Unchanged | "Possible correlate (stale data)" | Suppressed |

### Scope / denominator lines

| Normal (Fresh) | Aging | Stale | Critical |
|----------------|-------|-------|----------|
| "X% of N observations" | "X% of N observations · limited sample" | "X% of N observations · stale data" | Suppressed |
| "Based on N linked matches across M topics." | "Based on N linked matches across M topics · limited sample." | "Based on stale observations — import fresh data." | "No current data." |
| "Directional — based on your tracked prompt sample, not a market census." | Append: "Limited sample." | "Stale data — last observation {date}." | "No current data available." |

### All-clear / summary lines

| Normal (Fresh) | Aging | Stale | Critical |
|----------------|-------|-------|----------|
| "All clear — nothing changed since the last scan." | Suppressed (existing behavior) | Suppressed | Suppressed |
| "Your top move" (recommendation) | "Your top move (limited sample)" | "Your top move — based on stale data, verify before acting" | Suppressed |

### Finding provenance

| Normal (Fresh) | Aging | Stale | Critical |
|----------------|-------|-------|----------|
| "Observed in latest crawl · 2h ago" | "Observed in latest crawl · 4d ago" | "Observed in latest crawl · 18d ago — may be outdated" | "Last crawl over 30d ago — very low reliability" |

---

## 7. Interaction with Existing Proof-Layer Elements

### `sample_quality_tier`

- `limited` triggers **Aging** state on its own (Rule 3).
- `limited` modifies copy in every surface where it applies (Market, Changes, Today primary action).
- `moderate` and `strong` do not trigger escalation by themselves.
- When `limited` combines with `Stale` crawl, the state stays **Stale** (higher severity wins).

### `confidence_basis` (from 1.1f/1.1g)

- Under **Aging**: `buildAttributionConfidenceBasis()` output is unchanged but the calling surface may append "· limited sample."
- Under **Stale**: the calling surface appends "· stale data — treat as directional only."
- Under **Critical**: the `ConfidenceBadge` is not rendered.

### Denominator / scope notes (from 1.1e/1.1f)

- Already deployed: "of N observations," directional scope line, sample quality tier label.
- Under **Aging**: sample quality tier label is always shown (even for moderate/strong if another Aging trigger fires).
- Under **Stale**: scope notes are replaced with staleness warnings (see §6).
- Under **Critical**: scope notes are replaced with import CTAs.

### `HowWeKnowPanel`

- Under all states: the panel continues to show its normal content (crawl run IDs, row counts, dates, methodology text). This is factual provenance — it doesn't change under degradation.
- Under **Stale** and **Critical**: the panel gains an additional line: "Some metrics shown on this page may not reflect current conditions" (Stale) or "Data is critically outdated — import and scan before relying on any metric" (Critical).

### FAQ entries (from 1.1h)

- Q5 ("What if your data is stale?") is the canonical reference for staleness behavior. The methodology destination should link to it.
- Q12 ("How should I interpret 'sample quality: limited'?") is the reference for the Aging state driven by sample quality.
- Q7 ("What if the AI answered differently tomorrow?") addresses the fundamental volatility concern underlying all escalation rules.

---

## 8. Edge Cases

### Zero data (no imports, no scans)

- **State:** Critical (Rule 1: `isDemoMode = true` OR `resultsRowCount = 0` with no crawl).
- **Behavior:** All metric surfaces show import CTAs (already implemented via demo banners from Phase 2A). No metrics, no findings, no recommendations.
- **Findings:** No findings to display (no crawl has run). Finding section shows: "Run your first scan to detect changes."

### Fresh crawl + limited sample

- **State:** Aging (Rule 3: `sample_quality_tier = "limited"`).
- **Behavior:** Findings are fully actionable (crawl is fresh). Market metrics and attribution carry "(limited sample)" qualifiers. Recommendations are shown but with sample-quality caveat.
- **Rationale:** A fresh crawl means site-change detection is reliable. But competitive metrics and attribution depend on observation volume, which is limited.

### Fresh crawl + stale visibility

- **State:** Stale (Rule 2: `visibilityStaleVsCrawl = true AND crawlAgeDays > 7`) or Aging (Rule 3: `visibilityStaleVsCrawl = true AND crawlAgeDays <= 7`).
- **Behavior:** Findings are actionable (crawl is fresh). Market metrics and attribution carry staleness warnings. The mismatch is the key signal — the operator should import new visibility data to catch up with the crawl.
- **Copy:** Coverage strip: "Site crawl is current but visibility data is older — import fresh observations."

### Fresh visibility + stale crawl

- **State:** Stale (Rule 2: `crawlAgeDays > 14`) or Aging (Rule 3: `crawlAgeDays > 3`).
- **Behavior:** Market metrics are current (visibility data is fresh). Findings are stale (crawl is old). Attribution may be degraded (changes since last crawl aren't detected).
- **Copy:** Coverage strip: "Visibility data is current but the site crawl is {N} days old — changes since then aren't reflected."

### Rapid recency but low coverage

- **State:** Aging (Rule 3: `sample_quality_tier = "limited"`).
- **Behavior:** Even if the most recent import was yesterday, 50 observations don't produce reliable percentages. The sample quality trigger overrides recency.
- **Rationale:** Freshness alone doesn't make a thin sample reliable. The FAQ (Q12) explicitly addresses this.

### Conflicting surface states

- **Resolution:** One global coverage state applies to all surfaces. Individual surfaces may *additionally* suppress or modify their own content based on surface-specific conditions (e.g., Market suppresses KPIs under Critical; Changes suppresses scorecard). But the global state determines the *minimum* escalation level — no surface can escalate less than the global state.

### Operator overrides

- **Not supported in v1.** An operator cannot dismiss a staleness warning. This is intentional — the risk of an operator silencing a warning and then acting on stale data outweighs the annoyance. Revisit if operator feedback demands it post-launch.

---

## 9. Minimum v1 Implementation Slice

### What is required for v1

| # | Surface | What to implement | Priority |
|---|---------|-------------------|----------|
| 1 | **Global** | Extend `deriveCoverageTone()` to return the 4-state model (Fresh/Aging/Stale/Critical) using the trigger rules in §3. Preserve backward compatibility with existing callers. | P0 |
| 2 | **Today** | Wire coverage state into `shouldShowTodayAllClear()` — Aging blocks all-clear (already works for `partial`). Coverage strip renders based on state. | P0 |
| 3 | **Market** | Under Aging: always show sample quality tier. Under Stale: add section-level warning strip above KPI strip. Under Critical: suppress KPIs with import CTA. | P1 |
| 4 | **Changes** | Under Aging: append "· limited sample" to scope line. Under Stale: replace scope line with staleness warning. Under Critical: suppress scorecard with import CTA. | P1 |
| 5 | **Findings** | Under Stale: append "may be outdated" to provenance lines. Under Critical: prefix finding section with reliability warning. | P2 |

### States required for v1

All four: **Fresh, Aging, Stale, Critical.** The existing `CoverageTone` already implements three of four (ok, partial/degraded, critical). The new Aging state fills the gap between "everything fine" and "degraded."

### What can wait

| Item | Why it can wait |
|------|----------------|
| Per-section coverage states (different states for different surfaces) | Global state is sufficient for v1. Per-section adds complexity without proportional trust benefit. |
| Operator dismissal of warnings | Not needed until real operator feedback. |
| Automated score reweighting under degradation | Changes the scoring engine — much larger scope. |
| Push notifications for staleness | Alerting is out of scope for the proof layer. |
| Import-freshness tracking per source system | Only relevant when multiple import sources exist. |
| Historical coverage state logging | No operator use case yet. |

---

## 10. Out of Scope

| Item | Why deferred |
|------|-------------|
| **Full UI implementation** | This doc defines the rules; implementation is a future coding task. |
| **Automated reweighting of scores** | Attribution scores and recommendation priorities should not change under degradation in v1 — only the *display* and *framing* change. Reweighting is a domain-logic change with broader implications. |
| **Alerting / notification systems** | Push or email alerts for stale data are a Tier 2 concern. |
| **Advanced coverage analytics** | Coverage dashboards, historical trends, per-topic completeness — all Tier 2+. |
| **Prompt-bank governance** | Sample representativeness (are the right prompts being tracked?) is related to coverage but is a separate concern from freshness/staleness. |
| **Per-field staleness** | Tracking which individual fields are stale vs fresh within a single record adds complexity without clear v1 benefit. |
| **Multi-source import tracking** | When Beacon supports multiple import sources, per-source freshness will matter. Single-source v1 doesn't need it. |

---

## 11. Implementation Handoff Notes

### Likely files to be touched

| File | Change type | Safe? |
|------|------------|-------|
| `src/lib/today-proof-context.ts` | Extend `CoverageTone` type to include `"aging"` (or add a parallel `CoverageState` type). Extend `deriveCoverageTone()` with Aging rules. | Safe — additive. Existing callers treat any non-`"ok"` as degraded, so adding `"aging"` won't break them if they use `!== "ok"` checks. Verify each callsite. |
| `src/lib/today-ritual.ts` | Update `shouldShowTodayAllClear()` to block on `"aging"` state (if not already blocked by `coverageTone !== "partial"`). | Safe — already blocks on `partial`; `aging` should also block. |
| `src/lib/sample-quality-tier.ts` | No change — thresholds already defined. Consumed by escalation rules. | — |
| `src/app/(shell)/today-data.ts` | Compute coverage state and pass to `TodayClient`. May need to derive `lastImportAt` age for Rule 2. | Safe — read-only computation. |
| `src/app/(shell)/competitors/page.tsx` | Conditionally render warning strip under Stale/Critical. Suppress KPIs under Critical. | Safe — additive conditional rendering. |
| `src/app/(shell)/changes/scorecard-client.tsx` | Modify scope line text based on coverage state. Suppress under Critical. | Safe — copy changes only. |
| `src/components/today/today-findings.tsx` | Append staleness note to provenance line under Stale. | Safe — additive string. |
| `src/components/today/today-visibility-snapshot.tsx` | Render coverage strip color/copy based on state. | Safe — already handles `CoverageTone` values. |
| `src/components/shell/data-freshness-strip.tsx` | Potentially add coverage state indicator. | Safe — presentational component. |

### Safest first integration points

1. **Extend `deriveCoverageTone()` or add `deriveCoverageState()`.** This is the single function that all downstream surfaces should read from. The existing 4-way switch is the natural place to add the Aging check between `ok` and `partial`/`degraded`.

2. **Wire into Today first.** Today already consumes `CoverageTone` via `deriveCoverageTone()` in multiple places (visibility snapshot, all-clear, coverage strip). Adding Aging here is the smallest delta.

3. **Market second.** The Market page already shows `sample_quality_tier` and the directional scope line. Adding a warning strip under Stale is a single conditional block.

4. **Changes third.** The scorecard scope line already exists. Modifying its text based on coverage state is a string interpolation change.

5. **Findings last.** Provenance lines already include `relativeAge`. Appending a staleness note is the simplest change.

### Testing considerations

- **Unit test:** `deriveCoverageState()` (or extended `deriveCoverageTone()`) should have a test per trigger rule. 8–10 test cases covering each rule + precedence.
- **Snapshot tests:** Verify that existing route smoke tests still pass — the state computation is read-only and shouldn't break rendering, but suppressed content under Critical could change HTML output.
- **Edge case tests:** Zero-data, conflicting signals (fresh crawl + stale visibility), and limited sample should each be explicit test cases.
- **Backward compatibility:** If `CoverageTone` is extended (vs a new type), verify all existing `=== "ok"` and `!== "ok"` comparisons still work correctly. Consider using a new `CoverageState` type consumed only by new escalation code.

### Recommended approach: new type vs extending existing

**Recommendation: Add a new `CoverageState` type** rather than modifying `CoverageTone`.

- `CoverageTone` is consumed by `shouldShowTodayAllClear`, visibility snapshot component, and coverage strip. Changing its values could break these callsites.
- A new `CoverageState` type with `"fresh" | "aging" | "stale" | "critical"` can be computed alongside `CoverageTone` and consumed by new escalation code only.
- A mapping function `coverageStateFromTone(tone: CoverageTone, ctx: TodayProofContext): CoverageState` provides backward compatibility.

---

## Appendix A: Existing Threshold Map

For reference, all freshness/coverage thresholds currently in the codebase.

| Threshold | Value | Where defined | Used for |
|-----------|-------|---------------|----------|
| Crawl stale | >14 days | `today-data.ts` line ~870 | `crawlStale` on `TodayProofContext` |
| Coverage degraded (crawl) | >14 days + crawlStale | `deriveCoverageTone()` | `CoverageTone = "degraded"` |
| Coverage critical (crawl) | >30 days | `deriveCoverageTone()` | `CoverageTone = "critical"` |
| Scan overdue | past preferred hour + no scan today | `isScanOverdue()` | Trigger auto-scan |
| Stale running scan | >5 minutes | `STALE_SCAN_THRESHOLD_MS` | Crash recovery |
| Sample limited | <200 observations | `SAMPLE_QUALITY_LIMITED_BELOW` | `sample_quality_tier = "limited"` |
| Sample moderate | 200–1000 | `SAMPLE_QUALITY_MODERATE_AT_OR_BELOW` | `sample_quality_tier = "moderate"` |
| Sample strong | >1000 | Implicit | `sample_quality_tier = "strong"` |
| Too early (attribution) | <14 days since change | `TOO_EARLY_DAYS` in `scorecard.ts` | `verdict = "too_early"` |

## Appendix B: FAQ Cross-Reference

| Coverage state | Directly addressed by FAQ |
|----------------|--------------------------|
| **Aging** (limited sample) | Q6 (prompt count), Q12 (sample quality limited) |
| **Aging** (crawl aging) | Q16 (changed since crawl) |
| **Stale** | Q5 (stale data), Q7 (AI variability) |
| **Critical** | Q5 (stale data), Q14 (sharing numbers — don't share critical-state data) |

## Appendix C: Forbidden Claims Protection

| Forbidden claim | How escalation protects |
|-----------------|------------------------|
| F7 — "Complete picture" | Aging/Stale states explicitly flag incomplete or outdated data |
| F18 — "Data is current" when stale | Stale state prevents this claim by replacing scope lines with staleness warnings |
| F2 — Unqualified "market share" | Limited sample Aging state appends "limited sample" to denomination |
| F4 — "Will improve visibility" | Stale state suppresses or qualifies recommendation confidence labels |
| F17 — Unqualified "high confidence" | Limited sample Aging state appends "(limited sample)" to evidence labels |

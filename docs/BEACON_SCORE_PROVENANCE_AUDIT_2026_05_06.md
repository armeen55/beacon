# Beacon Score Provenance Audit — 2026-05-06

**Trust Sprint Phase 1 (1.A + 1.B). Read-only audits, two parallel agents.**

> Operator framing: "I do not fully trust scores or visibility math." Be brutal. No hype. No "probably." Every claim points to file:line, table, denominator, numerator, failure mode.

Scope: every score visible on `/today` — composite visibility, mention/citation counts, ChatGPT/Perplexity primary %, competitor leaderboard share-of-voice, share-capture banner, prompt categorization (winning/weak/close/absent/outranked/early).

Two-line summary: math is sound on stationary native-only days; **the engine is undefended against (a) brand-vs-competitor formula asymmetry on the leaderboard, (b) silent fallback to all-time Profound `results` totals when the derived KPI table has no row, (c) mixing of pre-cutover Profound rows with native rows in the chart compositor, (d) the "Share Capture" banner's coincidence-detector math.** Every operator-visible number on `/today` should be read as DIRECTIONAL until at least one of these is closed.

---

## Phase 1.A — /today headline scores

### 1. Overall visibility (chart headline)

| # | Question | Answer |
|---|---|---|
| 1 | Source store | `prompt_answer_observations` (Supabase, via `tenantRepo.getPromptAnswerObservations({ since })`) → `promptAnswerObservations` in render scope. |
| 2 | Query/filter | `loadFreshCanonicalData` (`canonical-store.ts:294-320`) with `observed_at >= since`. `today-data.ts:2218` calls `computeVisibilityTimeSeries({ metric:'composite', startDate, endDate })`. |
| 3 | Date window | Server precomputes 60d series — `chartStartDate = today − 59d`, `chartEndDate = today UTC` (`today-data.ts:2203-2211`). Client slices to 7/14/30/60d on toggle (`visibility-score-chart.tsx:80-85`, default 14d at line 101). |
| 4 | Platform inclusion | `obs.platform ?? "unknown"` — bucketed; ALL platforms participate (`visibility-score.ts:214`). **Case-sensitive raw string** — `"chatgpt"` vs `"ChatGPT"` would split into separate per-platform buckets (no `canonicalizePlatform` in `computeVisibilityTimeSeries`, unlike `enrichment-rollup.ts:181`). |
| 5 | samplingStatus | **Composite metric does NOT downgrade for proof/partial sampling.** `aggregateSamplingStatus` (`poll-health.ts:392`) is computed separately for the headline KPI tile (`today-data.ts:1442-1445`) but **NEVER fed into `computeVisibilityTimeSeries`**. The chart treats a 5-obs proof day identically to a 100-obs full day. |
| 6 | Denominator | Per day, per platform: `p.obs` (count of observations on that platform that day). Then averaged across sampled platforms (`visibility-score.ts:256`). |
| 7 | Numerator | `p.cited` per platform (count where `tracked_brand_cited === true`), divided by `p.obs` to give a per-platform rate; averaged across platforms. |
| 8 | Partial chunks | **INCLUDED.** Any observation with `observed_at` in window counts equally — no chunk-completion gate. May 6 chunk-0 (24/25 prompts) feeds the score with the same weight as a complete day. |
| 9 | Pre-cutover Profound data | **NOT directly** — `prompt_answer_observations` is the native-poll table. However W4 historical_recovered rows live in this same table with capitalized platform labels ("ChatGPT") and would mix with native lowercase. Boundary is implicit (data origin), not enforced in code. |
| 10 | Failure modes | (a) `bucket.length === 0` skips date entirely (`visibility-score.ts:199`) → phantom gaps. (b) `sampledPlatformRates.length === 0` returns `0` (line 253) → no observations becomes 0% silently. (c) **Case-mismatch**: native "chatgpt" vs imported "ChatGPT" produce separate per-platform rates that get averaged together, double-weighting that platform. (d) `tracked_brand_cited` is null on imported rows → counted as not-cited. |

**Verdict: DIRECTIONAL ONLY.** Math sound on native-only days; no sampling gate, no platform canonicalization in the engine, silent mixing of historical_recovered + native rows.

### 2. Mentions count (headline tile)

| # | Question | Answer |
|---|---|---|
| 1 | Source store | `daily_metric_snapshots` when `todayKpis !== null`; **else fallback to `results` table** (legacy Profound, all-time). |
| 2 | Query | `today-kpis.ts:46-57` — `select(...).eq("date", dateISO).eq("source_type","derived").eq("scope_type","platform")`. |
| 3 | Date window | Single day. `todayISO = now.toISOString().slice(0,10)`, fallback to yesterday (`today-kpis.ts:92-105`). |
| 4 | Platform inclusion | All `scope_type='platform'` rows for that date. No per-platform filter. |
| 5 | samplingStatus | **YES — passively surfaced**, not used to gate the number. `derivedKpiSamplingStatus` (`today-data.ts:1442-1445`) renders as a tag. The count itself is not adjusted: a proof day's 5-mention total is shown raw alongside a "proof" tag. |
| 6 | Denominator | None — raw count. |
| 7 | Numerator | `Σ row.mention_count` across platform rows for the date (`today-kpis.ts:71-72`). |
| 8 | Partial chunks | **INCLUDED.** `daily_metric_snapshots` is rebuilt from observations regardless of chunk completion. May 6 chunk-0 (24/25) means mention_count reflects only 24 prompts. |
| 9 | Pre-cutover Profound data | **YES via fallback path.** When `todayKpis === null` the tiles fall through to `visibilitySummary.totalMentions` (`today-data.ts:1413-1415`) — the entire `results` table all-time sum, no date filter. |
| 10 | Failure modes | (a) Null `mention_count` coerced to 0 (`today-kpis.ts:71`). (b) **Fallback to all-time `results` sum is dramatically different in magnitude than 1-day derived count — operator can be looking at "today" or "5 years of Profound" depending on a Supabase hiccup.** (c) No tenant filter on `daily_metric_snapshots` query — relies on RLS / single-tenant assumption. |

**Verdict: DIRECTIONAL ONLY.** Headline accurate when derived rows exist; failure mode silently swaps in an all-time Profound total.

### 3. Citations count (headline tile)

Same source/query as Mentions; numerator is `Σ row.citation_count` (`today-kpis.ts:70`). Same fallback to `visibilitySummary.totalCitations` (`results.reduce((s,r)=>s+r.citation_count,0)`, `today-data.ts:625`). Same failure modes.

**Verdict: DIRECTIONAL ONLY.** Identical to Mentions — silent fallback to all-time Profound results when Supabase rows are missing.

### 4. ChatGPT primary % (per-platform)

| # | Question | Answer |
|---|---|---|
| 1 | Source store | `prompt_answer_observations` (native-poll only — Schema-v2 `primary_recommendation` field). |
| 2 | Query/filter | `enrichment-rollup.ts:723 buildPlatformPrimaryRateSparklines` — `inWindow(o, startDate, endDate)` and `o.platform` after `canonicalizePlatform` (line 738). Headline displays the **latest sampled point** with non-null primaryRate (`enrichment-v2.tsx:385-387`). |
| 3 | Date window | `windowDays = 14` default (`enrichment-rollup.ts:726`). End date = `todayISOUtc()`. |
| 4 | Platform inclusion | `canonicalizePlatform(o.platform)` — case-insensitive match for "chatgpt"/"ChatGPT"/"perplexity" (`poll-health.ts:200`). Rows lacking `primary_recommendation` are excluded; if NO obs carries the field, returns `[]` (line 759). |
| 5 | samplingStatus | **YES, soft.** `classifySample(totalObservations)` produces `sampleStatus`; UI labels "(early data)" when "thin" (`enrichment-v2.tsx:404-407`). Number itself not gated. |
| 6 | Denominator | `day.obs` — observations on that platform that day. |
| 7 | Numerator | `day.primary` — count where `o.primary_recommendation === true`. |
| 8 | Partial chunks | **INCLUDED.** No chunk gate. May 6 chunk-0's 24 ChatGPT obs would form the latest point's denominator. |
| 9 | Pre-cutover Profound | **EXCLUDED in practice** — `primary_recommendation` is Schema-v2 native; Profound rows lack it (line 759). W4 historical_recovered rows could mix in if they carry the flag. |
| 10 | Failure modes | (a) **Headline shows the *latest* sampled day, not the window average** — a single-prompt proof day could read "Primary 100%" or "0%". (b) If `primary_recommendation` is `null` (not `false`), numerator drops it but denominator still counts it → silent rate suppression. |

**Verdict: DIRECTIONAL ONLY.** Headline is "latest day rate" not "window rate" — high variance on small-sample days.

### 5. Perplexity primary % (per-platform)

Identical code path to ChatGPT — same `buildPlatformPrimaryRateSparklines`, same `canonicalizePlatform("perplexity")` (`poll-health.ts:200`), same denominator/numerator. **Verdict: DIRECTIONAL ONLY.** Same concerns; Perplexity historically has lower sample volume per chunk so "latest day" volatility is worse.

### Cross-cutting findings (Phase 1.A)

- **No live Supabase row counts taken in this audit** — code-only. Mark all post-cutover row counts UNVERIFIED until cross-checked against `prompt_answer_observations`.
- **The KPI tile and the chart headline can disagree.** KPI tile reads `daily_metric_snapshots` (single day); chart reads `prompt_answer_observations` (60d composite). Related but not identical pipelines.
- **Tenant isolation** is present in `loadFreshCanonicalData` (`canonical-store.ts:306-308`) but **NOT** in `fetchTodayDerivedKpis` (`today-kpis.ts:46-52`) — the KPI tiles trust RLS / single-tenant deployment.
- **`visibilitySummary` uses ALL `results` rows** with no tenant or date filter for the fallback totals — this is the Profound-cliff hazard called out in the code comment but still live.

---

## Phase 1.B — leaderboard + prompt categorization

### Score 1 — Competitor Leaderboard Visibility

| # | Field | Detail |
|---|---|---|
| 1 | Source | `prompt_answer_observations` via `loadFreshCanonicalData()` (`canonical-store.ts:294-332`, tenant-scoped). Read at `today-data.ts:303-310`. |
| 2 | Query/filter | `tenantRepo.getPromptAnswerObservations({ since: observationsSince })` — DB-side `observed_at >= since`. **No native-regime filter**, no platform filter, no `tenant_id` re-check (relies on `tenantRepo.forTenant`). |
| 3 | Date window | TWO layers. Outer load: 60d (`today-data.ts:297`). Inner: `LEADERBOARD_WINDOWS = [7, 14, 30, 60]` (`today-data.ts:2239`). Default visible = 14d. |
| 4 | Platform inclusion | ALL — aggregator does not filter by platform (`visibility-score.ts:467-555`). Sums across `chatgpt`, `perplexity`, `google_aio`, plus mixed-case Profound legacy strings. |
| 5 | samplingStatus | **NO downgrade for partial-day sampling within a day.** Only the *delta column* downgrades: `minSampledDaysForDelta(windowDays) = max(2, ceil(windowDays/3))` (`visibility-score.ts:81-83`). Score itself is `count / totalInWindow * 100`. |
| 6 | Denominator | `totalInWindow` = total observations across ALL platforms (`visibility-score.ts:494`). Brand and competitors use the same denominator. |
| 7 | Numerator | **Brand and competitor numerators are different.** Competitor: count where `mentions[]` contains the entity slug, threshold ≥3 mentions (`visibility-score.ts:543`). Brand: `tracked_brand_mentioned === true` OR alias scan (`visibility-score.ts:144-155`); brand score = `mentionRate` or `composite(mentionRate, citationRate)` with **position-weight** on citations (`visibility-score.ts:524-525, 132-141`). Competitors get raw `count/total*100`, no position weight. **Brand and competitor scores are NOT computed the same way.** |
| 8 | Partial chunks | Yes. Any obs whose `observed_at >= startDate` participates regardless of completeness. |
| 9 | Profound/imported influence | **YES — fully mixed in.** No `NATIVE_REGIME_START` guard in `visibility-score.ts` (verified — only `observed_at` references at lines 187, 288, 492, all date-window comparisons). Pre-2026-04-22 Profound rows with populated `mentions[]` count the same as native rows. The classifier guards (`opportunity-classify.ts:139-150`); the leaderboard does not. |
| 10 | Failure modes | (a) **Mention case-sensitivity**: leaderboard normalizes via `slugifyEntity` ✅, but per-platform breakdown (`computeVisibilityTimeSeriesByPlatform`, line 282) does NOT canonicalize platform — splits "Perplexity" vs "perplexity" into separate buckets. (b) **Substring collisions**: whole-string slug match — "Bay Builders" inside "South Bay Builders Inc" wouldn't match unless extractor put exact substring. UNVERIFIED whether the upstream extractor does that. (c) **Entity-pollution-filter applied** at `today-data.ts:2256` ✅; but filter's metadata-trust rule (`entity-pollution-filter.ts:101-106`) lets ANY entity tagged `competitor`/`brand` with any `domain` through — even generic names — so a miscategorized "Houzz" still ranks. (d) **Competitor de-duping**: by `slugifyEntity(name)` only — "De Mattei Construction" vs "DeMattei Construction" → different slugs. |

**Verdict: DIRECTIONAL ONLY.** Ordinal ranking is reasonable; but **brand row uses position-weighted citation formula while competitors use a flat mention-rate formula, and Profound legacy data dilutes the window. The "X% share-of-voice" number is not strictly comparable across rows.**

### Score 2 — Share Capture banner

| # | Field | Detail |
|---|---|---|
| 1-4 | Source/window/platforms | Derived purely from leaderboard above. No new data load. Same 14d default window. |
| 5 | samplingStatus | Inherits leaderboard. Banner only fires when `brandRow.delta !== null` (`visibility-leaderboard.tsx:55`). |
| 6-7 | Threshold | brand `delta > 0.5` AND ≥1 top-5 competitor with `delta < -0.5` (`visibility-leaderboard.tsx:50, 56`). Hardcoded ±0.5pt. NOT a "share of total mentions" — a per-row delta-coincidence test. |
| 10 | Failure modes | (a) **The label "Share capture" is misleading.** Math is "your ppt up while ≥1 of top-5 ppt down by ≥0.5". Does NOT verify mentions were redistributed competitor → brand. Two unrelated platforms can move oppositely with no causal link. (b) Top-5 only — a competitor outside top-5 losing share while you gain doesn't trip it. (c) Brand-row delta uses position-weighted citation rate, competitor rows use flat mention rate → "delta" units aren't apples-to-apples. |

**Verdict: UNRELIABLE.** Copy promises causal "share capture"; math is just a coincidence detector across two formulas that aren't dimensionally equal.

### Score 3 — Prompt category counts

`buildPromptDecisionMatrix` (`today-data.ts:500-505`) → `opportunity-classify.ts`.

| # | Field | Detail |
|---|---|---|
| 1-2 | Source | Same `prompt_answer_observations` store. Per-prompt filter (`opportunity-classify.ts:146-150`): `o.prompt_id === args.prompt.id && o.observed_at.slice(0,10) >= effectiveStart`. `activePrompts = prompts.filter(p => p.is_active)`. |
| 3 | Date window | `lookbackDays = 7` (default at `opportunity-classify.ts:96`). **Clamped forward to `NATIVE_REGIME_START = "2026-04-22"`** — `effectiveStart = max(lookbackStart, NATIVE_REGIME_START)` (`opportunity-classify.ts:139-145`). |
| 4 | Platform inclusion | ALL platforms; case-normalized to lowercase (`opportunity-classify.ts:170`). "ChatGPT"/"chatgpt" merge correctly here. |
| 5 | samplingStatus | **YES — explicit downgrade.** <`minObservationsForCategory = 3` total obs → forced into `"early"` (`opportunity-classify.ts:296-309`). Within Winning, **per-platform** also requires ≥3 obs (lines 316-318). |
| 6-7 | Thresholds | **Early**: `relevant.length < 3`. **Winning**: any platform with `p.primary / p.observations >= 0.5` AND `p.observations >= 3` (`winningPrimaryRate=0.5`); first match wins. **Outranked**: `primaryCount===0 && citedCount===0 && mentionedCount===0` AND `dominantCompetitors.length >= 2` (lines 343-348). `outrankedMinCompetitors=2`. dominantCompetitors = competitor names appearing in `o.competitor_co_mentions[]` of ≥2 obs. **Close**: `!brandTrulyAbsent && primaryCount === 0`. **Absent**: fallback. **No "weak" category** — operator's question conflates `absent` + `outranked`. |
| 8 | Partial chunks | Included. `>= effectiveStart` is date-only string comparison. |
| 9 | Profound/imported | **NO** — native-regime guard at `opportunity-classify.ts:139-150` correctly forces `effectiveStart >= "2026-04-22"`. ✅ |
| 10 | Failure modes | (a) **`competitor_co_mentions` is null on pre-Apr-22 rows** — combined with regime filter, consistent. But native rows that haven't been re-extracted have `null` → contribute 0 dominantCompetitors → could under-count Outranked. (b) **Entity-pollution-filter NOT applied to prompt classifier.** Filter is consumed only by `visibility-score.ts:21, 366`; classifier filters `competitor_co_mentions` only by "is in `ownedEntityNames`" (line 213). If extractor wrote "Houzz" or "General Contractors" into `competitor_co_mentions`, it counts toward `dominantCompetitors` → falsely trips Outranked. UNVERIFIED whether extractor populates that field with directories. (c) **Case-sensitive name matching** in `competitor_co_mentions` — `Map.set(name, ...)` with no normalization (`opportunity-classify.ts:214`). "De Mattei" / "de mattei" are distinct. (d) **`is_active` filter only at `decision-matrix.ts:102`** — direct callers (`prompt-drilldown.ts:121`) bypass. |

**Verdict: TRUSTWORTHY for "early" + "winning" on prompts with ≥3 native obs on a single platform. DIRECTIONAL ONLY for "outranked" — depends on extractor's `competitor_co_mentions` quality and lacks the entity-pollution-filter the leaderboard uses.**

### Cross-cutting findings (Phase 1.B)

- **Lookback inconsistency on the same /today page.** Classifier = 7d clamped to native regime; leaderboard default = 14d (toggle 7/14/30/60), no native clamp. The two surfaces disagree on what "recent" means.
- **Entity-pollution-filter coverage mismatch.** Applied at `visibility-score.ts:366` (leaderboard) ✅. NOT applied in `opportunity-classify.ts` (verified: no import). UNVERIFIED whether `competitor-primary.ts` calls it.
- **Brand vs competitor formula asymmetry on the leaderboard** is the single most material unfairness — brand gets composite + position-weight; competitors get flat mention rate. Cited at `visibility-score.ts:520-552`.

---

## Combined verdicts (Phase 1)

| Score | Verdict | Why |
|---|---|---|
| Composite visibility (chart) | DIRECTIONAL | No sampling gate; case-mismatch hazard; mixes native + historical_recovered. |
| Mentions / Citations tile | DIRECTIONAL | Silent fallback to all-time Profound `results` total. |
| ChatGPT primary % | DIRECTIONAL | Headline = latest day rate, high variance on small samples. |
| Perplexity primary % | DIRECTIONAL | Same as ChatGPT, lower volume. |
| Competitor leaderboard share | DIRECTIONAL | Brand vs competitor formula asymmetry; Profound row dilution. |
| Share Capture banner | **UNRELIABLE** | Coincidence detector marketed as causal. |
| Prompt category — early / winning | TRUSTWORTHY | `≥3 obs` gate + native regime guard. |
| Prompt category — outranked | DIRECTIONAL | No pollution filter; case-sensitive co-mentions. |
| Prompt category — close / absent | DIRECTIONAL | Same dependencies as outranked. |

**Recommended capability for next step:** Balanced — Phase 1 fixes (gate composite by samplingStatus, canonicalize platform in engine, replace fallback to all-time `results` with hard-fail empty-state, flatten leaderboard formula across rows, retire Share Capture banner OR re-label as "co-incidence", apply pollution filter to classifier) are bounded behavioral edits across ~6 files.

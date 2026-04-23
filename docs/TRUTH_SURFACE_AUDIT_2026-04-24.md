# Truth-Surface Audit — 2026-04-24

**Context.** Beacon pivoted on 2026-04-22 from Profound CSV imports to native
Perplexity + OpenAI polling. Commit 2 of the "Replace Profound in 2 weeks"
phase audited every daily-use surface for silent-lies: where is the rendered
data actually coming from, is it trustworthy post-pivot, and what ships in
this commit vs what waits for a dedicated follow-up.

**Summary.** The single biggest silent lie is: `citation_evidence_index` is
frozen at the last Profound import build (2026-04-15, 9 days ago) and four
daily-use surfaces silently render rankings / counts from it — /pages,
/competitors, /topics, /changes. Native-poll data from Apr 22+ is written to
`prompt_answer_observations` and `daily_metric_snapshots` but is NOT yet
rebuilt into the citation evidence index. Today's KPI tiles are the single
exception: they read raw `prompt_answer_observations` and reflect current
native data correctly.

## Verdict table

| Surface | Data source | Trustworthy post-pivot? | Fixed in this commit? | Needs dedicated commit? |
|---|---|---|---|---|
| Today — poll-health strip | `observation_runs` via `poll-health.ts` | Yes — live native | Commit 1 (shipped) | No |
| Today — KPI tiles (total citations, mentions) | raw `prompt_answer_observations` canonical store | Yes — reads native directly | No code change needed | Commit 5 (flip to derived snapshots for architectural alignment) |
| Today — visibility chart + leaderboard | raw `prompt_answer_observations` canonical store | Yes — reads native directly | No code change needed | Commit 5 (possibly flip to derived; raw obs have the per-day granularity charts need) |
| Today — freshness banner | `promptAnswerObservations` latest `observed_at` | Yes — live native | No change | Commit 7 (Profound copy replacement) |
| /pages — per-URL citation counts | `citation_evidence_index` (frozen 2026-04-15) | **No — silently stale** | Yes — honesty banner mounted (`EvidenceFreshnessBanner`) surfaces the cutoff | Commit 7 (full native-citation rebuild) |
| /competitors — rankings, co-mention matrix, battlecards | `citation_evidence_index` + `citationEvidenceIndex.topCompetitors` | **No — silently stale** | Yes — honesty banner mounted | Commit 7 (full native-citation rebuild) |
| /topics — topic rankings, frontier opportunities | `citation_evidence_index.by_page_and_topic` + `by_topic` | **No — silently stale** | Yes — honesty banner mounted | Commit 7 (full native-citation rebuild) |
| /changes — Z-score verdicts | `url-citation-history` (Profound cold-store shards only) | **Partial lie** — engine is source-homogeneous (Profound only) but no indicator that native data exists and isn't integrated | Yes — honesty banner mounted + engine-level source-type guard added (`DailyPoint.source_type`, `not_enough_native_baseline` verdict when pre/post windows are pure-split) | Commit 7 (full partial-overlap mixed-window math + native series integration) |
| /review | Current — not touched this commit | Unknown | No | Possibly Commit 5 |

## What this commit shipped

1. **Shared `EvidenceFreshnessBanner` component** — `src/components/shell/evidence-freshness-banner.tsx`. Reads `citation_evidence_index.built_at`, renders a compact strip with the build date, age in days, and a plain-English explanation that native polls are running but not yet integrated into the evidence index. Amber tint when age ≥ 3 days (currently true).
2. **Banner mounted on 4 surfaces** — /pages (per-URL citation counts), /competitors (rankings), /topics (topic rankings), /changes (Z-score verdicts).
3. **Engine-level source-type guard** — `src/domains/attribution/url-verdict.ts` gains an optional `source_type: "benchmark" | "derived"` tag on every `DailyPoint`. When the baseline window is entirely one source and the post-change window is entirely the other (pure split), the engine returns a new verdict `not_enough_native_baseline` with an operator-facing explanation, instead of silently Z-scoring across measurement systems. Back-compat: when any point is untagged, the guard does not fire.
4. **Tagged Profound shards as `source_type="benchmark"`** — `denseSeries()` in `url-citation-history.ts` now stamps every emitted point as benchmark. Sets up the guard to fire automatically when Commit 7 adds native observations to the series.
5. **Tests** — 6 new test cases in `url-verdict.test.ts` covering pure-split abstain, same-source benchmark, same-source derived, untagged back-compat, internally-mixed baseline, no-split same-source. Full suite 23/23 pass.

## What's explicitly deferred to Commit 7

- **Full partial-overlap mixed-window math.** Current guard only fires on the pure-split case (baseline all-benchmark, post all-derived). When Commit 7 integrates native citations into `url-citation-history`, changes near the Apr 21/22 boundary will have partially-overlapping windows that need smarter math (e.g. post-window uses only derived days, baseline uses only benchmark days; or source-normalized Z-score).
- **Rebuild `citation_evidence_index` from native observations.** This is the root fix for the /pages, /competitors, /topics silent-lies. Currently only the Profound import orchestrator builds the index. Native poll needs its own post-poll index rebuild (or a unified rebuild that reads both sources).
- **Replace the honesty banner with "live native data" language** once the rebuild lands.

## What was checked and found trustworthy

- **Today KPI computation** (`today-data.ts`): reads raw `prompt_answer_observations`, no hard `source_type="benchmark"` filter or Profound-only reads found. The banner on Today is the poll-health strip (Commit 1), not an evidence-freshness banner.
- **Daily metric snapshots (derived rows)**: `daily_metric_snapshots` with `source_type="derived"` are being written correctly per the 04-23 Supabase query (Perplexity 51.5% / ChatGPT 59.83% visibility for platform-scope rows). Today's KPI tiles don't read these yet (Commit 5 flips them), but the underlying data is healthy.
- **observation_runs**: healthy native-poll rows for 04-22, 04-23. Poll-health canary (Commit 1) verifies this automatically daily.

## Ongoing watch items

- `citation_evidence_index.built_at` will stay at 2026-04-15 until Commit 7 rebuilds it. The banner surfaces the staleness accurately; operator always knows.
- Any NEW surface added that reads `citation_evidence_index` should also mount `EvidenceFreshnessBanner` until the native-integration commit lands.

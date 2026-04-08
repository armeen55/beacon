# Source Map — Profound → Beacon Canonical Types

Last verified: 2026-04-07

## Source → Canonical Type Mapping

| Source File | Rows | → Canonical Type | Notes |
|-------------|------|-----------------|-------|
| `prompts_export.csv` | 100 | `TrackedPrompt` | **Primary seed** — has Profound UUIDs |
| `profound_raw_data_with_citations.csv` | 9,596 | `PromptAnswerObservation` | One per execution |
| `profound_raw_data_with_citations.csv` | ~99 groups | `ObservationRun` | Group by (date, platform) |
| `profound_citations_data.csv` | 85,004 | `CitationObservation` | **Primary citation source** |
| `profound_summarized_export.csv` | 16,623 | `DailyMetricSnapshot` (benchmark only) | NOT source of truth |
| `profound_summarized_export.csv` | 1,848 assets | `TrackedEntity` (candidates only) | Requires classification |
| `imported-changes.json` | 83 | `Change` | Existing changelog |
| Citation hostnames | ~700+ | `TrackedEntity` (supplement) | Domain-based classification |

## Primary Keys / Identity

| Source File | Natural Key | Unique? | Verified |
|-------------|------------|---------|----------|
| Prompts export | `ID` (UUID) | Yes | 100/100 |
| Raw executions | `run_id` | Yes | 9,596/9,596 |
| Raw executions | `(prompt, platform, date)` | Yes | Zero dupes |
| Citations | `(run_id, row_position)` | Yes | Implicit from file order |
| Citations | `(run_id, url)` | 99.98% | 20 duplicate pairs |
| Summarized | `(date, asset, platform)` | Yes | 16,623/16,623 |

## Join Keys Between Files

```
prompts_export.Prompt <==exact==> raw_executions.prompt (100/100 match)
raw_executions.run_id <==FK==> citations.run_id (9,473 of 9,596)
citations.hostname <==lookup==> tracked_entities.domain
raw_executions.topic <==exact==> prompts_export.Topic (12/12 match)
changes.topic_targeted <==fuzzy==> raw_executions.topic (needs normalization)
changes.url <==domain match==> citations.hostname
```

**IMPORTANT:** Prompts export UUIDs do NOT appear in the raw execution file.
The join between them is via exact `prompt` text matching.

## Data Flow

```
Source Layer (CSV imports, one-time)
  │
  ├─ prompts_export.csv ──────→ TrackedPrompt (100 rows, with Profound IDs)
  │
  ├─ raw_executions.csv ──────→ ObservationRun (group by date × platform, ~99 runs)
  │                        ──→ PromptAnswerObservation (9,596 rows)
  │
  ├─ citations.csv ───────────→ CitationObservation (85,004 rows)
  │
  ├─ summarized.csv ──────────→ DailyMetricSnapshot (benchmark import, 16,623 rows)
  │                        ──→ TrackedEntity candidates (1,848, requires classification)
  │
  └─ imported-changes.json ──→ Change (83 rows, existing)

Canonical Layer (JSON stores)
  │
  ├─ TrackedPrompt          100 rows        hot
  ├─ TrackedEntity          ~200 rows       hot (after classification)
  ├─ ObservationRun         ~99 rows        hot
  ├─ PromptAnswerObs        9,596 rows      hot (without answer_text)
  ├─ CitationObservation    85,004 rows     cold (lazy-loaded)
  ├─ DailyMetricSnapshot    ~20K rows       hot
  ├─ Change                 83 rows         hot
  ├─ answer_texts           9,596 entries   cold (on-demand)
  │
Derived Layer (computed on demand, cached in JSON)
  │
  ├─ OutcomeEvent ← detected from DailyMetricSnapshot time series
  ├─ CandidateCause ← matched OutcomeEvent × Change
  └─ EventDecision ← operator input (persisted)
```

## Import Order (dependency chain)

1. **TrackedPrompt** ← from prompts_export.csv (has Profound IDs)
2. **TrackedEntity** ← from citation hostnames + summarized assets (classify, then promote)
3. **ObservationRun** ← from raw_executions.csv grouped by (date, platform)
4. **PromptAnswerObservation** ← from raw_executions.csv (FK → run + prompt)
5. **CitationObservation** ← from citations.csv (FK → prompt_answer via run_id)
6. **DailyMetricSnapshot** ← derive from observations + import summarized as benchmark
7. **OutcomeEvent** ← derive from snapshot time series
8. **CandidateCause** ← cross-match events × changes

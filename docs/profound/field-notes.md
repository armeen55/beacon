# Field Notes — Profound Export Files

Generated from programmatic inspection of actual data files.
Last verified: 2026-04-07

## File 1: `profound_raw_data_with_citations.csv`

- **Size:** 43 MB (42,924,404 bytes)
- **CSV lines:** 356,691 (inflated by multiline `response` field)
- **Actual data rows:** 9,596 (verified via csv.DictReader)
- **Grain:** One row per prompt × platform × date
- **BOM:** UTF-8 BOM present (`\ufeff` prefix on `run_id` header)

| Column | Type | Sparsity | Sample | Notes |
|--------|------|----------|--------|-------|
| `run_id` | UUID | 100% | `e2d1f2b2-feb9-...` | Row PK (9,596 unique, verified) |
| `date` | ISO date | 100% | `2026-04-06` | 33 dates: 2026-03-05 → 2026-04-06 |
| `platformId` | UUID | 100% | 3 distinct | FK to platform |
| `platform` | Enum | 100% | `ChatGPT`, `Google AI Overviews`, `Perplexity` | 3 values |
| `topic` | String | 100% | 12 distinct values | Prompt campaign group |
| `tags` | CSV | 100% | `design-build, custom-home` | Multi-value, ~20 tags |
| `region` | Enum | 100% | `United States` | Constant — discard |
| `persona` | String | 0% | `""` | Always empty — discard |
| `type` | Enum | 100% | `open-ended` | Constant — discard |
| `prompt` | Text | 100% | 100 distinct prompts | Full question text |
| `mentions` | CSV | ~80% | `Ritz Builders, Element Homes` | All entities mentioned |
| `normalized_mentions` | CSV | ~80% | Same, canonicalized | Use this over `mentions` |
| `position` | Rank | 20.3% | `#1`, `#3`, empty | Ritz rank among mentions. Empty = not mentioned |
| `response` | Markdown | 100% | Full LLM response | Median 2,754 chars, max 9,438. **Multiline** |
| `search_queries` | CSV | 53% | Fanout queries | Perplexity 97%, ChatGPT 58%, GAIO 0% |
| `mentioned?` | Bool | 100% | `Yes` (1,946=20.3%) / `No` (7,650=79.7%) | Tracked brand detection |
| `citation_1`…`citation_36` | URL | Sparse | Full URLs with fragments | 0-36 per row. Median ~9 |

### Execution distribution per date × platform

| Date Range | ChatGPT | Google AIO | Perplexity | Total/day |
|------------|---------|------------|------------|-----------|
| 2026-03-05 | 100 | 100 | 100 | 300 |
| 2026-03-06 to 03-09 | 100 | 17-32 | 100 | 217-232 |
| 2026-03-10 onwards | 100 | 100 | 100 | 300 |

Google AI Overviews had reduced execution counts during days 2-5 (ramp-up).

### Position distribution

| Position | Count | % |
|----------|-------|---|
| (empty/not mentioned) | 7,650 | 79.7% |
| #1 | 1,189 | 12.4% |
| #2 | 213 | 2.2% |
| #3 | 176 | 1.8% |
| #4 | 128 | 1.3% |
| #5 | 85 | 0.9% |
| #6-#11 | 155 | 1.6% |

### Citations per row distribution

| Citations | Rows | % |
|-----------|------|---|
| 0 | 123 | 1.3% |
| 1-5 | 901 | 9.4% |
| 6-10 | 7,276 | 75.8% |
| 10 exactly | 4,006 | 41.7% |
| 11-20 | 1,269 | 13.2% |
| 21-36 | 27 | 0.3% |

## File 2: `profound_citations_data.csv`

- **Size:** 54 MB (54,124,119 bytes)
- **Actual rows:** 85,004 (verified)
- **Grain:** One cited URL per prompt execution
- **BOM:** UTF-8 BOM present

| Column | Type | Sample | Notes |
|--------|------|--------|-------|
| `run_id` | UUID | FK to raw executions | 9,473 unique (123 zero-citation executions absent) |
| `date` | ISO date | 33 dates | Same range as raw |
| `url` | URL | Full URL with fragments | Some have `?utm_source=chatgpt.com` |
| `hostname` | Domain | `www.houzz.com` | Includes `www.`/`m.` prefixes — normalize |
| `path` | Path | URL path only | |
| `title` | Text | Page title | 3 empty values |
| `text` | Text | Page snippet | **19% empty** (mostly ChatGPT) |
| `platform` | Enum | 3 values | Perplexity 39%, GAIO 32%, ChatGPT 29% |
| `topic` | String | 12 values | Inherited from execution |
| `tags` | CSV | Same as raw | Inherited from execution |
| `region` | Enum | `United States` | Constant — discard |
| `persona` | String | `""` | Empty — discard |
| `prompt` | Text | Full prompt | Inherited from execution |
| `citationCategory` | Enum | 6 values | Profound source classification |
| `category` | Enum | Title Case of above | Redundant — discard |
| `mentioned` | Enum | `n/a` 99%, `undetected` 1% | Useless — discard |

### citationCategory distribution

| Value | Count | % |
|-------|-------|---|
| `other` | 71,367 | 84.0% |
| `earned_media` | 5,211 | 6.1% |
| `social` | 4,901 | 5.8% |
| `owned` | 3,100 | 3.6% |
| `earned_institutions` | 369 | 0.4% |
| `pr_wire` | 56 | 0.1% |

### Citations per execution

Min=1, Max=36, Median=10, Mean=9.0

### Top 25 citation hostnames (normalized)

| Hostname | Count | Classification |
|----------|-------|----------------|
| constructelements.com | 3,689 | Competitor |
| valleyboutiquebuilders.com | 3,619 | Competitor |
| houzz.com | 3,418 | Directory |
| homebuilderdigest.com | 3,283 | Directory |
| ritzbuilders.com | 3,100 | **Owned** |
| supplehomesinc.com | 3,060 | Competitor |
| craftsmensguild.com | 2,668 | Competitor |
| reddit.com | 2,274 | Social |
| diamondcertified.org | 1,879 | Directory |
| greenberg.construction | 1,728 | Competitor |
| demattei.com | 1,706 | Competitor |
| yelp.com | 1,534 | Directory |
| baysidebuildersgroup.com | 1,389 | Competitor |
| baybuilders.com | 1,298 | Competitor |
| valleyhomebuilders.com | 1,248 | Competitor |
| noadesignbuild.com | 1,185 | Competitor |
| goldengategroupinc.com | 1,091 | Competitor |
| siliconvalleybuilders.com | 1,053 | Competitor |
| angi.com | 1,041 | Directory |
| customhome.us | 964 | Competitor |
| sanfranciscoarchitects.org | 904 | Competitor |
| crcbuildersinc.com | 885 | Competitor |
| wisebuilders.org | 866 | Competitor |
| feldman.construction | 846 | Competitor |
| generalcontractors.org | 832 | Directory |

### Cross-file reconciliation

- Raw run_ids: 9,596
- Citation run_ids: 9,473
- Overlap: 9,473 (100% of citations have matching executions)
- Missing from citations: 123 (zero-citation executions)
- Orphan citations: 0

## File 3: `profound_summarized_export_1775609720310.csv`

- **Size:** 2.5 MB (2,453,595 bytes)
- **Actual rows:** 16,623 (verified)
- **Grain:** One row per date × asset × platform
- **BOM:** None detected

| Column | Type | Sample | Notes |
|--------|------|--------|-------|
| `key` | Composite | `2026-03-05-Element Homes-UUID` | Synthetic — discard |
| `date` | ISO date | 33 dates | Same range |
| `asset` | String | 1,848 unique | Includes non-brand entities |
| `platform` | Enum | 3 values | Perplexity 3,756, GAIO 5,239, ChatGPT 7,628 |
| `visibility` | Percent str | `36.71%` | Parse → float |
| `shareOfVoice` | Percent str | `6.97%` | Parse → float |
| `averagePosition` | Rank str | `#2.9` | Parse → float |
| `rank` | Integer str | `1`, `42` | Derivable — discard |

### Ritz in summarized: 3 VARIANT NAMES

| Asset Name | Rows |
|------------|------|
| `Ritz Builders` | 71 |
| `Ritz` | 25 |
| `Ritz / Element-style architect-led design-build firms` | 1 |

This is critical: Profound tracks entity name variants separately.

### Platform row distribution

ChatGPT has the most assets per day (more entities get mentioned). Google AIO and Perplexity have fewer.

## File 4: `prompts_export_2026-04-07_17-56-47.csv`

- **Size:** 33 KB (33,246 bytes)
- **Rows:** 100 (verified)
- **Grain:** One row per tracked prompt
- **This is the TrackedPrompt seed data from Profound**

| Column | Type | Sample | Notes |
|--------|------|--------|-------|
| `ID` | UUID | Profound prompt ID | 100 unique |
| `Topic` | String | 12 topics | Maps to topic entity |
| `Prompt` | Text | Full prompt text | **100/100 match with raw execution prompts** |
| `Tags` | CSV | `design-build, custom-home` | Multi-value |
| `Regions` | String | `United States` | Constant |
| `Language` | String | `en-US` | Constant |
| `Platforms` | CSV | `chatgpt, perplexity, google-ai-overviews` | All 3 for every prompt |
| `Personas` | String | `""` | Empty |
| `Type` | String | `Visibility` | Constant |
| `Created` | Datetime | `3/5/2026, 01:00 PM` | US format |
| `Updated` | Datetime | `3/11/2026, 08:13 PM` | US format |

### Topic distribution

| Topic | Prompts |
|-------|---------|
| Atherton Construction | 11 |
| Cupertino Construction | 11 |
| Los Altos Construction | 11 |
| Menlo Park Construction | 11 |
| Palo Alto Construction | 11 |
| Shield: Custom Home Builder Bay Area | 10 |
| Shield: Luxury Home Builder Bay Area | 10 |
| Already Have Architectural Plans (Bay Area) | 5 |
| Best Design-Build Firm for Custom Homes(Bay Area) | 5 |
| Best Modern Home Builder (Bay Area) | 5 |
| Build on My Lot / Empty Lot Builders (Bay Area) | 5 |
| Whole Home Renovation Builders (Bay Area) | 5 |

City topics (5 cities × 11 prompts = 55) + Shield topics (2 × 10 = 20) + Specialty (5 × 5 = 25) = 100.

## Columns Needing Human Confirmation

1. `search_queries` — is `, ` always the delimiter?
2. `text` in citations — cited page content or LLM paraphrase?
3. `position` — Ritz-specific or configurable per export?
4. Do Profound prompt IDs (from prompts_export) appear anywhere in the execution data? (Not in current raw file.)
5. Why does Profound track "Ritz" and "Ritz Builders" as separate entities in summarized?

## Columns to Discard

| Column | File | Reason |
|--------|------|--------|
| `persona` | Raw, Citations | Always empty |
| `type` | Raw | Always `open-ended` |
| `region` | Raw, Citations | Always `United States` |
| `category` | Citations | Redundant with `citationCategory` |
| `mentioned` | Citations | 99% `n/a`, useless |
| `key` | Summarized | Synthetic composite |
| `rank` | Summarized | Derivable from visibility |

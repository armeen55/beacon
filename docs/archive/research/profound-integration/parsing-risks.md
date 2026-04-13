# Parsing Risks — Profound Export Files

Last verified: 2026-04-07

## CRITICAL RISKS

### Risk 1: Multiline `response` field

The `response` column in raw_executions contains multiline markdown.
9,596 data rows become 356,691 CSV lines.
**Must use a proper CSV parser** (Python `csv` or Node `csv-parse`) with correct quoting.
Naive line-by-line parsing will fail catastrophically.

### Risk 2: UTF-8 BOM

Both `profound_raw_data_with_citations.csv` and `profound_citations_data.csv` have UTF-8 BOM (`\ufeff`).
The BOM attaches to the first column header: `\ufeff"run_id"` instead of `run_id`.
**Fix:** Open files with `encoding='utf-8-sig'` (Python) or strip BOM in Node.

### Risk 3: Visibility formula is NOT simply `mentions / total_executions`

Verified mismatches between computed and reported visibility:
- ChatGPT: matches perfectly on some dates, mismatches on others
- Google AI Overviews: consistently mismatches
- Root cause: Profound tracks "Ritz" and "Ritz Builders" as **separate entities** in the summarized export. The raw file's `normalized_mentions` may combine them differently.
- Additionally, Google AIO had reduced execution counts (17-32) during 2026-03-06 to 03-09, but the summarized denominators don't match the raw row counts even for those dates.
- **Beacon should derive its own mention rate from raw data and treat summarized as benchmark only.**

## HIGH RISKS

### Risk 4: Three Ritz entity variants in summarized

| Asset Name | Rows |
|------------|------|
| `Ritz Builders` | 71 |
| `Ritz` | 25 |
| `Ritz / Element-style architect-led design-build firms` | 1 |

Beacon must merge these when importing benchmark data.

### Risk 5: Citation URL fragments and tracking params

Many URLs contain `#:~:text=` (Google text fragments) and `?utm_source=chatgpt.com`.
**Normalize:** Strip UTM params for dedup. Keep full URL for display.

### Risk 6: `other` category dominance (84%)

71,367 of 85,004 citations are classified as `other` by Profound.
Most competitors and directories are in this bucket.
**Beacon must apply secondary classification** by hostname.

### Risk 7: `mentioned?` column name has special character

The `?` in the column name can cause issues with some parsers and object key access.

## MODERATE RISKS

### Risk 8: Changelog dirty data (14% of changes affected)

- 10 entries have truncated topic: `"Luxury Home Builder Bay Are"` (missing `a`)
- 1 entry has hypothesis text leaked into city_targeted field
- 2 entries have garbage impact windows (`"Batch 1 complete..."`, `"1–3 Days"` with em-dash)
- **Must normalize before attribution matching**

### Risk 9: `search_queries` delimiter ambiguity

Individual queries may contain commas. Splitting on `, ` (comma-space) is safer than `,` alone.

### Risk 10: Hostname normalization

Domains appear with/without `www.` and `m.` prefixes.
`m.yelp.com` vs `www.yelp.com` vs `yelp.com` — all the same entity.
**Normalize:** Strip `www.`, `m.`, lowercase.

### Risk 11: 20 duplicate (run_id, url) pairs in citations

Same URL cited multiple times within one execution. Keep all with position-based ordering.

### Risk 12: No explicit `is_owned` flag

Neither file has a reliable `is_owned` field.
**Derive:** Match hostname against owned domain list (initially `ritzbuilders.com`).

## LOW RISKS

### Risk 13: Early date ramp-up

2026-03-06 to 03-09: Google AIO has 17-32 executions vs normal 100.
Account for variable denominators when computing daily aggregates.

### Risk 14: Percentage/rank string formats in summarized

`visibility` = `"36.71%"`, `averagePosition` = `"#2.9"`.
Parse: strip `%` and `#`, convert to float.

### Risk 15: Summarized composite key is unparseable

Format `{date}-{asset}-{platformId}` — asset names contain hyphens.
**Don't parse** — use `date` + `asset` + `platform` columns directly.

### Risk 16: Entity dedup in summarized assets

1,848 unique assets include geographic terms, platform names, and variant spellings.
Must filter and classify before creating TrackedEntity records.

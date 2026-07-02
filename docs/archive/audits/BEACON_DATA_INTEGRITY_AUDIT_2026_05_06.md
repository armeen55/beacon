# Beacon Data Integrity Audit — 2026-05-06

**Trust Sprint Phase 4. Read-only Supabase audit on tenant `tenant-ritz-founder` in project `jdegznovgysxyweknewh`. All queries SELECT-only. NO writes.**

> Operator framing: "I do not fully trust the data underneath the brain. Be brutal." 10 integrity checks across observations, snapshots, changelog, recommended_edits, prompts, entities. RED verdict.

Two-line summary: **3 HIGH-severity findings dominate.** (1) **116+ duplicate observation keys** on 2026-04-23 from re-run chunks inserted as new rows rather than de-duped; (2) **partial chunks contaminating snapshots** on 2026-04-23, 2026-04-26, 2026-05-06 with reduced denominators (66, 99, 117 vs 100/200) — day-over-day visibility comparisons are apples-to-oranges across these 3 dates; (3) **28,285 daily_metric_snapshots rows + 14,096 prompt_answer_observations rows with `tenant_id=''`** (empty string, not NULL — RLS may not catch). Plus 2 test-tenant rows leaked into `recommended_edits`. Final verdict: **RED — data layer needs a de-dup migration + tenant_id backfill + re-snapshot of 3 dates before any new attribution claim is safe.**

---

## Per-check findings

### Check 1 — Duplicate observations by `(prompt_id, platform, day)` — **HIGH**

**Result:** 116+ duplicate keys (LIMIT 20 returned, more exist). Worst offender: prompt `f69f9953-4013-4f11-a296-6069d7c97a43` × ChatGPT × 2026-04-23 has **4 rows**. Sample row IDs:
- `obs-native-pollrun-1776906200888-c0qlw3-…`
- `…-1776966954565-1ueped-…`
- `…-1776968352482-wa03y5-…`
- `…-1776968536785-43qbe2-…`

(4 distinct run_ids — one early-morning run plus a 17:56 → 18:22 chunk re-run cluster). Daily roll-up confirms inflation: **2026-04-23 has 317 observations / 200 unique keys (117 duplicates that day alone).**

**Impact:** visibility scoring counts mentions across observations; duplicates double-count. The 2026-04-23 platform snapshot for ChatGPT cites `derived_from_run_id=pollrun-1776968536785-43qbe2` (the last 18:22 re-run) but the observation table still contains all 4 runs — any code path that aggregates observations directly (not via the snapshot) will inflate.

### Check 2 — Partial chunks contaminating snapshots — **HIGH**

**Result:** 3 days affected:
- **2026-04-23**: 4 chunks failed (offsets 0/25/50/75 all `0/25 prompts`) before 3 succeeded.
- **2026-04-26**: chunk offset=50 captured `16/25` (`partial`), offset=75 captured `0/25` (`failed`).
- **2026-05-06**: chunk offset=0 captured `24/25` (`partial`).

Snapshot evidence:
- 2026-04-26 ChatGPT platform snapshot: `total_possible=66` (vs normal 100 for Perplexity that day).
- 2026-05-06 ChatGPT: `total_possible=99`.
- 2026-04-23 ChatGPT: `total_possible=117` (inflated by Check-1 duplicates).

Operator-facing visibility scores (66.67%, 48.48%, 59.83%) come from skinnier denominators than other days. **Day-over-day deltas across these dates are not comparing like to like.**

### Check 3 — Stale `benchmark` snapshots in tenant scope — **MED**

**Result:**

| scope_type | source_type | rows | date range |
|---|---|---|---|
| entity | benchmark | 1,380 | 2026-04-07 → **2026-04-14** |
| entity | derived | 6,253 | 2026-03-05 → 2026-05-06 |
| platform | derived | 169 | — |
| topic | derived | 1,994 | — |

All `benchmark` rows pre-date NATIVE_REGIME_START (2026-04-22) — most recent is 2026-04-14, 8 days before native cutover. Not contaminating post-cutover days, but readable by any "scope_type=entity" sweep that doesn't filter on `source_type='derived'` or date >= 2026-04-22. Charts showing "last 60 days" will mix regimes.

### Check 4 — Mixed regime within a single scope — **MED**

**Result:** 2 scopes have both regimes:
- `entity / baybuilders / ChatGPT` — both `benchmark` + `derived`, 2026-03-05 → 2026-05-06.
- `entity / ritzbuilders / Perplexity` — both `benchmark` + `derived`, 2026-03-05 → 2026-05-06.

These are exactly the two scopes a 60-day chart would render. **If charting code SUMs/AVGs across `source_type` without segmenting, the displayed series mixes Profound-derived benchmark days with native-derived days.**

### Check 5 — Tenant leakage / NULL tenant_id — **HIGH**

**Result: empty-string `tenant_id=''` rows exist in 2 production tables:**

| Table | `tenant_id=''` rows | `tenant-ritz-founder` rows | Span |
|---|---|---|---|
| `daily_metric_snapshots` | **28,285** | 9,796 | 2026-03-05 → 2026-04-21 |
| `prompt_answer_observations` | **14,096** | 16,441 | 2026-04-07 → 2026-04-21 (300/day) |
| `recommended_edits` | 28 ritz | + 2 test-tenant rows (`test-c1c-1777584795434-a/b`) | — |

Empty-tenant snapshots stop the day before NATIVE_REGIME_START. Empty-tenant observations are exactly 300/day — clearly Profound-derived legacy data not backfilled with `tenant_id`. **Empty-string is NOT NULL — RLS deny-all policies may pass it through if predicates only check `IS NOT NULL`.**

The new RLS gate that landed today (commit `bd848df`) needs verification that empty-string is rejected, not just NULL. **28k orphaned snapshot rows is a real footgun** — they need either tenant_id backfill or a hard delete decision.

### Check 6 — Profound-era changelog still active — **MED**

**Result:**

| source_system | rows | date range |
|---|---|---|
| `pdf_changelog_rebuild` | 232 | 2026-03-02 → 2026-04-14 |
| `changelog_csv` | 85 | 2026-03-05 → 2026-04-08 |
| `scan_detection` | 14 | 2026-04-14 → 2026-04-22 |
| `source_system=NULL` | 3 | 2026-04-27 (post-cutover, unattributed) |

Per `lifecycle-classification.ts` Rule 5 the 317 imported/PDF rows should be tagged `imported_legacy` and de-weighted, but **they're still queryable** by anything filtering on tenant + date range without checking `source_system`. The 3 NULL rows on 2026-04-27 are a separate concern — unattributed entries shouldn't pass schema validation.

### Check 7 — LLM placeholder copy in active recommended_edits — **CLEAN**

**Result:** 20 `source='openai'` rows scanned (recent; status mostly `recommended`, one `dismissed`, one `verified_live`). Placeholder pattern scan (`^draft answer|tbd\b|\[insert|rewrite below|operator: rewrite|TBD`) returned **0 rows**.

Sample shows realistic action_types (`add_h2_section`, `add_faq`) and structured rec_ids. **No LLM-source rows have placeholder bodies.** The W3 §3.13 placeholder validator is doing its job.

### Check 8 — Null URLs / missing keys — **MED**

| Table | NULL URLs | Total scanned |
|---|---|---|
| `recommended_edits.target_url` | **0** | clean |
| `pages.url` | **0** | clean |
| `changelog_entries.url` | 25 | flag |
| `prompt_answer_observations.citation_urls` | 420 | flag (~2.5%) |

420 observations with null `citation_urls` is small but means citation-attribution code must defensively handle null. 25 null-URL changelog entries breaks any "click through to changed page" UI.

### Check 9 — Duplicate recommended_edits — **CLEAN**

**Result: 0 rows.** No duplicates by `(rec_id, action_type, target_url, target_element_key)`.

### Check 10 — Debug/test rows in production tables — **LOW (with caveat)**

**Result:** `tenant_id` does not exist on `tracked_prompts` or `tracked_entities` (single-tenant tables). Re-ran unfiltered: **0 matches** for `test|debug|dummy|placeholder` patterns.

But Check 5 already surfaced production debug rows: `recommended_edits` contains 2 rows under `tenant_id` siblings of `tenant-ritz-founder`: `test-c1c-1777584795434-a` and `test-c1c-1777584795434-b` — clearly seeded test fixtures from a customer-2-isolation test that landed today.

**Severity: LOW for prompts/entities; MED for the 2 stray test recommended_edits rows.**

---

## Final summary — Data integrity verdict: **RED**

Justification (HIGH findings dominate):

1. **Check 1 (HIGH):** 116+ duplicate observation keys on 2026-04-23 alone. Re-run chunks inserted as new observations rather than de-duped; 117 stale rows exist for that day. Any score that aggregates raw observations (not snapshots) is inflated.
2. **Check 2 (HIGH):** Partial chunks on 2026-04-23, 2026-04-26, 2026-05-06 baked into platform snapshots with reduced denominators (66, 99, 117 vs 100/200). Day-over-day visibility comparisons are apples-to-oranges across these 3 dates.
3. **Check 5 (HIGH):** 28,285 snapshot rows + 14,096 observation rows with `tenant_id=''` still in production tables. New RLS deny-all needs verification that empty-string is rejected, not just NULL. Plus 2 test-tenant rows (`test-c1c-…`) leaked into `recommended_edits`.

**Medium findings stack:** Profound-era benchmark snapshots (Check 3), mixed regimes per scope (Check 4), legacy `pdf_changelog_rebuild` rows still active (Check 6), 25 null changelog URLs + 420 null citation_urls (Check 8). **Clean wins:** no LLM placeholder copy (Check 7), no duplicate recommended_edits (Check 9), no debug names in tracked_prompts/entities (Check 10).

### Top 3 fix priorities (operator decision)

1. **De-dup `prompt_answer_observations` by `(prompt_id, platform, day)`,** keep latest run_id; add unique index to prevent recurrence.
2. **Decide on the 28k+14k empty-tenant rows:** backfill `tenant_id='tenant-ritz-founder'` (if they're truly the founder's old Profound data) or hard delete. Either way, **add a NOT NULL + non-empty CHECK constraint** to both tables.
3. **Re-snapshot 2026-04-23, 2026-04-26, 2026-05-06** after de-duping observations and either flag or backfill the missing chunks; **expose `total_possible` in the operator UI** so partial days are visible.

**Recommended capability for next step:** Max — Opus, because the de-dup + tenant_id backfill + RLS verification is a multi-table data migration touching the core trust wedge.

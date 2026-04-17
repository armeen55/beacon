# Track 1.4 Phase 2A — Local Review Read-Path Spec

> **PURPOSE:** Lock the v1 local-review data contract and ingestion path so `/local` can move from placeholder review state to real imported review signals.
>
> **NOT FOR:** Connector implementation, reply flows, sentiment NLP, ranking claims, or background sync.

**Last updated:** 2026-04-12

---

## 1. Decision

### Chosen v1 path: Manual import (CSV / JSON)

**Why this is the right first move:**

1. **Proven pattern.** Beacon already has a CSV/JSON import pipeline (`src/lib/import/actions.ts`) with preview → validate → persist → post-import hooks. Extending it to a new entity type (`reviews`) is a well-understood, low-risk change.
2. **Zero external auth.** No Google OAuth, no API quotas, no connector maintenance. The operator pastes or uploads a file; Beacon validates and stores it. Trust risk is minimal because the operator controls the data.
3. **Validation-first.** Manual import forces explicit data contracts — required fields, formats, validation rules — before any automation can bypass them. This prevents the "connector silently ingests garbage" failure mode.
4. **Fastest path to real `/local` data.** An operator can export reviews from Google Business Profile (or any platform) and import them in minutes. Health score, review count, and average rating immediately become real.
5. **Roadmap alignment.** Nano-phase 1.4i ("Import / connector fallback") explicitly positions the CSV/manual path as the primary option, with a connector as a later alternative.

**Why a connector is deferred:**

- Google Business Profile API requires OAuth 2.0 setup, scope verification, and ongoing token management — heavy infrastructure for a single-user internal app.
- Connector complexity (auth, refresh, rate limits, error states, schema drift) is disproportionate to the v1 goal of "show real review signals on `/local`."
- A connector can be added later as a convenience layer on top of the same data contract — the import contract defined here is the stable interface regardless of source.
- The roadmap does not require a connector in Phase 2A; 1.4b says "API/source choice documented" and 1.4i is the connector fallback.

---

## 2. Source-of-truth contract

### Review record schema

```typescript
type LocalReviewRecord = {
  /** Stable unique identifier for deduplication. Required. */
  id: string;

  /** Platform the review came from. Required. Allowed: "google", "yelp", "bbb", "houzz", "other". */
  source: "google" | "yelp" | "bbb" | "houzz" | "other";

  /** Star rating, 1–5 inclusive. Required. */
  rating: number;

  /** ISO 8601 date string (YYYY-MM-DD or full ISO). Required. */
  created_at: string;

  /** Full review text. Optional. May be empty for rating-only reviews. */
  review_text?: string;

  /** Reviewer display name. Optional. */
  reviewer_name?: string;

  /** Business listing name (for multi-location disambiguation). Optional. */
  listing_name?: string;

  /** URL to the review on the source platform. Optional. */
  review_url?: string;

  /** External location ID (e.g., Google Place ID). Optional. */
  location_id?: string;
};
```

### Field rules

| Field | Required | Type | Constraints |
|-------|----------|------|-------------|
| `id` | Yes | string | Non-empty. Unique within the import set. Used for deduplication across imports. |
| `source` | Yes | string | Must be one of: `google`, `yelp`, `bbb`, `houzz`, `other`. Case-insensitive on import (normalized to lowercase). |
| `rating` | Yes | number | Integer or float, 1–5 inclusive. Values outside this range are rejected. |
| `created_at` | Yes | string | Parseable date. Accepts `YYYY-MM-DD`, `MM/DD/YYYY`, or full ISO 8601. Future dates are rejected. |
| `review_text` | No | string | Max 5000 characters. Trimmed on import. |
| `reviewer_name` | No | string | Max 200 characters. Trimmed. |
| `listing_name` | No | string | Max 200 characters. |
| `review_url` | No | string | Valid URL format if provided. |
| `location_id` | No | string | Max 200 characters. No format enforcement in v1. |

---

## 3. Import / ingest contract

### Accepted formats

| Format | Structure |
|--------|-----------|
| **CSV** | First row is headers. Keys are lowercased and snake_cased (per existing `parseCSV` behavior). |
| **JSON** | Array of objects. Keys are lowercased and snake_cased (per existing `parseJSON` behavior). |

### Required CSV headers / JSON keys

Minimum required: `id`, `source`, `rating`, `created_at`

### Example payloads

**CSV:**

```csv
id,source,rating,created_at,review_text,reviewer_name
rev-001,google,5,2026-03-15,Excellent work on our kitchen remodel. Highly recommend.,John D.
rev-002,google,4,2026-03-10,Good quality but took longer than expected.,Sarah M.
rev-003,yelp,5,2026-02-28,,Anonymous
rev-004,google,3,2026-02-15,Average experience. Communication could be better.,Mike R.
```

**JSON:**

```json
[
  {
    "id": "rev-001",
    "source": "google",
    "rating": 5,
    "created_at": "2026-03-15",
    "review_text": "Excellent work on our kitchen remodel. Highly recommend.",
    "reviewer_name": "John D."
  },
  {
    "id": "rev-002",
    "source": "google",
    "rating": 4,
    "created_at": "2026-03-10",
    "review_text": "Good quality but took longer than expected.",
    "reviewer_name": "Sarah M."
  }
]
```

### Validation rules

1. **Missing required fields** → row rejected, error surfaced in preview.
2. **Invalid `source`** → row rejected. Error: "source must be one of: google, yelp, bbb, houzz, other".
3. **Invalid `rating`** → row rejected. Error: "rating must be a number between 1 and 5".
4. **Unparseable `created_at`** → row rejected. Error: "created_at must be a valid date".
5. **Future `created_at`** → row rejected. Error: "created_at cannot be in the future".
6. **Oversized text fields** → warning + truncated to limit.
7. **Empty import** → rejected at action level. Error: "No valid review records found".

### Error handling

- Follows existing import pattern: `previewImport` returns `ImportPreview` with `valid`, `errors`, `warnings`, `sample`.
- Validation errors are row-level, capped at 20 in UI.
- Valid rows are imported even if some rows fail (partial import allowed).

### Duplicate handling

- **Dedup key:** `id` field.
- **On conflict:** If a review with the same `id` already exists in the store, the **newer import wins** (upsert semantics). This allows operators to re-import a corrected export without duplicates.
- **Cross-source dedup:** Not enforced in v1. The same review imported with different `id` values from different sources would appear as separate records. This is acceptable because the operator controls the import.

### Persistence

- Store name: `"local-reviews"` via existing `writeStore`/`readStore` pattern.
- File: `.data/local-reviews.json`
- Format: `LocalReviewRecord[]`
- No cap in v1 (practical limit: a few hundred for a local business).

---

## 4. Derived metrics for `/local`

Once `local-reviews` store has records, `getLocalPresenceSnapshot()` updates its derivation:

### `hasReviews`

```
true if readStore("local-reviews").length > 0
```

### `reviewCount`

```
readStore("local-reviews").length
```

### `avgRating`

```
sum(reviews.map(r => r.rating)) / reviews.length
rounded to 1 decimal place
```

### Sentiment band (simple, no NLP)

Derived from `avgRating` only:

| Band | Condition | Label |
|------|-----------|-------|
| Positive | avgRating >= 4.0 | "Positive" |
| Mixed | avgRating >= 3.0 and < 4.0 | "Mixed" |
| Concerning | avgRating < 3.0 | "Concerning" |

This is a directional label, not sentiment analysis. The `/local` UI must frame it as: "Based on average rating across imported reviews."

### Health score update

Current rules (from Phase 1):

```
weak    → !hasListing
ok      → hasListing && !hasReviews
strong  → hasListing && hasReviews
```

No change to the logic — `hasReviews` becoming `true` after import automatically promotes health from `ok` to `strong`.

### Freshness

- `newestReviewDate`: `max(reviews.map(r => r.created_at))`
- `oldestReviewDate`: `min(reviews.map(r => r.created_at))`
- `importedAt`: timestamp of most recent import run (from `import-runs` store, filtered to `entityType === "reviews"`)
- If `importedAt` is > 30 days old, display: "Review data may be outdated — consider re-importing."

---

## 5. Trust boundaries

### What Beacon knows (after import)

- The review records the operator imported: rating, date, text, source, reviewer name.
- Aggregate statistics: count, average, sentiment band.
- Whether imported data is recent or stale (based on `importedAt`).

### What Beacon does not know

- Whether the imported reviews are complete (operator may have filtered or omitted reviews).
- Whether the reviews are current (they reflect the export date, not live state).
- Internal Google ranking signals, review velocity, or response rates.
- Competitive review benchmarks (no comparison data in v1).
- Whether the business has reviews on platforms not imported.

### What Beacon must not claim

- **No ranking claims.** "Your reviews help your ranking" — never. Beacon does not know the relationship between reviews and local ranking.
- **No completeness claims.** "You have N reviews" must always be qualified: "N imported reviews" or "based on imported data."
- **No sentiment analysis claims.** The sentiment band is derived from average rating only. No text analysis, no NLP, no emotion detection.
- **No competitive comparison.** "Your reviews are better/worse than competitors" — never. No competitor review data exists.
- **No freshness guarantees.** "Your reviews are up to date" — never unless import is recent.

### How stale review data should be framed

- If `importedAt` > 30 days: "Review data was last imported [date]. It may not reflect your current review profile."
- If `importedAt` > 90 days: "Review data is significantly outdated. Re-import recommended."
- Always show the import date alongside review statistics.

---

## 6. UI impact

### Empty state (no reviews imported — current behavior)

```
Reviews
Not connected yet
Review data will appear here once imported. Beacon does not estimate ratings
or review counts from other signals.
```

No change from Phase 1 except:
- "once connected" → "once imported" (copy tweak to match manual import path).

### Populated state (reviews imported)

```
Reviews
N imported reviews · avg M.M★ · [Sentiment band]
Source: [source breakdown, e.g., "12 Google · 3 Yelp"]
Newest: [date] · Imported: [date]
```

If stale (importedAt > 30 days):
```
Review data was last imported [date] — consider re-importing.
```

### Disclosure copy update

The `<details>` "How this works" disclosure should update when reviews are present:

- "Review data is imported manually — it reflects the export, not live state."
- "Average rating and sentiment band are derived from imported ratings only. No text analysis is performed."
- "Review count reflects imported records and may not be complete."
- Link to `/settings/methodology` unchanged.

### Methodology note

Add to `/settings/methodology` (reviews section, when review content is specified in that page):
- "Review signals are imported manually by the operator. Beacon does not connect to review platforms directly."
- "The sentiment band (Positive / Mixed / Concerning) is based solely on average star rating, not review text analysis."

---

## 7. Out of scope (explicitly deferred)

| Item | Why deferred | Prerequisite |
|------|-------------|-------------|
| **Reply flows** | Requires write access, liability model, AI draft + human approve workflow | 1.4e |
| **Alerts** | Requires notification system, urgency classification | 1.4f |
| **Review text analysis / NLP** | Trust risk, accuracy concerns, no validated methodology | Future research |
| **Direct ranking claims** | No evidence basis, forbidden by proof layer (1.1a F11) | Never without evidence |
| **API sync jobs** | Connector complexity, auth infrastructure | 1.4i |
| **Background refresh** | Requires scheduler, error handling, freshness monitoring | After connector |
| **Competitor review benchmarking** | No competitor review data source in v1 | 1.4h |
| **Review velocity / trend analysis** | Requires time-series depth not available from single import | After multiple imports |
| **Multi-location support** | `listing_name` / `location_id` fields are optional stubs for future use | After v1 validation |
| **Review response rate tracking** | Requires response data not in v1 schema | After reply flows |

---

## 8. Implementation-ready handoff

### Files to create

| File | Purpose |
|------|---------|
| `src/lib/import/review-mapper.ts` | `mapReviewRow()` — validates and normalizes a single review record from CSV/JSON row. Returns `{ entity: LocalReviewRecord \| null, errors: string[], warnings: string[] }`. |

### Files to modify

| File | Change |
|------|--------|
| `src/lib/import/types.ts` | Add `"reviews"` to `ImportEntityType`. Add `IMPORT_COLUMN_DOCS.reviews` with required/optional column definitions. |
| `src/lib/import/engine.ts` | Add `"reviews"` case to `getMapper()` switch, pointing to `mapReviewRow`. |
| `src/lib/import/actions.ts` | Add `"reviews"` handling in `insertEntity` (push to in-memory review array) and `persistImportedEntities` (write to `"local-reviews"` store). Add post-import hook: no milestone/experiment sync needed, but `revalidatePath("/local")`. |
| `src/lib/local-presence.ts` | Update `getLocalPresenceSnapshot()` to read `"local-reviews"` store. Derive `hasReviews`, `reviewCount`, `avgRating` from actual data. Add `sentimentBand`, `newestReviewDate`, `importedAt` to `LocalPresenceSnapshot`. |
| `src/app/(shell)/local/page.tsx` | Update Reviews section: empty state → populated state with count, rating, sentiment, source breakdown, freshness. Update disclosure copy. |
| `src/app/(shell)/settings/import/page.tsx` (or `import-page.tsx`) | Add `"reviews"` to entity type selector dropdown. |

### Files to create (tests)

| File | Purpose |
|------|---------|
| `tests/lib/import/review-mapper.test.ts` | Unit tests for `mapReviewRow`: valid rows, missing required fields, invalid source, rating out of range, future dates, oversized text, duplicate handling. |
| `tests/lib/local-presence-with-reviews.test.ts` | Unit tests for updated `getLocalPresenceSnapshot()` with review data: metrics derivation, sentiment band, health promotion, freshness. |

### Safest order of implementation

1. **Define types** — Add `LocalReviewRecord` type to `src/lib/local-presence.ts` (or a new `src/domains/local/types.ts`). Add `"reviews"` to `ImportEntityType`.
2. **Build mapper** — Create `review-mapper.ts` with validation. Unit test it.
3. **Wire into import pipeline** — Add `"reviews"` to `engine.ts`, `actions.ts`, and the import UI entity selector.
4. **Update local presence derivation** — Read `"local-reviews"` store in `getLocalPresenceSnapshot()`. Unit test.
5. **Update `/local` UI** — Populated state, disclosure copy, freshness warning.
6. **Update docs** — Methodology page (if needed), HANDOFF, VERIFICATION_LOG.

### Tests required

- `mapReviewRow` — 10+ cases: valid, missing id/source/rating/created_at, invalid source string, rating 0 and 6, future date, valid date formats (ISO, MM/DD/YYYY), oversized review_text, empty import.
- `getLocalPresenceSnapshot` with reviews — 5+ cases: no reviews (existing), reviews present (count, avgRating, sentimentBand, healthScore promotion), single review, mixed sources, stale import.
- Smoke test for `/local` with review data — renders populated state.

---

## Appendix: How an operator gets review data

### Google Business Profile export

1. Open Google Business Profile → Reviews.
2. Download reviews (Google Takeout or third-party export tool).
3. Map columns to Beacon's required fields (`id`, `source` = "google", `rating`, `created_at`).
4. Paste or upload CSV/JSON in Settings → Import → Entity: Reviews.

### Yelp export

1. Use Yelp's business owner export or third-party tool.
2. Same column mapping.

### Manual entry

For businesses with few reviews, direct JSON entry is practical:

```json
[
  { "id": "g1", "source": "google", "rating": 5, "created_at": "2026-03-01" },
  { "id": "g2", "source": "google", "rating": 4, "created_at": "2026-02-15" }
]
```

This is the fastest path from "Not connected yet" to real data on `/local`.

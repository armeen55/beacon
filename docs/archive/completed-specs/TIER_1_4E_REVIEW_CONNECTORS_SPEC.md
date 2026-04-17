# Track 1.4e — Review Connectors Sub-Spec

> **PURPOSE:** Define the platform-specific connector architecture for Google Business Profile and Yelp reviews (**shipped** — on-demand pull in Settings → Connectors). This spec **extends** `TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md` — it does not replace it. Manual import remains the baseline and fallback. Connectors are **optional** and **additive** on top of the same `LocalReview` data contract.
>
> **NOT FOR:** Implementation code, OAuth library selection, cron job scheduling, CI/CD pipeline design, or launch date commitment. **This document is spec only.**

**Last updated:** 2026-04-13  
**Extends:** `TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md` (1.4d — review monitoring v1 scope)  
**Data contract:** `TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md` (import row schema)  
**Runtime types:** `src/lib/local-reviews-types.ts` (`LocalReview`, `LocalReviewSource`)  
**Canonical methodology:** `/settings/methodology#review-connectors`, `#review-source-timestamps`, `#review-monitoring-v1`, `#local-reviews`

---

## 1. Relationship to 1.4d

This spec is a **child** of `TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md`. The following 1.4d rules carry forward without change:

- Manual CSV/JSON import remains the **baseline truth** and **universal fallback**.
- No sentiment NLP, no trend detection, no response tracking, no competitor review comparison, no ranking claims.
- All review data — whether imported manually or fetched by a connector — is treated as a **snapshot**, not a live stream.
- The same `LocalReview` record schema (§2 of the Phase 2 read-path spec) is the **single storage contract**. Connectors write rows that conform to it; they do not introduce a second schema.
- Freshness is always **last-successful-ingest or last-successful-sync relative** — never an SLA or continuous “live” guarantee. **Combined** age may drive Today/Market; **per-source** “Last synced” / manual lines appear on `/local` (methodology `#review-source-timestamps`).

**If 1.4d says "not allowed," it is still not allowed under 1.4e.** Connectors add an ingestion path — they do not unlock new analytic capabilities.

---

## 2. Supported connectors (v1 scope)

Exactly **two** connector platforms are in scope for **shipped** implementation (Google + Yelp). No additional connector platforms until a separate spec is written and approved.

| Platform | Priority | Status in this spec |
|----------|----------|---------------------|
| **Google Business Profile** | Primary | **Shipped** — behavior matches contract below (on-demand `Sync now`) |
| **Yelp** | Secondary | **Shipped** — behavior matches contract below (on-demand `Sync now`) |

All other sources (`bbb`, `houzz`, `other`) remain **manual import only**. Adding a third connector requires a new spec addendum.

---

## 3. Auth model

### 3.1 Google Business Profile

| Property | Contract |
|----------|----------|
| Auth type | **OAuth 2.0** (Google Identity Platform). Scopes: `business.manage` (read-only review access). No write scopes. |
| Token storage | Server-side only. Encrypted at rest in `.data/connector-tokens.json` (or equivalent secure store). **Never** exposed in client-side JavaScript, HTML, logs, or browser storage. |
| Expiration | Access tokens expire per Google's policy (typically 1 hour). Refresh tokens stored alongside; automatic silent refresh on next sync attempt. |
| Refresh failure | If refresh fails (revoked, expired refresh token, Google policy change): mark connector status as `disconnected`, preserve last good snapshot, surface "Connection expired — reconnect in Settings" on `/local` and methodology. **Do not** silently retry indefinitely. |
| User disconnect | Operator can disconnect at any time via **Settings → Connectors**. Disconnect: revoke token at Google (best-effort API call), delete local token file entry, retain previously synced review rows (they remain as the last stored snapshot — not deleted). |

### 3.2 Yelp

| Property | Contract |
|----------|----------|
| Auth type | **API key** (Yelp Fusion v3). Read-only. No write operations. |
| Token storage | Server-side only. Stored in `.data/connector-tokens.json` alongside Google tokens (same file, keyed by platform). **Never** in client bundles or logs. |
| Expiration | Yelp API keys do not expire unless revoked by the operator or Yelp. Beacon should validate the key on each sync attempt and handle `401` / `403` as a disconnect event. |
| User disconnect | Operator removes or clears the API key in Settings. Beacon deletes the key from local storage. Previously synced rows are retained. |

### 3.3 General auth rules

- **No client-side auth flows.** OAuth redirect, token exchange, and key entry all happen server-side or via a Settings form that posts to a server action.
- **No tokens in URL query strings, cookie values, or diagnostic dumps.**
- **Log redaction:** Any log entry that touches connector operations must redact tokens, keys, and user identifiers. Log only: platform name, sync run ID, row count, duration, error category.

---

## 4. Data contract (per platform)

Both connectors map platform-native fields to the existing `LocalReview` schema. No enrichment, no transformation beyond type-safe mapping.

### 4.1 Google Business Profile

| `LocalReview` field | Google API source | Mapping rule |
|---------------------|-------------------|--------------|
| `id` | `reviewId` (platform-native) | Prefixed: `google:{reviewId}` to avoid cross-platform collisions |
| `source` | — | Hard-coded: `"google"` |
| `rating` | `starRating` enum (`ONE` through `FIVE`) | Map enum to integer `1`–`5` |
| `created_at` | `createTime` (RFC 3339) | Pass through as ISO 8601 string |
| `review_text` | `comment` | Optional; may be empty for rating-only reviews. Truncate to 5,000 chars. |
| `reviewer_name` | `reviewer.displayName` | Optional; max 200 chars. |
| `listing_name` | Derived from GBP location name in the API response | Optional; max 200 chars. |
| `review_url` | Constructed: `https://search.google.com/local/reviews?placeid={placeId}` or omitted if not constructible | Optional |
| `location_id` | GBP `name` field (e.g. `accounts/{id}/locations/{id}`) | Optional; max 200 chars. |

### 4.2 Yelp

| `LocalReview` field | Yelp API source | Mapping rule |
|---------------------|-----------------|--------------|
| `id` | `id` (Yelp review ID) | Prefixed: `yelp:{id}` |
| `source` | — | Hard-coded: `"yelp"` |
| `rating` | `rating` (integer 1–5) | Direct pass-through |
| `created_at` | `time_created` (ISO 8601) | Direct pass-through |
| `review_text` | `text` | Optional; truncate to 5,000 chars. |
| `reviewer_name` | `user.name` | Optional; max 200 chars. |
| `listing_name` | Business name from the Yelp business endpoint | Optional; max 200 chars. |
| `review_url` | `url` | Optional |
| `location_id` | Yelp `business_id` (alias) | Optional; max 200 chars. |

### 4.3 Mapping rules (shared)

- **ID prefixing is mandatory.** `google:{nativeId}` and `yelp:{nativeId}` ensure no collision with each other or with manually imported rows (which use operator-chosen IDs).
- **No enrichment.** Connectors do not look up reviewer profiles, add sentiment labels, compute trends, or attach metadata not present in the platform response.
- **No transformation beyond mapping.** Field values are type-coerced (enum → int, date format normalization) but not interpreted, filtered, or scored by the connector layer.

---

## 5. Ingestion rules

### 5.1 Pull-only

Connectors **read** reviews from the platform API. They **never** write, reply, flag, vote, or modify anything on the platform. No write scopes. No POST/PUT/PATCH/DELETE to platform endpoints.

### 5.2 Snapshot-based

Each sync run is a **snapshot pull**: fetch all (or paginated) reviews from the platform, map them to `LocalReview` rows, and merge-upsert into the local store.

- **Not streaming.** No websockets, no server-sent events, no long-poll connections to platform APIs.
- **Not incremental by default.** V1 connectors may fetch the full review set on each run. Incremental (since-last-sync) is an optimization permitted by this spec but not required.

### 5.3 Merge with manual data

- **Dedup by `id`.** The `id` field (with platform prefix) is the dedup key. If a connector row and a manual import row share the same `id`, the **most recent ingest** wins (same upsert semantics as `mergeUpsertLocalReviews`).
- **Manual rows with non-prefixed IDs are never overwritten** by connector rows (different `id` namespace due to prefix). Operators who manually import Google reviews without the `google:` prefix keep both — this is expected and documented, not a bug.
- **Manual import is never blocked or degraded** by an active connector. The import pipeline remains fully functional regardless of connector status.

### 5.4 Sync trigger

- **Operator-initiated** in v1 (**Settings → Connectors** → **Sync now**, not a background cron). Scheduled/automatic sync is a future optimization permitted but not specified here.
- Each sync run creates an **import run record** (`entity_type: "reviews"`, `source_system: "connector:google"` or `"connector:yelp"`) so combined freshness / staleness logic can treat connector observations the same way as successful manual imports for **summary** surfaces; **`/local`** still shows **per-source** timestamps (connector `last_synced_at` vs manual import runs — see methodology `#review-source-timestamps`).

---

## 6. Freshness model

### 6.1 Source tagging

Every review row carries its `source` field (`"google"`, `"yelp"`, or other). Connector-ingested rows are indistinguishable from manually imported rows of the same source **at the data layer** — the only difference is the import run's `source_system` (`"connector:google"` / `"connector:yelp"` vs e.g. `"upload"` / workbook sources).

### 6.2 UI display (shipped behavior)

| Element | Contract |
|---------|----------|
| Per-source timestamps | On **`/local`** → **Data freshness**: independent lines for **Google**, **Yelp**, and **manual import**; **“Last synced”** for a connector means the **most recent successful pull** for that source (token `last_synced_at`). **Each source updates independently.** Manual line uses latest qualifying `ImportRun` (excludes `connector:*` rows). |
| Combined freshness | Today / Market / listing-health **review-age** signals use the **latest** observation across manual import and connector syncs (same 30-day threshold as manual-only path — not “fresher by definition” because a connector exists). |
| Source on rows | Review rows carry `source` (`google`, `yelp`, etc.); per-row badges in detail views are optional — not required on summary surfaces. |
| Settings | Connectors card shows connection status and supports **Sync now** — no automatic schedule in v1. |

### 6.3 No SLA promises

- No "reviews updated every N hours" language unless a **future** scheduled feature is explicitly specified and shipped.
- No **“real-time”** or **“live sync”** labels for Beacon’s relationship to platforms — data is **snapshot**-based and **on-demand** in v1.
- Sync happens when the operator presses **Sync now** (v1). **No automatic syncing.**

---

## 7. Failure modes

Every failure mode must **degrade gracefully** to the last good state. No blank screens, no data loss, no silent corruption.

### 7.1 Auth failure

| Scenario | System behavior |
|----------|-----------------|
| OAuth token expired + refresh succeeds | Silent refresh; sync proceeds. No operator action. |
| OAuth token expired + refresh fails | Mark connector `disconnected`. Preserve all previously synced rows. Show on `/local`: "Google connection expired — reconnect in Settings." Log: `log.warn("Connector auth failed", { platform, error })`. |
| Yelp API key invalid (401/403) | Same as above: mark `disconnected`, preserve data, surface reconnect prompt. |
| Operator revokes access on Google/Yelp side | Next sync attempt fails with auth error → same disconnect flow. |

### 7.2 Partial fetch

| Scenario | System behavior |
|----------|-----------------|
| API returns some pages successfully, then errors on page N | **Commit rows from successful pages.** Mark sync run as `partial`. Surface: "Sync completed partially — [X] reviews fetched, some may be missing." Do **not** discard good data because of a late-page error. |
| API returns zero rows (empty business, new listing) | Store empty result. Show "0 reviews from [platform]" — do **not** treat as an error. |

### 7.3 API downtime / network failure

| Scenario | System behavior |
|----------|-----------------|
| Platform API unreachable (timeout, 5xx) | Sync run fails. Preserve last good snapshot. Surface: "Sync failed — [platform] may be temporarily unavailable. Data may be outdated." Retry is manual (operator presses Sync again). |
| DNS failure, TLS error | Same as above. Log category: `network_error`. |

### 7.4 Quota / rate limits

| Scenario | System behavior |
|----------|-----------------|
| 429 Too Many Requests | Back off. If retries exhausted within the sync run, commit whatever was fetched, mark run as `partial`. Surface: "Rate limited by [platform] — try again later." |
| Google daily quota exceeded | Same as 429. No automatic retry scheduling in v1. |

### 7.5 General principles

- **Last good snapshot is sacred.** Never delete or zero-out stored reviews because a sync failed.
- **Every failure is surfaceable.** The operator can always see what happened (Settings → connector status or `/local` banner).
- **No silent failures.** If a sync run fails or is partial, it must appear in the import run log and on the relevant UI surface.

---

## 8. Coverage truth

Even with connectors active, Beacon's coverage model (inherited from 1.4d §3) still applies:

- **Beacon may not have full review coverage.** Platform APIs may filter, paginate differently, or lag behind the live profile.
- **Platform discrepancies are expected.** Google counts in Search may differ from counts in the GBP API. Yelp's API may exclude "not recommended" reviews. These are platform behaviors, not Beacon bugs.
- **Manual imports may still be needed.** For platforms without connectors (BBB, Houzz, niche directories), for reviews the API does not expose, or as a cross-check against connector output.
- **Connector + manual rows coexist.** The store holds all rows from all sources. Counts and averages are computed over the full merged set.

---

## 9. UI disclosures (shipped — manual + optional connectors)

Surfaces must stay consistent with **`/settings/methodology`** and 1.4d §7: **no automatic syncing**, **no SLA**, **counts may differ** from platform UIs, **Beacon may not reflect full review coverage**.

| Surface | Disclosure contract (v1) |
|---------|---------------------------|
| **`/local`** — review counts / sentiment | Based on **rows in Beacon** after manual import and/or connector sync; not a completeness claim. |
| **`/local`** — Data freshness | Three lines always (Google / Yelp / manual); **“Last synced”** = most recent successful pull for that connector; **“Never synced”** / **“No imports yet”** when absent; **each source updates independently**; short lines: no automatic syncing; based only on imported or synced data. |
| **Today** / **Market** local strips | Footnote pattern: **based on imported data only** (or equivalent approved copy) for summary surfaces; combined age may reflect the latest manual or connector observation — **not** per-source on those routes. |
| **Methodology** | Anchors `#review-monitoring-v1`, `#local-reviews`, `#review-connectors`, `#review-source-timestamps` stay aligned with this spec. |

**When a connector is authorized and used:**

1. It is accurate to say the operator pulled reviews **on demand**; **“Last synced”** reflects the **most recent successful pull** for that source.
2. **“May not reflect full platform data”** / **counts may differ** — APIs and filters apply (see §8).

**When disconnected or never synced:**

1. Connector row may read **Never synced**; stored rows from a prior successful pull may still exist until cleared.
2. Manual import remains available — **connectors do not replace** manual import.

---

## 10. What is still not allowed (inherited from 1.4d, reiterated for clarity)

Connectors do not unlock any of the following. Each requires its own spec if ever pursued:

| Capability | Status | Gate |
|-----------|--------|------|
| Auto-replies to reviews | **Forbidden** | Separate spec + legal review |
| Sentiment AI / NLP on text | **Forbidden** | Separate spec + model selection |
| Ranking impact claims | **Forbidden** | No path defined |
| Competitor review comparison | **Forbidden** | No competitor review data source |
| Alerts / notifications (email, push, SMS) | **Forbidden** | Separate spec (1.4d §9 rule 2 applies) |
| Review generation campaigns | **Forbidden** | Out of scope (1.4d §12) |
| Write operations to platforms | **Forbidden** | Connectors are pull-only (§5.1) |

---

## 11. Security and storage

### 11.1 Token storage

- Tokens (OAuth access + refresh, Yelp API key) stored in `.data/connector-tokens.json` (gitignored, same directory as other `.data` stores).
- Encrypted at rest using a local machine key or environment-provided secret. Exact encryption mechanism is an implementation detail — but **plaintext tokens on disk are not acceptable** in production.
- File permissions: readable only by the Beacon process user (0600 or equivalent).

### 11.2 Client-side exposure: zero

- No tokens, keys, or auth state in client JavaScript bundles, React Server Component serialization, HTML source, cookies, or `localStorage`.
- Settings UI shows only: connection status (`connected` / `disconnected`), platform name, and last sync timestamp. Not the token value.

### 11.3 Minimal retention

- **Tokens:** Retained only while the connector is connected. On disconnect, deleted from `.data/connector-tokens.json`.
- **Review rows:** Retained indefinitely (same as manual imports) unless the operator uses "Clear data" in Settings. Rows are not deleted on disconnect — they become the "last synced" snapshot.

### 11.4 Revoke and delete

- Operator can **disconnect** (revoke) any connector at any time.
- Operator can **clear all review data** (existing `clearEntityData("local-reviews")` path) to remove connector-sourced rows alongside manual ones.
- No partial clear by source in v1 (all or nothing). Per-source clear is a permitted future enhancement but not specified here.

---

## 12. FAQ (connector additions — canonical with methodology)

These answers **supplement** (not replace) the 1.4d FAQ and match **`/settings/methodology`** FAQ entries.

### How often does Beacon sync reviews?

In v1: **only when you press "Sync now"** in **Settings → Connectors** for that platform. There is **no automatic schedule** and **no automatic syncing**. A future spec may add optional scheduled sync, but no cadence is promised; no SLA or **“real-time”** parity language is permitted.

### Why don't my counts match exactly?

Platform APIs may not expose all reviews. Google may exclude reviews pending moderation. Yelp may exclude "not recommended" reviews. Additionally, your Beacon store may contain manually imported rows from other time periods or sources. Mismatches are expected.

### What happens if my connection breaks?

Beacon preserves the last successfully synced review rows. **`/local`** shows per-source **Last synced** or **Never synced** for each connector, and **Settings → Connectors** shows connection status. The **Today** local attention strip does **not** surface connector auth status directly — it uses combined review-age, NAP, and health signals with the standard **Based on imported data only.** footnote (see methodology FAQ). Reconnect in **Settings → Connectors** or continue using manual import. No data is lost.

### Can I use both a connector and manual import for the same platform?

Yes. Manual imports and connector syncs write to the same store. Dedup is by `id`. If you import a Google review CSV with IDs that don't match the `google:` prefix convention, both sets coexist. If IDs match, the most recent ingest wins.

---

## 13. Hard rules (anti–feature creep)

1. **No overpromising.** Copy must never say "always up to date," "real-time," or "complete." Use "last synced," "snapshot," "may not reflect full data."
2. **No hidden sync assumptions.** Every sync is explicitly logged, timestamped, and surfaceable in UI. No background jobs that run without the operator knowing.
3. **Explainability test.** Every piece of data or status must be explainable to a non-technical operator in one sentence: "Beacon pulled your Google reviews at 9:03 AM — here are the 47 it found."
4. **Inherit all 1.4d hard rules.** §9 of `TIER_1_4D_REVIEW_MONITORING_V1_SPEC.md` applies in full.
5. **Connectors are additive.** Removing or disabling a connector must not break manual import, `/local` rendering, Today/Market surfacing, or listing health scoring.

---

## 14. Success criteria

- An **engineer** reading this spec can **maintain or extend** the shipped Google/Yelp connectors without ambiguity about auth flow, data mapping, merge semantics, failure handling, or security requirements.
- The **product** cannot drift into "real-time review monitoring" claims — every surface has a timestamp and a "may not be complete" qualifier.
- The **trust layer** (1.4d methodology, listing health, Today/Market strips) remains intact and truthful regardless of whether zero, one, or both connectors are active.
- A **new operator** connecting Google/Yelp for the first time understands immediately that Beacon **pulls** reviews on demand — it does not manage, respond to, or rank them; it does not stay continuously in sync with the platform.

---

## 15. Document control

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-04-13 | Initial connector sub-spec extending 1.4d |
| 1.1 | 2026-04-13 | Marked Google + Yelp **shipped**; aligned freshness (combined vs per-source `/local`), disclosures, and methodology cross-links; removed “when implemented” / manual-only baseline drift |

**Supersedes:** Nothing. This spec is additive to 1.4d. **1.4d** remains authoritative for **monitoring** boundaries; **1.4e** narrows **connector** auth, mapping, merge, and failure behavior. **Manual import remains the universal fallback.**

---

## 16. Out of scope (explicit backlog rejections)

- Background/cron sync scheduling (permitted by this spec but not defined; requires its own implementation spec).
- Per-source data clear (clear only Google rows, keep Yelp + manual).
- Multi-location routing (mapping multiple GBP locations to a single Beacon workspace).
- Review text search or filtering.
- Webhook-based push from platforms (if ever available).
- Third-party connector platforms (Zapier, Make, etc.).

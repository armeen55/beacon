# Track 1.4d — Review Monitoring v1 (Scope Spec)

> **PURPOSE:** Lock a strict, bounded definition of what “review monitoring” means in Beacon so operators and engineers do not confuse imported snapshots with live platform truth, and so **additional** connectors or ingestion/sync modes cannot silently expand scope without an explicit spec update.
>
> **NOT FOR:** Connector implementation, OAuth, polling infrastructure, alert products, sentiment NLP, or ranking claims. **This document is spec only** — it does not add runtime behavior.

**Last updated:** 2026-04-13  
**Canonical methodology summary:** `/settings/methodology#review-monitoring-v1` (and `#local-reviews`, `#review-source-timestamps`, `#review-connectors`)  
**Related:** `TIER_1_4E_REVIEW_CONNECTORS_SPEC.md` (Google + Yelp shipped, on-demand), `TIER_1_4_PHASE_2_LOCAL_REVIEW_READ_PATH_SPEC.md` (import row contract), `src/lib/local-presence.ts` (Today/Market use a **combined** latest-observation age; `/local` also shows **per-source** timestamps — import/sync-relative, not platform-SLA guarantees).

---

## 1. Supported sources (v1)

**Product positioning (monitoring v1):**

| Tier | Source | Role in v1 |
|------|--------|------------|
| Primary | **Google** | Optional **Google Business Profile** connector (Settings → Connectors) — **on-demand** review pull only (`Sync now`). **Also:** manual CSV/JSON import (Settings → Import → Local reviews). |
| Secondary | **Yelp** | Optional **Yelp Fusion** connector — **on-demand** pull only. **Also:** manual import. |
| Manual / other | **`other`**, `bbb`, `houzz`, etc. | Manual import only in v1; no committed connector for these sources. |

**Hard rules (monitoring / trust — this spec stays bounded):**

- Review rows reach Beacon only through **manual import** and/or **operator-initiated connector sync**. There is **no automatic syncing**, no background polling of platforms, and **no SLA** on currency vs Google/Yelp.
- **Connectors are optional** and **additive** — they extend manual import; they do not replace it.
- “Primary” and “secondary” describe **methodology and product ordering** (Google first, Yelp second), **not** a guarantee that either connector is connected or that data is complete.
- **No completeness guarantee:** Beacon only reflects rows in the local store. **Beacon may not reflect the full set of reviews on a platform** (API limits, moderation, export filters, timing). Counts **may differ** from what you see when browsing Google or Yelp.
- **Monitoring narrative** (what Beacon may say about “reviews here”) must stay consistent with: **manual path always exists**; **Google/Yelp optional**; **freshness is import/sync-relative**, not a real-time mirror of the platform.

**Not repeated in 1.4d:** OAuth scopes, token storage, field-level mapping — see **`TIER_1_4E_REVIEW_CONNECTORS_SPEC.md`**.

---

## 2. Data collection — current vs future

### Current (v1 — matches shipped product)

- **Manual CSV/JSON import** via Settings → Import → Local reviews (`entity_type: reviews`).
- **Optional Google Business Profile and Yelp connectors** via Settings → Connectors — **pull on demand only** (`Sync now`); same `LocalReview` store and import-run audit trail as manual path.
- **No automatic syncing** — no cron, no webhooks, no silent background pulls.
- **No SLA / no “always current” guarantee** — data may be incomplete or outdated relative to the platform.
- **Freshness (two levels, aligned with methodology):**
  - **Combined signal** (e.g. Today / Market local surfacing, listing-health review-freshness points): derived from the **latest successful observation** across manual review imports and connector syncs (see `REVIEW_IMPORT_STALE_AFTER_DAYS` in `local-presence`).
  - **Per-source display** on **`/local`**: independent lines for Google, Yelp, and manual import (`#review-source-timestamps`). **“Last synced”** (connectors) means the **most recent successful pull** for that source; manual line uses the latest qualifying import run excluding connector audit rows.

### Future (explicitly **not** implemented; **no delivery date**)

- **Scheduled or recurring connector sync** — not in v1; no promised cadence if added later.
- **Additional connectors** beyond Google and Yelp (e.g. another directory) — would require a new spec addendum; not implied by this document.

**Engineering rule:** No UI or copy may imply automatic syncing, continuous platform mirroring, or SLA-backed freshness. Connector “connected” state means **authorized for on-demand pull**, not **always up to date**.

---

## 3. Coverage model

- Beacon **only knows what is imported.** Counts and averages are **over imported rows**, not over the live internet.
- **Absence of data ≠ absence of reviews.** Empty import or missing file does **not** mean the business has no reviews on Google or Yelp.
- **Partial imports = partial truth.** A subset of locations, a date range export, or a filtered export is still stored as truth *for that file* — not as a census of all reviews.
- **Deduplication** is by stable `id` within the store (last import wins per id) — still bounded to imported rows only.

---

## 4. Freshness / SLA (import- and sync-relative only)

**Definitions (aligned with shipped product behavior):**

- **Fresh (combined, import/sync-based):** The latest successful **manual reviews import** or **connector sync** that brought in at least one row was completed **within the last 30 days** (threshold in `REVIEW_IMPORT_STALE_AFTER_DAYS` — used for Today/Market-style surfacing and listing-health review-age points).
- **Stale:** That combined observation is **older than 30 days**, or timestamp missing while review rows exist, or **no reviews in store** (nothing to treat as current).

**Per-source (display on `/local` only):** Google `last_synced_at`, Yelp `last_synced_at`, and manual-import run time are **not merged** on that screen; each source updates **only** when you run that path. See methodology **`#review-source-timestamps`**.

**Explicit non-goals:**

- **No polling promises** — Beacon does not poll platforms on a schedule.
- **No alert SLAs** — no guaranteed notification time for new reviews.
- **No uptime or “always accurate” claims** — no wording that implies continuous sync with Google/Yelp.

Staleness is a **nudge to re-import or sync**, not a measurement of platform-side latency and not a guarantee of completeness.

---

## 5. What Beacon will show (v1)

### Allowed

- **Review count** (imported rows).
- **Average rating** (from imported numeric ratings).
- **Presence / absence** of imported review data (has rows vs empty store).
- **Freshness** derived from **last successful manual import or connector observation** (combined for summary surfaces; per-source on `/local` as above).
- **Simple sentiment band** from **average star rating only** (not text) — already documented under local reviews methodology; **not** NLP.

### Not allowed (v1)

- **Sentiment analysis** on review text (no classification of prose, emotion, or topics from text).
- **Trend detection** (no week-over-week velocity charts, no “reviews accelerating” claims from Beacon math).
- **Response tracking** (no reply status, response rate, or template workflows in Beacon).
- **Competitor review comparison** (no competitor review counts or ratings in Beacon v1).
- **Review impact on rankings** — Beacon does not attribute local/AI ranking movement to reviews in v1.

---

## 6. Operator guidance

- **Use Beacon** to understand **review rows stored after import or on-demand sync**, **import/sync-relative freshness**, and **configured identity** relative to listing health (see listing-health methodology).
- **Use native platforms** (Google Business Profile, Yelp, etc.) for **authoritative on-platform review management**, public responses, disputes, and counts as shown to consumers there.

Beacon is a **read-side snapshot** of what you imported or synced — not an inbox replacement and not a continuous mirror of live platforms.

---

## 7. Disclosures (required in any UI or copy touching reviews)

Any surface showing review counts, averages, or freshness **must** be defensible with:

1. **“Based only on imported or synced data.”** (or equivalent: data in Beacon after import / `Sync now`.)
2. **“No automatic syncing”** — updates when you import or run **Sync now** on a connector; not a standing connection to the platform.
3. **“May not reflect your full review set on Google, Yelp, or elsewhere.”** Counts **may differ** from platform reality; **Beacon may not have full review coverage** even when a connector is used.

Optional but recommended: link to `/settings/methodology#review-monitoring-v1`, `#local-reviews`, `#review-connectors`, and `#review-source-timestamps` as appropriate.

---

## 8. FAQ (canonical answers)

These answers are **normative** for product and support copy.

### Why don’t counts match Google/Yelp?

Beacon shows **rows in the Beacon store** after your last manual import or connector sync. Platforms change outside Beacon; APIs and exports may omit reviews; timing differs from browsing the consumer site. **Partial coverage and timing differences** are expected; mismatches are **not** a bug by themselves.

### Does Beacon sync reviews automatically?

**No.** There is **no automatic syncing**. New or changed reviews appear in Beacon only after you **import a file** (Settings → Import) or run **`Sync now`** on a connector (Settings → Connectors). No background schedule is implied.

### Can Beacon respond to reviews?

**No.** No reply composer, no AI drafts for public responses, no posting to platforms. Use Google/Yelp (or your reputation tool) for responses.

### Do reviews affect my rankings here?

**Not in Beacon’s models.** Beacon does not compute “ranking impact of reviews” and does not claim that reviews cause citation or AI visibility changes. Any correlation you observe elsewhere is outside this v1 scope.

---

## 9. Hard rules (anti–feature creep)

1. **No false freshness** — UI, docs, and marketing must not imply **automatic** sync, **continuous** platform mirroring, **SLA-backed** currency, or **“live”** / **“real-time”** parity with Google/Yelp. **“Last synced”** means **most recent successful pull** for that connector; connector **connected** means **authorized for on-demand pull**, not always current.
2. **No vague future promises** — Do not advertise undated “coming soon” for **scheduled** multi-platform sync unless explicitly approved in a release plan. **Google + Yelp on-demand connectors are shipped**; this rule targets **undelivered** expansions (e.g. cron, extra platforms).
3. **Match current system reality** — Copy must remain true whether the operator uses **manual only**, **connectors only**, or **both**; optional connectors must never read as mandatory.
4. **Single-user internal app first** — No teams, permissions, or multi-tenant review workflows unless explicitly requested later.
5. **Trust over breadth** — Prefer missing features to overstated coverage.

---

## 10. Success criteria

- A **new operator** reading methodology + this spec cannot reasonably believe Beacon replaces Google/Yelp for on-platform review management, **automatic** ingestion, or **complete** live counts.
- A **future engineer** cannot expand scope (scheduled sync, new platforms, NLP, alerts) without updating **this spec**, **1.4e** where applicable, and the methodology anchors — deliberate friction is intentional.
- **Trust boundary** holds with **shipped** Google/Yelp connectors: 1.4d remains the **monitoring** contract; 1.4e remains the **connector** contract; both stay consistent with `/settings/methodology`.

---

## 11. Document control

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-04-13 | Initial spec + methodology anchor |
| 1.1 | 2026-04-13 | Aligned with shipped Google + Yelp on-demand connectors, per-source `/local` timestamps, combined freshness for Today/Market; removed obsolete “manual only / no APIs” drift |

---

## 12. Out of scope (explicit backlog rejections)

- Review request campaigns, SMS/email review generation.
- Sentiment / topic modeling on text.
- Competitive review benchmarking.
- GBP posts, Q&A, or photos as part of “review monitoring.”
- Legal hold, e-discovery, or regulated retention workflows (unless separately specified).

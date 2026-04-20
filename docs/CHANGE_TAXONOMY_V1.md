# Change Taxonomy v1 — architecture spec

**Status:** architecture LOCKED · leaf buckets PROVISIONAL until first full classifier run
**Source of truth for:** `src/domains/attribution/change-taxonomy.ts` · `scripts/classify-historical-changes.ts`
**Supersedes:** `docs/DRAFT_CHANGE_TAXONOMY.md` (heuristic draft, kept for reference)

---

## What's locked

1. **Seven taxonomy layers.** Every event belongs to exactly one:
   - `change` — on-site live edits
   - `offsite_owned_change` — edits to external profiles we control (GBP, Yelp, Houzz, Facebook, etc.)
   - `offsite_external_signal` — third-party activity we did not author (customer reviews published, external mentions)
   - `finding` — scanner observations
   - `status` — resolution / state-transition events
   - `infra` — sitewide technical changes (rendering, performance, scripts, tracking plumbing)
   - `noise` — measurement snapshots, vague batches, reviews of state, non-actions

2. **Naming convention.** `family.object.action` (3 parts) or `family.section.object.action` (4 parts when the section context changes the attribution question). Actions: `add | modify | remove | replace | deduplicate | normalize | publish | reorder | create`.

3. **Bundle structure.** Every event has `primary_bucket + child_tags[]`. Children are atomic sub-edits within a logical parent change (e.g. hero upgrade bundle). `paired_with[]` links natural siblings (FAQ copy ↔ FAQ schema on same page same day).

4. **Classified event record** (storage shape — one per event):

```ts
type ClassifiedEvent = {
  source_id: string;
  source_type: "changelog" | "finding";
  classifier_version: string;

  taxonomy_layer: "change" | "offsite_owned_change" | "offsite_external_signal"
                | "finding" | "status" | "infra" | "noise";
  primary_bucket: string;             // one of the enum values for the chosen layer
  child_tags: string[];               // atomic sub-edits if parent is a bundle
  paired_with: string[];              // other source_ids linked to this event

  scope: "single_url" | "section" | "sitewide" | "offsite" | "infra-global" | "tenant-global";
  url: string | null;
  url_type: UrlType | null;
  offsite_platform: string | null;    // e.g. "google-business-profile"

  authorship: "user_authored" | "system_detected" | "third_party_generated";

  confidence: "high" | "medium" | "low";
  classifier_rationale: string;

  bundle_parent_id: string | null;
  bundle_size: number;

  observed_at: string;
  tenant_id: string;
};
```

**Why `authorship` is separate from `source_type`:** `source_type` tells us where the record came from (changelog vs scanner). `authorship` tells us who caused the thing to happen:
- `user_authored` — an operator (you / future customer) did the edit. Examples: H1 rewrite, Facebook bio change, claiming a Yelp profile.
- `system_detected` — Beacon's scanner found it. Examples: invalid schema, missing schema, unexpected page change. Never "caused by us."
- `third_party_generated` — someone outside the tenant's control did it. Examples: a customer published a Google review, a directory added/removed our listing, a Bing crawler rate-limited us.

These three have different attribution math. A user-authored edit can credit a citation lift. A system-detected finding informs recommendations but cannot claim credit. A third-party review is a signal that may correlate with lift but was not an action we took.

---

## What's provisional

Every **leaf bucket** is provisional until the first full classifier pass has produced real distribution counts. Leaves will be merged or split based on N:

- Leaves with `N >= 5` → likely LOCKED after first pass
- Leaves with `N = 2–4` → candidates for merging up one level
- Leaves with `N = 1` → almost certainly merge into sibling or parent
- Leaves the LLM had to invent (not in the seed enum) → reviewed one-by-one

Families and parent buckets (e.g. `content.hero.upgrade`, `structure.page.create.*`) are LOCKED. The sub-typing within families (e.g. whether we keep `content.section.add.neighborhoods` as its own leaf or roll it into `content.section.add.generic`) depends on N.

---

## Corrections from the earlier redline

Five architectural fixes:

1. **Split offsite into two layers.** `offsite_owned_change` vs `offsite_external_signal`. Customer-published GBP reviews and our-published review responses are now in different layers. Each event still belongs to exactly one layer.
2. **Rendering → infra.** `structure.*` is site topology (pages, redirects, sitemap, nav, footer, breadcrumbs). Rendering / SSR / SSG / prerender moves to `infra.rendering.*`.
3. **Heading primitives stay.** `content.h1.modify`, `content.h1.add`, `content.h2.add`, `content.h2.modify`, `content.h3.add`, `content.h3.modify` remain as permanent atomic primitives usable as `child_tags` in bundles or standalone. Legacy H3-as-FAQ events get reassigned (not via deleting the bucket).
4. **Architecture locked, leaves provisional.** Layers + naming + bundle structure + record shape are now source-of-truth. Leaf consolidation happens after first classifier pass with real counts.
5. **`authorship` field added.** Three values distinguishing user edits, system detections, and third-party activity.

---

## Layer membership rules (deterministic where possible)

These rules are applied **before** any LLM call, to keep cost down and reduce LLM ambiguity:

| Rule | Decision |
|---|---|
| `source_type === "finding"` | `layer = finding`, `authorship = system_detected` (unless finding is a `guardrail_cleared` or `*_resolved`, then `layer = status`) |
| `source_type === "finding"` AND `type` ∈ `{guardrail_cleared, *_resolved}` | `layer = status`, `authorship = system_detected` |
| URL matches `/(houzz|buildzoom|bing-places|facebook|pinterest|instagram|yelp)/i` OR platform text present | `layer = offsite_owned_change` if description verb is edit-like (create/update/claim/correct/rename); else `offsite_external_signal` |
| URL/context matches `google-business-profile` OR `gbp`  | `offsite_owned_change` if description is response/edit; `offsite_external_signal` if review publication by a third party |
| Description contains measurement language ("captured baseline", "captured N answers", "reviewed robots.txt", "reviewed server logs") | `layer = noise`, `authorship = user_authored` (operator took a measurement, not a change) |
| Description matches infra patterns ("prerender", "SSG", "SSR", "LCP", "TBT", "CLS", "PageSpeed", "HubSpot defer", "GTM defer", "Profound integration") | `layer = infra`, `authorship = user_authored` |
| Description is a vague batch header with no object ("Mar 25 Optimizations", "Apr 02 Batch", "Applied content and structure edits") | `layer = noise`, `primary_bucket = noise.vague-catchall`, `confidence = low` |
| None of the above | `layer = change`, fall through to LLM classification |

---

## Locked families

### `change.*`

```
content.*          visible page copy, headings, sections, lists, tables, cards
metadata.*         <title>, <meta>, canonical, robots, og, twitter-card, crawler-directives
schema.*           JSON-LD edits
media.*            images, videos, galleries, alt-text
link-graph.*       internal + outbound links, anchor text
structure.*        page create/rebuild/remove, redirects, sitemap, nav, footer, breadcrumbs
```

### `offsite_owned_change.*`

```
offsite_owned_change.gbp.profile.*
offsite_owned_change.gbp.review-response.*
offsite_owned_change.yelp.profile.*
offsite_owned_change.houzz.profile.*
offsite_owned_change.buildzoom.profile.*
offsite_owned_change.bing-places.profile.*
offsite_owned_change.social.facebook.*
offsite_owned_change.social.pinterest.*
```

### `offsite_external_signal.*`

```
offsite_external_signal.gbp.review.publish        customer published a review
offsite_external_signal.gbp.mention
offsite_external_signal.third-party.mention
```

### `finding.*`

```
finding.schema.invalid
finding.schema.missing-for-page-type
finding.schema.duplicate
finding.schema.faq-without-jsonld
finding.content.unexpected-change
finding.guardrail.new
finding.page.stale-visibility
finding.robots.ai-crawler-blocked
```

### `status.*`

```
status.guardrail.cleared
status.finding.resolved
status.scan.mismatch-resolved
```

### `infra.*`

```
infra.rendering.ssg-enable
infra.rendering.ssr-config
infra.performance.lcp-optimize
infra.performance.pagespeed-sitewide
infra.scripts.hubspot-defer
infra.scripts.gtm-defer
infra.scripts.third-party-defer
infra.tracking.profound-integration-update
infra.tracking.analytics-update
infra.production.dev-leakage-cleanup
infra.form.integration-test
```

### `noise.*`

```
noise.measurement-snapshot
noise.baseline-capture
noise.review-check
noise.vague-catchall
noise.dedup-artifact
```

See `src/domains/attribution/change-taxonomy.ts` for the full leaf enum and per-bucket lock status.

---

## First-pass classifier exit gate

After `scripts/classify-historical-changes.ts` runs:

- [ ] ≥ 95% of events have `layer` and `primary_bucket` assigned (no `unclassified`)
- [ ] ≤ 15% of `change` layer events are `confidence = low`
- [ ] Every `paired_with` reference is bidirectional
- [ ] No event has `authorship = user_authored` with `layer = finding` (rule violation)
- [ ] No event has `layer = change` with `authorship = third_party_generated` (rule violation)
- [ ] Distribution report produced: `.data/taxonomy-distribution-report.json`
- [ ] N=1 and N=2 leaves flagged for merge review

Only after that report does the operator decide which provisional leaves to lock, merge, or retire.

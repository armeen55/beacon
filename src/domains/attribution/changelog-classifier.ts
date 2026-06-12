/**
 * changelog-classifier — Proof Engine activation (2026-06-11 day shift).
 *
 * THE MISSING KEYSTONE. The causal Proof Engine (natural-controls.ts:
 * `attributeAll` → diff-in-diff lift vs comparable untreated URLs) is
 * fully built + tested but had ZERO runtime callers — its only
 * orchestrator was a one-shot manual script reading legacy flat
 * `.data/classified-events.json` (from an LLM-coupled historical
 * classifier). So `loadChangeOutcomeById` returned null in production
 * and the customer's causal "Proof" drilldown on /changes/[id] never
 * populated.
 *
 * This adapter closes that gap with a DETERMINISTIC, enum-grounded
 * classifier: a per-tenant ChangelogEntry → ClassifiedEvent (the input
 * `attributeAll` consumes). It reads the changelog's OWN structured
 * fields (signal_type, asset_type, url) rather than re-deriving intent
 * from free text — robust, vertical-agnostic, and 100% LLM-free
 * (rail: zero paid API spend).
 *
 * Methodology — why diff-in-diff with comparable untreated URLs is the
 * right causal design here, and why the engine's "computed vs
 * weak_estimate" + confidence-tier honesty is mandatory (parallel-
 * trends is fundamentally unverifiable from data alone), is grounded in
 * (≥5 sources):
 *   1. Huntington-Klein, "The Effect" ch.18 (difference-in-differences):
 *      https://theeffectbook.net/ch-DifferenceinDifference.html
 *   2. Cunningham, "Causal Inference: The Mixtape" ch.9 (DiD):
 *      https://mixtape.scunning.com/09-difference_in_differences
 *   3. LS Analytics, "Parallel Trends: the make-or-break assumption":
 *      https://ls-analytics.com/parallel-trends-the-make-or-break-assumption-for-difference-in-differences/
 *   4. Cunningham, "The Mixtape" ch.10 (synthetic control — a weighted
 *      pool of comparable units tracks the treated unit better than one):
 *      https://mixtape.scunning.com/10-synthetic_control
 *   5. Synthetic control method (donor pool must share characteristics):
 *      https://en.wikipedia.org/wiki/Synthetic_control_method
 *   6. Averi, "AI citation tracking" (lift measured as citation-frequency
 *      change on a fixed prompt cadence — the unit our series uses):
 *      https://www.averi.ai/blog/ai-citation-tracking-chatgpt-perplexity-claude
 *   7. digitalapplied, "AI share of voice framework 2026":
 *      https://www.digitalapplied.com/blog/ai-share-of-voice-tracking-brand-citations-framework-2026
 *
 * The engine already honors 1–5: it returns `weak_estimate` (treated-only
 * descriptives, no causal claim) below the control-count floor, grades
 * confidence by control count + baseline + post-window data, and never
 * emits a causal `adjusted_lift` without ≥minControls comparable URLs.
 * This classifier only feeds it correctly-shaped, honestly-confident
 * events; it NEVER manufactures eligibility.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { SignalType, AssetType } from "@/lib/constants";
import {
  CLASSIFIER_VERSION,
  inferUrlType,
  normalizeUrl,
  layerOf,
  type ClassifiedEvent,
  type TaxonomyLayer,
  type EventScope,
  type UrlType,
  type Authorship,
  type Confidence,
} from "./change-taxonomy";

/** signal_type → (layer, scope, representative valid bucket id, authorship).
 *  Only `change`-layer + `single_url` events are eligible for URL-level
 *  diff-in-diff (eligibilityCheck); everything else is classified
 *  HONESTLY into its real layer so the engine cleanly returns an
 *  ineligible status rather than a fake lift. */
const SIGNAL_MAP: Record<
  SignalType,
  { layer: TaxonomyLayer; scope: EventScope; bucket: string; authorship: Authorship }
> = {
  faq: { layer: "change", scope: "single_url", bucket: "content.faq.add", authorship: "user_authored" },
  content: { layer: "change", scope: "single_url", bucket: "content.body.rewrite", authorship: "user_authored" },
  service_page: { layer: "change", scope: "single_url", bucket: "content.body.rewrite", authorship: "user_authored" },
  page: { layer: "change", scope: "single_url", bucket: "content.body.rewrite", authorship: "user_authored" },
  technical: { layer: "infra", scope: "infra-global", bucket: "infra.generic", authorship: "user_authored" },
  citation: { layer: "offsite_owned_change", scope: "offsite", bucket: "offsite_owned_change.gbp.profile.create", authorship: "user_authored" },
  off_page_seo: { layer: "offsite_owned_change", scope: "offsite", bucket: "offsite_owned_change.gbp.profile.create", authorship: "user_authored" },
  review: { layer: "offsite_external_signal", scope: "tenant-global", bucket: "offsite_external_signal.gbp.review.publish", authorship: "third_party_generated" },
  lead_form: { layer: "noise", scope: "tenant-global", bucket: "noise.vague-catchall", authorship: "user_authored" },
  measurement: { layer: "noise", scope: "tenant-global", bucket: "noise.measurement-snapshot", authorship: "system_detected" },
};

/** asset_type → URL archetype fallback, used only when the URL itself
 *  doesn't yield a type via inferUrlType. Vertical-agnostic page roles. */
const ASSET_URL_TYPE: Record<AssetType, UrlType> = {
  homepage: "home",
  city_page: "location",
  service_page: "service",
  service_pages: "service" as UrlType, // defensive: never in ASSET_TYPES, but cheap
  infrastructure: "other",
  sitemap: "other",
  directory_profile: "other",
  lead_form: "landing",
  project_page: "project",
  process_page: "service",
  brand_page: "landing",
  hub_page: "hub",
} as Record<AssetType, UrlType>;

/**
 * Classify ONE changelog entry into a ClassifiedEvent the natural-
 * controls engine can attribute. Pure + deterministic; no I/O, no LLM.
 *
 * Confidence (drives eligibility — `low` is rejected by the engine):
 *   - `low`  when an on-site change has NO url (can't run URL-level math),
 *            or the description is empty/trivial.
 *   - `high` when an on-site change carries a url + a real description
 *            (the typed signal_type already tells us what it is).
 *   - `medium` otherwise (e.g., url present but description thin).
 * Non-change layers keep their own confidence but are ineligible anyway.
 */
export function classifyChangelogEntry(
  entry: ChangelogEntry,
  tenantId: string,
): ClassifiedEvent {
  const map = SIGNAL_MAP[entry.signal_type] ?? SIGNAL_MAP.content;
  const url = normalizeUrl(entry.url);
  // Prefer the URL's structural archetype; when the path yields nothing
  // specific (inferUrlType returns null OR the catch-all "other"), trust
  // the changelog's typed asset_type instead — it's better signal than
  // "other" for cross-tenant pattern matching.
  let urlType: UrlType | null = null;
  if (url) {
    const structural = inferUrlType(url);
    urlType =
      structural && structural !== "other"
        ? structural
        : ASSET_URL_TYPE[entry.asset_type] ?? structural ?? "other";
  }
  const description = (entry.change_description ?? "").trim();

  let confidence: Confidence;
  if (map.layer === "change") {
    if (!url) confidence = "low";
    else if (description.length >= 12) confidence = "high";
    else confidence = "medium";
  } else {
    // Non-attributable layers: confidence reflects description clarity
    // but the engine gates them out on layer/scope regardless.
    confidence = description.length >= 12 ? "medium" : "low";
  }

  return {
    source_id: entry.id,
    source_type: "changelog",
    classifier_version: CLASSIFIER_VERSION,
    taxonomy_layer: map.layer,
    primary_bucket: map.bucket,
    child_tags: [],
    paired_with: [],
    scope: map.scope,
    url,
    url_type: urlType,
    offsite_platform: null,
    authorship: map.authorship,
    confidence,
    classifier_rationale: `deterministic: signal_type=${entry.signal_type} asset_type=${entry.asset_type} → layer=${map.layer}/scope=${map.scope}`,
    bundle_parent_id: null,
    bundle_size: 1,
    observed_at: entry.timestamp || entry.created_at,
    tenant_id: tenantId,
  };
}

/** Classify a tenant's changelog into events for `attributeAll`.
 *  Archived entries are dropped (they're hidden from /changes). */
export function classifyChangelogEntries(
  entries: ReadonlyArray<ChangelogEntry & { archived?: boolean }>,
  tenantId: string,
): ClassifiedEvent[] {
  const out: ClassifiedEvent[] = [];
  for (const e of entries) {
    if (e.archived) continue;
    const classified = classifyChangelogEntry(e, tenantId);
    // Defensive: never emit an event whose bucket isn't a real taxonomy
    // id (keeps brain pattern-keys + summaries honest).
    if (layerOf(classified.primary_bucket) === null) continue;
    out.push(classified);
  }
  return out;
}

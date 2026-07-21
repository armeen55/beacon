/**
 * Change taxonomy — v1 architecture.
 *
 * Source of truth: `docs/CHANGE_TAXONOMY_V1.md`.
 *
 * Every Beacon event is classified into exactly one of six taxonomy layers.
 * Each classified event carries `primary_bucket + child_tags[]` so Beacon's
 * attribution brain can learn both bundle effects (did the hero upgrade
 * package work?) and atomic effects (did the H1 alone matter?).
 *
 * Leaf buckets marked PROVISIONAL may be merged, split, or retired after
 * the first full classifier pass produces real distribution counts.
 * Layer/family/parent structure is LOCKED and should not change without
 * updating the spec doc.
 */

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** Top-level classification. Every event belongs to exactly one. */
export type TaxonomyLayer =
  | "change" //                   on-site live edits
  | "offsite_owned_change" //     edits to external profiles we control
  | "offsite_external_signal" //  third-party activity (customer reviews, mentions)
  | "finding" //                  scanner observation (not an edit)
  | "status" //                   state transition (finding resolved, guardrail cleared)
  | "infra" //                    sitewide technical change (rendering, perf, scripts)
  | "noise"; //                   measurement snapshot, vague batch, non-action

/** Who caused the event. Independent of `source_type`. */
export type Authorship =
  | "user_authored" //            operator/customer took the action
  | "system_detected" //          Beacon's scanner noticed it
  | "third_party_generated"; //   external actor (customer review, external mention)

/** Attribution math uses this to decide single-URL vs tenant-wide math. */
export type EventScope =
  | "single_url" //               one page was edited
  | "section" //                  one section of one page
  | "sitewide" //                  applied across many URLs on our site
  | "offsite" //                   action happened on an external platform
  | "infra-global" //              technical change affecting all URLs
  | "tenant-global"; //            tenant-level signal (external review, brand mention)

/** URL archetype. Used for cross-tenant pattern matching in the brain. */
export type UrlType =
  | "home"
  | "location"
  | "service"
  | "project"
  | "available-home"
  | "landing"
  | "blog"
  | "hub"
  | "legal"
  | "other";

export type Confidence = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Bucket metadata
// ---------------------------------------------------------------------------

/** `locked` = architecturally committed. `provisional` = may merge/split after first classifier pass. */
export type BucketLockStatus = "locked" | "provisional";

export type BucketDef = {
  id: string;
  layer: TaxonomyLayer;
  description: string;
  lock: BucketLockStatus;
  /** `true` when this bucket is typically the parent of a bundle (carries child_tags). */
  isBundleParent?: boolean;
};

// ---------------------------------------------------------------------------
// Change layer buckets
// ---------------------------------------------------------------------------

export const CHANGE_BUCKETS = {
  // --- content: bundles ---
  "content.hero.upgrade": { parent: true, provisional: false, desc: "Hero section added or substantially rebuilt (H1 + subhead + CTA + image)." },
  "content.hero.add": { parent: true, provisional: false, desc: "New hero section added to a page that didn't have one." },
  "content.faq.add": { parent: true, provisional: false, desc: "Visible FAQ section added (Q&A copy in HTML, separate from JSON-LD)." },
  "content.faq.modify": { parent: false, provisional: false, desc: "FAQ content modified (questions/answers changed)." },
  "content.faq.replace": { parent: false, provisional: false, desc: "FAQ block replaced wholesale (e.g. 11-question → 6-question)." },
  "content.faq.normalize-styling": { parent: false, provisional: true, desc: "FAQ answer styling normalized across pages without content change." },

  // --- content: headings (atomic primitives, usable as child_tags) ---
  "content.h1.add": { parent: false, provisional: false, desc: "New H1 added to a page." },
  "content.h1.modify": { parent: false, provisional: false, desc: "H1 text rewritten." },
  "content.h2.add": { parent: false, provisional: false, desc: "New H2 added." },
  "content.h2.modify": { parent: false, provisional: false, desc: "H2 text rewritten." },
  "content.h3.add": { parent: false, provisional: false, desc: "New H3 added." },
  "content.h3.modify": { parent: false, provisional: false, desc: "H3 text rewritten." },
  "content.subheadline.modify": { parent: false, provisional: false, desc: "Sub-headline (typically under hero H1) modified." },
  "content.subheadline.add": { parent: false, provisional: false, desc: "Sub-headline added." },
  "content.hero.subheadline.modify": { parent: false, provisional: true, desc: "Hero subheadline modified (4-part name for when hero context matters)." },
  "content.hero.h1.modify": { parent: false, provisional: true, desc: "Hero H1 modified (4-part name for when hero context matters)." },

  // --- content: sections ---
  "content.section.add.process": { parent: false, provisional: false, desc: "Process / workflow section added (n-step how-we-work)." },
  "content.section.add.neighborhoods": { parent: false, provisional: false, desc: "Neighborhoods / micro-markets section (city-specific area descriptions)." },
  "content.section.add.cost": { parent: false, provisional: false, desc: "Cost / pricing / $-per-sqft section added." },
  "content.section.add.adu": { parent: false, provisional: true, desc: "ADU / accessory-dwelling section added." },
  "content.section.add.service-area": { parent: false, provisional: false, desc: "Service-area grid / cities-served list added." },
  "content.section.add.comparison": { parent: false, provisional: false, desc: "Comparison / builder-vs-builder section added." },
  "content.section.add.quick-facts": { parent: false, provisional: true, desc: "Quick facts / data-point strip added." },
  "content.section.add.right-fit-grid": { parent: false, provisional: true, desc: "Right-Fit style grid added." },
  "content.section.add.generic": { parent: false, provisional: false, desc: "Generic content section added (absorbs trust-strip, checklist, featured-project-grid, narrative-block, and other one-off named variants)." },
  "content.section.replace.generic": { parent: false, provisional: false, desc: "Generic section replacement (absorbs portfolio/why-us and other one-off replaced variants)." },
  "content.testimonial-block.add": { parent: false, provisional: false, desc: "Customer testimonial / quote block added." },
  "content.table.add": { parent: false, provisional: false, desc: "Comparison / data table added." },
  "content.anchor-ids.add": { parent: false, provisional: false, desc: "Section anchor IDs added for internal linking." },

  // --- content: cards / CTAs / body ---
  "content.card.add": { parent: false, provisional: true, desc: "Card added to a grid (e.g. project card on a portfolio grid)." },
  "content.card.title.modify": { parent: false, provisional: true, desc: "Card title modified." },
  "content.card.reorder": { parent: false, provisional: true, desc: "Cards reordered on a grid." },
  "content.blurb.add": { parent: false, provisional: true, desc: "Short descriptive blurb added (typically inside a comparison/list section)." },
  "content.cta.add": { parent: false, provisional: false, desc: "Call-to-action button/link added." },
  "content.cta.modify": { parent: false, provisional: false, desc: "CTA copy or link modified." },
  "content.cta.remove": { parent: false, provisional: false, desc: "CTA removed." },
  "content.cta-section.add": { parent: false, provisional: true, desc: "Dedicated CTA section (headline + body + buttons) added." },
  "content.body.rewrite": { parent: false, provisional: false, desc: "Body copy substantially rewritten on a single section." },

  // --- metadata ---
  "metadata.title.modify": { parent: false, provisional: false, desc: "<title> tag modified." },
  "metadata.meta-description.modify": { parent: false, provisional: false, desc: "<meta name=description> modified." },
  "metadata.canonical.modify": { parent: false, provisional: false, desc: "<link rel=canonical> modified." },
  "metadata.robots.modify": { parent: false, provisional: false, desc: "meta-robots or robots directive modified." },
  "metadata.open-graph-tags.modify": { parent: false, provisional: false, desc: "Open Graph tags modified (og:title, og:description, og:image, og:url, og:type)." },
  "metadata.twitter-card.modify": { parent: false, provisional: true, desc: "Twitter Card tags modified." },
  "metadata.crawler-directives.robots-txt.modify": { parent: false, provisional: false, desc: "robots.txt file modified." },
  "metadata.crawler-directives.llms-txt.publish": { parent: false, provisional: false, desc: "llms.txt file published/modified." },
  "metadata.indexing-directives.set": { parent: true, provisional: false, desc: "Bundle: robots + canonical (+ og) set together in one deploy." },
  "metadata.meta.modify": { parent: false, provisional: false, desc: "Generic metadata update (fallback when the specific tag is unclear)." },

  // --- schema ---
  "schema.faqpage.add": { parent: false, provisional: false, desc: "FAQPage JSON-LD added." },
  "schema.faqpage.remove": { parent: false, provisional: true, desc: "FAQPage JSON-LD removed." },
  "schema.faqpage.deduplicate": { parent: false, provisional: false, desc: "Duplicate FAQPage JSON-LD blocks consolidated to one." },
  "schema.breadcrumb.add": { parent: false, provisional: false, desc: "BreadcrumbList JSON-LD added." },
  "schema.article.add": { parent: false, provisional: false, desc: "Article / BlogPosting JSON-LD added." },
  "schema.localbusiness.add": { parent: false, provisional: false, desc: "LocalBusiness / HomeAndConstructionBusiness / GeneralContractor JSON-LD added." },
  "schema.howto.add": { parent: false, provisional: false, desc: "HowTo JSON-LD added." },
  "schema.webpage.add": { parent: false, provisional: true, desc: "WebPage JSON-LD added." },
  "schema.organization.add": { parent: false, provisional: true, desc: "Organization JSON-LD added." },
  "schema.professional-service.add": { parent: false, provisional: true, desc: "ProfessionalService JSON-LD added." },
  "schema.service.add": { parent: false, provisional: true, desc: "Service JSON-LD added." },
  "schema.offer.add": { parent: false, provisional: true, desc: "Offer / price JSON-LD added (attached to a listing)." },
  "schema.videoobject.add": { parent: false, provisional: false, desc: "VideoObject JSON-LD added." },
  "schema.imagegallery.add": { parent: false, provisional: true, desc: "ImageGallery JSON-LD added." },
  "schema.single-family-residence.add": { parent: false, provisional: false, desc: "SingleFamilyResidence JSON-LD added (available-home listing)." },
  "schema.review.add": { parent: false, provisional: false, desc: "Review JSON-LD added." },
  "schema.content.edit": { parent: false, provisional: false, desc: "Schema JSON-LD content edited without type set changing." },
  "schema.other.add": { parent: false, provisional: true, desc: "Other typed JSON-LD added (fallback)." },
  "schema.other.remove": { parent: false, provisional: true, desc: "Other typed JSON-LD removed (fallback)." },

  // --- media ---
  "media.image.add": { parent: false, provisional: false, desc: "Image added." },
  "media.image.replace": { parent: false, provisional: false, desc: "Image replaced (usually higher resolution or different subject)." },
  "media.hero-image.add": { parent: false, provisional: false, desc: "Hero image added." },
  "media.hero-image.modify": { parent: false, provisional: false, desc: "Hero image positioning / focal point modified." },
  "media.alt-text.add": { parent: false, provisional: false, desc: "Alt text added to images." },
  "media.alt-text.modify": { parent: false, provisional: true, desc: "Alt text modified." },
  "media.gallery.add": { parent: true, provisional: false, desc: "Image gallery section added." },
  "media.video.add": { parent: false, provisional: true, desc: "Video embed added." },

  // --- link-graph ---
  "link-graph.internal-link.add": { parent: false, provisional: false, desc: "Internal link added on a page." },
  "link-graph.internal-link.modify": { parent: false, provisional: false, desc: "Internal link target or anchor modified." },
  "link-graph.outbound-link.add": { parent: false, provisional: true, desc: "External / outbound link added." },
  "link-graph.anchor-text.modify": { parent: false, provisional: true, desc: "Anchor text of an existing link modified." },

  // --- structure (site topology) ---
  "structure.page.create.location": { parent: true, provisional: false, desc: "New city / location page created. Usually a bundle." },
  "structure.page.create.service": { parent: true, provisional: false, desc: "New service page created." },
  "structure.page.create.project": { parent: true, provisional: false, desc: "New project / portfolio page created." },
  "structure.page.create.available-home": { parent: true, provisional: false, desc: "New available-home listing page created." },
  "structure.page.create.landing": { parent: true, provisional: false, desc: "New standalone landing / comparison page created." },
  "structure.page.create.generic": { parent: true, provisional: false, desc: "Generic page creation (fallback)." },
  "structure.page.rebuild": { parent: true, provisional: false, desc: "Existing page substantially reconstructed (multi-section rewrite)." },
  "structure.page.remove": { parent: false, provisional: true, desc: "Page removed / delisted." },
  "structure.redirect.add": { parent: false, provisional: false, desc: "301 / 302 redirect added between URLs." },
  "structure.sitemap-xml.modify": { parent: false, provisional: false, desc: "sitemap.xml modified." },
  "structure.route.ensure-200": { parent: false, provisional: true, desc: "Parent route ensured to return 200 (routing hygiene)." },
  "structure.footer.link.add": { parent: false, provisional: false, desc: "Link added to global footer." },
  "structure.footer.link.remove": { parent: false, provisional: true, desc: "Link removed from global footer." },
  "structure.footer.modify": { parent: false, provisional: true, desc: "Global footer modified (fallback)." },
  "structure.nav.item.add": { parent: false, provisional: false, desc: "Nav item added to top navigation." },
  "structure.nav.item.remove": { parent: false, provisional: false, desc: "Nav item removed from top navigation." },
  "structure.nav.reorder": { parent: false, provisional: false, desc: "Top navigation item sequence changed." },
  "structure.nav.modify": { parent: false, provisional: true, desc: "Top navigation modified (fallback)." },
  "structure.breadcrumb.add": { parent: false, provisional: false, desc: "Visible breadcrumbs added (separate from schema)." },
} as const;

export type ChangeBucketId = keyof typeof CHANGE_BUCKETS;

// ---------------------------------------------------------------------------
// Offsite owned change layer
// ---------------------------------------------------------------------------

export const OFFSITE_OWNED_BUCKETS = {
  "offsite_owned_change.gbp.profile.create": { parent: false, provisional: true, desc: "GBP profile created or claimed." },
  "offsite_owned_change.gbp.profile.modify": { parent: false, provisional: false, desc: "GBP profile fields edited." },
  "offsite_owned_change.gbp.review-response.publish": { parent: false, provisional: false, desc: "Published our response to a GBP review." },
  "offsite_owned_change.yelp.profile.claim": { parent: false, provisional: false, desc: "Yelp business profile claimed/completed." },
  "offsite_owned_change.yelp.profile.modify": { parent: false, provisional: true, desc: "Yelp profile edited." },
  "offsite_owned_change.houzz.profile.create": { parent: false, provisional: false, desc: "Houzz profile created." },
  "offsite_owned_change.houzz.profile.modify": { parent: false, provisional: true, desc: "Houzz profile edited." },
  "offsite_owned_change.buildzoom.profile.modify": { parent: false, provisional: true, desc: "BuildZoom profile edited/corrected." },
  "offsite_owned_change.bing-places.profile.create": { parent: false, provisional: false, desc: "Bing Places for Business profile created." },
  "offsite_owned_change.social.facebook.bio.modify": { parent: false, provisional: false, desc: "Facebook bio edited." },
  "offsite_owned_change.social.pinterest.image-rename.bulk": { parent: false, provisional: true, desc: "Bulk image rename/optimize on Pinterest." },
  "offsite_owned_change.generic": { parent: false, provisional: false, desc: "Generic owned-offsite change (fallback)." },
} as const;

export type OffsiteOwnedBucketId = keyof typeof OFFSITE_OWNED_BUCKETS;

// ---------------------------------------------------------------------------
// Offsite external signal layer
// ---------------------------------------------------------------------------

export const OFFSITE_EXTERNAL_BUCKETS = {
  "offsite_external_signal.gbp.review.publish": { parent: false, provisional: false, desc: "Customer published a review on our GBP." },
  "offsite_external_signal.gbp.mention": { parent: false, provisional: true, desc: "Mention of our brand on GBP (non-review)." },
  "offsite_external_signal.third-party.mention": { parent: false, provisional: true, desc: "Brand mentioned by third party (press, directory, forum)." },
  "offsite_external_signal.generic": { parent: false, provisional: false, desc: "Generic external signal (fallback)." },
} as const;

export type OffsiteExternalBucketId = keyof typeof OFFSITE_EXTERNAL_BUCKETS;

// ---------------------------------------------------------------------------
// Finding layer (scanner observations)
// ---------------------------------------------------------------------------

export const FINDING_BUCKETS = {
  "finding.schema.invalid": { parent: false, provisional: false, desc: "Scanner flagged JSON-LD as invalid for Google rich-result requirements." },
  "finding.schema.missing-for-page-type": { parent: false, provisional: false, desc: "Page missing the expected schema types for its asset type." },
  "finding.schema.duplicate": { parent: false, provisional: false, desc: "Scanner detected duplicate JSON-LD blocks." },
  "finding.schema.faq-without-jsonld": { parent: false, provisional: false, desc: "Page has FAQ content but no FAQPage JSON-LD." },
  "finding.content.unexpected-change": { parent: false, provisional: false, desc: "Content changed without a matching changelog entry." },
  "finding.guardrail.new": { parent: false, provisional: false, desc: "New guardrail condition detected on a page." },
  "finding.page.stale-visibility": { parent: false, provisional: false, desc: "Visibility data went stale on a URL." },
  "finding.robots.ai-crawler-blocked": { parent: false, provisional: false, desc: "robots.txt disallows an AI crawler on a cited URL." },
  "finding.title.changed": { parent: false, provisional: false, desc: "Scanner detected <title> tag change without changelog entry." },
  "finding.meta.changed": { parent: false, provisional: false, desc: "Scanner detected meta tag change without changelog entry." },
  "finding.h1.changed": { parent: false, provisional: false, desc: "Scanner detected H1 change without changelog entry." },
  "finding.canonical.changed": { parent: false, provisional: false, desc: "Scanner detected canonical change without changelog entry." },
  "finding.links.changed": { parent: false, provisional: false, desc: "Scanner detected link changes without changelog entry." },
  "finding.page.added": { parent: false, provisional: false, desc: "Scanner detected a new page." },
  "finding.page.removed": { parent: false, provisional: false, desc: "Scanner detected a page removal." },
  "finding.deploy.mismatch": { parent: false, provisional: false, desc: "Scanner detected a deploy-related snapshot mismatch." },
  "finding.generic": { parent: false, provisional: false, desc: "Generic finding (fallback)." },
} as const;

export type FindingBucketId = keyof typeof FINDING_BUCKETS;

// ---------------------------------------------------------------------------
// Status layer (state transitions)
// ---------------------------------------------------------------------------

export const STATUS_BUCKETS = {
  "status.guardrail.cleared": { parent: false, provisional: false, desc: "A guardrail condition was cleared." },
  "status.finding.resolved": { parent: false, provisional: false, desc: "A finding was marked resolved." },
  "status.scan.mismatch-resolved": { parent: false, provisional: true, desc: "A scan mismatch was resolved." },
} as const;

export type StatusBucketId = keyof typeof STATUS_BUCKETS;

// ---------------------------------------------------------------------------
// Infra layer (sitewide technical changes)
// ---------------------------------------------------------------------------

export const INFRA_BUCKETS = {
  "infra.rendering.ssg-enable": { parent: false, provisional: false, desc: "Static generation / prerendering enabled." },
  "infra.rendering.ssr-config": { parent: false, provisional: true, desc: "SSR configuration changed." },
  "infra.performance.lcp-optimize": { parent: false, provisional: false, desc: "Largest-contentful-paint optimization (preload, prioritization)." },
  "infra.performance.pagespeed-sitewide": { parent: false, provisional: false, desc: "Sitewide PageSpeed / Lighthouse optimization batch." },
  "infra.scripts.third-party-defer": { parent: false, provisional: false, desc: "Third-party script deferred from critical path (absorbs hubspot/gtm/analytics-specific variants)." },
  "infra.tracking.profound-integration-update": { parent: false, provisional: false, desc: "Profound log integration update (measurement plumbing)." },
  "infra.tracking.analytics-update": { parent: false, provisional: true, desc: "Analytics configuration update." },
  "infra.production.dev-leakage-cleanup": { parent: false, provisional: false, desc: "Removed localhost/dev references from production source." },
  "infra.form.integration-test": { parent: false, provisional: false, desc: "Form integration tested (e.g. HubSpot mapping)." },
  "infra.generic": { parent: false, provisional: false, desc: "Generic infrastructure change (fallback)." },
} as const;

export type InfraBucketId = keyof typeof INFRA_BUCKETS;

// ---------------------------------------------------------------------------
// Noise layer
// ---------------------------------------------------------------------------

export const NOISE_BUCKETS = {
  "noise.measurement-snapshot": { parent: false, provisional: false, desc: "'Captured N answers' / measurement export." },
  "noise.baseline-capture": { parent: false, provisional: false, desc: "'First clean baseline' / starting-point measurement." },
  "noise.review-check": { parent: false, provisional: false, desc: "'Reviewed robots.txt / server logs / settings' — no action taken." },
  "noise.vague-catchall": { parent: false, provisional: false, desc: "Description too vague to classify (e.g. 'Mar 25 Optimizations')." },
  "noise.dedup-artifact": { parent: false, provisional: false, desc: "Duplicate entry resulting from legacy ingestion." },
} as const;

export type NoiseBucketId = keyof typeof NOISE_BUCKETS;

// ---------------------------------------------------------------------------
// Union of all bucket ids
// ---------------------------------------------------------------------------

/** Returns the layer a bucket belongs to, or `null` if the id is unknown. */
export function layerOf(bucket: string): TaxonomyLayer | null {
  if (bucket in CHANGE_BUCKETS) return "change";
  if (bucket in OFFSITE_OWNED_BUCKETS) return "offsite_owned_change";
  if (bucket in OFFSITE_EXTERNAL_BUCKETS) return "offsite_external_signal";
  if (bucket in FINDING_BUCKETS) return "finding";
  if (bucket in STATUS_BUCKETS) return "status";
  if (bucket in INFRA_BUCKETS) return "infra";
  if (bucket in NOISE_BUCKETS) return "noise";
  return null;
}

// ---------------------------------------------------------------------------
// Classified event record
// ---------------------------------------------------------------------------

export const CLASSIFIER_VERSION = "v1.0";

export type ClassifiedEvent = {
  source_id: string;
  source_type: "changelog" | "finding";
  classifier_version: string;

  taxonomy_layer: TaxonomyLayer;
  primary_bucket: string;
  child_tags: string[];
  paired_with: string[];

  scope: EventScope;
  url: string | null;
  url_type: UrlType | null;
  offsite_platform: string | null;

  authorship: Authorship;

  confidence: Confidence;
  classifier_rationale: string;

  bundle_parent_id: string | null;
  bundle_size: number;

  observed_at: string;
  tenant_id: string;
};

// ---------------------------------------------------------------------------
// Helpers (deterministic pre-classification)
// ---------------------------------------------------------------------------

/** Strip protocol+domain; lowercase; drop trailing slash. Stable key for URL matching. */
export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "");
  return stripped.toLowerCase() || "/";
}

/** Derive URL archetype from a path. `null` for offsite or unknown. */
export function inferUrlType(url: string | null): UrlType | null {
  if (!url) return null;
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  if (isOffsitePlatform(normalized) !== null) return null;
  if (normalized === "/" || normalized === "") return "home";
  if (normalized.startsWith("/locations/")) return "location";
  if (normalized === "/locations") return "hub";
  if (normalized.startsWith("/services/")) return "service";
  if (normalized === "/services") return "hub";
  if (normalized.startsWith("/explore-projects/")) return "project";
  if (normalized === "/explore-projects") return "hub";
  if (normalized.startsWith("/available-homes/")) return "available-home";
  if (normalized === "/available-homes") return "hub";
  if (/^\/(luxury|custom|design-build)-home-builder-bay-area/.test(normalized)) return "landing";
  if (/^\/(privacy|terms|legal)/.test(normalized)) return "legal";
  if (normalized.startsWith("/blog")) return "blog";
  if (/^\/(about-us|our-process|our-difference|contact-us|design-studio|services|explore-projects|locations|available-homes|our-partners)\b/.test(normalized)) return "hub";
  return "other";
}

/** Detect offsite platform from a URL/context string. Returns canonical platform name or null. */
export function isOffsitePlatform(input: string | null): string | null {
  if (!input) return null;
  const lower = input.toLowerCase();
  if (lower.includes("houzz.com")) return "houzz";
  if (lower.includes("buildzoom.com")) return "buildzoom";
  if (lower.includes("facebook.com") || lower === "facebook page") return "facebook";
  if (lower.includes("pinterest.com")) return "pinterest";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("yelp.com") || lower === "yelp") return "yelp";
  if (lower.includes("bing-places") || lower.includes("bing places")) return "bing-places";
  if (lower.includes("google-business-profile") || lower.includes("google business profile") || lower === "gbp") return "google-business-profile";
  return null;
}

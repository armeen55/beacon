/**
 * Phase 1 Step 4 — Classify every historical Beacon event into the v1 taxonomy.
 *
 * Input sources:
 *   - .data/imported-changes.json  (303 changelog entries, minus archived)
 *   - .data/scan-findings.json     (85 findings, minus rejected/ignored/linked-accepted)
 *
 * Strategy (cost-aware):
 *   1. Deterministic pre-classification routes most events to their layer
 *      (finding/status from finding.type, offsite from URL, infra from
 *      keywords, noise from measurement/vague phrasing). ~60–80% of events
 *      land this way with high confidence and no LLM cost.
 *   2. Change-layer candidates go through a strong heuristic classifier
 *      (keyword + structured schema_types). Most land here.
 *   3. Remaining ambiguous change-layer events optionally hit Claude Haiku
 *      via the Anthropic Messages API. When ANTHROPIC_API_KEY is unset,
 *      these events get primary_bucket = `noise.vague-catchall` with
 *      confidence=low so the distribution report still surfaces them.
 *   4. Post-classification passes: bundle detection (same-day same-URL
 *      parent/child grouping) and pair linking (FAQ copy ↔ FAQ schema).
 *
 * Outputs:
 *   - .data/classified-events.json        full array of ClassifiedEvent
 *   - .data/taxonomy-distribution-report.json  per-bucket counts + flags
 *   - console summary (layer totals, low-confidence %, N=1 leaves)
 *
 * Usage:
 *   npx tsx scripts/classify-historical-changes.ts                # heuristic only
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/classify-historical-changes.ts   # + LLM
 *   npx tsx scripts/classify-historical-changes.ts --dry-run      # no writes
 *
 * Undo:
 *   rm .data/classified-events.json .data/taxonomy-distribution-report.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSIFIER_VERSION,
  CHANGE_BUCKETS,
  OFFSITE_OWNED_BUCKETS,
  OFFSITE_EXTERNAL_BUCKETS,
  FINDING_BUCKETS,
  STATUS_BUCKETS,
  INFRA_BUCKETS,
  NOISE_BUCKETS,
  allBucketIds,
  changeBucketIds,
  layerOf,
  inferUrlType,
  isOffsitePlatform,
  normalizeUrl,
  type ClassifiedEvent,
  type TaxonomyLayer,
  type Authorship,
  type EventScope,
  type Confidence,
} from "../src/domains/attribution/change-taxonomy";

// ---------------------------------------------------------------------------
// Input shapes (subset of canonical types)
// ---------------------------------------------------------------------------

type ChangelogRow = {
  id: string;
  timestamp: string;
  signal_type?: string;
  asset_type?: string;
  url: string | null;
  asset_name?: string;
  change_description?: string;
  topic_targeted?: string;
  archived?: boolean;
  schema_types_added?: string[];
  schema_types_removed?: string[];
  visible_copy_changed?: boolean;
  tenant_id?: string;
};

type FindingRow = {
  id: string;
  type: string;
  url: string;
  summary?: string;
  currentState?: string | null;
  previousState?: string | null;
  detectedAt: string;
  status: "pending" | "accepted" | "rejected" | "ignored" | "expected";
  linkedChangeId?: string | null;
  tenant_id?: string;
};

/** Unified intermediate shape before classification. */
type RawEvent = {
  id: string;
  source_type: "changelog" | "finding";
  timestamp: string;
  url: string | null;
  description: string; // combined text used for keyword matching
  platform_context: string | null; // extra non-URL context (e.g. "Facebook page")
  tenant_id: string;
  changelog?: ChangelogRow;
  finding?: FindingRow;
};

// ---------------------------------------------------------------------------
// Paths + CLI flags
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "..");
const CHANGELOG_PATH = resolve(ROOT, ".data/imported-changes.json");
const FINDINGS_PATH = resolve(ROOT, ".data/scan-findings.json");
const OUT_EVENTS = resolve(ROOT, ".data/classified-events.json");
const OUT_REPORT = resolve(ROOT, ".data/taxonomy-distribution-report.json");

const DRY_RUN = process.argv.includes("--dry-run");
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LLM_ENABLED = !!ANTHROPIC_KEY && !process.argv.includes("--no-llm");
const LLM_MODEL = "claude-haiku-4-5-20251001";
const LLM_MAX_CALLS = Number(process.env.CLASSIFIER_LLM_MAX_CALLS ?? "200");

// ---------------------------------------------------------------------------
// Load + normalize
// ---------------------------------------------------------------------------

function loadEvents(): RawEvent[] {
  const changelog = JSON.parse(readFileSync(CHANGELOG_PATH, "utf8")) as ChangelogRow[];
  const findings = JSON.parse(readFileSync(FINDINGS_PATH, "utf8")) as FindingRow[];

  const events: RawEvent[] = [];

  for (const r of changelog) {
    if (r.archived) continue;
    const platformContext = detectPlatformContext(r);
    events.push({
      id: r.id,
      source_type: "changelog",
      timestamp: r.timestamp,
      url: r.url,
      description: [
        r.change_description ?? "",
        r.asset_name ? `(${r.asset_name})` : "",
        r.topic_targeted ?? "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
      platform_context: platformContext,
      tenant_id: r.tenant_id || "tenant-ritz-founder",
      changelog: r,
    });
  }

  for (const f of findings) {
    if (f.status === "rejected") continue;
    if (f.status === "ignored" || f.status === "expected") continue;
    if (f.status === "accepted" && f.linkedChangeId) continue; // already in changelog
    events.push({
      id: f.id,
      source_type: "finding",
      timestamp: f.detectedAt,
      url: f.url,
      description: [
        f.summary ?? "",
        f.previousState ? `was: ${f.previousState}` : "",
        f.currentState ? `now: ${f.currentState}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .trim(),
      platform_context: null,
      tenant_id: f.tenant_id || "tenant-ritz-founder",
      finding: f,
    });
  }

  return events;
}

function detectPlatformContext(r: ChangelogRow): string | null {
  // Some changelog entries put the platform in `url` field (non-URL string) or asset_name.
  const candidates = [r.url ?? "", r.asset_name ?? ""].filter(Boolean);
  for (const c of candidates) {
    const platform = isOffsitePlatform(c);
    if (platform) return platform;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deterministic classifiers
// ---------------------------------------------------------------------------

const FINDING_TYPE_TO_BUCKET: Record<string, string> = {
  schema_invalid: "finding.schema.invalid",
  schema_missing_for_page_type: "finding.schema.missing-for-page-type",
  faq_without_schema: "finding.schema.faq-without-jsonld",
  unexpected_change: "finding.content.unexpected-change",
  new_guardrail: "finding.guardrail.new",
  stale_visibility: "finding.page.stale-visibility",
  robots_txt_blocked: "finding.robots.ai-crawler-blocked",
  title_changed: "finding.title.changed",
  meta_changed: "finding.meta.changed",
  h1_changed: "finding.h1.changed",
  canonical_changed: "finding.canonical.changed",
  faq_changed: "finding.content.unexpected-change",
  schema_changed: "finding.content.unexpected-change",
  content_changed: "finding.content.unexpected-change",
  links_changed: "finding.links.changed",
  deploy_mismatch: "finding.deploy.mismatch",
  page_added: "finding.page.added",
  page_removed: "finding.page.removed",
  guardrail_cleared: "status.guardrail.cleared",
};

function classifyFindingEvent(e: RawEvent): ClassifiedEvent {
  const type = e.finding!.type;
  const bucket = FINDING_TYPE_TO_BUCKET[type] ?? "finding.generic";
  const layer: TaxonomyLayer = bucket.startsWith("status.") ? "status" : "finding";
  const urlType = inferUrlType(e.url);
  return base(e, {
    taxonomy_layer: layer,
    primary_bucket: bucket,
    child_tags: [],
    scope: layer === "status" ? "single_url" : "single_url",
    url_type: urlType,
    authorship: "system_detected",
    confidence: bucket === "finding.generic" ? "low" : "high",
    rationale: `Finding.type='${type}' maps deterministically to '${bucket}'.`,
  });
}

/** Detect offsite events and sub-layer (owned vs external). */
function classifyOffsiteEvent(e: RawEvent): ClassifiedEvent | null {
  const platform = e.platform_context ?? isOffsitePlatform(e.url);
  if (!platform) return null;

  const desc = e.description.toLowerCase();
  const authoredByUs =
    /\b(claimed|created|completed|corrected|updated|set|synced|renamed|optimized|implemented|revised|mapped|published review response|review response)\b/i.test(
      desc,
    );
  const isCustomerReview =
    /published.*(review|5-star)/.test(desc) && !/review response/.test(desc);

  if (isCustomerReview) {
    return base(e, {
      taxonomy_layer: "offsite_external_signal",
      primary_bucket: platform === "google-business-profile" ? "offsite_external_signal.gbp.review.publish" : "offsite_external_signal.generic",
      child_tags: [],
      scope: "tenant-global",
      url_type: null,
      offsite_platform: platform,
      authorship: "third_party_generated",
      confidence: "high",
      rationale: `Customer-authored review on ${platform} (description matches review-publish pattern).`,
    });
  }

  // Owned offsite change
  let bucket = "offsite_owned_change.generic";
  if (platform === "google-business-profile") {
    bucket = /response/i.test(desc) ? "offsite_owned_change.gbp.review-response.publish" : "offsite_owned_change.gbp.profile.modify";
  } else if (platform === "yelp") {
    bucket = /claim|complete/i.test(desc) ? "offsite_owned_change.yelp.profile.claim" : "offsite_owned_change.yelp.profile.modify";
  } else if (platform === "houzz") {
    bucket = /created|new/i.test(desc) ? "offsite_owned_change.houzz.profile.create" : "offsite_owned_change.houzz.profile.modify";
  } else if (platform === "buildzoom") {
    bucket = "offsite_owned_change.buildzoom.profile.modify";
  } else if (platform === "bing-places") {
    bucket = "offsite_owned_change.bing-places.profile.create";
  } else if (platform === "facebook") {
    bucket = "offsite_owned_change.social.facebook.bio.modify";
  } else if (platform === "pinterest") {
    bucket = "offsite_owned_change.social.pinterest.image-rename.bulk";
  }

  return base(e, {
    taxonomy_layer: "offsite_owned_change",
    primary_bucket: bucket,
    child_tags: [],
    scope: "offsite",
    url_type: null,
    offsite_platform: platform,
    authorship: "user_authored",
    confidence: authoredByUs ? "high" : "medium",
    rationale: `Offsite platform=${platform}; verb analysis indicates operator-authored edit.`,
  });
}

/** Detect noise (measurement captures, vague batches, review checks). */
function classifyNoiseEvent(e: RawEvent): ClassifiedEvent | null {
  const desc = e.description.toLowerCase();

  if (/captured .* baseline|first clean baseline|baseline snapshot/i.test(desc)) {
    return base(e, {
      taxonomy_layer: "noise",
      primary_bucket: "noise.baseline-capture",
      child_tags: [],
      scope: "tenant-global",
      url_type: inferUrlType(e.url),
      authorship: "user_authored",
      confidence: "high",
      rationale: "Measurement baseline capture — not a website change.",
    });
  }

  if (/captured \d+ (exported )?answers?|post-change snapshot|snapshot captured/i.test(desc)) {
    return base(e, {
      taxonomy_layer: "noise",
      primary_bucket: "noise.measurement-snapshot",
      child_tags: [],
      scope: "tenant-global",
      url_type: inferUrlType(e.url),
      authorship: "user_authored",
      confidence: "high",
      rationale: "Measurement snapshot — not a website change.",
    });
  }

  if (/^reviewed\s+(robots\.txt|server logs|server settings)|reviewed.*to ensure.*not blocked/i.test(desc)) {
    return base(e, {
      taxonomy_layer: "noise",
      primary_bucket: "noise.review-check",
      child_tags: [],
      scope: inferScopeFromUrl(e.url),
      url_type: inferUrlType(e.url),
      authorship: "user_authored",
      confidence: "high",
      rationale: "State review / audit — no change was made.",
    });
  }

  // Vague batches with no object noun
  const isVagueBatch =
    /^(applied|published|deployed) (content and structure edits|structural.* optimization|targeted structural|production-log)/i.test(desc) ||
    /\b(mar|apr|feb|jan|may|jun) \d{1,2} (batch|optimization|optimizations)\b/i.test(desc) ||
    /^(reconstructed|complete page reconstruction)(?!.*with .*(metadata|hero|h1|faq|schema))/i.test(desc);

  if (isVagueBatch && !hasSpecificObject(desc)) {
    return base(e, {
      taxonomy_layer: "noise",
      primary_bucket: "noise.vague-catchall",
      child_tags: [],
      scope: inferScopeFromUrl(e.url),
      url_type: inferUrlType(e.url),
      authorship: "user_authored",
      confidence: "low",
      rationale: "Description is a vague batch header with no specific object; cannot attribute.",
    });
  }

  return null;
}

function hasSpecificObject(desc: string): boolean {
  // Returns true if description mentions a concrete editable object.
  return /\b(title|h1|h2|h3|meta description|canonical|robots|faq|faqpage|schema|json-ld|og:|open graph|sitemap|nav|footer|breadcrumb|hero|cta|button|image|alt text|table|anchor|redirect|section)\b/i.test(
    desc,
  );
}

/** Detect infra events (sitewide technical changes). */
function classifyInfraEvent(e: RawEvent): ClassifiedEvent | null {
  const desc = e.description.toLowerCase();

  if (/\b(prerender|pre-render|ssg|static site generation|initial html before js hydration)\b/i.test(desc)) {
    return buildInfra(e, "infra.rendering.ssg-enable", "SSG / prerendering enabled.");
  }
  if (/\blcp\b|largest contentful paint|preload.*hero|prioritiz(e|ed) .*hero image/i.test(desc)) {
    return buildInfra(e, "infra.performance.lcp-optimize", "LCP optimization.");
  }
  if (/pagespeed|lighthouse|tbt|cls|core web vitals/i.test(desc)) {
    return buildInfra(e, "infra.performance.pagespeed-sitewide", "Sitewide PageSpeed/Lighthouse optimization.");
  }
  if (/hubspot script .*(defer|delayed)|delayed hubspot/i.test(desc)) {
    return buildInfra(e, "infra.scripts.third-party-defer", "HubSpot script deferred (merged into third-party-defer).");
  }
  if (/gtm (defer|delayed|impact)/i.test(desc)) {
    return buildInfra(e, "infra.scripts.third-party-defer", "GTM deferred (merged into third-party-defer).");
  }
  if (/profound.*integration|profound.*custom-log|profound custom log|profound production|profound update/i.test(desc)) {
    return buildInfra(e, "infra.tracking.profound-integration-update", "Profound log integration update.");
  }
  if (/localhost\/dev|dev references from production|localhost leakage/i.test(desc)) {
    return buildInfra(e, "infra.production.dev-leakage-cleanup", "Dev-reference leakage cleanup in production.");
  }
  if (/hubspot (field )?mapping|lead form submission|test lead submission/i.test(desc)) {
    return buildInfra(e, "infra.form.integration-test", "Form integration test.");
  }

  return null;
}

function buildInfra(e: RawEvent, bucket: string, reason: string): ClassifiedEvent {
  return base(e, {
    taxonomy_layer: "infra",
    primary_bucket: bucket,
    child_tags: [],
    scope: "infra-global",
    url_type: inferUrlType(e.url),
    authorship: "user_authored",
    confidence: "high",
    rationale: reason,
  });
}

// ---------------------------------------------------------------------------
// Change-layer heuristic classifier
// ---------------------------------------------------------------------------

type HeuristicResult = {
  primary: string;
  children: string[];
  confidence: Confidence;
  rationale: string;
};

function classifyChangeEvent(e: RawEvent): HeuristicResult | null {
  const desc = e.description;
  const lower = desc.toLowerCase();
  const schemaAdded = e.changelog?.schema_types_added ?? [];
  const schemaRemoved = e.changelog?.schema_types_removed ?? [];

  // --- schema deduplication (high-signal) ---
  if (/\bremoved duplicate faqpage|consolidated.*faqpage|removed.*duplicate .*faq schema|consolidated.*faq schema/i.test(desc)) {
    return { primary: "schema.faqpage.deduplicate", children: [], confidence: "high", rationale: "Duplicate FAQPage consolidation." };
  }
  if (/\bremoved.*split.*faq schema|removed extra split faq/i.test(desc)) {
    return { primary: "schema.faqpage.deduplicate", children: [], confidence: "high", rationale: "Split/extra FAQPage blocks consolidated." };
  }

  // --- schema additions via structured field ---
  if (schemaAdded.length > 0) {
    const children = schemaAdded.map(typedSchemaBucket).filter((b): b is string => !!b);
    if (children.length === 1) {
      return { primary: children[0], children: [], confidence: "high", rationale: `Schema type added: ${schemaAdded[0]}.` };
    }
    if (children.length > 1) {
      // Multi-schema bundle — primary is the most specific type
      const primary = pickPrimarySchema(children);
      return { primary, children: children.filter((c) => c !== primary), confidence: "high", rationale: `Multi-schema bundle: ${schemaAdded.join(", ")}.` };
    }
  }
  if (schemaRemoved.length > 0) {
    const removedBuckets = schemaRemoved.map(typedSchemaBucket).filter((b): b is string => !!b).map((b) => b.replace(".add", ".remove"));
    if (removedBuckets.length === 1) {
      return { primary: "schema.other.remove", children: [], confidence: "high", rationale: `Schema type removed: ${schemaRemoved[0]}.` };
    }
  }

  // --- schema additions via text (no structured field) ---
  if (/\b(faqpage json-ld|faq schema|faq json-ld|added faqpage)\b/i.test(desc) && !/removed/i.test(desc)) {
    return { primary: "schema.faqpage.add", children: [], confidence: "high", rationale: "FAQPage schema addition mentioned in text." };
  }
  if (/\bbreadcrumblist|breadcrumb schema|breadcrumb json-ld\b/i.test(desc) && /add|implement/i.test(lower)) {
    return { primary: "schema.breadcrumb.add", children: [], confidence: "high", rationale: "Breadcrumb schema addition." };
  }
  if (/\bhomeandconstructionbusiness|generalcontractor|localbusiness.*json-ld|localbusiness schema\b/i.test(desc)) {
    return { primary: "schema.localbusiness.add", children: [], confidence: "high", rationale: "LocalBusiness schema addition." };
  }
  if (/\bprofessionalservice json-ld|professionalservice schema\b/i.test(desc)) {
    return { primary: "schema.professional-service.add", children: [], confidence: "high", rationale: "ProfessionalService schema addition." };
  }
  if (/\barticle schema|article.*json-ld\b/i.test(desc) && /add|implement/i.test(lower)) {
    return { primary: "schema.article.add", children: [], confidence: "high", rationale: "Article schema addition." };
  }
  if (/\bsinglefamilyresidence/i.test(desc)) {
    const children: string[] = [];
    if (/\boffer\b/i.test(desc)) children.push("schema.offer.add");
    return { primary: "schema.single-family-residence.add", children, confidence: "high", rationale: "SingleFamilyResidence schema (listing)." };
  }
  if (/\bvideoobject|video schema\b/i.test(desc)) {
    return { primary: "schema.videoobject.add", children: [], confidence: "high", rationale: "VideoObject schema addition." };
  }
  if (/\bhowto schema|how-to schema|howto json-ld\b/i.test(desc)) {
    return { primary: "schema.howto.add", children: [], confidence: "high", rationale: "HowTo schema addition." };
  }
  if (/\breview schema|review json-ld\b/i.test(desc)) {
    return { primary: "schema.review.add", children: [], confidence: "high", rationale: "Review schema addition." };
  }
  if (/\baeo-optimized faqpage and review schema/i.test(desc)) {
    return { primary: "schema.faqpage.add", children: ["schema.review.add"], confidence: "high", rationale: "FAQPage + Review schema bundle." };
  }

  // --- llms.txt ---
  if (/\bllms\.txt\b/i.test(desc)) {
    return { primary: "metadata.crawler-directives.llms-txt.publish", children: [], confidence: "high", rationale: "llms.txt published." };
  }

  // --- metadata: title ---
  if (/\bset title tag to|title tag to '|updated (homepage |meta )?title|revised.*title|new title\b/i.test(desc)) {
    return { primary: "metadata.title.modify", children: [], confidence: "high", rationale: "<title> tag modified." };
  }

  // --- metadata: meta description ---
  if (/\bset meta description|meta description targeting|updated meta desc/i.test(desc)) {
    return { primary: "metadata.meta-description.modify", children: [], confidence: "high", rationale: "Meta description modified." };
  }

  // --- metadata: open graph (bundled) ---
  if (/\bopen graph|og:title|og:description|og:image|og:type|og:url\b/i.test(desc)) {
    const children: string[] = [];
    if (/canonical/i.test(desc)) children.push("metadata.canonical.modify");
    if (/robots .*(index|follow)|index,?\s*follow/i.test(desc)) children.push("metadata.robots.modify");
    return {
      primary: children.length > 0 ? "metadata.indexing-directives.set" : "metadata.open-graph-tags.modify",
      children: children.length > 0 ? ["metadata.open-graph-tags.modify", ...children] : [],
      confidence: "high",
      rationale: "Open Graph tags set (with related indexing directives if present).",
    };
  }

  // --- metadata: robots + canonical bundle ---
  const hasRobots = /\bset robots|robots to index,?\s*follow|meta robots|robots.txt\b/i.test(desc) || /\bindex,?\s*follow\b/i.test(desc);
  const hasCanonical = /\bcanonical\b/i.test(desc);
  if (hasRobots && hasCanonical) {
    return { primary: "metadata.indexing-directives.set", children: ["metadata.robots.modify", "metadata.canonical.modify"], confidence: "high", rationale: "Robots + canonical set together." };
  }
  if (hasCanonical) {
    return { primary: "metadata.canonical.modify", children: [], confidence: "high", rationale: "Canonical modified." };
  }
  if (hasRobots) {
    return { primary: "metadata.robots.modify", children: [], confidence: "high", rationale: "Robots directive modified." };
  }

  // --- page creation bundles ---
  const pageCreate = detectPageCreate(e);
  if (pageCreate) return pageCreate;

  // --- page rebuilds ---
  if (/\b(reconstructed|complete page reconstruction|page reconstruction|restructured|rebuilt).*(with|including|updated|rewritten|replaced)\b/i.test(desc)) {
    const children = extractPageRebuildChildren(desc);
    return { primary: "structure.page.rebuild", children, confidence: "high", rationale: "Page rebuild bundle." };
  }

  // --- hero sections ---
  if (/\b(hero section|hero image .*(overlay|h1|cta))/i.test(desc) && /add|added/i.test(lower)) {
    const children: string[] = [];
    if (/\bh1\b/i.test(desc)) children.push("content.h1.modify");
    if (/sub-?head(line)?|subtitle/i.test(desc)) children.push("content.subheadline.modify");
    if (/\bcta|button\b/i.test(desc)) children.push("content.cta.add");
    if (/\bimage|photo\b/i.test(desc)) children.push("media.hero-image.add");
    return { primary: "content.hero.upgrade", children, confidence: "high", rationale: "Hero section added (bundle)." };
  }
  if (/\b(revised|updated) hero (h1|subheadline|subtitle|image)\b/i.test(desc)) {
    const children: string[] = [];
    if (/\bh1\b/i.test(desc)) children.push("content.h1.modify");
    if (/subtitle|sub-?head(line)?/i.test(desc)) children.push("content.subheadline.modify");
    return { primary: "content.hero.upgrade", children, confidence: "high", rationale: "Hero bundle modified." };
  }

  // --- hero subheadline alone ---
  if (/\b(hero|page) subheading|subhead(line|ing)? (beneath|under).*h1\b/i.test(desc) && /updated|revised|set/i.test(lower)) {
    return { primary: "content.hero.subheadline.modify", children: [], confidence: "high", rationale: "Hero subheadline modified." };
  }

  // --- H1 standalone ---
  if (/\bset h1|revised hero h1|updated h1|h1 to '/i.test(desc)) {
    return { primary: "content.h1.modify", children: [], confidence: "high", rationale: "H1 modified." };
  }

  // --- FAQ visible section ---
  if (/\b(added|publish(ed)?).*(faq section|faq block|\d+-question faq|faq with \d+|faq(s)? .*(section|block))/i.test(desc) && !/faq schema|faqpage/i.test(desc)) {
    return { primary: "content.faq.add", children: [], confidence: "high", rationale: "Visible FAQ section added." };
  }
  if (/\bfaq block plus heading and description updates|published faq.*html|published.*faq section/i.test(desc)) {
    const children: string[] = [];
    if (/heading|h\d/i.test(desc)) children.push("content.h2.add");
    if (/description/i.test(desc)) children.push("metadata.meta-description.modify");
    return { primary: "content.faq.add", children, confidence: "high", rationale: "FAQ add + heading/description update bundle." };
  }
  if (/\bfaq with (faqpage )?json-?ld|faq section.*json-?ld|faq.*two-column/i.test(desc)) {
    return { primary: "content.faq.add", children: ["schema.faqpage.add"], confidence: "high", rationale: "FAQ copy + FAQPage schema pair." };
  }
  if (/\bnormalized faq answer styling/i.test(desc)) {
    return { primary: "content.faq.normalize-styling", children: [], confidence: "high", rationale: "FAQ answer styling normalized sitewide." };
  }
  if (/\breplaced.*faq|replaced.*\d+-question faq|removed.*faq.*added.*\d+/i.test(desc)) {
    return { primary: "content.faq.replace", children: [], confidence: "high", rationale: "FAQ block replaced (N-question → M-question)." };
  }
  if (/\bupdated faq|updated faqs|homepage faq updates/i.test(desc)) {
    return { primary: "content.faq.modify", children: [], confidence: "medium", rationale: "FAQ content modified." };
  }

  // --- sections by subtype ---
  if (/\b(process (section|strip)|\d+-step process|steps? to (a )?(custom|luxury|bay area))\b/i.test(desc) && /add|embedded/i.test(lower)) {
    return { primary: "content.section.add.process", children: [], confidence: "high", rationale: "Process section added." };
  }
  if (/\bneighborhood|micro-?market/i.test(desc) && /add|added|descriptions/i.test(lower)) {
    return { primary: "content.section.add.neighborhoods", children: [], confidence: "high", rationale: "Neighborhoods / micro-markets section." };
  }
  if (/\bcost section|cost (table|strip)|\$\d+-?\d+.*sqft|per sqft|\bfar\b/i.test(desc) && /add|added/i.test(lower)) {
    return { primary: "content.section.add.cost", children: [], confidence: "high", rationale: "Cost section added." };
  }
  if (/\badu|accessory dwelling/i.test(desc) && /section|added/i.test(lower)) {
    return { primary: "content.section.add.adu", children: [], confidence: "high", rationale: "ADU section added." };
  }
  if (/\bservice-?area grid|cities served|areas we serve/i.test(desc) && /add|converted|column/i.test(lower)) {
    return { primary: "content.section.add.service-area", children: [], confidence: "high", rationale: "Service-area grid / cities-served list." };
  }
  if (/\b(comparison table|builder comparison|top-rated.*builders|\d+-builder comparison)/i.test(desc)) {
    return { primary: "content.section.add.comparison", children: ["content.table.add"], confidence: "high", rationale: "Builder comparison section with table." };
  }
  if (/\bquick facts|data-point strip|data points/i.test(desc)) {
    return { primary: "content.section.add.quick-facts", children: [], confidence: "high", rationale: "Quick-facts section." };
  }
  if (/\btrust strip|credibility marker|proof strip|award logos/i.test(desc) && /add|added/i.test(lower)) {
    return { primary: "content.section.add.generic", children: [], confidence: "medium", rationale: "Trust strip / credibility markers (merged into generic section-add)." };
  }
  if (/\bfeatured project grid|featured-project/i.test(desc)) {
    return { primary: "content.section.add.generic", children: [], confidence: "medium", rationale: "Featured-project grid (merged into generic section-add)." };
  }
  if (/\bright-?fit grid/i.test(desc)) {
    return { primary: "content.section.add.right-fit-grid", children: [], confidence: "high", rationale: "Right-Fit grid." };
  }
  if (/\bchecklist|evaluation.*\d+-point/i.test(desc)) {
    return { primary: "content.section.add.generic", children: [], confidence: "medium", rationale: "Numbered checklist section (merged into generic section-add)." };
  }
  if (/\bdescription block|project narrative|narrative copy block/i.test(desc)) {
    return { primary: "content.section.add.generic", children: [], confidence: "medium", rationale: "Narrative description block (merged into generic section-add)." };
  }
  if (/\btestimonial|client.*quote|partner testimonials/i.test(desc)) {
    return { primary: "content.testimonial-block.add", children: [], confidence: "high", rationale: "Testimonial block." };
  }

  // --- generic sections ---
  if (/\badded (hook |remodel capture |home remodeling |section \d+|project spotlight)/i.test(desc)) {
    return { primary: "content.section.add.generic", children: [], confidence: "medium", rationale: "Generic named section added." };
  }
  if (/\breplaced.*portfolio/i.test(desc)) {
    return { primary: "content.section.replace.generic", children: [], confidence: "high", rationale: "Portfolio section replaced (merged into generic section-replace)." };
  }
  if (/\breplaced.*why.*ritz/i.test(desc)) {
    return { primary: "content.section.replace.generic", children: [], confidence: "high", rationale: "'Why Ritz' section replaced (merged into generic section-replace)." };
  }

  // --- tables / lists standalone ---
  if (/\btable\b/i.test(desc) && /add|added/i.test(lower) && !/\bcomparison\b/i.test(desc)) {
    return { primary: "content.table.add", children: [], confidence: "medium", rationale: "Table added." };
  }

  // --- CTAs ---
  if (/\bcta|call to action|consultation button|two cta buttons\b/i.test(desc) && /add|added/i.test(lower) && !/hero/i.test(desc)) {
    if (/cta section|headline, body copy, advantage list/i.test(desc)) {
      return { primary: "content.cta-section.add", children: ["content.cta.add"], confidence: "high", rationale: "CTA section added." };
    }
    return { primary: "content.cta.add", children: [], confidence: "high", rationale: "CTA added (not hero)." };
  }
  if (/\bremoved.*(cta|button|explore)/i.test(desc)) {
    return { primary: "content.cta.remove", children: [], confidence: "high", rationale: "CTA removed." };
  }

  // --- cards ---
  if (/\b(updated|revised).*card title\b/i.test(desc)) {
    return { primary: "content.card.title.modify", children: [], confidence: "high", rationale: "Card title modified." };
  }
  if (/\badded.*(project card|card on \/explore-projects|\d+(nd|rd|th) (active )?card|project cards|princeton.*kiner.*card)\b/i.test(desc)) {
    return { primary: "content.card.add", children: [], confidence: "high", rationale: "Project card added to grid." };
  }
  if (/\breordered.*card|reordered.*live project/i.test(desc)) {
    return { primary: "content.card.add", children: ["content.card.reorder"], confidence: "high", rationale: "Card grid edited — reorder captured as child tag (reorder-only is not a leaf)." };
  }

  // --- anchor IDs ---
  if (/\banchor id|section anchor|anchor-id/i.test(desc)) {
    return { primary: "content.anchor-ids.add", children: [], confidence: "high", rationale: "Section anchor IDs added." };
  }

  // --- blurbs ---
  if (/\bindividual builder blurb|builder blurb descriptions/i.test(desc)) {
    return { primary: "content.blurb.add", children: [], confidence: "high", rationale: "Builder blurb descriptions added to comparison." };
  }

  // --- breadcrumbs ---
  if (/\bvisible breadcrumbs|breadcrumbs with breadcrumblist/i.test(desc)) {
    return { primary: "structure.breadcrumb.add", children: ["schema.breadcrumb.add"], confidence: "high", rationale: "Visible breadcrumbs + BreadcrumbList schema." };
  }

  // --- links ---
  if (/\binternal link.*(anchor|pointing to|added internal)|added internal link/i.test(desc)) {
    return { primary: "link-graph.internal-link.add", children: [], confidence: "high", rationale: "Internal link added." };
  }
  if (/\bupdated placeholder links|updated.*route to/i.test(desc)) {
    return { primary: "link-graph.internal-link.modify", children: [], confidence: "high", rationale: "Internal link target updated." };
  }

  // --- media ---
  if (/\breplaced.*(blurry )?(preview )?images?|higher-resolution versions?\b/i.test(desc)) {
    return { primary: "media.image.replace", children: [], confidence: "high", rationale: "Image replaced (quality upgrade)." };
  }
  if (/\badjusted.*hero image|hero image positioning|hero image.*focal/i.test(desc)) {
    return { primary: "media.hero-image.modify", children: [], confidence: "high", rationale: "Hero image positioning modified." };
  }
  if (/\b(\d+-image|image collage|image gallery|gallery section)\b/i.test(desc) && /add/i.test(lower)) {
    return { primary: "media.gallery.add", children: [], confidence: "high", rationale: "Image gallery added." };
  }
  if (/\balt text|alt-text|alt attribute|entity-aligned file naming/i.test(desc)) {
    return { primary: "media.alt-text.add", children: [], confidence: "medium", rationale: "Alt text or entity-aligned file naming." };
  }

  // --- nav + footer ---
  if (/\breordered main navigation|reordered.*top nav|main navigation to updated|navigation reorder/i.test(desc)) {
    const children: string[] = [];
    if (/removed.*(faq|ritzom|privacy|item)/i.test(desc)) children.push("structure.nav.item.remove");
    return { primary: "structure.nav.reorder", children, confidence: "high", rationale: "Nav reordered (+ optional item removal)." };
  }
  if (/\b(added|removed)\b.*\bto (main )?navigation|from navigation|navigation menu\b/i.test(desc)) {
    const add = /added/i.test(desc.split(/navigation/i)[0] ?? "");
    return { primary: add ? "structure.nav.item.add" : "structure.nav.item.remove", children: [], confidence: "high", rationale: "Nav item add/remove." };
  }
  if (/\bfooter\b/i.test(desc) && /add|added|link/i.test(lower)) {
    return { primary: "structure.footer.link.add", children: [], confidence: "high", rationale: "Footer link added." };
  }

  // --- redirects ---
  if (/\b(301|302|permanent|temporary) redirect|redirect from/i.test(desc)) {
    return { primary: "structure.redirect.add", children: [], confidence: "high", rationale: "Redirect added." };
  }

  // --- sitemap ---
  if (/\bsitemap\b/i.test(desc)) {
    return { primary: "structure.sitemap-xml.modify", children: [], confidence: "high", rationale: "Sitemap modified." };
  }

  // --- route ensure ---
  if (/\bensured.*parent route|returns 200|ensured .* route exists/i.test(desc)) {
    return { primary: "structure.route.ensure-200", children: [], confidence: "high", rationale: "Route 200-check." };
  }

  // --- body rewrite ---
  if (/\brewrote|rewritten|body copy rewrite|copy refresh|content refresh\b/i.test(desc)) {
    return { primary: "content.body.rewrite", children: [], confidence: "medium", rationale: "Body copy rewrite." };
  }

  // --- catch-all heading adds with city/service text ---
  if (/\bh2\b/i.test(desc) && /add|added/i.test(lower)) {
    return { primary: "content.h2.add", children: [], confidence: "medium", rationale: "H2 added." };
  }
  if (/\bh3\b/i.test(desc) && /add|added/i.test(lower)) {
    return { primary: "content.h3.add", children: [], confidence: "medium", rationale: "H3 added." };
  }

  return null;
}

function typedSchemaBucket(typeName: string): string | null {
  const t = typeName.toLowerCase();
  if (/faq/.test(t)) return "schema.faqpage.add";
  if (/breadcrumb/.test(t)) return "schema.breadcrumb.add";
  if (/localbusiness|homeandconstruction|generalcontractor/.test(t)) return "schema.localbusiness.add";
  if (/professionalservice/.test(t)) return "schema.professional-service.add";
  if (/^service$/.test(t)) return "schema.service.add";
  if (/^offer$/.test(t)) return "schema.offer.add";
  if (/^article$|blogposting/.test(t)) return "schema.article.add";
  if (/^webpage$/.test(t)) return "schema.webpage.add";
  if (/^organization$/.test(t)) return "schema.organization.add";
  if (/howto/.test(t)) return "schema.howto.add";
  if (/videoobject/.test(t)) return "schema.videoobject.add";
  if (/imagegallery/.test(t)) return "schema.imagegallery.add";
  if (/singlefamilyresidence/.test(t)) return "schema.single-family-residence.add";
  if (/^review$/.test(t)) return "schema.review.add";
  return "schema.other.add";
}

function pickPrimarySchema(children: string[]): string {
  // Preference order when multiple schemas added: most "specific content" wins.
  const priority = [
    "schema.faqpage.add",
    "schema.localbusiness.add",
    "schema.professional-service.add",
    "schema.article.add",
    "schema.howto.add",
    "schema.single-family-residence.add",
    "schema.service.add",
    "schema.videoobject.add",
    "schema.breadcrumb.add",
    "schema.organization.add",
    "schema.webpage.add",
    "schema.imagegallery.add",
    "schema.offer.add",
    "schema.review.add",
    "schema.other.add",
  ];
  for (const p of priority) if (children.includes(p)) return p;
  return children[0];
}

function detectPageCreate(e: RawEvent): HeuristicResult | null {
  const desc = e.description;
  if (!/\b(created new|new page|launched page|published new|created.*page at|built and published)/i.test(desc)) return null;
  const urlType = inferUrlType(e.url);
  let primary = "structure.page.create.generic";
  if (urlType === "location" || /\/locations\//.test(desc) || /city page/i.test(desc)) primary = "structure.page.create.location";
  else if (urlType === "service" || /\/services\//.test(desc) || /service page/i.test(desc)) primary = "structure.page.create.service";
  else if (urlType === "project" || /\/explore-projects\//.test(desc) || /project page/i.test(desc)) primary = "structure.page.create.project";
  else if (urlType === "available-home" || /\/available-homes\//.test(desc) || /available home/i.test(desc)) primary = "structure.page.create.available-home";
  else if (urlType === "landing" || /standalone landing|guide page at|luxury.*bay area|custom.*bay area/i.test(desc)) primary = "structure.page.create.landing";
  return { primary, children: [], confidence: "high", rationale: `Page creation detected (url_type=${urlType ?? "unknown"}).` };
}

function extractPageRebuildChildren(desc: string): string[] {
  const children: string[] = [];
  if (/\bmetadata\b/i.test(desc)) children.push("metadata.meta.modify");
  if (/\bhero\b/i.test(desc)) children.push("content.hero.upgrade");
  if (/\bh1\b/i.test(desc)) children.push("content.h1.modify");
  if (/\bfaqs?|faq section\b/i.test(desc)) children.push("content.faq.modify");
  if (/\bschema\b/i.test(desc)) children.push("schema.content.edit");
  if (/\bprocess\b/i.test(desc)) children.push("content.section.replace.generic");
  return children;
}

function inferScopeFromUrl(url: string | null): EventScope {
  if (!url) return "sitewide";
  const normalized = normalizeUrl(url);
  if (!normalized || normalized === "/" || normalized === "") return "single_url";
  if (isOffsitePlatform(normalized)) return "offsite";
  return "single_url";
}

// ---------------------------------------------------------------------------
// LLM classifier (optional, Claude Haiku via fetch)
// ---------------------------------------------------------------------------

async function classifyChangeEventLLM(e: RawEvent): Promise<HeuristicResult | null> {
  if (!LLM_ENABLED) return null;

  const validBuckets = changeBucketIds();
  const prompt = `You are classifying a single website change event into Beacon's change taxonomy.

VALID BUCKETS (use only these exact strings):
${validBuckets.join("\n")}

EVENT:
- url: ${e.url ?? "(site-wide)"}
- timestamp: ${e.timestamp}
- description: ${e.description}

TASK:
Return a single JSON object:
{
  "primary": "<one bucket from the list>",
  "children": ["<atomic sub-edits if this is a bundle; empty array if atomic>"],
  "confidence": "high" | "medium" | "low",
  "rationale": "<one sentence>"
}

Rules:
- If the description describes multiple edits (e.g. "added hero with H1, subhead, CTA, image"), use a parent bucket like content.hero.upgrade with children listing the atomic sub-edits.
- Prefer the most specific bucket that fits.
- If the description is too vague to classify confidently, set confidence=low and pick the closest reasonable bucket (often a generic one like content.section.add.generic or metadata.meta.modify).
- Return ONLY the JSON object, no prose.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      console.warn(`  LLM call failed: ${resp.status} ${await resp.text().catch(() => "")}`);
      return null;
    }
    const body = (await resp.json()) as { content?: Array<{ text?: string }> };
    const text = body.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { primary?: string; children?: string[]; confidence?: Confidence; rationale?: string };
    if (!parsed.primary || !validBuckets.includes(parsed.primary)) return null;
    const children = (parsed.children ?? []).filter((c) => validBuckets.includes(c));
    return {
      primary: parsed.primary,
      children,
      confidence: parsed.confidence ?? "medium",
      rationale: `[LLM] ${parsed.rationale ?? "No rationale provided."}`,
    };
  } catch (err) {
    console.warn(`  LLM error: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Base record builder
// ---------------------------------------------------------------------------

type BaseOpts = {
  taxonomy_layer: TaxonomyLayer;
  primary_bucket: string;
  child_tags: string[];
  scope: EventScope;
  url_type: ReturnType<typeof inferUrlType>;
  offsite_platform?: string | null;
  authorship: Authorship;
  confidence: Confidence;
  rationale: string;
};

function base(e: RawEvent, opts: BaseOpts): ClassifiedEvent {
  return {
    source_id: e.id,
    source_type: e.source_type,
    classifier_version: CLASSIFIER_VERSION,
    taxonomy_layer: opts.taxonomy_layer,
    primary_bucket: opts.primary_bucket,
    child_tags: opts.child_tags,
    paired_with: [],
    scope: opts.scope,
    url: normalizeUrl(e.url),
    url_type: opts.url_type,
    offsite_platform: opts.offsite_platform ?? null,
    authorship: opts.authorship,
    confidence: opts.confidence,
    classifier_rationale: opts.rationale,
    bundle_parent_id: null,
    bundle_size: 1 + opts.child_tags.length,
    observed_at: e.timestamp,
    tenant_id: e.tenant_id,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function classifyOne(e: RawEvent, llmCallsRemaining: { n: number }): Promise<ClassifiedEvent> {
  // 1. Findings + status from finding.type
  if (e.source_type === "finding") {
    return classifyFindingEvent(e);
  }

  // 2. Offsite platforms
  const offsite = classifyOffsiteEvent(e);
  if (offsite) return offsite;

  // 3. Noise (measurement captures, vague batches, review checks)
  const noise = classifyNoiseEvent(e);
  if (noise) return noise;

  // 4. Infrastructure
  const infra = classifyInfraEvent(e);
  if (infra) return infra;

  // 5. Change layer (heuristic)
  const heuristic = classifyChangeEvent(e);
  if (heuristic) {
    return base(e, {
      taxonomy_layer: "change",
      primary_bucket: heuristic.primary,
      child_tags: heuristic.children,
      scope: inferScopeFromUrl(e.url),
      url_type: inferUrlType(e.url),
      authorship: "user_authored",
      confidence: heuristic.confidence,
      rationale: heuristic.rationale,
    });
  }

  // 6. Optional LLM fallback
  if (LLM_ENABLED && llmCallsRemaining.n > 0) {
    llmCallsRemaining.n -= 1;
    const llm = await classifyChangeEventLLM(e);
    if (llm) {
      return base(e, {
        taxonomy_layer: "change",
        primary_bucket: llm.primary,
        child_tags: llm.children,
        scope: inferScopeFromUrl(e.url),
        url_type: inferUrlType(e.url),
        authorship: "user_authored",
        confidence: llm.confidence,
        rationale: llm.rationale,
      });
    }
  }

  // 7. Last resort: vague catchall
  return base(e, {
    taxonomy_layer: "noise",
    primary_bucket: "noise.vague-catchall",
    child_tags: [],
    scope: inferScopeFromUrl(e.url),
    url_type: inferUrlType(e.url),
    authorship: "user_authored",
    confidence: "low",
    rationale: "No heuristic matched" + (LLM_ENABLED ? " and LLM fallback was skipped/failed." : "; LLM not enabled.") + " Needs operator review.",
  });
}

// Post-classification passes

function linkFaqPairs(events: ClassifiedEvent[]): void {
  // Pair FAQ copy additions with same-URL same-day FAQPage schema additions.
  const byKey = new Map<string, ClassifiedEvent[]>();
  for (const e of events) {
    if (e.primary_bucket !== "content.faq.add" && e.primary_bucket !== "schema.faqpage.add") continue;
    const day = (e.observed_at || "").slice(0, 10);
    const key = `${e.url ?? ""}@${day}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(e);
  }
  for (const [, group] of byKey) {
    const faq = group.find((g) => g.primary_bucket === "content.faq.add");
    const schema = group.find((g) => g.primary_bucket === "schema.faqpage.add");
    if (faq && schema && faq.source_id !== schema.source_id) {
      if (!faq.paired_with.includes(schema.source_id)) faq.paired_with.push(schema.source_id);
      if (!schema.paired_with.includes(faq.source_id)) schema.paired_with.push(faq.source_id);
    }
  }
}

function validate(events: ClassifiedEvent[]): string[] {
  const errors: string[] = [];
  for (const e of events) {
    const expectedLayer = layerOf(e.primary_bucket);
    if (!expectedLayer) {
      errors.push(`${e.source_id}: primary_bucket '${e.primary_bucket}' is not a known bucket in any layer`);
    } else if (expectedLayer !== e.taxonomy_layer) {
      errors.push(`${e.source_id}: bucket ${e.primary_bucket} belongs to layer ${expectedLayer}, got ${e.taxonomy_layer}`);
    }
    if (e.taxonomy_layer === "finding" && e.authorship === "user_authored") {
      errors.push(`${e.source_id}: finding cannot be user_authored`);
    }
    if (e.taxonomy_layer === "change" && e.authorship === "third_party_generated") {
      errors.push(`${e.source_id}: change cannot be third_party_generated`);
    }
    for (const c of e.child_tags) {
      if (!layerOf(c)) errors.push(`${e.source_id}: child_tag '${c}' is not a valid bucket`);
    }
  }
  return errors;
}

// Distribution + merge-recommendation report

type Report = {
  generated_at: string;
  classifier_version: string;
  llm_enabled: boolean;
  totals: { events: number; by_layer: Record<string, number>; by_authorship: Record<string, number>; by_confidence: Record<string, number> };
  by_bucket: Array<{ bucket: string; layer: string; count: number; provisional: boolean; example_ids: string[] }>;
  merge_candidates: Array<{ bucket: string; count: number; suggestion: string }>;
  low_confidence_change_pct: number;
  validation_errors: string[];
};

function allBucketsWithMeta(): Array<{ id: string; layer: TaxonomyLayer; provisional: boolean }> {
  const out: Array<{ id: string; layer: TaxonomyLayer; provisional: boolean }> = [];
  const add = (obj: Record<string, { provisional: boolean }>, layer: TaxonomyLayer) => {
    for (const [id, meta] of Object.entries(obj)) out.push({ id, layer, provisional: meta.provisional });
  };
  add(CHANGE_BUCKETS as unknown as Record<string, { provisional: boolean }>, "change");
  add(OFFSITE_OWNED_BUCKETS as unknown as Record<string, { provisional: boolean }>, "offsite_owned_change");
  add(OFFSITE_EXTERNAL_BUCKETS as unknown as Record<string, { provisional: boolean }>, "offsite_external_signal");
  add(FINDING_BUCKETS as unknown as Record<string, { provisional: boolean }>, "finding");
  add(STATUS_BUCKETS as unknown as Record<string, { provisional: boolean }>, "status");
  add(INFRA_BUCKETS as unknown as Record<string, { provisional: boolean }>, "infra");
  add(NOISE_BUCKETS as unknown as Record<string, { provisional: boolean }>, "noise");
  return out;
}

function buildReport(events: ClassifiedEvent[], validationErrors: string[]): Report {
  const byLayer: Record<string, number> = {};
  const byAuth: Record<string, number> = {};
  const byConf: Record<string, number> = {};
  const bucketCounts = new Map<string, { count: number; examples: string[] }>();

  for (const e of events) {
    byLayer[e.taxonomy_layer] = (byLayer[e.taxonomy_layer] ?? 0) + 1;
    byAuth[e.authorship] = (byAuth[e.authorship] ?? 0) + 1;
    byConf[e.confidence] = (byConf[e.confidence] ?? 0) + 1;
    const agg = bucketCounts.get(e.primary_bucket) ?? { count: 0, examples: [] };
    agg.count += 1;
    if (agg.examples.length < 3) agg.examples.push(e.source_id);
    bucketCounts.set(e.primary_bucket, agg);
  }

  const meta = new Map(allBucketsWithMeta().map((m) => [m.id, m]));
  const byBucket: Report["by_bucket"] = Array.from(bucketCounts.entries())
    .map(([bucket, v]) => ({
      bucket,
      layer: meta.get(bucket)?.layer ?? "unknown",
      count: v.count,
      provisional: meta.get(bucket)?.provisional ?? true,
      example_ids: v.examples,
    }))
    .sort((a, b) => b.count - a.count);

  const mergeCandidates: Report["merge_candidates"] = [];
  for (const b of byBucket) {
    if (b.layer === "noise" || b.layer === "status") continue;
    if (b.count === 0) continue;
    if (b.count <= 2 && b.provisional) {
      mergeCandidates.push({
        bucket: b.bucket,
        count: b.count,
        suggestion: `Only ${b.count} observation(s); consider merging into parent family or marking analytically weak.`,
      });
    }
  }

  const changeEvents = events.filter((e) => e.taxonomy_layer === "change");
  const lowConfChange = changeEvents.filter((e) => e.confidence === "low").length;
  const lowConfPct = changeEvents.length === 0 ? 0 : (lowConfChange / changeEvents.length) * 100;

  return {
    generated_at: new Date().toISOString(),
    classifier_version: CLASSIFIER_VERSION,
    llm_enabled: LLM_ENABLED,
    totals: { events: events.length, by_layer: byLayer, by_authorship: byAuth, by_confidence: byConf },
    by_bucket: byBucket,
    merge_candidates: mergeCandidates,
    low_confidence_change_pct: Number(lowConfPct.toFixed(1)),
    validation_errors: validationErrors,
  };
}

async function main() {
  const events = loadEvents();
  console.log(`Loaded ${events.length} raw events (changelog + findings).`);
  console.log(`LLM: ${LLM_ENABLED ? `enabled (model=${LLM_MODEL}, max_calls=${LLM_MAX_CALLS})` : "DISABLED (set ANTHROPIC_API_KEY to enable)"}`);
  console.log(`Dry run: ${DRY_RUN}`);

  const classified: ClassifiedEvent[] = [];
  const budget = { n: LLM_MAX_CALLS };
  let processed = 0;
  for (const e of events) {
    const c = await classifyOne(e, budget);
    classified.push(c);
    processed += 1;
    if (processed % 50 === 0) console.log(`  ...${processed}/${events.length}`);
  }

  linkFaqPairs(classified);

  const errors = validate(classified);
  if (errors.length > 0) {
    console.warn(`\nVALIDATION ERRORS (${errors.length}):`);
    for (const err of errors.slice(0, 10)) console.warn(`  - ${err}`);
    if (errors.length > 10) console.warn(`  ...and ${errors.length - 10} more.`);
  }

  const report = buildReport(classified, errors);

  if (!DRY_RUN) {
    writeFileSync(OUT_EVENTS, JSON.stringify(classified, null, 2));
    writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${OUT_EVENTS} (${classified.length} events)`);
    console.log(`Wrote ${OUT_REPORT}`);
  } else {
    console.log("\n(dry-run — no files written)");
  }

  // Console summary
  console.log("\n=== LAYER TOTALS ===");
  for (const [layer, n] of Object.entries(report.totals.by_layer)) console.log(`  ${layer.padEnd(28)} ${n}`);
  console.log("\n=== AUTHORSHIP ===");
  for (const [a, n] of Object.entries(report.totals.by_authorship)) console.log(`  ${a.padEnd(28)} ${n}`);
  console.log("\n=== CONFIDENCE ===");
  for (const [c, n] of Object.entries(report.totals.by_confidence)) console.log(`  ${c.padEnd(28)} ${n}`);
  console.log(`\nLow-confidence change events: ${report.low_confidence_change_pct}%`);
  console.log(`Validation errors: ${report.validation_errors.length}`);
  console.log(`Merge candidates (N<=2 provisional): ${report.merge_candidates.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

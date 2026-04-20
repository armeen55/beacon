/**
 * Phase 1 Step 1 — Draft change taxonomy from real Beacon data.
 *
 * Reads every "change" Beacon knows about:
 *   - `.data/imported-changes.json` (changelog entries: Profound imports +
 *     confirmed scan findings; skips archived)
 *   - `.data/scan-findings.json` (pending + orphan-accepted findings Beacon
 *     detected but not yet confirmed into changelog; skips rejected + already-
 *     linked accepted)
 *
 * Clusters each event by a heuristic-inferred taxonomy bucket (keyword match
 * on description text + structured schema_types_added/removed when present).
 *
 * Outputs:
 *   - `docs/DRAFT_CHANGE_TAXONOMY.md` — proposed ~50 taxonomy entries, ordered
 *     by frequency. Each entry shows count, description, 2–3 example IDs.
 *     Unclassified events listed at the bottom for operator redline.
 *
 * Non-goals:
 *   - This is NOT the production classifier. It is a one-shot analysis to
 *     seed the real taxonomy file (`src/domains/attribution/change-taxonomy.ts`).
 *   - No files outside `docs/` are written. No `.data/` writes.
 *
 * Usage:
 *   npx tsx scripts/draft-change-taxonomy.ts
 *
 * Undo:
 *   rm docs/DRAFT_CHANGE_TAXONOMY.md
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Data shapes (subset of canonical types — inlined to keep this script zero-dep)
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
  city_targeted?: string | null;
  archived?: boolean;
  change_family?: string;
  change_type?: string;
  schema_types_added?: string[];
  schema_types_removed?: string[];
  visible_copy_changed?: boolean;
};

type FindingRow = {
  id: string;
  type: string;
  url: string;
  pagePath?: string;
  summary?: string;
  currentState?: string | null;
  previousState?: string | null;
  detectedAt: string;
  status: "pending" | "accepted" | "rejected" | "ignored" | "expected";
  linkedChangeId?: string | null;
};

type Event = {
  id: string;
  source: "changelog" | "finding";
  when: string;
  url: string | null;
  description: string;
  signal_type?: string;
  asset_type?: string;
  finding_type?: string;
  schema_types_added?: string[];
  schema_types_removed?: string[];
  visible_copy_changed?: boolean;
  change_family?: string;
  change_type?: string;
};

// ---------------------------------------------------------------------------
// Heuristic taxonomy buckets
// ---------------------------------------------------------------------------

/**
 * Order matters: first match wins. Place more specific rules above more general ones.
 * Each rule's `match` receives the event; returns true to claim the event for this bucket.
 */
type TaxonomyRule = {
  id: string;
  description: string;
  match: (e: Event) => boolean;
};

const DESC = (e: Event) => (e.description || "").toLowerCase();
const has = (e: Event, ...needles: string[]) => {
  const t = DESC(e);
  return needles.some((n) => t.includes(n.toLowerCase()));
};

const RULES: TaxonomyRule[] = [
  // --- SCHEMA (structured data) ---
  {
    id: "schema.faqpage.add",
    description: "FAQPage JSON-LD added to a page.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /faq/i.test(t)) ||
      has(e, "added faqpage", "faq schema added", "added faq json-ld", "faq structured data added"),
  },
  {
    id: "schema.faqpage.remove",
    description: "FAQPage JSON-LD removed from a page.",
    match: (e) =>
      (e.schema_types_removed ?? []).some((t) => /faq/i.test(t)) ||
      has(e, "removed faqpage", "faq schema removed"),
  },
  {
    id: "schema.breadcrumb.add",
    description: "BreadcrumbList JSON-LD added.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /breadcrumb/i.test(t)) ||
      has(e, "breadcrumb schema", "added breadcrumb"),
  },
  {
    id: "schema.localbusiness.add",
    description: "LocalBusiness / HomeAndConstructionBusiness schema added.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) =>
        /localbusiness|homeandconstruction|generalcontractor/i.test(t),
      ) || has(e, "localbusiness schema", "local business schema"),
  },
  {
    id: "schema.howto.add",
    description: "HowTo JSON-LD added.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /howto/i.test(t)) || has(e, "howto schema", "how-to schema"),
  },
  {
    id: "schema.article.add",
    description: "Article / BlogPosting schema added.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /article|blogposting/i.test(t)) ||
      has(e, "article schema"),
  },
  {
    id: "schema.webpage.add",
    description: "WebPage JSON-LD added.",
    match: (e) => (e.schema_types_added ?? []).some((t) => /^webpage$/i.test(t)),
  },
  {
    id: "schema.organization.add",
    description: "Organization schema added.",
    match: (e) => (e.schema_types_added ?? []).some((t) => /organization/i.test(t)),
  },
  {
    id: "schema.single-family-residence.add",
    description: "SingleFamilyResidence JSON-LD (listing schema for available homes) added.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /singlefamilyresidence/i.test(t)) ||
      has(e, "singlefamilyresidence"),
  },
  {
    id: "schema.service.add",
    description: "Service JSON-LD added.",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /^service$/i.test(t)) ||
      (has(e, "service schema", "service json-ld") && !has(e, "services page")),
  },
  {
    id: "schema.offer.add",
    description: "Offer / price JSON-LD added (attached to a listing).",
    match: (e) =>
      (e.schema_types_added ?? []).some((t) => /^offer$/i.test(t)) || has(e, "offer schema", "offer json-ld"),
  },
  {
    id: "schema.other.add",
    description: "Other structured-data type added (catch-all for typed schema; also matches 'JSON-LD schema' text when structured field is empty).",
    match: (e) =>
      (e.schema_types_added ?? []).length > 0 ||
      has(e, "json-ld schema", "added json-ld", "schema with", "schema targeting"),
  },
  {
    id: "schema.other.remove",
    description: "Other structured-data type removed (catch-all).",
    match: (e) => (e.schema_types_removed ?? []).length > 0 || has(e, "removed json-ld"),
  },
  {
    id: "schema.content.edit",
    description: "Schema content edited without changing the set of types.",
    match: (e) => e.change_type === "schema_content_edited",
  },
  {
    id: "schema.invalid.detected",
    description: "Scanner flagged JSON-LD as invalid for Google rich-result requirements.",
    match: (e) => e.finding_type === "schema_invalid",
  },
  {
    id: "schema.missing-for-page-type",
    description: "Scanner flagged a page missing the expected schema for its asset type.",
    match: (e) => e.finding_type === "schema_missing_for_page_type",
  },
  {
    id: "schema.faq-without-jsonld",
    description: "Page has FAQ-style content but no FAQPage JSON-LD.",
    match: (e) => e.finding_type === "faq_without_schema",
  },

  // --- CONTENT (visible copy) ---
  {
    id: "content.h1.modify.city-service",
    description: "H1 modified; new H1 includes a city + service combo.",
    match: (e) =>
      (e.finding_type === "h1_changed" ||
        has(e, "h1 changed", "h1 updated", "updated h1", "rewrote h1", "set h1")) &&
      has(e, "city", "palo alto", "menlo park", "atherton", "mountain view", "los altos", "cupertino", "saratoga", "los gatos"),
  },
  {
    id: "content.h1.modify",
    description: "H1 modified (generic).",
    match: (e) =>
      e.finding_type === "h1_changed" ||
      has(e, "h1 changed", "h1 updated", "updated h1", "rewrote h1", "new h1", "set h1", "h1 set", "h1 to '"),
  },
  {
    id: "content.title.modify",
    description: "<title> tag modified.",
    match: (e) =>
      e.finding_type === "title_changed" ||
      has(e, "title changed", "title updated", "new title", "rewrote title", "title rename", "set title", "title tag to", "title to '"),
  },
  {
    id: "content.h2.add.city-name",
    description: "H2 added that mentions a city name.",
    match: (e) =>
      has(e, "h2") &&
      (has(e, "added", "new") &&
        has(e, "city", "palo alto", "menlo park", "atherton", "mountain view", "los altos", "cupertino")),
  },
  {
    id: "content.h2.add.service-name",
    description: "H2 added that mentions a service (remodel, custom home, adu, etc.).",
    match: (e) =>
      has(e, "h2") &&
      has(e, "added", "new") &&
      has(e, "remodel", "custom home", "adu", "accessory dwelling", "renovation", "kitchen", "bathroom", "whole-home"),
  },
  {
    id: "content.h2.add",
    description: "H2 added (generic).",
    match: (e) => has(e, "h2") && has(e, "added", "new"),
  },
  {
    id: "content.h2.modify",
    description: "H2 modified.",
    match: (e) => has(e, "h2") && has(e, "changed", "updated", "rewrote", "rewritten"),
  },
  {
    id: "content.h3.modify",
    description: "H3 added or modified.",
    match: (e) => has(e, "h3"),
  },
  {
    id: "content.faq.add",
    description: "Visible FAQ block added (Q&A copy on the page, separate from JSON-LD).",
    match: (e) =>
      e.finding_type === "faq_changed" ||
      (has(e, "faq", "q&a", "question") && has(e, "added", "new")),
  },
  {
    id: "content.body.rewrite",
    description: "Body copy substantially rewritten.",
    match: (e) =>
      e.finding_type === "content_changed" ||
      has(e, "rewrote", "rewritten", "content refresh", "copy refresh", "copy rewrite", "rewrite"),
  },
  {
    id: "content.table.add",
    description: "Comparison / data table added to a page.",
    match: (e) => has(e, "table") && has(e, "added", "new"),
  },
  {
    id: "content.list.add",
    description: "Bulleted / numbered list added.",
    match: (e) => (has(e, "list", "bullet") && has(e, "added", "new")) || has(e, "added list"),
  },
  {
    id: "content.testimonial.add",
    description: "Customer testimonial / quote block added.",
    match: (e) => has(e, "testimonial", "quote") && has(e, "added", "new"),
  },
  {
    id: "content.cta.modify",
    description: "Call-to-action button / link copy modified.",
    match: (e) => has(e, "cta", "call to action", "button"),
  },

  // --- METADATA ---
  {
    id: "metadata.meta-description.modify",
    description: "<meta name=description> modified.",
    match: (e) =>
      e.finding_type === "meta_changed" ||
      has(e, "meta description", "meta desc", "description tag"),
  },
  {
    id: "metadata.canonical.modify",
    description: "<link rel=canonical> modified.",
    match: (e) => e.finding_type === "canonical_changed" || has(e, "canonical"),
  },
  {
    id: "metadata.robots.modify",
    description: "robots.txt or meta-robots modified.",
    match: (e) =>
      e.finding_type === "robots_txt_blocked" ||
      has(e, "robots.txt", "meta robots", "robots meta", "set robots", "index,follow", "index, follow", "noindex removed", "removed inherited noindex"),
  },
  {
    id: "metadata.open-graph.modify",
    description: "Open Graph meta tags (og:title, og:description, og:image, og:url, og:type) set or modified.",
    match: (e) => has(e, "open graph", "og:title", "og:description", "og:image", "og:url", "og:type", " og "),
  },
  {
    id: "metadata.twitter-card.modify",
    description: "Twitter Card meta tags modified.",
    match: (e) => has(e, "twitter card", "twitter:card", "twitter:title"),
  },

  // --- LINK GRAPH ---
  {
    id: "link-graph.internal.add",
    description: "Internal link added to a page.",
    match: (e) =>
      (e.finding_type === "links_changed" && has(e, "internal", "added")) ||
      has(e, "added internal link", "new internal link", "internal link added"),
  },
  {
    id: "link-graph.outbound.add",
    description: "Outbound / external link added.",
    match: (e) => has(e, "outbound", "external link") && has(e, "added", "new"),
  },
  {
    id: "link-graph.links.modify",
    description: "Links modified (direction unknown).",
    match: (e) => e.finding_type === "links_changed",
  },

  // --- MEDIA ---
  {
    id: "media.image.add",
    description: "Image added.",
    match: (e) => (has(e, "image", "photo") && has(e, "added", "new")) || has(e, "added image"),
  },
  {
    id: "media.alt-text.add",
    description: "Alt text added to images.",
    match: (e) => has(e, "alt text", "alt-text", "alt attribute"),
  },
  {
    id: "media.video.add",
    description: "Video embed added.",
    match: (e) => has(e, "video") && has(e, "added", "new"),
  },

  // --- STRUCTURE (site-level) ---
  {
    id: "structure.page.add.location",
    description: "New city / location page created.",
    match: (e) =>
      (has(e, "created new", "new page", "launched page", "created.*page") || e.finding_type === "page_added") &&
      has(e, "city page", "location page", "/locations/", "locations/"),
  },
  {
    id: "structure.page.add.project",
    description: "New project / portfolio page created.",
    match: (e) =>
      has(e, "created new") &&
      has(e, "project page", "portfolio", "/explore-projects/", "explore-projects/"),
  },
  {
    id: "structure.page.add.available-home",
    description: "New available-home listing page created.",
    match: (e) =>
      has(e, "created new") && has(e, "available home", "/available-homes/"),
  },
  {
    id: "structure.page.add.landing",
    description: "New standalone landing / comparison page created.",
    match: (e) =>
      has(e, "created new", "standalone landing") && has(e, "landing page"),
  },
  {
    id: "structure.page.add",
    description: "New page created (generic, not matched by a more specific page-add rule).",
    match: (e) =>
      e.finding_type === "page_added" ||
      has(e, "page created", "new page", "page added", "launched page", "created new page", "created new standalone", "created new city", "created new project", "created new available"),
  },
  {
    id: "structure.page.remove",
    description: "Page removed.",
    match: (e) => e.finding_type === "page_removed" || has(e, "page removed", "deleted page"),
  },
  {
    id: "structure.redirect.add",
    description: "301 / 302 redirect added between URLs.",
    match: (e) =>
      has(e, "301 redirect", "302 redirect", "permanent redirect", "temporary redirect", "redirect from"),
  },
  {
    id: "structure.route.ensure",
    description: "Parent route ensured to return 200 (sitemap / routing hygiene).",
    match: (e) => has(e, "ensured", "parent route", "returns 200"),
  },
  {
    id: "structure.sitemap.modify",
    description: "Sitemap updated.",
    match: (e) => has(e, "sitemap"),
  },
  {
    id: "structure.footer.modify",
    description: "Global footer modified (links, attribution, contact block).",
    match: (e) => has(e, "footer"),
  },
  {
    id: "structure.header.modify",
    description: "Global header / top nav modified.",
    match: (e) => has(e, "header nav", "top nav", "navigation menu", "nav menu"),
  },

  // --- CONTENT SECTIONS (catch-alls for "Added X section" patterns) ---
  {
    id: "content.section.add.process",
    description: "Process / workflow section added (n-step process, how we work).",
    match: (e) =>
      has(e, "process section", "process strip") ||
      (has(e, "added") && has(e, "process") && has(e, "step", "steps")),
  },
  {
    id: "content.section.add.neighborhoods",
    description: "Neighborhoods / micro-markets section added (city-specific area descriptions).",
    match: (e) => has(e, "neighborhood", "micro-market", "micro market"),
  },
  {
    id: "content.section.add.cost",
    description: "Cost / pricing / $per-sqft section added.",
    match: (e) =>
      has(e, "cost section", "pricing section") ||
      (has(e, "added") && has(e, "sqft", "$/sqft", "per sqft", "cost")),
  },
  {
    id: "content.section.add.adu",
    description: "ADU / accessory dwelling section added.",
    match: (e) => has(e, "adu section") || (has(e, "added") && has(e, "adu", "accessory dwelling")),
  },
  {
    id: "content.section.add.quick-facts",
    description: "Quick facts / data-point strip added (lot size, FAR, min acre, etc.).",
    match: (e) => has(e, "quick facts", "data points", "data strip"),
  },
  {
    id: "content.section.add.hero",
    description: "Hero section added (top-of-page banner with image + H1 + CTA).",
    match: (e) => has(e, "hero section", "hero strip", "hero card", "hero block"),
  },
  {
    id: "content.section.add.trust-strip",
    description: "Trust strip / credibility markers section added.",
    match: (e) => has(e, "trust strip", "credibility marker", "proof strip"),
  },
  {
    id: "content.section.add.comparison",
    description: "Comparison / builder-vs-builder section added.",
    match: (e) => has(e, "comparison section", "comparison grid", "builder comparison", "vs ", " vs."),
  },
  {
    id: "content.section.add.service-area",
    description: "Service-area grid / cities-served list added.",
    match: (e) => has(e, "service-area", "service area grid", "cities served", "areas we serve"),
  },
  {
    id: "content.section.add.description-block",
    description: "Narrative description / project copy block added.",
    match: (e) => has(e, "description block", "project narrative", "narrative copy"),
  },
  {
    id: "content.section.add",
    description: "Generic content section added (catch-all — 'Added Section N' / 'Added X section').",
    match: (e) =>
      has(e, "added section") ||
      (has(e, "added") && has(e, "section ")) ||
      has(e, "added full-width", "added block", "added grid", "added strip"),
  },
  {
    id: "content.anchor-ids.add",
    description: "Section anchor IDs added for internal section linking (#faq, #process, etc.).",
    match: (e) => has(e, "anchor id", "anchor-id", "section anchor", "anchor ids"),
  },
  {
    id: "content.style.normalize",
    description: "Styling / formatting normalized across multiple pages (sitewide style pass).",
    match: (e) => has(e, "normalized styling", "unified styling", "normalized answer styling", "style normalization"),
  },

  // --- OPERATIONAL (noise / infrastructure / non-content) ---
  {
    id: "ops.deploy-mismatch",
    description: "Scanner detected a deploy-related snapshot mismatch (not a real content change).",
    match: (e) => e.finding_type === "deploy_mismatch",
  },
  {
    id: "ops.unexpected-change",
    description: "Scanner flagged a change without a matching changelog entry.",
    match: (e) => e.finding_type === "unexpected_change",
  },
  {
    id: "ops.guardrail.new",
    description: "Scanner flagged a new guardrail condition.",
    match: (e) => e.finding_type === "new_guardrail",
  },
  {
    id: "ops.guardrail.cleared",
    description: "A guardrail condition was cleared.",
    match: (e) => e.finding_type === "guardrail_cleared",
  },
  {
    id: "ops.stale-visibility",
    description: "Visibility data went stale on a URL.",
    match: (e) => e.finding_type === "stale_visibility",
  },
];

// ---------------------------------------------------------------------------
// Load + normalize events
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "..");
const CHANGELOG_PATH = resolve(ROOT, ".data/imported-changes.json");
const FINDINGS_PATH = resolve(ROOT, ".data/scan-findings.json");
const OUT_PATH = resolve(ROOT, "docs/DRAFT_CHANGE_TAXONOMY.md");

function loadChangelog(): Event[] {
  const raw = JSON.parse(readFileSync(CHANGELOG_PATH, "utf8")) as ChangelogRow[];
  return raw
    .filter((r) => !r.archived)
    .map((r): Event => ({
      id: r.id,
      source: "changelog",
      when: r.timestamp,
      url: r.url,
      description: [
        r.change_description ?? "",
        r.asset_name ? `(${r.asset_name})` : "",
        r.topic_targeted ?? "",
      ]
        .filter(Boolean)
        .join(" "),
      signal_type: r.signal_type,
      asset_type: r.asset_type,
      schema_types_added: r.schema_types_added,
      schema_types_removed: r.schema_types_removed,
      visible_copy_changed: r.visible_copy_changed,
      change_family: r.change_family,
      change_type: r.change_type,
    }));
}

function loadFindings(): Event[] {
  const raw = JSON.parse(readFileSync(FINDINGS_PATH, "utf8")) as FindingRow[];
  return raw
    .filter((f) => {
      // Skip rejected — operator already said "not a real change".
      if (f.status === "rejected") return false;
      // Skip accepted that are already linked to a changelog row (double-count).
      if (f.status === "accepted" && f.linkedChangeId) return false;
      // Skip ignored / expected — operational, not change events.
      if (f.status === "ignored" || f.status === "expected") return false;
      return true;
    })
    .map((f): Event => ({
      id: f.id,
      source: "finding",
      when: f.detectedAt,
      url: f.url,
      description: [f.summary ?? "", f.previousState ? `was: ${f.previousState}` : "", f.currentState ? `now: ${f.currentState}` : ""]
        .filter(Boolean)
        .join(" · "),
      finding_type: f.type,
    }));
}

// ---------------------------------------------------------------------------
// Classify + report
// ---------------------------------------------------------------------------

type Bucket = {
  id: string;
  description: string;
  examples: Event[];
};

function classify(events: Event[]): { buckets: Map<string, Bucket>; unclassified: Event[] } {
  const buckets = new Map<string, Bucket>();
  const unclassified: Event[] = [];

  for (const e of events) {
    const rule = RULES.find((r) => r.match(e));
    if (!rule) {
      unclassified.push(e);
      continue;
    }
    let b = buckets.get(rule.id);
    if (!b) {
      b = { id: rule.id, description: rule.description, examples: [] };
      buckets.set(rule.id, b);
    }
    b.examples.push(e);
  }

  return { buckets, unclassified };
}

function formatExampleLine(e: Event): string {
  const date = e.when?.slice(0, 10) ?? "?";
  const url = e.url ?? "(site-wide)";
  const desc = (e.description || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const src = e.source === "finding" ? `finding:${e.finding_type ?? "?"}` : "changelog";
  return `- \`${e.id}\` · ${date} · ${url} · _${src}_ — ${desc || "(no description)"}`;
}

function render(buckets: Map<string, Bucket>, unclassified: Event[], totals: { changelog: number; findings: number }) {
  const sorted = Array.from(buckets.values()).sort((a, b) => b.examples.length - a.examples.length);
  const total = totals.changelog + totals.findings;
  const classified = total - unclassified.length;

  const lines: string[] = [];
  lines.push(`# DRAFT change taxonomy (auto-generated)`);
  lines.push("");
  lines.push(`_Generated 2026-04-20 by \`scripts/draft-change-taxonomy.ts\`. This is a draft — redline it._`);
  lines.push("");
  lines.push(`## Sources`);
  lines.push("");
  lines.push(`- **\`${CHANGELOG_PATH.replace(ROOT + "/", "")}\`** — ${totals.changelog} changelog entries (excluding archived)`);
  lines.push(`- **\`${FINDINGS_PATH.replace(ROOT + "/", "")}\`** — ${totals.findings} scan findings (pending + orphan-accepted; excluded rejected/ignored/already-linked-accepted)`);
  lines.push(`- **Total events analyzed:** ${total}`);
  lines.push(`- **Classified into ${sorted.length} taxonomy buckets:** ${classified} events (${((classified / total) * 100).toFixed(1)}%)`);
  lines.push(`- **Unclassified (needs redline):** ${unclassified.length} events (${((unclassified.length / total) * 100).toFixed(1)}%)`);
  lines.push("");
  lines.push(`## How to redline this file`);
  lines.push("");
  lines.push(`1. Read each bucket below. If the \`id\` is wrong, rewrite it. If the \`description\` is wrong, rewrite it.`);
  lines.push(`2. If two buckets should be merged, note \`MERGE with <other-id>\` inline.`);
  lines.push(`3. If a bucket should be split (too broad), note \`SPLIT: <sub-id-1>, <sub-id-2>\`.`);
  lines.push(`4. For every entry in the **UNCLASSIFIED** section: either propose a new bucket id or mark \`NOT A CHANGE\` if it's operational noise.`);
  lines.push(`5. When done, tell me "taxonomy redlined" and I'll generate \`src/domains/attribution/change-taxonomy.ts\` from your edits.`);
  lines.push("");
  lines.push(`## Taxonomy buckets (by frequency)`);
  lines.push("");

  sorted.forEach((b, i) => {
    lines.push(`### ${i + 1}. \`${b.id}\` — ${b.description}`);
    lines.push(`**Count:** ${b.examples.length}`);
    lines.push("");
    lines.push(`**Examples:**`);
    const sample = b.examples.slice(0, 3);
    sample.forEach((e) => lines.push(formatExampleLine(e)));
    if (b.examples.length > 3) {
      lines.push(`- _…and ${b.examples.length - 3} more._`);
    }
    lines.push("");
  });

  lines.push(`## UNCLASSIFIED (${unclassified.length} events)`);
  lines.push("");
  lines.push(`These did not match any heuristic rule. Most common reasons:`);
  lines.push("");
  lines.push(`- Vague description ("updated page", "copy refresh") — needs either a new bucket or rejection as noise.`);
  lines.push(`- Edit type the heuristic doesn't know about yet — propose a new bucket id.`);
  lines.push(`- Non-change event (measurement, notes, pure-metric row) — mark \`NOT A CHANGE\`.`);
  lines.push("");
  unclassified.slice(0, 200).forEach((e) => lines.push(formatExampleLine(e)));
  if (unclassified.length > 200) {
    lines.push("");
    lines.push(`_…and ${unclassified.length - 200} more unclassified. Full list can be regenerated with \`npx tsx scripts/draft-change-taxonomy.ts\`._`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const changelog = loadChangelog();
  const findings = loadFindings();
  const all = [...changelog, ...findings];
  const { buckets, unclassified } = classify(all);
  const out = render(buckets, unclassified, { changelog: changelog.length, findings: findings.length });
  writeFileSync(OUT_PATH, out, "utf8");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  sources: ${changelog.length} changelog + ${findings.length} findings = ${all.length} events`);
  console.log(`  classified into ${buckets.size} buckets`);
  console.log(`  unclassified: ${unclassified.length} (${((unclassified.length / all.length) * 100).toFixed(1)}%)`);
}

main();

/**
 * CX5.4 — Guided execution payload generators.
 *
 * Each generator takes a DetectedGap + tenant context and produces a
 * paste-ready payload: FAQ questions with answer outlines, JSON-LD
 * schema blocks, comparison table HTML, content section outlines.
 *
 * Every payload includes:
 *   - Exact content to add (questions, code, HTML)
 *   - Placement guidance ("after the Our Process section")
 *   - Scope ("applies to 12 city pages")
 *   - Verification criteria ("FAQPage schema present and valid")
 */

import type { BeaconTenant } from "@/domains/tenants/types";
import type { DetectedGap, GuidedPayload } from "./types";

// ---------------------------------------------------------------------------
// FAQ generator
// ---------------------------------------------------------------------------

const FAQ_TEMPLATES_BY_TOPIC: Record<string, Array<{ q: string; a: string }>> = {
  custom_home_builder: [
    { q: "How long does it take to build a custom home?", a: "Most custom homes take 12-18 months from groundbreaking to move-in, depending on size, complexity, and permitting timelines in your area." },
    { q: "How much does it cost to build a custom home?", a: "Custom home costs vary widely — typically $300-$600+ per square foot depending on finishes, site conditions, and local labor markets." },
    { q: "What's the difference between a custom builder and a production builder?", a: "Custom builders design and build one home at a time to your exact specifications. Production builders build the same plans repeatedly across multiple lots." },
    { q: "Do I need my own architect or does the builder provide one?", a: "Design-build firms handle both architecture and construction. If you hire a standalone builder, you'll typically bring your own architect." },
    { q: "What should I look for when choosing a custom home builder?", a: "Look for: licensed and insured, portfolio of similar projects, transparent pricing, clear communication style, references from recent clients, and experience in your specific area." },
    { q: "Can I make changes during construction?", a: "Most builders allow changes during construction, but changes after framing can be costly. The best time to finalize decisions is during the design phase." },
    { q: "What permits are needed to build a custom home?", a: "You'll typically need: building permit, grading permit, electrical/plumbing/mechanical permits, and potentially environmental or historic review depending on your lot." },
  ],
  remodel: [
    { q: "How long does a whole home remodel take?", a: "A comprehensive whole-home remodel typically takes 6-12 months depending on scope, permitting, and structural changes required." },
    { q: "Should I remodel or tear down and rebuild?", a: "Remodel when the foundation and structure are sound and you want to preserve character. Rebuild when structural issues exist or the layout can't accommodate your needs." },
    { q: "Do I need to move out during a remodel?", a: "For a whole-home remodel, yes — living in a construction zone is disruptive and can slow the project. Budget for temporary housing during the renovation." },
    { q: "How much does a whole home remodel cost?", a: "Whole-home remodels typically run $200-$400+ per square foot depending on the extent of structural changes, finishes, and your local market." },
    { q: "What's the return on investment for a whole home remodel?", a: "ROI varies by project — kitchen and bathroom remodels typically recoup 60-80% of cost, while adding square footage can recoup 50-70%." },
  ],
  adu: [
    { q: "How much does it cost to build an ADU?", a: "ADU costs typically range from $150,000 to $400,000+ depending on size, foundation type, and whether it's attached or detached." },
    { q: "Do I need a permit to build an ADU?", a: "Yes — ADUs require building permits. Many California cities have streamlined ADU permitting under state law, but requirements vary by municipality." },
    { q: "How long does it take to build an ADU?", a: "Most ADUs take 6-10 months from permit application to completion, with permitting itself taking 2-4 months in many jurisdictions." },
    { q: "Can I rent out my ADU?", a: "In most California cities, yes — ADUs can be rented as long-term or short-term rentals, subject to local ordinances." },
    { q: "What size ADU can I build on my property?", a: "California state law generally allows ADUs up to 1,200 sq ft on single-family lots, but setback requirements and lot coverage limits may constrain the footprint." },
  ],
};

function getFaqQuestionsForGap(
  gap: DetectedGap,
  tenant: BeaconTenant,
): Array<{ question: string; answer_outline: string }> {
  // Find the best matching topic from the tenant's project mix
  const projectMixTopics: Record<string, string> = {
    new_construction: "custom_home_builder",
    whole_home_remodel: "remodel",
    kitchen_bath: "remodel",
    adu_addition: "adu",
    teardown_rebuild: "custom_home_builder",
    commercial_residential: "custom_home_builder",
  };

  let topicKey: string | null = null;
  for (const mix of tenant.project_mix) {
    if (projectMixTopics[mix]) {
      topicKey = projectMixTopics[mix];
      break;
    }
  }

  // No builder-vertical topic matched the tenant's project mix (e.g. a content
  // site like an encyclopedia, which has none). Emit NO FAQ rather than
  // defaulting to custom-home-builder content on a non-builder tenant
  // (tool-for-everyone). The FAQ templates here are builder-specific by nature.
  if (topicKey === null) return [];
  const templates = FAQ_TEMPLATES_BY_TOPIC[topicKey] ?? [];

  // Customize with city if the gap is on a city page
  const city = extractCityFromUrl(gap.page_url);

  return templates.slice(0, 7).map((t) => ({
    question: city ? t.q.replace(/your area|your/g, city) : t.q,
    answer_outline: t.a,
  }));
}

function extractCityFromUrl(url: string): string | null {
  const match = url.match(/\/locations?\/([\w-]+)/i);
  if (match) {
    return match[1]
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON-LD builders
// ---------------------------------------------------------------------------

function buildFaqJsonLd(
  questions: Array<{ question: string; answer_outline: string }>,
): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answer_outline,
      },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

function buildServiceJsonLd(tenant: BeaconTenant): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: tenant.business_name,
    url: `https://${tenant.domain}`,
    areaServed: tenant.cities_served.map((c) => ({
      "@type": "City",
      name: c,
    })),
    serviceType: tenant.project_mix.map((p) =>
      p.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    ),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

function buildLocalBusinessJsonLd(
  tenant: BeaconTenant,
  city: string,
): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    name: tenant.business_name,
    url: `https://${tenant.domain}`,
    areaServed: { "@type": "City", name: city },
  };
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

// ---------------------------------------------------------------------------
// Comparison table builder
// ---------------------------------------------------------------------------

function buildComparisonHtml(
  tenant: BeaconTenant,
  competitors: string[],
): string {
  // Vertical-NEUTRAL criteria so the table fits any tenant (was builder-specific:
  // "Project types", "Budget range", "Design-build capability"). TODO(tool-for-
  // everyone): derive from the tenant's industry/services config.
  const criteria = [
    "What they offer",
    "Coverage / range",
    "Depth & detail",
    "Reputation & proof",
    "Pricing or access",
    "Recency",
  ];

  const cols = [tenant.business_name, ...competitors.slice(0, 4)];
  const headerRow = cols.map((c) => `    <th>${c}</th>`).join("\n");
  const bodyRows = criteria
    .map(
      (criterion) =>
        `  <tr>\n    <td>${criterion}</td>\n${cols.map(() => "    <td><!-- Fill in --></td>").join("\n")}\n  </tr>`,
    )
    .join("\n");

  return `<table class="comparison-table">
<thead>
  <tr>
    <th>Criteria</th>
${headerRow}
  </tr>
</thead>
<tbody>
${bodyRows}
</tbody>
</table>`;
}

// ---------------------------------------------------------------------------
// Main payload generator
// ---------------------------------------------------------------------------

export function generatePayload(opts: {
  gap: DetectedGap;
  tenant: BeaconTenant;
}): GuidedPayload {
  const { gap, tenant } = opts;

  switch (gap.type) {
    case "missing_faq":
    case "insufficient_faq": {
      const questions = getFaqQuestionsForGap(gap, tenant);
      return {
        kind: "faq",
        questions,
        json_ld: buildFaqJsonLd(questions),
        placement: "Add the FAQ section after the main content, before the footer. Add the JSON-LD in the page <head>.",
      };
    }

    case "missing_faq_schema": {
      // FAQ content already exists — just need the schema
      return {
        kind: "schema",
        schema_type: "FAQPage",
        json_ld: "<!-- Extract existing FAQ questions from the page and wrap them in FAQPage JSON-LD. See the FAQ addition template for the schema structure. -->",
        placement: "Add the JSON-LD <script> tag in the page <head>. Questions should match the existing FAQ content exactly.",
      };
    }

    case "missing_comparison_table": {
      const competitors = tenant.discovered_competitors.length > 0
        ? tenant.discovered_competitors
        : ["Competitor 1", "Competitor 2", "Competitor 3", "Competitor 4"];
      return {
        kind: "comparison",
        competitors,
        criteria: [
          "Years in business",
          "Project types",
          "Service area",
          "Budget range",
          "Licensed & insured",
          "Design-build capability",
        ],
        html: buildComparisonHtml(tenant, competitors),
        placement: "Add the comparison table after the introduction section, before testimonials. Works best on service and city pages.",
      };
    }

    case "missing_schema":
    case "missing_service_schema": {
      return {
        kind: "schema",
        schema_type: "ProfessionalService",
        json_ld: buildServiceJsonLd(tenant),
        placement: "Add the JSON-LD <script> tag in the page <head>.",
      };
    }

    case "missing_localbusiness": {
      const city = extractCityFromUrl(gap.page_url) ?? tenant.cities_served[0] ?? "your city";
      return {
        kind: "schema",
        schema_type: "HomeAndConstructionBusiness",
        json_ld: buildLocalBusinessJsonLd(tenant, city),
        placement: "Add the JSON-LD <script> tag in the page <head> of this city page.",
      };
    }

    case "duplicate_faq_schema": {
      return {
        kind: "schema",
        schema_type: "FAQPage",
        json_ld: "<!-- Consolidate all FAQPage blocks into one. Remove duplicate <script type=\"application/ld+json\"> tags. -->",
        placement: "Keep one FAQPage JSON-LD block in the page <head>. Remove all others.",
      };
    }

    case "thin_content":
    case "missing_h2_structure": {
      return {
        kind: "content",
        section_title: gap.type === "thin_content" ? "Content Expansion" : "Section Structure",
        outline: gap.type === "thin_content"
          ? "Expand the page content to 800+ words. Add sections covering: what makes this service/area unique, the process, typical costs, timeline expectations, and how to get started."
          : "Add 4-6 H2 sections: Overview, Our Process, What to Expect, Costs & Timeline, FAQ, Get Started.",
        placement: "Structure the page with clear H2 headings. Each section should be 100-200 words.",
      };
    }

    case "low_internal_links": {
      return {
        kind: "content",
        section_title: "Internal Linking",
        outline: "Add 5+ internal links to related service pages, city pages, and project portfolio pages. Link from natural anchor text within the content.",
        placement: "Distribute links throughout the page content, not just in a footer link block.",
      };
    }

    case "stale_content":
    default: {
      return {
        kind: "content",
        section_title: "Content Refresh",
        outline: "Review and update the page content. Add recent project examples, update statistics, and ensure all information is current.",
        placement: "Update inline throughout the existing content.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Dev ticket formatter
// ---------------------------------------------------------------------------

export function formatAsTicket(opts: {
  gap: DetectedGap;
  payload: GuidedPayload;
  populationNarrative: string | null;
  format: "markdown";
}): string {
  const { gap, payload, populationNarrative } = opts;

  const lines: string[] = [];
  lines.push(`## ${gap.description}`);
  lines.push("");
  lines.push(`**Page:** ${gap.page_url}`);
  lines.push(`**Current:** ${gap.current_state}`);
  lines.push(`**Target:** ${gap.target_state}`);
  if (gap.affected_page_count > 1) {
    lines.push(`**Scope:** ${gap.affected_page_count} pages have this same gap`);
  }
  lines.push("");

  if (populationNarrative) {
    lines.push("### Why this matters");
    lines.push(populationNarrative);
    lines.push("");
  }

  lines.push("### What to do");
  lines.push("");

  switch (payload.kind) {
    case "faq":
      lines.push("1. Add the following FAQ section to the page:");
      lines.push("");
      for (const q of payload.questions) {
        lines.push(`   **Q: ${q.question}**`);
        lines.push(`   A: ${q.answer_outline}`);
        lines.push("");
      }
      lines.push("2. Add this JSON-LD to the page `<head>`:");
      lines.push("");
      lines.push("```html");
      lines.push(payload.json_ld);
      lines.push("```");
      lines.push("");
      lines.push(`3. Placement: ${payload.placement}`);
      break;

    case "comparison":
      lines.push("1. Add this comparison table to the page:");
      lines.push("");
      lines.push("```html");
      lines.push(payload.html);
      lines.push("```");
      lines.push("");
      lines.push(`2. Fill in the data for each competitor: ${payload.competitors.join(", ")}`);
      lines.push(`3. Placement: ${payload.placement}`);
      break;

    case "schema":
      lines.push("1. Add this JSON-LD to the page `<head>`:");
      lines.push("");
      lines.push("```html");
      lines.push(payload.json_ld);
      lines.push("```");
      lines.push("");
      lines.push(`2. Placement: ${payload.placement}`);
      break;

    case "content":
      lines.push(`1. ${payload.outline}`);
      lines.push(`2. Placement: ${payload.placement}`);
      break;
  }

  lines.push("");
  lines.push("### Acceptance criteria");
  lines.push("");
  lines.push(`- [ ] ${gap.target_state}`);
  if (payload.kind === "faq") {
    lines.push("- [ ] FAQPage JSON-LD present and valid");
    lines.push("- [ ] No duplicate schema blocks");
  }
  if (payload.kind === "schema") {
    lines.push(`- [ ] ${payload.schema_type} JSON-LD present and valid`);
  }
  lines.push("- [ ] Mobile layout verified at 375px");
  lines.push("");
  lines.push("### Verification");
  lines.push("Beacon will re-scan this page within 24 hours and mark the move verified when all checks pass.");

  return lines.join("\n");
}

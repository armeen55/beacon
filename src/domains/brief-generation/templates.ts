import type { ProposedBriefType } from "./types";

type TemplateOutput = {
  requiredComponents: string[];
  recommendedSteps: string[];
  validationChecks: string[];
  successCriteria: string[];
  followThroughSignals: string[];
};

type TemplateContext = {
  targetCity: string | null;
  targetTopic: string | null;
  patternLabel: string | null;
  patternSuccessRate: number | null;
  opportunityLabel: string | null;
  hasCaveats: boolean;
  caveats: string[];
};

export function getTemplate(
  briefType: ProposedBriefType,
  ctx: TemplateContext
): TemplateOutput {
  switch (briefType) {
    case "coverage_expansion":
      return coverageExpansionTemplate(ctx);
    case "new_page":
      return newPageTemplate(ctx);
    case "page_rebuild":
      return pageRebuildTemplate(ctx);
    case "page_refresh":
      return pageRefreshTemplate(ctx);
    case "faq_upgrade":
      return faqUpgradeTemplate(ctx);
    case "schema_alignment":
      return schemaAlignmentTemplate(ctx);
    case "internal_linking":
      return internalLinkingTemplate(ctx);
    case "crawlability_fix":
      return crawlabilityFixTemplate(ctx);
    case "measurement_fix":
      return measurementFixTemplate(ctx);
  }
}

function coverageExpansionTemplate(ctx: TemplateContext): TemplateOutput {
  const city = ctx.targetCity ?? "target market";
  const topic = ctx.targetTopic ?? "target topic";

  return {
    requiredComponents: [
      `Unique, locally-relevant content for ${city}`,
      "City-specific service details, project examples, or neighborhood context",
      "LocalBusiness JSON-LD schema with accurate NAP",
      "Internal links from hub/parent pages",
      "Distinct meta title and description — not a keyword-swap template",
      "At least 3 unique local proof points (projects, testimonials, area knowledge)",
    ],
    recommendedSteps: [
      `Research ${city}-specific search demand and competition`,
      `Draft page with genuine local differentiation — not a template clone`,
      "Add LocalBusiness + areaServed schema",
      "Build internal link paths from parent service/city hub",
      "Submit to Google Search Console for indexing",
      "Monitor impressions and citations for 14–30 days",
    ],
    validationChecks: [
      "Page passes Google doorway-page heuristic: is it a real destination, not a funnel?",
      `Content is >60% unique vs. other city pages for "${topic}"`,
      "No keyword-swap patterns detectable across city variants",
      "Internal links are natural, not footer-wall spam",
      "Schema matches visible page content exactly",
      ...(ctx.hasCaveats
        ? ["CAVEAT CHECK: Verify that expansion does not create near-duplicate thin pages"]
        : []),
    ],
    successCriteria: [
      `Page indexed within 7 days`,
      `First impressions/citations within 14 days`,
      `Mention or citation on at least 1 AI platform within 30 days`,
      "No cannibalization detected with existing city pages",
    ],
    followThroughSignals: [
      "New result rows appear in Beacon for this city/topic",
      "Outcome events detected (first_mention, citation_gained, position_improvement)",
      "No indexation issues in Search Console",
    ],
  };
}

function newPageTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Clear primary intent mapping — one page, one job",
      "Unique substantive content (not thin or templated)",
      "Appropriate schema markup for the page type (for example Article, FAQPage, Service, or LocalBusiness only when applicable)",
      "Internal link integration with existing site hierarchy",
      "Meta tags targeting primary query intent",
    ],
    recommendedSteps: [
      "Validate search demand for target query/topic",
      "Check existing site for cannibalization risk",
      "Draft content with clear structure (H2s, lists, direct answers)",
      "Add structured data aligned with page content",
      "Build 2–3 internal links from contextually relevant pages",
      "Monitor indexation and initial impressions",
    ],
    validationChecks: [
      "Page serves a genuinely distinct intent from existing pages",
      "Content is substantive (not filler)",
      "Schema markup matches visible content",
      ...(ctx.hasCaveats
        ? ["CAVEAT CHECK: Verify intent does not overlap existing pages (cannibalization)"]
        : []),
    ],
    successCriteria: [
      "Page indexed and receiving impressions within 14 days",
      "No ranking drops on existing pages for related queries",
      "At least one AI platform citation within 30 days",
    ],
    followThroughSignals: [
      "Beacon detects new result rows for target topic",
      "Outcome events trigger for this page/topic",
    ],
  };
}

function pageRebuildTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Audit of current page performance and weaknesses",
      "Revised content structure targeting primary intent",
      "Updated schema markup",
      "Preserved or redirected existing URL equity",
      "Refreshed internal linking context",
    ],
    recommendedSteps: [
      "Export current performance metrics (impressions, citations, rankings)",
      "Identify structural weaknesses (thin content, poor structure, outdated info)",
      "Rebuild with improved content, structure, and schema",
      "Maintain same URL or implement proper 301 redirect",
      "Update internal links pointing to this page",
      "Monitor for performance recovery within 14–21 days",
    ],
    validationChecks: [
      "No accidental URL change without redirect",
      "Content quality measurably improved vs. old version",
      "Schema remains valid and accurate",
    ],
    successCriteria: [
      "Page maintains or improves existing ranking positions within 21 days",
      "Citation rate improves or maintains within 30 days",
      "No indexation issues post-rebuild",
    ],
    followThroughSignals: [
      "Beacon detects position improvement or sustained visibility",
      "No regression events on this result",
    ],
  };
}

function pageRefreshTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Identification of outdated or thin sections",
      "Fresh content additions targeting current search intent",
      "Schema review and update",
    ],
    recommendedSteps: [
      "Review current page for outdated information",
      "Add fresh, relevant sections or update existing ones",
      "Verify schema markup is current",
      "Request re-crawl via Search Console",
    ],
    validationChecks: [
      "Updates add genuine informational value",
      "No content removed that was driving existing traffic",
    ],
    successCriteria: [
      "Impressions or citations improve within 14 days of refresh",
      "Content freshness signal recognized by search engines",
    ],
    followThroughSignals: [
      "Beacon detects positive outcome events post-change",
    ],
  };
}

function faqUpgradeTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Real questions users actually ask (from search queries, reviews, sales calls)",
      "Specific, accurate answers — not filler or marketing copy",
      "FAQPage schema markup matching visible content exactly",
      "Page-specific questions — not generic FAQ blocks copy-pasted across pages",
    ],
    recommendedSteps: [
      "Research actual user questions for this topic/city/service",
      "Draft 4–6 high-quality Q&A pairs with specific, useful answers",
      "Add FAQPage JSON-LD schema matching visible FAQ content",
      "Position FAQ section where it supports page intent (not buried or dominant)",
      "Monitor for rich result eligibility and citation extraction",
    ],
    validationChecks: [
      "FAQ questions are genuinely local/topic-specific, not generic",
      "Answers are accurate, specific, and >2 sentences each",
      "FAQPage schema exactly matches visible FAQ text",
      "FAQ block is not identical across multiple pages",
      ...(ctx.hasCaveats
        ? [
            "CAVEAT CHECK: FAQ rich results are largely limited to authoritative/government sites since Aug 2023 — do not rely on rich results as primary benefit",
            "CAVEAT CHECK: FAQ content value is in answering real user questions, not in schema manipulation",
          ]
        : []),
    ],
    successCriteria: [
      "FAQ content addresses real user queries (validate via search console query data)",
      "AI platforms extract FAQ answers in citations within 30 days",
      "No thin-content or duplicate-FAQ signals",
    ],
    followThroughSignals: [
      "Beacon detects citation or mention events referencing FAQ content",
      "Search Console shows question-format queries matching FAQ",
    ],
  };
}

function schemaAlignmentTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Audit of current structured data across target pages",
      "Correct schema types (LocalBusiness, Service, FAQPage) per page",
      "Consistent NAP data across all LocalBusiness schemas",
      "Schema matches visible page content exactly",
    ],
    recommendedSteps: [
      "Audit structured data with Google Rich Results Test",
      "Fix mismatched or missing schema on target pages",
      "Ensure NAP consistency across all location schemas",
      "Validate all schemas pass structured data testing tool",
    ],
    validationChecks: [
      "All schemas pass Google Rich Results Test without errors",
      "Schema content matches visible page content",
      "No conflicting entity types on same page",
    ],
    successCriteria: [
      "Zero structured data errors in Search Console within 7 days",
      "Rich result eligibility maintained or gained",
    ],
    followThroughSignals: [
      "Search Console structured data report shows clean status",
    ],
  };
}

function internalLinkingTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Map of target pages and their current internal link profile",
      "Hub/spoke link architecture plan",
      "Contextual anchor text (not exact-match keyword spam)",
    ],
    recommendedSteps: [
      "Identify orphan or under-linked target pages",
      "Add contextual internal links from topically relevant parent/sibling pages",
      "Build hub page linking to all related city/service pages if not present",
      "Verify crawl path depth is <4 clicks from homepage",
    ],
    validationChecks: [
      "Links are contextually relevant, not footer/sidebar walls",
      "Anchor text is natural and varied",
      "No circular or broken internal links",
      "Target pages are discoverable within 3 clicks of homepage",
    ],
    successCriteria: [
      "Target pages crawled more frequently (verify via server logs or Search Console)",
      "Impressions improve on under-linked pages within 14–21 days",
    ],
    followThroughSignals: [
      "Beacon detects improved result metrics on previously under-linked pages",
    ],
  };
}

function crawlabilityFixTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Identification of exact crawlability issue (JS rendering, blocked resources, orphan pages)",
      "Server-side rendering or pre-rendering solution if JS-dependent",
      "Robots.txt and meta robots audit",
    ],
    recommendedSteps: [
      "Identify which pages are not being indexed or are rendered client-only",
      "Implement SSR/pre-rendering for critical content",
      "Fix robots.txt blocking or noindex directives",
      "Submit updated sitemap to Search Console",
      "Monitor crawl stats for improvement",
    ],
    validationChecks: [
      "Critical content is visible in raw HTML response (not JS-only)",
      "No accidental noindex or robots.txt blocks",
      "Sitemap is accurate and up-to-date",
      ...(ctx.hasCaveats
        ? ["CAVEAT CHECK: SSR alone does not fix weak content — ensure underlying content quality is sufficient"]
        : []),
    ],
    successCriteria: [
      "Previously un-indexed pages appear in Google index within 7–14 days",
      "Crawl stats in Search Console show improved coverage",
    ],
    followThroughSignals: [
      "New result rows appear in Beacon for previously invisible pages",
      "Index coverage report improves in Search Console",
    ],
  };
}

function measurementFixTemplate(ctx: TemplateContext): TemplateOutput {
  return {
    requiredComponents: [
      "Identification of exact attribution or matching gap",
      "Metadata improvements needed (topic alignment, platform tagging, URL accuracy)",
      "Changelog entry quality requirements",
    ],
    recommendedSteps: [
      "Audit changelog entries for missing or inaccurate metadata",
      "Fix topic, platform, and URL fields on affected changes",
      "Re-run attribution pipeline to verify improved matching",
      "Monitor candidate discovery quality for affected results",
    ],
    validationChecks: [
      "Changelog entries have accurate topic, platform, and URL metadata",
      "Candidate discovery finds plausible causes for previously unlinked events",
      "No false-positive matches introduced by metadata changes",
    ],
    successCriteria: [
      "Previously unlinked events now have candidate causes",
      "Attribution confidence improves for affected clusters",
      "Fewer 'no candidate' events in diagnostics",
    ],
    followThroughSignals: [
      "Beacon diagnostics show improved attribution coverage",
      "Cluster status changes from 'fix_data' to 'working' or 'review_now'",
    ],
  };
}

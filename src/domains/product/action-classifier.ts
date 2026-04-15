/**
 * Action Classifier — parses change descriptions into specific action classes.
 *
 * Stateless, operator-agnostic. Works for any site's changelog entries.
 * First matching rule wins (rules are ordered from most specific to least).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionClass =
  | "faq_addition"
  | "faq_expansion"
  | "faq_consolidation"
  | "comparison_table"
  | "schema_addition"
  | "schema_update"
  | "title_update"
  | "meta_update"
  | "hero_update"
  | "internal_links"
  | "content_section"
  | "page_creation"
  | "cost_section"
  | "process_section"
  | "testimonials"
  | "gallery_addition"
  | "cta_addition"
  | "breadcrumbs"
  | "neighborhoods_section"
  | "subheading_update"
  | "anchor_ids"
  | "robots_update"
  | "opengraph_update"
  | "proof_strip"
  | "video_addition"
  | "general_content";

export type ClassifiedAction = {
  actionClass: ActionClass;
  /** Human-readable label for the recommendation headline */
  label: string;
};

// ---------------------------------------------------------------------------
// Classification rules (ordered — first match wins)
// ---------------------------------------------------------------------------

const RULES: { pattern: RegExp; actionClass: ActionClass; label: string }[] = [
  // Page creation (most specific — before content matches)
  { pattern: /\bcreated\s+new\s+.*\bpage\b|\bbuilt\s+and\s+published\s+.*\bpage\b|\bnew\s+standalone\s+landing\s+page\b/i, actionClass: "page_creation", label: "Create new page" },

  // FAQ patterns
  { pattern: /\bremoved?\s+duplicate\s+faq|\bconsolidated\s+.*\bfaq|\bmerged?\s+.*\bfaq\s+block/i, actionClass: "faq_consolidation", label: "Consolidate FAQ blocks" },
  { pattern: /\bexpand(?:ed)?\s+faq|\badditional\s+(?:faq|q&a)\s+question|\bdeepen(?:ed)?\s+faq\s+answer/i, actionClass: "faq_expansion", label: "Expand FAQ answers" },
  { pattern: /\bfaq\b.*\bsection\b|\badded?\s+\d+-question\b|\bq&a\b.*\bblock\b|\bfaq\b.*\bheading|\binserted?\s+faq/i, actionClass: "faq_addition", label: "Add FAQ section" },

  // Comparison / competitive content
  { pattern: /\bcomparison\s+(?:table|section|chart|grid)\b|\bbuilder\s+comparison\b|\bvs\b.*\bsection\b/i, actionClass: "comparison_table", label: "Add comparison table" },

  // Schema / structured data
  { pattern: /\bschema\b.*\bupdat|\bschema\b.*\brevised|\bschema\b.*\bconsolidat/i, actionClass: "schema_update", label: "Update structured data" },
  { pattern: /\bjson-ld\b|\bschema\b.*\badded|\bfaqpage\b.*\bschema\b|\bstructured\s+data\b|\bbreadcrumblist\b.*\bschema\b/i, actionClass: "schema_addition", label: "Add structured data" },

  // Title / meta / OG
  { pattern: /\bset\s+title\s+tag\b|\btitle\s+(?:tag\s+)?to\b|\bupdated?\s+(?:page\s+)?title\b/i, actionClass: "title_update", label: "Update title tag" },
  { pattern: /\bmeta\s+desc(?:ription)?\b|\bog\s+tags?\b|\bopen\s*graph\b/i, actionClass: "meta_update", label: "Update meta description" },
  { pattern: /\brobots?\b.*\bindex|\bnoindex\b|\bcanonical\b/i, actionClass: "robots_update", label: "Update robots/canonical" },

  // Hero / subheading
  { pattern: /\bhero\b.*\b(?:section|card|image|banner)\b|\bhero\s+h[12]\b/i, actionClass: "hero_update", label: "Update hero section" },
  { pattern: /\bh1\b.*\bsubtitle\b|\bsubheading\b|\bh2\s+beneath\s+h1\b|\brevised?\s+(?:hero\s+)?h1\b/i, actionClass: "subheading_update", label: "Update page subheading" },

  // Specific content sections
  { pattern: /\bcost\b.*\b(?:section|breakdown|block|table)\b|\bpricing\b.*\bsection\b/i, actionClass: "cost_section", label: "Add cost breakdown" },
  { pattern: /\bprocess\b.*\b(?:section|step|timeline)\b|\bour\s+process\b/i, actionClass: "process_section", label: "Add process section" },
  { pattern: /\bneighborhood\b.*\bsection\b|\bcity\b.*\bgrid\b|\blocation\b.*\bgrid\b/i, actionClass: "neighborhoods_section", label: "Add neighborhoods section" },
  { pattern: /\btestimonial\b|\breview\b.*\bsection\b|\bclient\s+(?:story|stories|quote)/i, actionClass: "testimonials", label: "Add testimonials" },
  { pattern: /\bgallery\b.*\bsection\b|\b\d+-image\s+gallery\b|\bphoto\s+gallery\b/i, actionClass: "gallery_addition", label: "Add image gallery" },
  { pattern: /\bvideo\b.*\b(?:section|embed|block)\b|\byoutube\b|\bvideoobject\b/i, actionClass: "video_addition", label: "Add video section" },
  { pattern: /\bcta\b|\bcall\s+to\s+action\b|\bcontact\s+form\b.*\bsection/i, actionClass: "cta_addition", label: "Add call-to-action" },
  { pattern: /\bproof\s+strip\b|\btrust\s+(?:bar|strip|badge)\b|\baward\b.*\bstrip/i, actionClass: "proof_strip", label: "Add proof strip" },
  { pattern: /\bbreadcrumb\b/i, actionClass: "breadcrumbs", label: "Add breadcrumbs" },
  { pattern: /\banchor\s+id/i, actionClass: "anchor_ids", label: "Add anchor IDs" },

  // Links
  { pattern: /\binternal\s+(?:section\s+)?link|\badded?\s+(?:\d+\s+)?link.*\bpointing\b/i, actionClass: "internal_links", label: "Add internal links" },

  // Generic content (broad — near the end)
  { pattern: /\bcontent\b.*\b(?:section|block|update|edit|revise)\b|\bapplied?\s+content\b|\bcopy\b.*\bedit/i, actionClass: "content_section", label: "Update content section" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function classifyChangeDescription(description: string): ClassifiedAction {
  const lower = description.toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(lower)) {
      return { actionClass: rule.actionClass, label: rule.label };
    }
  }
  return { actionClass: "general_content", label: "Update content" };
}

/**
 * Infer a human-readable move label from a signal_type when no change
 * description is available (e.g., pattern-driven recommendations).
 */
export function inferMoveFromSignalType(
  signalType: string,
  _assetType?: string,
): ClassifiedAction {
  switch (signalType) {
    case "faq":
      return { actionClass: "faq_addition", label: "Add FAQ section" };
    case "technical":
      return { actionClass: "schema_addition", label: "Add structured data" };
    case "content":
      return { actionClass: "content_section", label: "Enhance content sections" };
    case "citation":
      return { actionClass: "internal_links", label: "Strengthen citation sources" };
    default:
      return { actionClass: "general_content", label: "Update content" };
  }
}

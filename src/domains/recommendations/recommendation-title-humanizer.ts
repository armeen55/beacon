/**
 * W3 Step 3.5d (2026-05-02) — recommendation-title humanizer.
 *
 * Operator browser audits (2026-05-02 × 3) flagged that titles
 * still leaked raw prompt copy or scenario-class fallbacks ("Create
 * a page for this comparison scenario") that read cheap. Operator
 * locked a domain-specific topic-tag set + geo extraction so titles
 * ship as concrete operator actions:
 *
 *   "If I buy a property with an older house"      →
 *     vacant-lot custom home / older-home rebuild  ←  topic tag
 *   "best builders in Atherton"                    →  Atherton ←  geo
 *   create_new_page + topic + geo                  →
 *     "Create an Atherton older-home rebuild page"
 *
 * Pure / deterministic. The W3 Step 3.4 LLM `operatorTitle` still
 * wins when the adjudicator emits one (`buildResolvedRecommendationTitle`
 * already short-circuits there). This humanizer is the deterministic
 * fallback when no LLM title exists — which is most recs in a young
 * deployment.
 */

import { titleCase } from "./providers/generators/_text-utils";
import type {
  PageIntentResolution,
  RecommendationAction,
} from "./resolved-types";
import { NEEDS_NEW_PAGE } from "./resolved-types";

// ── Topic patterns (operator-locked) ────────────────────────────────────

/**
 * Topic tag descriptors. Operator scope (W3 §3.5d.7):
 *   vacant lot                   → "vacant-lot custom home"
 *   older house / rebuild /
 *     teardown                   → "older-home rebuild"
 *   architect vs design-build    → "design-build vs architect"
 *   completed plans              → "completed-plans handoff"
 *   steep lot / soil             → "steep-lot feasibility"
 *   major structural remodel     → "structural remodel"
 *   modernizing old home         → "modernizing older homes"
 *   cost                         → "cost planning"
 *   permit                       → "permitting"
 *
 * Order matters — the FIRST match wins so more specific patterns
 * (e.g., "architect vs design-build") fire before generic ones
 * (e.g., "cost"). Each tag carries:
 *   - `topic`: the operator-readable phrase used in titles
 *   - `triggers`: regex patterns. ANY trigger firing tags the rec.
 *   - `priority`: lower numbers win ties.
 */
type TopicTag = {
  readonly id: string;
  readonly topic: string;
  readonly triggers: ReadonlyArray<RegExp>;
  readonly priority: number;
};

const TOPIC_TAGS: ReadonlyArray<TopicTag> = [
  // Decision/comparison topics — most specific, fire first.
  {
    id: "design_build_vs_architect",
    topic: "design-build vs architect",
    priority: 1,
    triggers: [
      /\bdesign[-\s]?build\b.*\barchitect\b/i,
      /\barchitect\b.*\bdesign[-\s]?build\b/i,
      /\barchitect[-\s]?led\b/i,
    ],
  },
  // Project-scenario topics
  {
    id: "completed_plans_handoff",
    topic: "completed-plans handoff",
    priority: 2,
    triggers: [
      /\bcompleted? (?:architectural )?plans?\b/i,
      /\bbuild from .+ plans?\b/i,
      /\bplans? (?:in hand|already done|complete)\b/i,
    ],
  },
  {
    id: "vacant_lot_custom_home",
    topic: "vacant-lot custom home",
    priority: 2,
    triggers: [
      /\bvacant lot\b/i,
      /\bempty lot\b/i,
      /\braw land\b/i,
      /\bbuild on .+ lot\b/i,
    ],
  },
  {
    id: "steep_lot_feasibility",
    topic: "steep-lot feasibility",
    priority: 2,
    triggers: [
      /\bsteep lot\b/i,
      /\bsteep slope\b/i,
      /\bhillside\b/i,
      /\bsoil (?:report|test|condition)/i,
      /\bgeotech/i,
    ],
  },
  // Older / teardown / rebuild family
  {
    id: "older_home_rebuild",
    topic: "older-home rebuild",
    priority: 3,
    triggers: [
      /\bteardown\b/i,
      /\btear[-\s]?down\b/i,
      /\bolder (?:home|house)\b/i,
      /\bold (?:home|house)\b/i,
      /\brebuild\b/i,
      /\bdemolish .+ rebuild\b/i,
    ],
  },
  {
    id: "modernizing_older_homes",
    topic: "modernizing older homes",
    priority: 3,
    triggers: [
      /\bmoderniz(?:e|ing|ation)\b/i,
      /\bupdate an? (?:older|old) (?:home|house)\b/i,
      /\bbring(?:ing)? .+ (?:up to date|to current code)\b/i,
    ],
  },
  // Remodel scope
  {
    id: "structural_remodel",
    topic: "structural remodel",
    priority: 4,
    triggers: [
      /\bmajor (?:structural |whole[-\s]?home )?remodel\b/i,
      /\bstructural (?:remodel|renovation|change|work)\b/i,
      /\bload[-\s]?bearing\b/i,
      /\bwhole[-\s]?home (?:remodel|renovation)\b/i,
    ],
  },
  // Cost / permit operational topics
  {
    id: "cost_planning",
    topic: "cost planning",
    priority: 5,
    triggers: [
      /\bcost(?:s|ing)?\b/i,
      /\bbudget(?:ing)?\b/i,
      /\bprice (?:per|of)\b/i,
      /\bhow much\b/i,
      /\baffordable?\b/i,
    ],
  },
  {
    id: "permitting",
    topic: "permitting",
    priority: 5,
    triggers: [
      /\bpermit(?:s|ting)?\b/i,
      /\bzoning\b/i,
      /\bplanning department\b/i,
    ],
  },
  // Kitchen / bath specific
  {
    id: "kitchen_remodel",
    topic: "kitchen remodel",
    priority: 6,
    triggers: [/\bkitchen (?:remodel|renovation|reno)\b/i, /\bkitchen redo\b/i],
  },
  {
    id: "bathroom_remodel",
    topic: "bathroom remodel",
    priority: 6,
    triggers: [/\bbath(?:room)? (?:remodel|renovation|reno)\b/i],
  },
  // Generic remodel / renovation
  {
    id: "renovation",
    topic: "renovation",
    priority: 7,
    triggers: [/\brenovat(?:e|ion|ing)\b/i, /\bremodel(?:ing)?\b/i],
  },
  // Generic custom home
  {
    id: "custom_home",
    topic: "custom home",
    priority: 8,
    triggers: [
      /\bcustom (?:home|house)\b/i,
      /\bnew construction\b/i,
      /\bground[-\s]?up build/i,
    ],
  },
];

/**
 * Detect the highest-priority topic tag in a label. Returns null
 * when no tag matches; caller falls back to a generic phrase.
 *
 * Pure / deterministic. Case-insensitive matching.
 */
export function extractTopicTag(label: string): string | null {
  if (typeof label !== "string" || label.trim().length === 0) return null;
  // Sort by priority ASC; first match wins.
  const sorted = [...TOPIC_TAGS].sort((a, b) => a.priority - b.priority);
  for (const tag of sorted) {
    for (const re of tag.triggers) {
      if (re.test(label)) return tag.topic;
    }
  }
  return null;
}

// ── Geo patterns ────────────────────────────────────────────────────────

/**
 * Bay Area cities Beacon tracks (operator-curated). Used to extract
 * geographic context from cluster labels. Order doesn't matter; the
 * first city matched in the label wins.
 */
const BAY_AREA_CITIES: ReadonlyArray<string> = [
  "Atherton",
  "Palo Alto",
  "Los Altos",
  "Los Altos Hills",
  "Menlo Park",
  "Woodside",
  "Portola Valley",
  "Mountain View",
  "Cupertino",
  "Saratoga",
  "Los Gatos",
  "Hillsborough",
  "Belmont",
  "San Carlos",
  "Burlingame",
  "Redwood City",
  "San Mateo",
  "Sunnyvale",
];

/**
 * Extract a Bay Area city name from a label. Returns the city in
 * its canonical capitalization, or null when no city is mentioned.
 *
 * Word-boundary anchored so "Mountain View" matches in "best
 * builders Mountain View" but not in "Mountainview" (one word).
 */
export function extractGeoTag(label: string): string | null {
  if (typeof label !== "string" || label.length === 0) return null;
  for (const city of BAY_AREA_CITIES) {
    const re = new RegExp(`\\b${escapeRegex(city)}\\b`, "i");
    if (re.test(label)) return city;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── URL → page-name slug humanizer ──────────────────────────────────────

/**
 * Derive a short readable page name from a target URL path. Used in
 * "Add X to the {page} page" / "Strengthen the {page} page" titles.
 *
 *   /services/whole-home-remodel    → "Whole Home Remodel"
 *   /locations/palo-alto            → "Palo Alto"
 *   /custom-home-builder-bay-area   → "Custom Home Builder"
 *   /                               → "homepage"
 *   (anything unparseable)          → "target page"
 */
export function pageNameFromUrl(url: string | null): string {
  if (!url || url === NEEDS_NEW_PAGE) return "target page";
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  if (path === "" || path === "/") return "homepage";
  // Pick the LAST segment (most specific).
  const segments = path.split("/").filter((s) => s.length > 0);
  const last = segments[segments.length - 1] ?? "";
  if (last.length === 0) return "target page";
  // Common geo / regional suffixes — drop them so "custom-home-
  // builder-bay-area" becomes "Custom Home Builder" (the suffix
  // already lives in the geo tag if relevant).
  const stripped = last.replace(/-bay-area$/i, "");
  // hyphen → space, title-case via existing helper.
  const phrase = stripped.replace(/-/g, " ").trim();
  if (phrase.length === 0) return "target page";
  return titleCase(phrase);
}

// ── Title composer ─────────────────────────────────────────────────────

export type HumanizeRecTitleArgs = {
  readonly clusterLabel: string | null;
  /** Promtp text fallback when clusterLabel is null/empty. */
  readonly promptTextFallback?: string | null;
  readonly resolution?: PageIntentResolution | null;
};

/**
 * Build an operator-facing title from a rec's cluster + resolution.
 *
 * Priority:
 *   1. resolution.operatorTitle (LLM-emitted) wins if present.
 *      `buildResolvedRecommendationTitle` already does this; this
 *      humanizer is the deterministic fallback.
 *   2. Detect topic tag + geo tag from the cluster label.
 *   3. Compose action-specific copy:
 *        create_new_page          → "Create a {Geo} {topic} page"
 *        expand_existing_page     → "Add a {topic} section to the {page}"
 *        strengthen_existing_page → "Strengthen the {page} for {topic} searches"
 *        merge_or_dedupe          → "Merge owned pages into the {page}"
 *        split_or_separate_page   → "Split the {page} into a dedicated {topic} page"
 *        watch                    → "Watch the {topic} cluster"
 *        needs_review             → "Review {topic} opportunity"
 *        add_section_or_faq       → "Add a {topic} section to the {page}"
 *
 * Pure / deterministic. Case-insensitive topic detection. Returns
 * a non-empty string for every input — falls back to operator-
 * readable defaults when no topic / no geo / no URL is available.
 */
export function humanizeRecTitle(args: HumanizeRecTitleArgs): string {
  const resolution = args.resolution ?? null;
  // (1) Operator title wins.
  if (
    resolution?.operatorTitle &&
    resolution.operatorTitle.trim().length > 0
  ) {
    return resolution.operatorTitle.trim();
  }

  const action: RecommendationAction =
    resolution?.action ?? "create_new_page";
  const labelSource =
    (args.clusterLabel ?? args.promptTextFallback ?? "").trim();
  const topic = extractTopicTag(labelSource);
  const geo = extractGeoTag(labelSource);

  const targetUrl =
    resolution?.targetUrl && resolution.targetUrl !== NEEDS_NEW_PAGE
      ? resolution.targetUrl
      : null;
  const pageName = pageNameFromUrl(targetUrl);

  // Compose by action.
  switch (action) {
    case "create_new_page":
      return composeCreatePageTitle(geo, topic);
    case "expand_existing_page":
    case "add_section_or_faq":
      return composeAddSectionTitle(topic, pageName);
    case "strengthen_existing_page":
      return composeStrengthenTitle(topic, pageName);
    case "merge_or_dedupe":
      return targetUrl
        ? `Merge owned pages into the ${pageName}`
        : "Merge overlapping owned pages";
    case "split_or_separate_page":
      return targetUrl
        ? `Split the ${pageName} into a dedicated ${topic ?? "scenario"} page`
        : `Split a bundled page into a dedicated ${topic ?? "scenario"} page`;
    case "watch":
      return topic
        ? `Watch the ${topic} cluster`
        : "Watch a winning cluster";
    case "needs_review":
      return topic
        ? `Review the ${topic} opportunity`
        : "Review a recommendation";
    default:
      return composeCreatePageTitle(geo, topic);
  }
}

function composeCreatePageTitle(
  geo: string | null,
  topic: string | null,
): string {
  if (geo && topic) {
    // "Create an Atherton older-home rebuild page"
    return `Create ${articleFor(geo)} ${geo} ${topic} page`;
  }
  if (topic) {
    return `Create ${articleFor(topic)} ${topic} page`;
  }
  if (geo) {
    return `Create a ${geo} services page`;
  }
  // Last-resort fallback per operator scope: don't quote raw prompt.
  return "Create a page for this scenario";
}

function composeAddSectionTitle(
  topic: string | null,
  pageName: string,
): string {
  if (topic) {
    return `Add a ${topic} section to the ${pageName} page`;
  }
  return `Add a new section to the ${pageName} page`;
}

function composeStrengthenTitle(
  topic: string | null,
  pageName: string,
): string {
  if (topic) {
    return `Strengthen the ${pageName} page for ${topic} searches`;
  }
  return `Strengthen the ${pageName} page`;
}

/**
 * Pick "a" vs "an" based on the next word's first sound. Naive
 * vowel-only check; good enough for the topic / geo set we ship.
 */
function articleFor(nextWord: string): "a" | "an" {
  const c = nextWord.trim().charAt(0).toLowerCase();
  return /[aeiou]/.test(c) ? "an" : "a";
}

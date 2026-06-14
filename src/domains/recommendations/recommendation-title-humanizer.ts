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
  // Whole-home renovation specific (Beacon-tracked cluster name) —
  // priority 6 so it beats the generic "renovation" tag without
  // racing the more-specific structural / kitchen / bathroom paths.
  {
    id: "whole_home_renovation",
    topic: "whole-home renovation",
    priority: 6,
    triggers: [
      /\bwhole[-\s]?home (?:renovation|remodel)\b/i,
      /\bwhole[-\s]?house (?:renovation|remodel)\b/i,
      /\bcomplete whole[-\s]?home/i,
    ],
  },
  // Generic remodel / renovation
  {
    id: "renovation",
    topic: "renovation",
    priority: 7,
    triggers: [/\brenovat(?:e|ion|ing)\b/i, /\bremodel(?:ing)?\b/i],
  },
  // Luxury / high-end (cluster topic seen in production) — priority 7
  // so a label like "Custom Home Builder Bay Area" maps via the
  // higher-priority custom_home pattern, but luxury labels get a
  // friendlier topic phrase.
  {
    id: "luxury_custom_home",
    topic: "luxury custom home",
    priority: 7,
    triggers: [
      /\bluxury (?:custom )?(?:home|house|build)/i,
      /\bhigh[-\s]?end (?:custom )?(?:home|house|build)/i,
      /\$\d+M\+/,
    ],
  },
  // Generic custom home
  {
    id: "custom_home",
    topic: "custom home",
    priority: 8,
    triggers: [
      /\bcustom (?:home|house|home builder)\b/i,
      /\bnew construction\b/i,
      /\bground[-\s]?up build/i,
    ],
  },
];

/**
 * #149-sibling (2026-06-11): match a label against the TENANT'S OWN
 * service phrases (BusinessConfig.services) — longest phrase first,
 * word-boundary anchored. The matched phrase IS the topic ("taco bar"),
 * so any vertical gets correct topics from its own vocabulary.
 */
function matchKnownService(
  label: string,
  knownServices: ReadonlyArray<string>,
): string | null {
  const phrases = [...knownServices]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i");
    if (re.test(label)) return phrase;
  }
  return null;
}

/**
 * Detect the highest-priority topic tag in a label. Returns null
 * when no tag matches; caller falls back to a generic phrase.
 *
 * Pure / deterministic. Case-insensitive matching.
 *
 * #149-sibling (2026-06-11): the tenant's own service phrases
 * (`knownServices`, from BusinessConfig.services) are tried FIRST —
 * tenant vocabulary beats the builder tag table. The builder TOPIC_TAGS
 * remain as the fallthrough: their patterns are builder-specific, so
 * they're a no-op for other verticals and exact parity for un-threaded
 * callers (founder/Ritz).
 */
export function extractTopicTag(
  label: string,
  knownServices?: ReadonlyArray<string>,
): string | null {
  if (typeof label !== "string" || label.trim().length === 0) return null;
  if (knownServices && knownServices.length > 0) {
    const fromServices = matchKnownService(label, knownServices);
    if (fromServices) return fromServices;
  }
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
  // City name sort matters: longer, more-specific names FIRST so
  // "Los Altos Hills" beats "Los Altos" and "Bay Area" never beats
  // a real city.
  "Los Altos Hills",
  "Atherton",
  "Palo Alto",
  "Los Altos",
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
  // Bay-Area-wide marker — used as a fallback when no individual
  // city is mentioned. Lower than every named city so a phrase like
  // "Atherton custom home Bay Area" still surfaces "Atherton".
  "Bay Area",
];

/**
 * Extract a city name from a label. Returns the city in its canonical
 * capitalization, or null when no city is mentioned.
 *
 * North-star de-hardcoding #149 (2026-06-11): the city vocabulary is an
 * INJECTED per-tenant list (`knownCities` — BusinessConfig.locations,
 * threaded from the server page through the action-row builder). The
 * Bay-Area list above remains ONLY as the legacy default for
 * un-threaded callers (founder/Ritz parity) — a Tucson restaurant's
 * labels match Tucson, never Atherton. Injected lists are matched
 * longest-name-first so "Los Altos Hills" beats "Los Altos" regardless
 * of the order the tenant listed them.
 *
 * Word-boundary anchored so "Mountain View" matches in "best
 * builders Mountain View" but not in "Mountainview" (one word).
 */
export function extractGeoTag(
  label: string,
  knownCities?: ReadonlyArray<string>,
): string | null {
  if (typeof label !== "string" || label.length === 0) return null;
  // undefined = un-threaded caller → legacy Bay-Area default (founder
  // parity). An INJECTED EMPTY list means "this tenant has no geo
  // vocabulary" (content publishers) and matches NOTHING — it must not
  // fall back to another tenant's cities.
  const cities =
    knownCities === undefined
      ? BAY_AREA_CITIES
      : [...knownCities]
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
          .sort((a, b) => b.length - a.length);
  for (const city of cities) {
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

// ── Topic-from-prompts (used when cluster label is geo-only or thin) ────

/**
 * Scan a list of prompt texts for the highest-priority topic. Returns
 * the operator-readable topic phrase, or null when no pattern matches
 * any prompt.
 *
 * This is the bridge that turns geo-only clusters ("Atherton") into
 * concrete titles when the prompt set covers a coherent scenario
 * ("design-build vs architect", "vacant-lot custom home", etc.).
 *
 * Pure / deterministic. Order doesn't depend on input order — we
 * always sort topic tags by priority ASC and return the first hit.
 */
export function extractTopicFromPrompts(
  prompts: ReadonlyArray<string>,
  knownServices?: ReadonlyArray<string>,
): string | null {
  if (!Array.isArray(prompts) || prompts.length === 0) return null;
  // #149-sibling: tenant service phrases first (see extractTopicTag).
  if (knownServices && knownServices.length > 0) {
    for (const text of prompts) {
      if (typeof text !== "string") continue;
      const fromServices = matchKnownService(text, knownServices);
      if (fromServices) return fromServices;
    }
  }
  const sorted = [...TOPIC_TAGS].sort((a, b) => a.priority - b.priority);
  for (const tag of sorted) {
    for (const re of tag.triggers) {
      for (const text of prompts) {
        if (typeof text === "string" && re.test(text)) return tag.topic;
      }
    }
  }
  return null;
}

// ── Cluster-label sanitizer (Beacon-tracked label noise → clean phrase) ──

/**
 * Beacon's cluster-builder occasionally emits labels like
 * "Shield: Custom Home Builder Bay Area" or
 * "Whole Home Renovation Builders (Bay Area)". The colon-prefixed
 * "Shield:" is an internal namespacing marker; the trailing
 * "(Bay Area)" / "Builders" / "Bay Area" suffixes carry duplicated
 * geo / category info that the title composer doesn't need.
 *
 * Returns a clean phrase suitable for a title. May still return an
 * empty string if everything was sanitized away.
 */
export function sanitizeClusterLabel(label: string): string {
  if (typeof label !== "string") return "";
  let s = label.trim();
  // Strip leading "Shield:" / "Brand:" / "Topic:" namespace prefix.
  s = s.replace(/^\s*(?:Shield|Topic|Brand|Category):\s+/i, "");
  // Drop parenthetical suffix "(Bay Area)" / "(Region)" / etc.
  s = s.replace(/\s*\([^)]*\)\s*$/g, "");
  // Drop trailing geographic suffix.
  s = s.replace(/\s+Bay Area$/i, "");
  // Drop trailing "Builders" / "Builder" / "Companies" — those are
  // category nouns embedded in a label, not part of the topic.
  s = s.replace(/\s+(Builders?|Companies|Contractors?|Firms?)$/i, "");
  return s.trim();
}

// ── Display-label cleaner (strip H2:/FAQ:/Title:/Meta: prefixes) ────────

/**
 * Strip leading taxonomy prefixes from an edit's `display_label` so
 * the row title doesn't render `Add an H2 "H2: …"` (the operator-
 * caught duplicate). Also strips matched outer quotes (curly or
 * straight) so the caller can re-quote consistently.
 *
 * Examples (operator-locked):
 *   `H2: Architect-led design-build advantage` →
 *     `Architect-led design-build advantage`
 *   `H2 heading (new): "Why teams choose us over De Mattei"` →
 *     `Why teams choose us over De Mattei`
 *   `New FAQ: "I own a vacant lot in Los Altos…"` →
 *     `I own a vacant lot in Los Altos…`
 *   `FAQ answer: Architect-led firm benefits` →
 *     `Architect-led firm benefits`
 *   `Architect-recommended builders for whole-home renovations` →
 *     `Architect-recommended builders for whole-home renovations` (unchanged)
 *
 * Returns an empty string when the cleaner removed everything.
 */
export function cleanDisplayLabel(
  label: string | null | undefined,
): string {
  if (typeof label !== "string") return "";
  let s = label.trim();
  if (s.length === 0) return "";
  // Strip a typed prefix like `H2:`, `FAQ:`, `Title:`, `Meta:`,
  // optionally with a parenthetical qualifier (`H2 heading (new):`,
  // `New FAQ:`, `FAQ answer:`, `FAQ question:`).
  const PREFIX_RE =
    /^(?:new\s+)?(?:h[1-6]|h[1-6]\s+heading|title|meta|meta\s+description|faq(?:\s+(?:question|answer))?|schema|section|copy)(?:\s*\([^)]*\))?\s*:\s*/i;
  for (let i = 0; i < 3; i += 1) {
    // Apply twice in case the label nests prefixes (e.g.,
    // "New FAQ: H2: …" — defensive).
    const stripped = s.replace(PREFIX_RE, "");
    if (stripped === s) break;
    s = stripped;
  }
  // Strip a single layer of matched outer quotes.
  s = stripOuterQuotes(s).trim();
  // Drop trailing ellipsis / horizontal-ellipsis the persistence
  // layer adds when truncating long labels — they're noise in titles.
  s = s.replace(/\s*[…\.]{1,3}$/g, "").trim();
  // W3 §3.15 (operator scope, 2026-05-04): strip trailing noise
  // qualifiers the persistence layer or the LLM adds — `(new)`,
  // `(new H2)`, `(new FAQ)`, `(question)`, `(answer)`. ONLY these
  // exact tokens are removed; legitimate parentheticals like
  // `(no footprint increase)` are preserved.
  const NOISE_TAGS = new Set([
    "new",
    "new h2",
    "new h3",
    "new faq",
    "new section",
    "question",
    "answer",
    // wave-12 buyer's-eye (2026-06-14): the bare (non-"new") type tags also
    // leaked to the customer queue — e.g. "Design-build for modern Bay Area
    // homes (H2)". They're redundant noise (the row already shows a TYPE
    // column + the top-pick appends the type), so strip them like the "new"
    // forms. Only unambiguous content-type tags — never a real parenthetical
    // like "(no footprint increase)".
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "faq",
    "section",
  ]);
  for (let i = 0; i < 3; i += 1) {
    const m = s.match(/\s*\(([^()]*)\)\s*$/);
    if (!m) break;
    const inner = m[1].trim().toLowerCase();
    if (!NOISE_TAGS.has(inner)) break;
    s = s.slice(0, m.index ?? s.length).trim();
  }
  // NB: only PARENTHESIZED type tags are treated as noise. A BARE trailing
  // token (e.g. "Working H2") is preserved as legitimate content — pinned by
  // recommendation-action-rows-faq-grouping.test.ts. (A bare "H2" that's
  // actually an artifact — e.g. the Atherton label — is a generation-side
  // issue, not a display one; the display layer must not guess.)
  return s;
}

/**
 * Strip ONE layer of matched outer quotes from a string. Handles
 * straight (`"…"`), curly (`"…"`), and single quotes (`'…'`). Returns
 * the original string when there's no matched pair.
 */
function stripOuterQuotes(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  const PAIRS: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"], // smart double quotes
    ["'", "'"],
    ["‘", "’"], // smart single quotes
  ];
  for (const [open, close] of PAIRS) {
    if (first === open && last === close) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

// ── Title composer ─────────────────────────────────────────────────────

export type HumanizeRecTitleArgs = {
  readonly clusterLabel: string | null;
  /** Prompt text fallback when clusterLabel is null/empty. */
  readonly promptTextFallback?: string | null;
  /** Optional list of prompt texts on the affected cluster. When
   *  cluster label + fallback don't yield a topic tag, we scan these
   *  for the highest-priority topic. */
  readonly affectedPromptTexts?: ReadonlyArray<string>;
  readonly resolution?: PageIntentResolution | null;
  /** #149 (2026-06-11): per-tenant city vocabulary
   *  (BusinessConfig.locations). Absent → legacy Bay-Area default. */
  readonly knownCities?: ReadonlyArray<string>;
  /** #149-sibling: per-tenant service phrases (BusinessConfig.services)
   *  — tried before the builder topic table. */
  readonly knownServices?: ReadonlyArray<string>;
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
  // Topic ladder:
  //   1. Topic in cluster label / prompt fallback (high-priority match).
  //   2. Topic in any affected prompt (W3 §3.5f — geo-only clusters
  //      like "Atherton" yield "design-build vs architect" once we
  //      look at the prompts that fall under them).
  const topic =
    extractTopicTag(labelSource, args.knownServices) ??
    extractTopicFromPrompts(args.affectedPromptTexts ?? [], args.knownServices);
  const geo =
    extractGeoTag(labelSource, args.knownCities) ??
    extractGeoTag((args.affectedPromptTexts ?? []).join(" "), args.knownCities);
  const sanitizedLabel = sanitizeClusterLabel(args.clusterLabel ?? "");

  const targetUrl =
    resolution?.targetUrl && resolution.targetUrl !== NEEDS_NEW_PAGE
      ? resolution.targetUrl
      : null;
  const pageName = pageNameFromUrl(targetUrl);

  // Compose by action.
  switch (action) {
    case "create_new_page":
      return composeCreatePageTitle({
        geo,
        topic,
        clusterPhrase: sanitizedLabel,
      });
    case "expand_existing_page":
    case "add_section_or_faq":
      return composeAddSectionTitle({ topic, pageName, geo });
    case "strengthen_existing_page":
      return composeStrengthenTitle({ topic, pageName });
    case "merge_or_dedupe":
      return targetUrl
        ? `Merge overlapping pages into the ${pageName} page`
        : "Merge overlapping owned pages";
    case "split_or_separate_page":
      // Use a "decision" verb so review-style copy reads as a real
      // operator decision, not a vague opportunity. The decision-row
      // composer in the action-rows builder layers more context.
      return targetUrl
        ? topic
          ? `Decide whether to split the ${pageName} page into a dedicated ${topic} page`
          : `Decide whether to split the ${pageName} page`
        : topic
          ? `Decide whether to split off a dedicated ${topic} page`
          : `Decide whether to split a bundled page`;
    case "watch":
      return topic
        ? `Watch the ${topic} cluster`
        : "Watch a winning cluster";
    case "needs_review":
      // Operator-locked (Step 3.5f): never "this opportunity" /
      // "this scenario". Prefer topic + geo + page.
      if (topic && geo) return `Decide direction for ${geo} ${topic}`;
      if (topic) return `Decide direction for ${topic}`;
      if (targetUrl) return `Review this ${pageName} page opportunity`;
      return "Review this page opportunity";
    default:
      return composeCreatePageTitle({
        geo,
        topic,
        clusterPhrase: sanitizedLabel,
      });
  }
}

function composeCreatePageTitle(args: {
  readonly geo: string | null;
  readonly topic: string | null;
  readonly clusterPhrase: string;
}): string {
  const { geo, topic } = args;
  // Decision-style topics ("design-build vs architect", "older-home
  // rebuild", "completed-plans handoff") read better with a "decision
  // page" suffix.
  const isDecisionTopic =
    topic !== null &&
    (topic.includes(" vs ") ||
      topic.endsWith(" rebuild") ||
      topic.endsWith(" handoff") ||
      topic.endsWith(" feasibility"));
  const suffix = isDecisionTopic ? "decision page" : "page";

  if (geo && topic) {
    // "Create an Atherton design-build vs architect decision page"
    // "Create an Atherton older-home rebuild decision page"
    return `Create ${articleFor(geo)} ${geo} ${topic} ${suffix}`;
  }
  if (topic) {
    return `Create ${articleFor(topic)} ${topic} ${suffix}`;
  }
  if (geo) {
    return `Create a dedicated ${geo} page`;
  }
  // No topic, no geo, but we DO have a cluster phrase — use it
  // verbatim instead of falling to the generic "this scenario" copy.
  if (args.clusterPhrase.length > 0) {
    return `Create a ${args.clusterPhrase} page`;
  }
  // Last-resort fallback per operator scope: don't quote raw prompt.
  // Operator browser audit (Step 3.5f) flagged "this scenario" as
  // generic. Use a slightly more grounded phrasing.
  return "Review this page opportunity";
}

function composeAddSectionTitle(args: {
  readonly topic: string | null;
  readonly pageName: string;
  readonly geo: string | null;
}): string {
  const pageLabel =
    args.pageName === "homepage" ? "homepage" : `${args.pageName} page`;
  if (args.topic) {
    return `Add a ${args.topic} section to the ${pageLabel}`;
  }
  if (args.geo) {
    return `Add a ${args.geo} services section to the ${pageLabel}`;
  }
  return `Review which section to add to the ${pageLabel}`;
}

function composeStrengthenTitle(args: {
  readonly topic: string | null;
  readonly pageName: string;
}): string {
  const pageLabel =
    args.pageName === "homepage" ? "homepage" : `${args.pageName} page`;
  if (args.topic) {
    return `Strengthen the ${pageLabel} for ${args.topic} searches`;
  }
  return `Strengthen the ${pageLabel}`;
}

/**
 * Pick "a" vs "an" based on the next word's first sound. Naive
 * vowel-only check; good enough for the topic / geo set we ship.
 */
function articleFor(nextWord: string): "a" | "an" {
  const c = nextWord.trim().charAt(0).toLowerCase();
  return /[aeiou]/.test(c) ? "an" : "a";
}

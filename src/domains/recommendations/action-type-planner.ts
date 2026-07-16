/**
 * W3 Step 3.11 (2026-05-04) — Action Type Planner v0.
 *
 * Operator scope: H2 + FAQ proved the safe-generation loop end-to-end
 * (query fanout → evidence packet → LLM → validators → exact bundle
 * replay → ranked action table). But H2 / FAQ are not the whole
 * product. Beacon must recommend the RIGHT website task type for
 * each cluster: create page, rewrite title, rewrite meta, rewrite
 * H1, add H2 / section, improve copy, add FAQ, add schema, add
 * internal links, add comparison table, technical fix, review
 * decision.
 *
 * This file is the PLANNER ONLY. It does NOT generate final copy.
 * It decides what KIND of task Beacon should recommend, surfaces a
 * per-plan audit (raw fanout trigger, normalized intent, page facts
 * used, why-this / why-not-other-types, confidence), and flags
 * `canGenerateNow` based on whether a safe generator exists today.
 *
 * Pure compute. No I/O, no LLM, no DB, no React. Same input → same
 * output (deterministic).
 *
 * Constraints (operator-locked at W3 §3.11 launch):
 *   1. Raw fanout queries MAY contain "best", "top", etc.; PUBLIC
 *      copy must not parrot them. The planner's `add_comparison_table`
 *      / `create_page` / `improve_body_copy` rules transform
 *      comparison-stage demand into buyer-decision angles.
 *   2. Schema is NEVER recommended for hidden / unsupported content.
 *      FAQPage requires a visible FAQ; BreadcrumbList requires real
 *      hierarchy; Service / WebPage requires page facts.
 *   3. The planner emits ONE plan per call in v0 (the highest-priority
 *      rule that fires). Other types that COULD have fired but didn't
 *      land in `whyNotOtherTypes`. Future versions may emit multiple.
 *   4. `canGenerateNow` is true ONLY for action types whose safe
 *      generator is already wired (`add_h2_section`, `add_faq` today).
 *      Everything else is a "queue this for the operator" task.
 */

import type { ActionType } from "./action-types";
import type { ElementType } from "@/domains/pages/extractors/registry";
import type {
  AffectedPromptBlock,
  AiSearchSignalBlock,
  OwnedPageCandidateBlock,
  SpecificEditEvidencePacket,
} from "./specific-edit-evidence";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Operator-facing planner-output enum. Distinct from the persisted
 * `ActionType` taxonomy so the planner can express a higher-level
 * intent ("rewrite_title") that maps to one or more concrete action
 * types ("edit_title" today; could grow to include "edit_title +
 * edit_meta" in a future Title-Pack generator).
 */
export type PlanActionType =
  | "create_page"
  | "rewrite_title"
  | "rewrite_meta_description"
  | "rewrite_h1"
  | "add_h2_section"
  | "improve_body_copy"
  | "add_faq"
  | "add_schema"
  | "add_internal_links"
  | "add_comparison_table"
  | "technical_fix"
  | "review_decision";

/**
 * Confidence rubric mirrors the W3 §3.11 query-fanout audit. Order
 * is intentional: fanout-backed > prompt-backed > site-inventory-
 * backed > thin. The planner stamps the highest tier that fits.
 */
export type PlanConfidence =
  | "fanout-backed"
  | "prompt-backed"
  | "site-inventory-backed"
  | "thin";

export type PlanRiskLevel = "low" | "medium" | "high";

/**
 * Page facts the planner consults when deciding what kind of task
 * to recommend. Sourced by the CALLER from
 * `page_element_inventory` / `page_snapshots` / scan output. Empty
 * when no owned page covers the cluster (the `create_page` rule
 * fires).
 */
export type PageFactsForPlanner = {
  /** Canonical URL the facts describe. */
  readonly url: string;
  /** SEO `<title>` text, when crawled. */
  readonly title: string | null;
  /** First H1, when crawled. */
  readonly h1: string | null;
  /** Meta description, when crawled. */
  readonly metaDescription: string | null;
  /** Top H2s on the page, in order (truncated to 8 by the inventory). */
  readonly h2s: ReadonlyArray<string>;
  /**
   * Visible FAQ block detected on the page (e.g., a FAQ section
   * with question/answer pairs the user can read). Required for
   * `add_schema` → FAQPage. Defaults `false` when unknown.
   */
  readonly visibleFaqExists: boolean;
  /**
   * Breadcrumb hierarchy detected (header crumb / sitemap depth).
   * Required for `add_schema` → BreadcrumbList.
   */
  readonly breadcrumbHierarchyExists: boolean;
  /**
   * Service / cost / process content detected. Required for
   * `add_schema` → Service / WebPage.
   */
  readonly servicePageContentExists: boolean;
  /**
   * Schema currently on the page. The planner uses this to decide
   * between `add_schema` (none present) and `fix_schema` (broken /
   * incomplete; v0 maps to technical_fix).
   */
  readonly hasSchemaOnPage: boolean;
  /** Page declares `<meta name="robots" content="noindex">`. */
  readonly noindexed: boolean;
  /** Canonical link points to a different URL. */
  readonly canonicalMismatch: boolean;
  /** Schema.org JSON-LD failed validation on the most recent crawl. */
  readonly invalidSchema: boolean;
  /** Crawl is older than 14 days (operator-locked threshold). */
  readonly crawlStale: boolean;
  /** Robots.txt blocks the URL. */
  readonly crawlBlocked: boolean;
  /**
   * The cluster's owned-page intent maps to THIS URL but the AI
   * keeps citing the homepage instead. Drives `add_internal_links`.
   */
  readonly homepageOverCitedForCluster: boolean;
};

/**
 * Per-plan structured audit. Mirrors `query-fanout-audit.ts` shape +
 * adds the "why this action type / why not the others" reasoning the
 * operator demanded at W3 §3.11 launch.
 */
export type PlanAudit = {
  /** Verbatim raw fanout queries that triggered the plan (may be empty). */
  readonly rawFanoutTriggers: ReadonlyArray<string>;
  /** One-line buyer-intent description with superlatives stripped. */
  readonly normalizedIntent: string;
  /** Which page-fact fields contributed to the decision. */
  readonly pageFactsUsed: ReadonlyArray<keyof PageFactsForPlanner>;
  /** Plain-English explanation of why THIS action type fits. */
  readonly whyThisActionType: string;
  /**
   * For every other PlanActionType that COULD have fired but didn't,
   * the reason it was rejected. Operator scope: keep this complete
   * so the audit is useful.
   */
  readonly whyNotOtherTypes: ReadonlyArray<{
    readonly type: PlanActionType;
    readonly because: string;
  }>;
  /** fanout-backed / prompt-backed / site-inventory-backed / thin. */
  readonly confidence: PlanConfidence;
};

/** One operator-facing plan. The action table renders this; the
 *  generator (when it exists) consumes `recommendedGenerator` to
 *  emit the actual edit. */
export type ActionPlan = {
  /** The high-level task type the operator sees. */
  readonly actionType: PlanActionType;
  /** Owned URL this plan targets. Null for `create_page`. */
  readonly targetUrl: string | null;
  /** Operator-friendly page label ("Whole Home Remodel page" /
   *  "Homepage" / "New page"). */
  readonly targetPageLabel: string;
  /** When applicable, the element type the generator should produce
   *  (h1 / h2 / title / meta_description / faq_question / etc.).
   *  Null for plans that operate at page level (create_page,
   *  technical_fix, review_decision). */
  readonly proposedElementType: ElementType | null;
  /** One-line summary of the evidence that drove this plan. */
  readonly evidenceReason: string;
  /** Audit block: raw fanout, intent, page facts used, why / why-not. */
  readonly audit: PlanAudit;
  /** low / medium / high — operator-facing risk indicator. */
  readonly riskLevel: PlanRiskLevel;
  /** Whether a safe generator exists today. v0: only `add_h2_section`
   *  + `add_faq` are wired; everything else is `false`. */
  readonly canGenerateNow: boolean;
  /** The concrete `ActionType` the generator will emit (when it
   *  exists). Maps PlanActionType → existing taxonomy 1:1 today;
   *  may map 1:N in the future (e.g., a Title-Pack generator
   *  emitting `edit_title` + `edit_meta`). */
  readonly recommendedGenerator: ActionType;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BuildRecommendedActionPlanInput = {
  /** The rec's specific-edit evidence packet (W3 §3.2). Carries
   *  affectedPrompts, aiSearchSignal, ownedPageCandidates,
   *  competitorPageBlueprints. */
  readonly packet: SpecificEditEvidencePacket;
  /**
   * Page facts for the resolved target URL. Null when the resolver
   * said `needs_new_page` (drives `create_page`) or when the caller
   * has no scan data. Different rules tolerate null differently —
   * `technical_fix` requires non-null, `add_h2_section` doesn't.
   */
  readonly pageFacts?: PageFactsForPlanner | null;
  /**
   * Optional explicit hint that the homepage is over-cited for this
   * cluster while the target page exists. Drives `add_internal_links`
   * directly when set. When omitted, the planner reads
   * `pageFacts.homepageOverCitedForCluster`.
   */
  readonly homepageOverCitedForCluster?: boolean;
};

// ---------------------------------------------------------------------------
// Heuristics — small, named, all unit-testable
// ---------------------------------------------------------------------------

const FORBIDDEN_MODIFIERS = [
  "best",
  "top",
  "top-rated",
  "leading",
  "premier",
  "elite",
  "highest-rated",
  "most trusted",
  "most popular",
  "frequently recommended",
  "award-winning",
] as const;

const COMPARISON_TRIGGERS: ReadonlyArray<RegExp> = [
  /\bwho should i hire\b/i,
  /\bwhat to look for\b/i,
  /\bbest\s+\w+/i,
  /\btop\s+\w+/i,
  /\bdesign[-\s]?build vs\b/i,
  /\barchitect vs\b/i,
  /\bcompare\b/i,
  /\bevaluate\b/i,
  /\bpros and cons\b/i,
  /\bvs\b/i,
];

const QUESTION_SHAPED: RegExp = /\b(who|what|how|when|where|why|which|do|does|is|are|can|should|will)\b.*\?$/i;

/** True when the fanout (or affected prompts) carry comparison-stage
 *  demand the operator wants transformed into buyer-decision angles
 *  (page / table / section), NOT a self-claim H2. */
export function fanoutLooksComparison(
  signal: AiSearchSignalBlock,
  prompts: ReadonlyArray<AffectedPromptBlock>,
): boolean {
  const all: string[] = [
    ...signal.topSearchQueries.map((q) => q.query),
    ...prompts.map((p) => p.promptText),
  ];
  return all.some((s) =>
    COMPARISON_TRIGGERS.some((re) => re.test(s)),
  );
}

/** True when at least one prompt or fanout query is shaped as a
 *  natural-language question (Who/What/How… ending in `?`). */
export function fanoutHasQuestionShape(
  signal: AiSearchSignalBlock,
  prompts: ReadonlyArray<AffectedPromptBlock>,
): boolean {
  for (const q of signal.topSearchQueries) {
    if (QUESTION_SHAPED.test(q.query.trim())) return true;
  }
  for (const p of prompts) {
    if (QUESTION_SHAPED.test(p.promptText.trim())) return true;
  }
  return false;
}

/** True when the fanout is dominated by forbidden self-claim
 *  superlatives ("best builder", "top luxury …"). Used to STEER
 *  the plan AWAY from a self-claim H2 — we'd prefer create_page /
 *  add_comparison_table / improve_body_copy. */
export function fanoutHasForbiddenSuperlative(
  signal: AiSearchSignalBlock,
): boolean {
  return signal.topSearchQueries.some((q) => {
    const t = q.query.toLowerCase().trim();
    return FORBIDDEN_MODIFIERS.some(
      (m) => t.includes(m) && (t.startsWith(m) || t.includes(` ${m} `)),
    );
  });
}

/** Strip leading articles + forbidden superlatives off the top
 *  fanout query for the audit's `normalizedIntent` line. */
export function normalizedIntentFromSignal(
  signal: AiSearchSignalBlock,
  prompts: ReadonlyArray<AffectedPromptBlock>,
): string {
  if (signal.topSearchQueries.length > 0) {
    const top = signal.topSearchQueries[0].query;
    const cleaned = top
      .replace(
        /^\s*(?:the\s+|a\s+|an\s+)?(best|top|top-rated|leading|premier|elite|highest-rated|most trusted|most popular|frequently recommended|award-winning)\s+/i,
        "",
      )
      .trim();
    return `Buyers searching for ${cleaned}`;
  }
  if (prompts.length > 0) {
    return `Prompt-only intent: "${prompts[0].promptText.slice(0, 110).trim()}…"`;
  }
  return "No fanout, no prompt evidence — abstain";
}

/** Owned-page coverage check. Returns the BEST candidate (highest
 *  matchScore) or null when no owned page covers the cluster. */
export function ownedPageBestMatch(
  candidates: ReadonlyArray<OwnedPageCandidateBlock>,
): OwnedPageCandidateBlock | null {
  if (candidates.length === 0) return null;
  // Cluster-match scoring already orders the array; defensively
  // pick the highest scorer.
  return candidates.reduce((best, c) =>
    !best || c.matchScore > best.matchScore ? c : best,
  );
}

/** Title quality heuristics. "Weak" = empty, generic, missing geo +
 *  service, OR mismatches the dominant fanout query topic. */
export function titleIsWeak(args: {
  readonly title: string | null;
  readonly h1: string | null;
  readonly clusterLabel: string | null;
  readonly topFanoutQuery: string | null;
}): boolean {
  const t = (args.title ?? "").trim();
  if (t.length === 0) return true;
  if (t.length < 12) return true;
  // Generic-template heuristics — operator scope: known cheap
  // patterns that say nothing.
  const GENERIC = [
    /^home$/i,
    /^homepage$/i,
    /^untitled$/i,
    /^welcome$/i,
    /^about us$/i,
    /^services$/i,
    /^locations$/i,
  ];
  if (GENERIC.some((re) => re.test(t))) return true;
  // If the cluster label is a known topic / geo and the title
  // mentions neither, treat as weak.
  const cl = (args.clusterLabel ?? "").toLowerCase();
  if (cl.length > 0) {
    const titleLow = t.toLowerCase();
    const clusterTokens = cl
      .split(/\s+/)
      .filter((tok) => tok.length >= 4); // skip "and", "the"
    const overlap = clusterTokens.some((tok) => titleLow.includes(tok));
    if (!overlap) return true;
  }
  return false;
}

/** Meta description quality heuristic. */
export function metaIsWeak(args: {
  readonly meta: string | null;
  readonly clusterLabel: string | null;
}): boolean {
  const m = (args.meta ?? "").trim();
  if (m.length === 0) return true;
  if (m.length < 60) return true; // way under SERP-snippet floor
  if (m.length > 200) return true; // truncated by SERP — operator-cheap signal
  const cl = (args.clusterLabel ?? "").toLowerCase();
  if (cl.length > 0) {
    const lowM = m.toLowerCase();
    const tokens = cl.split(/\s+/).filter((t) => t.length >= 4);
    const overlap = tokens.some((t) => lowM.includes(t));
    if (!overlap) return true;
  }
  return false;
}

/** H1 weakness mirrors title heuristic but with a stricter "missing"
 *  bar — empty / missing / generic. */
export function h1IsWeak(args: {
  readonly h1: string | null;
  readonly clusterLabel: string | null;
}): boolean {
  const h = (args.h1 ?? "").trim();
  if (h.length === 0) return true;
  if (/^home$/i.test(h)) return true;
  if (/^welcome$/i.test(h)) return true;
  const cl = (args.clusterLabel ?? "").toLowerCase();
  if (cl.length > 0) {
    const tokens = cl.split(/\s+/).filter((t) => t.length >= 4);
    const overlap = tokens.some((t) => h.toLowerCase().includes(t));
    if (!overlap) return true;
  }
  return false;
}

/** Body-copy thinness signal. Minimum-viable for v0: page H2 list is
 *  empty OR cluster topic is not represented in any H2. The full
 *  body-text scan is a future enhancement. */
export function bodyCopyIsThin(args: {
  readonly h2s: ReadonlyArray<string>;
  readonly clusterLabel: string | null;
}): boolean {
  if (args.h2s.length === 0) return true;
  const cl = (args.clusterLabel ?? "").toLowerCase();
  if (cl.length === 0) return false;
  const tokens = cl.split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) return false;
  return !args.h2s.some((h) =>
    tokens.some((t) => h.toLowerCase().includes(t)),
  );
}

/** Technical-issue check. Returns true when ANY page fact indicates a
 *  technical defect that should outrank content recommendations. */
export function pageHasTechnicalIssue(facts: PageFactsForPlanner): boolean {
  return (
    facts.noindexed ||
    facts.canonicalMismatch ||
    facts.invalidSchema ||
    facts.crawlBlocked ||
    facts.crawlStale
  );
}

// ---------------------------------------------------------------------------
// Mapping: PlanActionType → concrete ActionType (existing taxonomy)
// ---------------------------------------------------------------------------

const PLAN_TO_ACTION_TYPE: Record<PlanActionType, ActionType> = {
  create_page: "create_page",
  rewrite_title: "edit_title",
  rewrite_meta_description: "edit_meta",
  rewrite_h1: "change_h1",
  add_h2_section: "add_h2_section",
  improve_body_copy: "add_answer_block",
  add_faq: "add_faq",
  add_schema: "add_schema",
  add_internal_links: "add_internal_link",
  add_comparison_table: "add_table",
  technical_fix: "reorder_sections",
  review_decision: "watch",
};

const PLAN_TO_ELEMENT_TYPE: Record<PlanActionType, ElementType | null> = {
  create_page: null,
  rewrite_title: "title",
  rewrite_meta_description: "meta",
  rewrite_h1: "h1",
  add_h2_section: "h2",
  improve_body_copy: "answer_block",
  add_faq: "faq_question",
  add_schema: "schema_type",
  add_internal_links: "internal_link",
  add_comparison_table: "table",
  technical_fix: null,
  review_decision: null,
};

/** v0 generator support — the operator-locked safe set today. Every
 *  other PlanActionType emits `canGenerateNow: false` and surfaces as
 *  an operator-handoff task in the action table. */
const SAFE_GENERATORS_TODAY: ReadonlySet<PlanActionType> = new Set<PlanActionType>([
  "add_h2_section",
  "add_faq",
]);

const PLAN_LABELS: Record<PlanActionType, string> = {
  create_page: "Page",
  rewrite_title: "Title",
  rewrite_meta_description: "Meta",
  rewrite_h1: "H1",
  add_h2_section: "H2",
  improve_body_copy: "Copy",
  add_faq: "FAQ",
  add_schema: "Schema",
  add_internal_links: "Links",
  add_comparison_table: "Table",
  technical_fix: "Technical",
  review_decision: "Review",
};

/** Public: operator-readable label for a plan action type. */
export function planLabelFor(plan: PlanActionType): string {
  return PLAN_LABELS[plan];
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/**
 * v0: emit AT MOST ONE plan per call (the highest-priority rule that
 * fires). Other rules that COULD have fired but didn't surface in
 * `audit.whyNotOtherTypes`. Future versions may emit multiple plans
 * (e.g., title + meta + H1 all weak on the same page).
 */
export function buildRecommendedActionPlan(
  input: BuildRecommendedActionPlanInput,
): ActionPlan[] {
  const { packet, pageFacts } = input;
  const facts = pageFacts ?? null;
  const homepageOverCited =
    input.homepageOverCitedForCluster ??
    facts?.homepageOverCitedForCluster ??
    false;

  const owned = ownedPageBestMatch(packet.ownedPageCandidates);
  const ownedTarget = owned?.url ?? null;
  const ownedLabel = owned ? labelFromOwnedPage(owned) : "New page";
  const intent = normalizedIntentFromSignal(
    packet.aiSearchSignal,
    packet.affectedPrompts,
  );

  // Walk rules in operator-locked priority order. First match wins.
  // Each branch builds a complete ActionPlan + a why-not list for
  // the rules it skipped.
  const fired: PlanActionType | null = decideFiredRule({
    packet,
    facts,
    owned,
    homepageOverCited,
  });

  if (fired === null) {
    // No rule fires AND we have no owned page → review_decision is
    // the safe terminal. The packet had affected prompts but no
    // generator would honest-up emit copy. Fall back to a Review
    // task the operator handles.
    return [
      buildPlan({
        plan: "review_decision",
        targetUrl: ownedTarget,
        targetPageLabel: ownedLabel,
        evidenceReason: composeEvidenceReason(packet, "review"),
        intent,
        packet,
        facts,
        owned,
        homepageOverCited,
        whyThis:
          "No single content edit clearly dominates and the packet's evidence is too thin to ground a generator output. Surface as Review so the operator can pick the direction.",
      }),
    ];
  }

  return [
    buildPlan({
      plan: fired,
      targetUrl: fired === "create_page" ? null : ownedTarget,
      targetPageLabel: fired === "create_page" ? "New page" : ownedLabel,
      evidenceReason: composeEvidenceReason(packet, fired),
      intent,
      packet,
      facts,
      owned,
      homepageOverCited,
      whyThis: composeWhyThis({
        plan: fired,
        packet,
        facts,
        owned,
        homepageOverCited,
      }),
    }),
  ];
}

// ---------------------------------------------------------------------------
// Rule selection
// ---------------------------------------------------------------------------

type DecideArgs = {
  readonly packet: SpecificEditEvidencePacket;
  readonly facts: PageFactsForPlanner | null;
  readonly owned: OwnedPageCandidateBlock | null;
  readonly homepageOverCited: boolean;
};

/**
 * Operator-locked rule walk. Priority order:
 *   1. technical_fix     — page-level defect outranks content recs.
 *   2. create_page       — no owned page covers the cluster.
 *   3. add_internal_links — homepage over-cited while target exists.
 *   4. rewrite_h1        — H1 missing / vague.
 *   5. rewrite_title     — title generic / misaligned with fanout.
 *   6. rewrite_meta_description — meta missing / weak.
 *   7. add_comparison_table — comparison-stage demand (operator
 *      explicitly demanded this lands BEFORE add_h2_section so a
 *      "best luxury home builders" fanout doesn't degrade into a
 *      self-claim H2).
 *   8. add_faq           — question-shaped fanout.
 *   9. add_schema        — visible content supports it.
 *  10. add_h2_section    — page broadly matches but missing subtopic.
 *  11. improve_body_copy — right page exists but answer is thin.
 *  12. review_decision   — fallback when nothing else fires.
 */
function decideFiredRule(args: DecideArgs): PlanActionType | null {
  const { packet, facts, owned, homepageOverCited } = args;

  // 1. technical_fix — page-level defects outrank everything else.
  if (facts && pageHasTechnicalIssue(facts)) return "technical_fix";

  // 2. create_page — no owned page covers the cluster.
  if (!owned) return "create_page";

  // 3. add_internal_links — homepage over-cited while target exists.
  if (homepageOverCited) return "add_internal_links";

  // 4–6. on-page weakness checks (when we have facts). Order: H1 →
  // title → meta. Operator-locked: H1 wins because a missing H1 is
  // a more visible defect than a generic title or meta.
  if (facts) {
    if (
      h1IsWeak({ h1: facts.h1, clusterLabel: packet.clusterLabel })
    ) {
      return "rewrite_h1";
    }
    if (
      titleIsWeak({
        title: facts.title,
        h1: facts.h1,
        clusterLabel: packet.clusterLabel,
        topFanoutQuery:
          packet.aiSearchSignal.topSearchQueries[0]?.query ?? null,
      })
    ) {
      return "rewrite_title";
    }
    if (
      metaIsWeak({
        meta: facts.metaDescription,
        clusterLabel: packet.clusterLabel,
      })
    ) {
      return "rewrite_meta_description";
    }
  }

  // 7. add_comparison_table — operator-locked: comparison demand
  // routes here BEFORE add_h2_section so we don't degrade into a
  // self-claim H2.
  if (
    fanoutLooksComparison(packet.aiSearchSignal, packet.affectedPrompts) ||
    fanoutHasForbiddenSuperlative(packet.aiSearchSignal)
  ) {
    return "add_comparison_table";
  }

  // 8. add_faq — question-shaped fanout.
  if (
    fanoutHasQuestionShape(packet.aiSearchSignal, packet.affectedPrompts)
  ) {
    return "add_faq";
  }

  // 9. add_schema — only when visible content supports it.
  if (facts && schemaIsRecommendable(facts)) {
    return "add_schema";
  }

  // 10. add_h2_section — page exists, has H2s, broadly covers the
  // cluster topic but is missing a subtopic the fanout reveals.
  // `add_h2_section` fires when body is NOT thin overall but the
  // packet still has unmet evidence (affected prompts > 0).
  if (
    facts &&
    facts.h2s.length > 0 &&
    !bodyCopyIsThin({ h2s: facts.h2s, clusterLabel: packet.clusterLabel }) &&
    packet.affectedPrompts.length > 0
  ) {
    return "add_h2_section";
  }

  // 11. improve_body_copy — page exists but body is thin / cluster
  // topic isn't represented in any H2 yet.
  if (
    facts &&
    bodyCopyIsThin({ h2s: facts.h2s, clusterLabel: packet.clusterLabel })
  ) {
    return "improve_body_copy";
  }

  // 12. nothing fired → review_decision fallback (handled in the
  // caller).
  return null;
}

/** Schema is recommendable ONLY when visible content supports it.
 *  FAQPage requires a visible FAQ; BreadcrumbList requires hierarchy;
 *  Service / WebPage requires service content. */
export function schemaIsRecommendable(
  facts: PageFactsForPlanner,
): boolean {
  if (facts.hasSchemaOnPage) return false; // already present, not a new add
  return (
    facts.visibleFaqExists ||
    facts.breadcrumbHierarchyExists ||
    facts.servicePageContentExists
  );
}

// ---------------------------------------------------------------------------
// Plan-builder helpers
// ---------------------------------------------------------------------------

type BuildPlanArgs = {
  readonly plan: PlanActionType;
  readonly targetUrl: string | null;
  readonly targetPageLabel: string;
  readonly evidenceReason: string;
  readonly intent: string;
  readonly packet: SpecificEditEvidencePacket;
  readonly facts: PageFactsForPlanner | null;
  readonly owned: OwnedPageCandidateBlock | null;
  readonly homepageOverCited: boolean;
  readonly whyThis: string;
};

function buildPlan(args: BuildPlanArgs): ActionPlan {
  const rawFanoutTriggers = args.packet.aiSearchSignal.topSearchQueries.map(
    (q) => q.query,
  );
  const pageFactsUsed = collectPageFactsUsed(args.plan, args.facts);
  const whyNotOtherTypes = composeWhyNotOthers({
    chosen: args.plan,
    packet: args.packet,
    facts: args.facts,
    owned: args.owned,
    homepageOverCited: args.homepageOverCited,
  });
  const confidence = stampConfidence({
    plan: args.plan,
    packet: args.packet,
    facts: args.facts,
  });
  const risk: PlanRiskLevel = riskFor(args.plan);
  return {
    actionType: args.plan,
    targetUrl: args.targetUrl,
    targetPageLabel: args.targetPageLabel,
    proposedElementType: PLAN_TO_ELEMENT_TYPE[args.plan],
    evidenceReason: args.evidenceReason,
    audit: {
      rawFanoutTriggers,
      normalizedIntent: args.intent,
      pageFactsUsed,
      whyThisActionType: args.whyThis,
      whyNotOtherTypes,
      confidence,
    },
    riskLevel: risk,
    canGenerateNow: SAFE_GENERATORS_TODAY.has(args.plan),
    recommendedGenerator: PLAN_TO_ACTION_TYPE[args.plan],
  };
}

function collectPageFactsUsed(
  plan: PlanActionType,
  facts: PageFactsForPlanner | null,
): ReadonlyArray<keyof PageFactsForPlanner> {
  if (!facts) return [];
  const used: Array<keyof PageFactsForPlanner> = [];
  if (plan === "rewrite_title") used.push("title");
  if (plan === "rewrite_meta_description") used.push("metaDescription");
  if (plan === "rewrite_h1") used.push("h1");
  if (plan === "add_h2_section") used.push("h2s");
  if (plan === "improve_body_copy") used.push("h2s");
  if (plan === "add_schema") {
    if (facts.visibleFaqExists) used.push("visibleFaqExists");
    if (facts.breadcrumbHierarchyExists)
      used.push("breadcrumbHierarchyExists");
    if (facts.servicePageContentExists)
      used.push("servicePageContentExists");
    used.push("hasSchemaOnPage");
  }
  if (plan === "add_internal_links") used.push("homepageOverCitedForCluster");
  if (plan === "technical_fix") {
    if (facts.noindexed) used.push("noindexed");
    if (facts.canonicalMismatch) used.push("canonicalMismatch");
    if (facts.invalidSchema) used.push("invalidSchema");
    if (facts.crawlBlocked) used.push("crawlBlocked");
    if (facts.crawlStale) used.push("crawlStale");
  }
  return used;
}

function composeEvidenceReason(
  packet: SpecificEditEvidencePacket,
  context: PlanActionType | "review",
): string {
  const N = packet.affectedPrompts.reduce(
    (sum, p) => sum + p.observationCount,
    0,
  );
  const lead = `${N} AI answer${N === 1 ? "" : "s"}`;
  const compMentions = packet.aiSearchSignal.topCompetitorCoMentions;
  const competitor = compMentions[0]?.competitorName ?? null;
  const cluster = packet.clusterLabel ?? "this cluster";
  if (context === "create_page" || context === "review") {
    return `${lead}; no owned page covers ${cluster} yet.`;
  }
  if (context === "add_internal_links") {
    return `${lead}; homepage over-cited while target page exists.`;
  }
  if (context === "technical_fix") {
    return `${lead}; page-level technical defect outranks content edits.`;
  }
  if (competitor) {
    return `${lead}; ${competitor} competing for ${cluster} answers.`;
  }
  return `${lead}; ${cluster} cluster underrepresented on owned pages.`;
}

function composeWhyThis(args: {
  readonly plan: PlanActionType;
  readonly packet: SpecificEditEvidencePacket;
  readonly facts: PageFactsForPlanner | null;
  readonly owned: OwnedPageCandidateBlock | null;
  readonly homepageOverCited: boolean;
}): string {
  const { plan, packet, facts, owned } = args;
  switch (plan) {
    case "create_page":
      return `No owned page covers the "${packet.clusterLabel ?? "target"}" cluster — fanout shows distinct buyer intent that warrants a dedicated page.`;
    case "add_internal_links":
      return `The "${owned?.url ?? "target"}" page exists, but the AI keeps citing the homepage. An internal-link cluster from authoritative pages will redirect citation weight.`;
    case "rewrite_h1":
      return `Page H1 (${facts?.h1 ? `"${facts.h1}"` : "missing"}) is vague or doesn't anchor the cluster topic. Rewriting H1 first because it's the most visible defect.`;
    case "rewrite_title":
      return `SEO title (${facts?.title ? `"${facts.title}"` : "missing"}) is generic or misses the cluster topic + geo. A targeted rewrite pulls answer-engine snippets toward the page.`;
    case "rewrite_meta_description":
      return `Meta description is missing / weak / overlong. A buyer-intent rewrite improves SERP click-through and answer-engine framing.`;
    case "add_comparison_table":
      return `Fanout carries comparison-stage intent (e.g., ${
        packet.aiSearchSignal.topSearchQueries[0]?.query ?? "comparison query"
      }). A comparison table answers the buyer question without making a self-claim.`;
    case "add_faq":
      return `Fanout / prompts carry question-shaped intent. A FAQ pair answers the buyer's exact question with grounded copy.`;
    case "add_schema":
      return `Visible page content (${[
        facts?.visibleFaqExists ? "FAQ" : null,
        facts?.breadcrumbHierarchyExists ? "breadcrumbs" : null,
        facts?.servicePageContentExists ? "service info" : null,
      ]
        .filter(Boolean)
        .join(", ")}) supports schema. Schema is added only because the underlying content is real.`;
    case "add_h2_section":
      return `Page broadly matches the cluster but is missing one important subtopic. An H2 fills the gap without disrupting the rest of the page.`;
    case "improve_body_copy":
      return `Right page exists but the body answer is too thin to win the cluster's prompts. Strengthening copy without touching structure.`;
    case "technical_fix":
      return `Page-level technical defect detected (noindex / canonical / invalid schema / blocked crawl / stale). Fix this before any content edit.`;
    case "review_decision":
      return `Evidence is too thin or ambiguous for an automatic content edit. Surface as Review so the operator picks the direction.`;
  }
}

function composeWhyNotOthers(args: {
  readonly chosen: PlanActionType;
  readonly packet: SpecificEditEvidencePacket;
  readonly facts: PageFactsForPlanner | null;
  readonly owned: OwnedPageCandidateBlock | null;
  readonly homepageOverCited: boolean;
}): ReadonlyArray<{ type: PlanActionType; because: string }> {
  const { chosen } = args;
  const out: Array<{ type: PlanActionType; because: string }> = [];
  const ALL: PlanActionType[] = [
    "create_page",
    "rewrite_title",
    "rewrite_meta_description",
    "rewrite_h1",
    "add_h2_section",
    "improve_body_copy",
    "add_faq",
    "add_schema",
    "add_internal_links",
    "add_comparison_table",
    "technical_fix",
    "review_decision",
  ];
  for (const p of ALL) {
    if (p === chosen) continue;
    out.push({ type: p, because: rejectReason(p, args) });
  }
  return out;

  function rejectReason(
    p: PlanActionType,
    a: typeof args,
  ): string {
    const { packet, facts, owned, homepageOverCited, chosen } = a;
    if (p === "create_page") {
      return owned ? "An owned page already covers this cluster." : "Subordinate to the chosen rule.";
    }
    if (p === "add_internal_links") {
      return homepageOverCited
        ? "Subordinate to the chosen rule."
        : "Homepage isn't over-cited for this cluster.";
    }
    if (p === "rewrite_h1") {
      return facts && h1IsWeak({ h1: facts.h1, clusterLabel: packet.clusterLabel })
        ? "Subordinate to the chosen rule."
        : "Page H1 is acceptable.";
    }
    if (p === "rewrite_title") {
      return facts &&
        titleIsWeak({
          title: facts.title,
          h1: facts.h1,
          clusterLabel: packet.clusterLabel,
          topFanoutQuery:
            packet.aiSearchSignal.topSearchQueries[0]?.query ?? null,
        })
        ? "Subordinate to the chosen rule."
        : "Page title is acceptable.";
    }
    if (p === "rewrite_meta_description") {
      return facts &&
        metaIsWeak({ meta: facts.metaDescription, clusterLabel: packet.clusterLabel })
        ? "Subordinate to the chosen rule."
        : "Page meta description is acceptable.";
    }
    if (p === "add_comparison_table") {
      return fanoutLooksComparison(packet.aiSearchSignal, packet.affectedPrompts) ||
        fanoutHasForbiddenSuperlative(packet.aiSearchSignal)
        ? "Subordinate to the chosen rule."
        : "Fanout carries no comparison-stage intent.";
    }
    if (p === "add_faq") {
      return fanoutHasQuestionShape(packet.aiSearchSignal, packet.affectedPrompts)
        ? "Subordinate to the chosen rule."
        : "Fanout / prompts carry no question-shaped intent.";
    }
    if (p === "add_schema") {
      if (chosen === "add_schema") return "Subordinate to the chosen rule.";
      if (!facts) return "No page facts to support a schema add.";
      if (facts.hasSchemaOnPage) return "Schema already present on the page.";
      if (!schemaIsRecommendable(facts))
        return "No visible content supports a schema add (FAQPage / Breadcrumbs / Service blocked).";
      return "Subordinate to the chosen rule.";
    }
    if (p === "add_h2_section") {
      return facts ? "Subordinate to the chosen rule." : "No page facts available.";
    }
    if (p === "improve_body_copy") {
      return facts &&
        bodyCopyIsThin({ h2s: facts.h2s, clusterLabel: packet.clusterLabel })
        ? "Subordinate to the chosen rule."
        : "Body copy is not thin on this page.";
    }
    if (p === "technical_fix") {
      return facts && pageHasTechnicalIssue(facts)
        ? "Subordinate to the chosen rule."
        : "No technical defects detected on this page.";
    }
    if (p === "review_decision") {
      return "A direct content / technical rule fit better than a Review.";
    }
    return "Subordinate to the chosen rule.";
  }
}

function stampConfidence(args: {
  readonly plan: PlanActionType;
  readonly packet: SpecificEditEvidencePacket;
  readonly facts: PageFactsForPlanner | null;
}): PlanConfidence {
  const fanoutSize = args.packet.aiSearchSignal.topSearchQueries.length;
  const promptCount = args.packet.affectedPrompts.length;
  const factsPresent = args.facts !== null;
  const blueprintCount = args.packet.competitorPageBlueprints.length;
  if (args.plan === "technical_fix") {
    return factsPresent ? "site-inventory-backed" : "thin";
  }
  if (args.plan === "add_internal_links") {
    return factsPresent ? "site-inventory-backed" : "thin";
  }
  if (fanoutSize >= 1) return "fanout-backed";
  if (promptCount >= 1) return "prompt-backed";
  if (factsPresent || blueprintCount > 0) return "site-inventory-backed";
  return "thin";
}

function riskFor(plan: PlanActionType): PlanRiskLevel {
  switch (plan) {
    case "create_page":
      return "medium";
    case "rewrite_title":
    case "rewrite_meta_description":
    case "rewrite_h1":
      return "medium";
    case "add_h2_section":
    case "add_faq":
      return "low";
    case "improve_body_copy":
      return "medium";
    case "add_schema":
      return "low";
    case "add_internal_links":
      return "low";
    case "add_comparison_table":
      return "medium";
    case "technical_fix":
      return "high";
    case "review_decision":
      return "low";
  }
}

function labelFromOwnedPage(owned: OwnedPageCandidateBlock): string {
  // Reuse the same target-label heuristic the action-row builder
  // uses; we duplicate the simple-case formatter here to avoid
  // pulling the action-rows file into this module's import graph.
  if (owned.url === "/" || owned.url.endsWith("/index")) {
    return "Homepage";
  }
  // Last URL segment, title-cased + " page".
  try {
    const u = new URL(owned.url);
    const seg = u.pathname.replace(/\/$/, "").split("/").filter(Boolean).pop();
    if (!seg) return "Homepage";
    const phrase = seg.replace(/[-_]/g, " ");
    const cap = phrase.replace(/\b\w/g, (m) => m.toUpperCase());
    return `${cap} page`;
  } catch {
    return "Target page";
  }
}

// ---------------------------------------------------------------------------
// Imports for re-export — small operator-readable shim for the
// action-table layer.
// ---------------------------------------------------------------------------

export const PLAN_ACTION_TYPES_FOR_TABLE: ReadonlyArray<PlanActionType> = [
  "create_page",
  "rewrite_title",
  "rewrite_meta_description",
  "rewrite_h1",
  "add_h2_section",
  "improve_body_copy",
  "add_faq",
  "add_schema",
  "add_internal_links",
  "add_comparison_table",
  "technical_fix",
  "review_decision",
];

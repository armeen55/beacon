/**
 * intent-veto (2026-07-02, N6) - turns the existing query-intent classifier
 * (src/domains/experiments/answer-intent.ts) from a drafting HINT into a
 * ROUTER VETO. The classifier already caught one real failure: a Move served a
 * DEFINITION when its dominant demand was a DATE question ("chaharshanbe suri
 * 2026" is a "when" query, not a "what is" query). Today that only reshapes
 * drafts; this module makes the mismatch impossible to route at all.
 *
 * Given a Move's evidence packet + the lever the router is about to take, this
 * classifies the DOMINANT intent behind the queries feeding the Move and checks
 * whether the lever can actually satisfy that intent. When it clearly cannot,
 * it emits an Objection the router's EXISTING veto/downgrade machinery already
 * understands (Objection.severity: "veto" | "downgrade") - no new machinery,
 * just a new voice in the debate.
 *
 * DATA HONESTY NOTE: EvidencePacket.demand.queries is always [] in production
 * today (no per-query GSC impressions survive into a Move - see build-graph.ts /
 * evidence-packet.ts). This module follows the SAME synthesis convention already
 * used by demand-graph/prepare-today-moves.ts (the only other demand-graph
 * caller of answer-intent's classifyQueryIntent): the Move's own label counts as
 * the strongest signal (weight 2), each AI fanout sub-question counts once
 * (weight 1). That is real evidence (the actual query + the actual fanout
 * questions), just not impression-weighted - the veto is conservative
 * specifically because this signal is coarser than raw GSC.
 *
 * PURE / deterministic / no I/O / no LLM. Every rule below is documented in
 * place (Constitution law 2: a veto must name its evidence). Pinned by
 * intent-veto.test.ts.
 */

import { classifyQueryIntent, type QueryIntent } from "@/domains/experiments/answer-intent";
import { classifyQueryIntent as classifySurfaceIntent } from "./query-intent";
import type { EvidencePacket } from "./evidence-packet";
import type { MoveRouterAction, Objection, EvidenceRef } from "./specialist-opinions";

/** The plain-English label for each answer-shape intent (mirrors answer-intent.ts's
 *  own INTENT_LABEL, kept local so this module has no reason to reach into that
 *  file's internals - only its exported classifier). */
const INTENT_PLAIN: Record<QueryIntent, string> = {
  when: "a date",
  cost: "a price",
  how: "steps to do it",
  where: "a location",
  who: "a person or people",
  list: "a list",
  compare: "a comparison",
  what: "a definition",
};

/** Minimum dominant-intent impression share before a mismatch is trusted enough
 *  to VETO outright (rather than merely downgrade). Below this the demand is
 *  too split across intents to be confident the lever is wrong. */
const VETO_SHARE_MIN = 0.55;
/** Minimum share for even a "probable mismatch" downgrade - below this the
 *  signal is too thin to say anything (silent, per the conservative mandate). */
const DOWNGRADE_SHARE_MIN = 0.4;

/** Levers whose whole point is to answer a question DIRECTLY on the page with
 *  ONE committed sentence (the AEO answer block). Scoped to add_answer_block
 *  only, NOT change_title_meta - a title can still promise a date ("Chaharshanbe
 *  Suri 2026: Date, Traditions") without changing shape, so a title rewrite does
 *  not carry the same definition-vs-lookup failure mode the answer block does.
 *  (change_title_meta's own intent rule is rule 2 below: navigational mismatch.) */
const ANSWER_SHAPED_ACTIONS = new Set<MoveRouterAction>(["add_answer_block"]);

/** An answer-block lever "fits" an intent only when the lever's natural output
 *  format can satisfy that intent. A definition-shaped answer (the historical
 *  bug) never satisfies when/cost; a date/price-shaped answer never satisfies
 *  what/how/compare. "list"/"who"/"where" are lenient - a well-written block CAN
 *  cover them without changing shape, so they are not flagged. */
const ANSWER_BLOCK_CANNOT_SERVE: ReadonlySet<QueryIntent> = new Set(["when", "cost"]);

export type IntentVetoInput = {
  packet: EvidencePacket;
  /** The lever the router is about to take (seed or vote-elected, checked
   *  BEFORE this objection is folded in - the router re-checks after existing
   *  vetoes too, same as its other objection sources). */
  action: MoveRouterAction;
  /** True when the tenant has no transactional surface (checkout, booking,
   *  quote form, …) to route a transactional-intent create_page to. Threaded by
   *  the caller from BusinessConfig.contentSiteMode (content-only tenants - see
   *  src/lib/business-config.ts) - this module does no I/O of its own. Omitted
   *  ⇒ unknown ⇒ the transactional rule abstains rather than guessing. */
  tenantHasNoTransactionalSurface?: boolean;
};

/** One documented veto rule. Each returns null when it doesn't apply. Keeping
 *  them as small pure functions makes every rule independently testable and
 *  keeps `checkIntentVeto` a simple "run them all, take the first hit" reducer. */
type Rule = (ctx: RuleContext) => Objection | null;

type RuleContext = {
  action: MoveRouterAction;
  dominant: QueryIntent;
  dominantShare: number;
  topQueries: Array<{ query: string; impressions: number }>;
  primaryLabel: string;
  tenantHasNoTransactionalSurface?: boolean;
};

function evidenceRefs(ctx: RuleContext, detailSuffix: string): EvidenceRef[] {
  const cited = ctx.topQueries.slice(0, 3).map((q) => `"${q.query}"`).join(", ") || `"${ctx.primaryLabel}"`;
  return [
    {
      specialist: "gsc",
      source: "computed",
      key: ctx.primaryLabel,
      detail: `dominant intent=${ctx.dominant} (${Math.round(ctx.dominantShare * 100)}% of query signal) from ${cited}${detailSuffix}`,
    },
  ];
}

/**
 * RULE 1 - "definition lever on a lookup question" (the chaharshanbe bug, made
 * structural). add_answer_block commits to ONE answer shape - a single
 * sentence the page leads with. When the dominant intent is "when" (a date) or
 * "cost" (a price) but that shape is definitional by default (the classic
 * failure mode this whole module exists to close), block it.
 */
const ruleAnswerShapeMismatch: Rule = (ctx) => {
  if (!ANSWER_SHAPED_ACTIONS.has(ctx.action)) return null;
  if (!ANSWER_BLOCK_CANNOT_SERVE.has(ctx.dominant)) return null;
  if (ctx.dominantShare < DOWNGRADE_SHARE_MIN) return null;

  const wantLabel = INTENT_PLAIN[ctx.dominant];
  const leverLabel = "the answer block";
  const severity: Objection["severity"] = ctx.dominantShare >= VETO_SHARE_MIN ? "veto" : "downgrade";
  const detail =
    `That question wants ${wantLabel}, not a definition, so I ${severity === "veto" ? "blocked" : "flagged"} ` +
    `${leverLabel} and suggest a ${ctx.dominant === "when" ? "date" : "price"}-first fix instead. ` +
    `Evidence: ${ctx.topQueries.slice(0, 3).map((q) => `"${q.query}"`).join(", ") || `"${ctx.primaryLabel}"`} ` +
    `${severity === "veto" ? "is" : "leans"} a ${ctx.dominant === "when" ? "date" : "price"} lookup (${Math.round(ctx.dominantShare * 100)}% of the query signal), ` +
    `and a definitional answer would not satisfy it.`;

  return {
    kind: "wrong_lever_for_intent",
    against: [ctx.action],
    severity,
    detail,
    evidenceRefs: evidenceRefs(ctx, `; lever would answer with a definition`),
  };
};

/**
 * RULE 2 - "title/meta rewrite on a navigational query". A query like "iranopedia
 * login" or "iranopedia contact" is navigational: the searcher wants a SPECIFIC
 * OTHER PAGE (login/contact/hours), not a better title on THIS page. Rewriting
 * this page's title/meta cannot serve that intent - the searcher wants a
 * different destination entirely. Uses the coarser query-intent.ts classifier
 * (informational/commercial/transactional/navigational) since answer-intent.ts
 * has no navigational bucket - a second, purpose-fit lens on the same label.
 */
const ruleNavigationalTitleRewrite: Rule = (ctx) => {
  if (ctx.action !== "change_title_meta") return null;
  const surface = classifySurfaceIntent(ctx.primaryLabel);
  if (surface.intent !== "navigational") return null;

  const detail =
    `That question wants a specific page ("${ctx.primaryLabel}" reads as navigational), not a better title on ` +
    `this page, so I blocked the title/meta rewrite and suggest confirming the right destination page exists ` +
    `and is easy to find instead. Evidence: "${ctx.primaryLabel}" matched a navigational cue (login/contact/hours/` +
    `account-style query), so a title change here would not be what the searcher is asking for.`;

  return {
    kind: "wrong_lever_for_intent",
    against: ["change_title_meta"],
    severity: "veto",
    detail,
    evidenceRefs: [
      {
        specialist: "gsc",
        source: "computed",
        key: ctx.primaryLabel,
        detail: `navigational query "${ctx.primaryLabel}" (query-intent signals: ${surface.signals.join(", ")})`,
      },
    ],
  };
};

/**
 * RULE 3 - "new page for a transactional query with no transactional surface".
 * If the dominant demand is transactional (buy/order/book/quote) and the tenant
 * is content-only (BusinessConfig.contentSiteMode - no checkout/booking/quote
 * flow to land the visitor on), a brand-new content page cannot satisfy a buyer
 * ready to act. Downgrade, not veto: an informational page can still capture and
 * redirect the demand (e.g. "where to buy X" content pointing at retailers), so
 * this is a probable, not certain, mismatch. Abstains when tenantHasNoTransactionalSurface
 * is unset (unknown) rather than guessing.
 */
const ruleTransactionalNoSurface: Rule = (ctx) => {
  if (ctx.action !== "create_page") return null;
  if (ctx.tenantHasNoTransactionalSurface !== true) return null;
  const surface = classifySurfaceIntent(ctx.primaryLabel);
  if (surface.intent !== "transactional") return null;

  const detail =
    `That question wants to buy/book/order right now, not read a new article, so I flagged the new page and ` +
    `suggest pointing this demand at a real transactional path (or an outbound recommendation) instead. ` +
    `Evidence: "${ctx.primaryLabel}" matched a transactional cue (${surface.signals.join(", ")}) and this site has ` +
    `no checkout, booking, or quote surface to land a ready-to-buy visitor on.`;

  return {
    kind: "wrong_lever_for_intent",
    against: ["create_page"],
    severity: "downgrade",
    detail,
    evidenceRefs: [
      {
        specialist: "gsc",
        source: "computed",
        key: ctx.primaryLabel,
        detail: `transactional query "${ctx.primaryLabel}" (${surface.signals.join(", ")}); tenant has no transactional surface`,
      },
    ],
  };
};

/** Rules run in order; the FIRST that fires wins (they target disjoint lever
 *  shapes, so overlap is not expected, but a single objection per call keeps
 *  the router's objection list from double-counting one mismatch two ways). */
const RULES: Rule[] = [ruleAnswerShapeMismatch, ruleNavigationalTitleRewrite, ruleTransactionalNoSurface];

/**
 * Classify the dominant intent behind a Move and check whether `action` can
 * serve it. Returns null when the classifier abstains (no queries/fanouts to
 * read) OR no rule finds a clear mismatch - silent, by design (conservative:
 * veto only on clear mismatches, downgrade on probable ones, silent otherwise).
 */
export function checkIntentVeto(input: IntentVetoInput): Objection | null {
  const { packet, action, tenantHasNoTransactionalSurface } = input;
  const primaryLabel = packet.move.label;

  // Synthesize the impression-weighted query signal the packet doesn't carry
  // yet (see the module doc's DATA HONESTY NOTE): the Move's own label is the
  // strongest real signal (weight 2 - it is literally what the demand graph
  // clustered this Move under), each AI fanout sub-question counts once. This
  // mirrors prepare-today-moves.ts's existing, shipped convention exactly, so
  // this module makes no new assumption about the data.
  const signal = [
    { query: primaryLabel, impressions: 2 },
    ...(packet.demand.fanoutSeeds ?? []).map((q) => ({ query: q, impressions: 1 })),
  ].filter((s) => s.query && s.query.trim());

  const cls = classifyQueryIntent(signal);
  if (!cls) return null; // no signal at all → abstain, never guess

  const ctx: RuleContext = {
    action,
    dominant: cls.dominant,
    dominantShare: cls.dominantShare,
    topQueries: cls.signals
      .filter((s) => s.intent === cls.dominant)
      .sort((a, b) => b.impressions - a.impressions)
      .map((s) => ({ query: s.query, impressions: s.impressions })),
    primaryLabel,
    tenantHasNoTransactionalSurface,
  };

  for (const rule of RULES) {
    const hit = rule(ctx);
    if (hit) return hit;
  }
  return null;
}

/**
 * read-honesty (V1 Truth Convergence Phase 7) - WHEN a measurement read stops being
 * clean, and HOW it is worded. Leaf module: nothing is imported at runtime, so the
 * kernel leans on it without a cycle.
 *
 * Four pure jobs:
 *   0. THE METRIC TABLE. Which Search number a change is judged on, for every spelling a
 *      stored row can carry, and an explicit "not judged" for one it cannot.
 *   1. OVERLAP CLOSURE. A bundle applied together is ONE treatment. A LATER change on
 *      the SAME page is a second one, and it CLOSES the earlier change's clean window on
 *      the day it landed: reads up to that day stand, reads after it are confounded by
 *      the overlap and say so in the operator's own language. An overlap that landed
 *      FIRST leaves no clean stretch at all, so that read is confounded outright.
 *   2. THE LEARNING SHAPE every read carries, so an account can learn from its own
 *      history later. Shape only: nothing here aggregates, scores, or leaves the account.
 *   3. THE HEADLINE. Directional, never causal: the page moved AFTER the change.
 */

import type { KernelMetric, KernelVerdict } from "./kernel";

const DAY_MS = 86_400_000;
/** Two changes on one page inside this many days of each other cannot be separated. */
const OVERLAP_WINDOW_DAYS = 28;

const dayOf = (iso: string): string => (iso.length > 10 ? iso.slice(0, 10) : iso);
const msOf = (iso: string): number => Date.parse(`${dayOf(iso)}T00:00:00Z`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May 10" from a YYYY-MM-DD or ISO day. Operator copy never carries a raw date stamp, and
 *  Measurement may not import the component layer, so the month/day rendering lives here and
 *  matches monthDayLabel (src/components/data/receipt-line.tsx) exactly. An unparseable day
 *  returns itself rather than an invented date. PURE (UTC). */
export function monthDay(iso: string): string {
  const [y, m, d] = dayOf(iso).split("-").map((s) => parseInt(s, 10));
  if (!Number.isFinite(y) || !Number.isFinite(d) || !MONTHS[m - 1]) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

// ── Job 0: the metric table (both vocabularies, side by side) ────────────────

/**
 * THE ONE METRIC TABLE. Every spelling a stored row can carry, mapped to the Search number
 * that actually moves when that change works.
 *
 * TWO VOCABULARIES REACH THIS FUNCTION AND ALWAYS HAVE. Older producers stamp a KIND
 * ("title", "internal_link", "content"); the bundle producer stamps a FAMILY off
 * `changeFamily` ("title-family", "section-family", "links-family"). The table used to hold
 * kinds only, so every family spelling fell through to clicks: a title rewrite was graded on
 * the one number a snippet change moves last, and it read as a loss for weeks. Both
 * vocabularies are listed here, in one place, and nothing else is inferred.
 *
 *   ctr       the change alters what the searcher READS in the result, so the honest question
 *             is whether the same impressions now earn more clicks.
 *   position  the change alters how the page is FOUND and which address is eligible to rank
 *             (links, navigation, canonicals, forwards), so rank is the honest question.
 *   clicks    the whole page changed. Rank, click rate and query coverage all move together
 *             and no single rate owns the answer, so their sum is the only number that holds
 *             all three. A new page and a merge have no before-state on their own address at
 *             all, so "how many clicks now arrive that did not before" is the only fair ask.
 *
 * ONE DELIBERATE SPLIT: `schema` named as a KIND is a rich-result play and reads on click
 * rate, but `technical-family` also holds forwards, canonicals, hiding and navigation, and
 * the family word cannot say which one shipped. The family reads on rank, which is the
 * number every member of it moves, so it can never flatter itself on a rate it never touched.
 */
const METRIC_BY_ACTION: Record<string, KernelMetric> = {
  // What the searcher reads in the result.
  title: "ctr", edit_title: "ctr", change_title: "ctr", "title-family": "ctr", title_meta: "ctr",
  meta: "ctr", edit_meta: "ctr", meta_description: "ctr", description: "ctr", "description-family": "ctr",
  h1: "ctr", change_h1: "ctr", answer: "ctr", answer_block: "ctr", intro_answer_block: "ctr",
  opening_answer: "ctr", faq: "ctr", snippet: "ctr", schema: "ctr", add_schema: "ctr", fix_schema: "ctr",
  // How the page is found, and which address ranks.
  link: "position", internal_link: "position", add_internal_link: "position", internal_links: "position",
  internal_link_add: "position", internal_link_remove: "position", anchor_text: "position",
  "links-family": "position", section_reorder: "position", navigation: "position",
  canonical: "position", redirect: "position", noindex: "position", "technical-family": "position",
  // The whole page changed, or the page itself is new.
  content: "clicks", "section-family": "clicks", section: "clicks", section_add: "clicks",
  section_remove: "clicks", section_rewrite: "clicks", restructure: "clicks", full_rewrite: "clicks",
  factual_correction: "clicks", paragraph_correction: "clicks", source_pack: "clicks",
  source_update: "clicks", entity_expansion: "clicks", table_or_list_add: "clicks",
  edit_page: "clicks", new_page: "clicks", create_page: "clicks", consolidation: "clicks",
};

/**
 * Which Search metric a change is judged on. PURE.
 *
 * FAILS CLOSED. A spelling this table does not hold reads as `unclassified`, which produces
 * no verdict, claims no number and teaches ranking nothing. It used to fall through to
 * clicks, which is not a safe default: a wrong measure reports a real win as a loss, and a
 * loss the operator acts on is worse than a reading that says it has nothing to say.
 */
export function metricFor(actionType: string): KernelMetric {
  const a = (actionType || "").trim().toLowerCase();
  return METRIC_BY_ACTION[a]
    ?? METRIC_BY_ACTION[a.replace(/^(edit|change|add|fix|update|create)_/, "")]
    ?? "unclassified";
}

/** One change as the overlap math sees it: which page it landed on, and the stamp its
 *  measurement window is read from (implementedAt where there is one). */
type AnchoredChange = { id: string; path: string; anchoredAt: string };

/**
 * For every change: the same-page changes whose windows overlap it, and the day its own
 * clean window CLOSED because a later change landed on the page.
 *
 *   cleanUntil = a date  -> every overlap landed AFTER this change. Reads that close on
 *                           or before that date are this change's alone; later ones are
 *                           confounded by the overlap.
 *   cleanUntil = null    -> either no overlap at all (ids empty), or an overlap landed at
 *                           the same time or earlier, which leaves no clean stretch to read.
 *
 * PURE.
 */
export function overlapClosures(
  changes: ReadonlyArray<AnchoredChange>,
): Map<string, { ids: string[]; cleanUntil: string | null }> {
  const out = new Map<string, { ids: string[]; cleanUntil: string | null }>();
  for (const c of changes) out.set(c.id, { ids: [], cleanUntil: null });
  const later = new Map<string, string[]>();
  for (const c of changes) later.set(c.id, []);
  for (let i = 0; i < changes.length; i += 1) {
    for (let j = i + 1; j < changes.length; j += 1) {
      const a = changes[i];
      const b = changes[j];
      if (a.path !== b.path) continue;
      const at = msOf(a.anchoredAt);
      const bt = msOf(b.anchoredAt);
      if (!Number.isFinite(at) || !Number.isFinite(bt)) continue;
      if (Math.abs(at - bt) > OVERLAP_WINDOW_DAYS * DAY_MS) continue;
      out.get(a.id)!.ids.push(b.id);
      out.get(b.id)!.ids.push(a.id);
      if (bt > at) later.get(a.id)!.push(dayOf(b.anchoredAt));
      else if (at > bt) later.get(b.id)!.push(dayOf(a.anchoredAt));
    }
  }
  for (const c of changes) {
    const entry = out.get(c.id)!;
    const laters = later.get(c.id)!;
    // A clean stretch exists only when EVERY overlap arrived after this change.
    if (entry.ids.length > 0 && laters.length === entry.ids.length) {
      entry.cleanUntil = laters.sort()[0];
    }
  }
  return out;
}

// ── The learning shape (record shapes preserved, nothing aggregated) ──────────

/** The closed family set, spelled exactly as the proposal store spells it. Duplicated on
 *  purpose: Measurement must not import Decision, and one page's family has to mean the
 *  same word on both sides of that line. */
type LearningFamily =
  | "title-family" | "section-family" | "links-family" | "technical-family"
  | "consolidation" | "new_page" | "unclassified";

const FAMILY_BY_KIND: Record<string, LearningFamily> = {
  answer_block: "section-family", intro_answer_block: "section-family",
  title: "title-family", meta: "title-family", h1: "title-family",
  opening_answer: "section-family", section: "section-family", source_pack: "section-family",
  paragraph_correction: "section-family", section_add: "section-family", section_remove: "section-family",
  section_rewrite: "section-family", restructure: "section-family", full_rewrite: "section-family",
  factual_correction: "section-family", source_update: "section-family", entity_expansion: "section-family",
  table_or_list_add: "section-family",
  internal_links: "links-family", internal_link_add: "links-family",
  internal_link_remove: "links-family", anchor_text: "links-family",
  schema: "technical-family", canonical: "technical-family", redirect: "technical-family",
  noindex: "technical-family", navigation: "technical-family",
  consolidation: "consolidation", new_page: "new_page",
  // THE SAME TWO VOCABULARIES. A row whose only action word IS the family ("title-family",
  // written straight off `changeFamily`) had no entry here and learned as "unclassified", so
  // every bundle this account shipped taught it nothing. A family answers for itself.
  "title-family": "title-family", "section-family": "section-family",
  "links-family": "links-family", "technical-family": "technical-family",
};

/** Biggest thing the change did wins, so one change always names one family. */
const FAMILY_PRECEDENCE: readonly LearningFamily[] = [
  "new_page", "consolidation", "technical-family", "section-family", "links-family", "title-family",
];

/** A legacy ledger row names its own action ("edit_title", "add_schema"); strip the verb
 *  and the same closed map answers for it too. */
function kindOf(raw: string): string {
  return (raw || "").toLowerCase().replace(/^(edit|change|add|fix|update|create)_/, "");
}

/**
 * What one settled read carries forward for later account-scoped learning. Additive and
 * decode-safe: a legacy row with no components still returns a shape, and anything the
 * ledger does not hold reads null instead of being guessed. No cross-account anything.
 * PURE.
 */
export function learningShape(args: {
  /** The bundle components the operator applied, when the row holds them. */
  componentKinds: readonly string[];
  /** The row's own action name, the fallback a pre-bundle record still answers with. */
  actionType: string;
  diagnosisCause: string | null;
  evidenceItemCount: number | null;
  direction: "up" | "down" | "flat" | "unclear";
}): {
  actionFamily: LearningFamily;
  diagnosisCause: string | null;
  evidenceCompleteness: number | null;
  outcomeDirection: "up" | "down" | "flat" | "unclear";
} {
  const kinds = args.componentKinds.length > 0 ? args.componentKinds : [args.actionType];
  const families = new Set(kinds.map((k) => FAMILY_BY_KIND[kindOf(k)]).filter(Boolean) as LearningFamily[]);
  const actionFamily = FAMILY_PRECEDENCE.find((f) => families.has(f)) ?? "unclassified";
  return {
    actionFamily,
    diagnosisCause: args.diagnosisCause,
    evidenceCompleteness: typeof args.evidenceItemCount === "number" ? args.evidenceItemCount : null,
    outcomeDirection: args.direction,
  };
}

// ── The headline (directional, never causal) ─────────────────────────────────

/** The SIZE of a move, never its sign: the sentence owns the direction. A signed number
 *  inside a sentence that already said "down" printed "+0.5pp" on a losing change. */
function formatLift(metric: KernelMetric, lift: number): string {
  if (metric === "ctr") {
    const pp = Math.abs(Math.round(lift * 1000) / 10);
    return `${pp} percentage point${pp === 1 ? "" : "s"} of click rate`;
  }
  const size = metric === "position" ? Math.round(Math.abs(lift) * 10) / 10 : Math.abs(Math.round(lift));
  return `${size} ${metric === "position" ? "rank" : "click"}${size === 1 ? "" : "s"}`;
}

/**
 * The operator-facing headline for one read. Every directional sentence says the page
 * moved AFTER the change and compares it to similar pages; none of them says caused. A
 * confounded read NAMES what confounded it: the other changes made in the same window, or
 * the day this page was changed again. PURE.
 */
export function buildHeadline(args: {
  verdict: KernelVerdict;
  metric: KernelMetric;
  lift: number;
  impressionsLift: number;
  basisDay: number;
  overlapCount: number;
  /** The day a later change on this page closed the clean window, when one did. */
  overlapClosedOn: string | null;
  ga4ExtraSessions: number | null;
  ga4Trustworthy: boolean;
}): string {
  const win = `${args.basisDay}-day`;
  const mature = args.basisDay >= 28;
  const ga4 =
    args.ga4Trustworthy && typeof args.ga4ExtraSessions === "number" && args.ga4ExtraSessions !== 0
      ? ` GA4 shows ${args.ga4ExtraSessions > 0 ? "+" : ""}${Math.round(args.ga4ExtraSessions)} sessions since the change.`
      : "";
  switch (args.verdict) {
    case "confounded":
      return args.overlapClosedOn != null
        ? `This page moved over the ${win} window, but the page changed again on ${monthDay(args.overlapClosedOn)}, so everything after that day belongs to both changes and this movement cannot be pinned on one.${ga4}`
        : `This page moved over the ${win} window, but ${args.overlapCount} other change${args.overlapCount === 1 ? "" : "s"} landed on it at the same time, so this movement cannot be pinned on one.${ga4}`;
    // Observational, never causal: the page MOVED after the change. A pre-28-day read is still measuring, so it never closes with a verdict.
    case "stronger_improvement":
      return `This page moved up after the change: ${formatLift(args.metric, args.lift)} ahead of similar pages over the ${win} window.${mature ? " A clear, well supported move." : " This firms up when the 28-day window closes."}${ga4}`;
    case "directional_improvement":
      return `This page moved up after the change: ${formatLift(args.metric, args.lift)} ahead of similar pages over the ${win} window. Still observational, not proof.${ga4}`;
    case "directional_decline":
      return `This page moved down after the change: ${formatLift(args.metric, args.lift)} behind similar pages over the ${win} window.${mature ? " Worth trying a different angle on this page." : " Still measuring. This firms up when the 28-day window closes."}${ga4}`;
    case "no_clear_movement":
    default: {
      const vis = args.impressionsLift > 50 ? ` The page is showing for more searches though (+${Math.round(args.impressionsLift)} impressions vs similar pages).` : "";
      return `No clear change yet: the movement sits inside the range of similar pages over the ${win} window.${vis}${ga4}`;
    }
  }
}

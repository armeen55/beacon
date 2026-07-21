/**
 * decide-action (Wave 3C, 2026-07-10) - THE single decision authority for a change.
 *
 * Every card on /changes carries EXACTLY ONE decision from a six-value enum, with a one-to-one
 * CTA. No rendered card copy ever offers two actions ("redirect or internal-link", "edit or
 * create", "or differentiate"): Beacon picks one, using the change's own demand/intent signals.
 * PURE, no I/O, no clock. Consumed by build-canonical-changes.ts (base decision from the change's
 * type/family) and changes-data.ts (refined with the source move's cannibalization case), and by
 * the Changes list client (the one CTA + the actionable-vs-archive split).
 *
 * Pinned by decide-action.test.ts (every RecommendationAction / UnifiedKind / changeFamily input
 * maps to one of the six; the cannibalization directive is a single action, never "X or Y").
 */
import type { CanonicalChange } from "./canonical-change";
import type { RecommendationAction } from "@/domains/recommendations/resolved-types";
import type { UnifiedKind } from "@/domains/allocator/unified-list";

export type ChangeDecision =
  | "do_nothing"
  | "watch"
  | "edit_existing"
  | "consolidate"
  | "create_new_page"
  | "prune_redirect";

export type DecisionResult = { decision: ChangeDecision; cta: string | null };

/** The four decisions that put a change ON the command path (the actionable queue). The other two
 *  (watch, do_nothing) are the archive: preserved, visible, but off the daily command path. */
export const ACT_DECISIONS: ReadonlySet<ChangeDecision> = new Set<ChangeDecision>([
  "edit_existing",
  "consolidate",
  "create_new_page",
  "prune_redirect",
]);

export function isActDecision(d: ChangeDecision | undefined | null): boolean {
  return d != null && ACT_DECISIONS.has(d);
}

/** Operator-facing decision label - one plain verb phrase, no jargon, no dashes, never two actions. */
export const DECISION_LABEL: Record<ChangeDecision, string> = {
  edit_existing: "Edit this page",
  consolidate: "Merge these pages",
  create_new_page: "Build a new page",
  prune_redirect: "Redirect this page",
  watch: "Watching",
  do_nothing: "Leave as is",
};

/** The ONE call-to-action per decision (one-to-one). watch shows "Why I'm waiting"; do_nothing has
 *  no CTA (there is nothing to act on). */
export const DECISION_CTA: Record<ChangeDecision, string | null> = {
  edit_existing: "See the edit",
  consolidate: "See the merge plan",
  create_new_page: "See the page plan",
  prune_redirect: "See the redirect",
  watch: "Why I'm waiting",
  do_nothing: null,
};

// ── Per-dimension mappers (each total; each returns exactly one of the six) ──────────────────

/** resolved-types.ts RecommendationAction -> one decision. split_or_separate is the only
 *  demand-dependent row: real demand for the split-out topic justifies a new page, otherwise the
 *  cheaper edit-in-place. */
export function decisionFromRecommendationAction(
  action: RecommendationAction,
  opts: { hasDemand?: boolean } = {},
): ChangeDecision {
  switch (action) {
    case "watch":
    case "needs_review":
      return "watch";
    case "strengthen_existing_page":
    case "expand_existing_page":
    case "add_section_or_faq":
      return "edit_existing";
    case "create_new_page":
      return "create_new_page";
    case "merge_or_dedupe":
      return "consolidate";
    case "split_or_separate_page":
      return opts.hasDemand ? "create_new_page" : "edit_existing";
    default:
      return "edit_existing";
  }
}

/** unified-list.ts UnifiedKind -> one decision. Everything that touches an existing page (edit /
 *  link / fix / promote) is an edit; only a brand-new page is a create. */
export function decisionFromUnifiedKind(kind: UnifiedKind): ChangeDecision {
  return kind === "create" ? "create_new_page" : "edit_existing";
}

/** canonical-change.ts changeFamily -> one decision. new_page/hub is a create; everything else is
 *  an edit to a page that already exists. */
export function decisionFromChangeFamily(family: string): ChangeDecision {
  return family === "new_page" || family === "hub" ? "create_new_page" : "edit_existing";
}

// ── Cannibalization (the self-competition case) ─────────────────────────────────────────────

/** The demand/intent inputs that decide a cannibalization row's single action. */
export type CannibalDecisionInput = {
  /** True for the best-ranking page in the group (it absorbs the others). */
  isLead: boolean;
  /** The follower pages still earn their own Google clicks (keep + internal-link) vs are dead
   *  (redirect them in). Only consulted for the lead's own row. */
  followerHasDemand?: boolean;
  /** The pages serve deliberately distinct audiences (male/female, boy/girl, ...): differentiate
   *  in place, never fold together. */
  oppositeIntent?: boolean;
  /** The lead is the site homepage: a topic page must never redirect into the root. */
  leadIsHome?: boolean;
};

/** Decide the ONE action for a self-competition case, per the demand/intent rules:
 *   - lead page: fold the followers in with internal links when they still earn clicks, or with a
 *     redirect when they are dead;
 *   - homepage lead: never redirect a topic page into the root, so the topic page is edited to
 *     become the dedicated answer;
 *   - follower page: edit in place (add one internal link to the lead, or differentiate a distinct
 *     audience) - never a two-action "link or differentiate". */
export function decisionFromCannibalization(i: CannibalDecisionInput): ChangeDecision {
  if (i.leadIsHome) return "edit_existing";
  if (i.isLead) return i.followerHasDemand ? "edit_existing" : "prune_redirect";
  return "edit_existing";
}

/** The single plain-language directive for a cannibalization case, built from the DECIDED action -
 *  never a "redirect or internal-link" fork. First person free, no jargon, no dashes. */
export function cannibalizationDirective(i: {
  decision: ChangeDecision;
  leadPage: string;
  otherPages: string[];
  query: string;
  isLead: boolean;
}): string {
  const others = i.otherPages.join(", ");
  if (i.decision === "prune_redirect") {
    return i.isLead
      ? `"${i.leadPage}" is your best-ranking page for "${i.query}", so fold ${others} into it with a redirect so they stop splitting its clicks.`
      : `Redirect this page into "${i.leadPage}", your best-ranking one for "${i.query}", so they stop competing.`;
  }
  if (i.decision === "consolidate") {
    return `Consolidate your competing pages for "${i.query}" into "${i.leadPage}", your best-ranking one.`;
  }
  return i.isLead
    ? `"${i.leadPage}" is your best-ranking page for "${i.query}", so fold ${others} into it with one internal link each so they stop splitting its clicks.`
    : `Point this page at "${i.leadPage}", your best-ranking one for "${i.query}", with one internal link so they stop competing.`;
}

// ── The main entry: a CanonicalChange (+ its source move when known) -> one decision + CTA ───

export type DecideChangeInput = Pick<
  CanonicalChange,
  "status" | "changeType" | "changeFamily" | "qualityDecision"
> & {
  /** The change's target page path. Optional so the four-field base-decision
   *  callers (build-canonical-changes) stay valid, but supplied by every caller
   *  that passes a full CanonicalChange. When it names a real, already-live page,
   *  the change can never be a "build a new page" (see resolveDecision). */
  pagePath?: string | null;
};

/**
 * True when `pagePath` names a real, already-live content page (a normal
 * "/slug" path), as opposed to an empty/root/placeholder or a synthetic
 * not-yet-created marker. Used to catch the create/edit mislabel: a change
 * that targets a page which already exists can never be a "build a new page".
 * Pure.
 */
export function isRealExistingPagePath(pagePath: string | null | undefined): boolean {
  if (pagePath == null) return false;
  const p = pagePath.trim();
  if (p === "" || p === "/") return false;
  // A genuinely not-yet-created page carries a synthetic marker, never a live slug.
  if (/^(new|draft|proposed|create):/i.test(p)) return false;
  return p.startsWith("/") && p.length > 1;
}

export type DecideMoveInput = {
  cannibalization?: ReadonlyArray<{ isLead?: boolean; decision?: ChangeDecision } | null | undefined> | null;
} | null;

/**
 * THE single decision + one-to-one CTA for a change. Precedence:
 *   1. not actionable now (skipped / blocked by a live measurement or protected control) -> do_nothing;
 *   2. a failed content check (quality flagged) is never a confident move -> watch;
 *   3. a self-competition case on the source move decides consolidate / edit / prune;
 *   4. otherwise the change type/family decides create vs edit.
 * PURE, total.
 */
export function decideChangeAction(c: DecideChangeInput, move?: DecideMoveInput): DecisionResult {
  const decision = resolveDecision(c, move);
  return { decision, cta: DECISION_CTA[decision] };
}

/**
 * Destructive-action guard (audit 2026-07-20). A consolidate (merge) is ADVISORY
 * prose only: merging pages destroys URLs, and shipping a merge as paste-ready
 * `exactInstructions` would ship destruction with ZERO evidence gating. Today no
 * path attaches instructions to a consolidate row (they carry exactInstructions:
 * null), but this is a LATENT gap: if any future path ever does, this strips the
 * instructions back to advisory and logs LOUDLY. Type-level, total, pure aside
 * from the console warning. Call at the boundary that assembles a CanonicalChange
 * (build-canonical-changes / changes-data), right after the decision is known.
 */
export function stripInstructionsOnConsolidate<
  T extends { exactInstructions?: string | null },
>(decision: ChangeDecision, change: T): T {
  if (decision === "consolidate" && change.exactInstructions != null) {
    // LOUD: this must never happen in the current codebase. If it fires, a future
    // path attached destructive paste-ready text to a merge without evidence
    // gating — strip it to advisory before it can reach the operator.
    console.error(
      "[decide-action] BLOCKED destructive paste-ready text on a consolidate (merge) change; " +
        "stripping exactInstructions to advisory. Merging pages destroys URLs and must never " +
        "ship as a one-tap instruction without evidence gating.",
    );
    return { ...change, exactInstructions: null };
  }
  return change;
}

function resolveDecision(c: DecideChangeInput, move?: DecideMoveInput): ChangeDecision {
  if (c.status === "skipped" || c.status === "blocked") return "do_nothing";
  if (c.qualityDecision === "flagged") return "watch";
  const cannib = move?.cannibalization?.find((x): x is { isLead?: boolean; decision?: ChangeDecision } => !!x);
  if (cannib) {
    return cannib.decision ?? (cannib.isLead ? "consolidate" : "edit_existing");
  }
  const t = (c.changeType ?? "").toLowerCase();
  if (/merge|dedupe|consolidat/.test(t)) return "consolidate";
  if (/redirect|prune/.test(t)) return "prune_redirect";
  // An EXPLICIT create/new-page action type is a genuine build. A new_page
  // FAMILY alone is not: changeTypeFamily() collapses any "page"/"hub" action
  // type (e.g. split_page, which EDITS an existing page) into the new_page
  // family. So when only the family says new_page, a real already-live pagePath
  // forces the edit family — creating a page at a URL that already has one is
  // impossible (certified: /iran-animals/red-fox was rendering as "Build a new
  // page" for a page that already existed).
  if (/create|new_page/.test(t)) return "create_new_page";
  if (c.changeFamily === "new_page" || c.changeFamily === "hub") {
    return isRealExistingPagePath(c.pagePath) ? "edit_existing" : "create_new_page";
  }
  return "edit_existing";
}

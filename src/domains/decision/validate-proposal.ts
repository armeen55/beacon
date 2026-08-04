/**
 * decision/validate-proposal (CORE 100K decision kernel): the ONE
 * validator every ChangeProposal passes through before it can be shown as
 * actionable. It composes the existing, battle-tested safety gates into a
 * single verdict, so there is exactly one place that decides "is this draft
 * safe to put in front of a paying operator":
 *
 *   - draft-quality.ts (evaluateTitleMetaQuality)
 *     covers generic/thin/off-topic/relevance/missing-source/source-authority.
 *   - factual-entailment.ts (checkFactualEntailment): an invented number or
 *     entity with no grounding is a VIOLATION and rejects the draft; a dated,
 *     sourced contradiction of the page is an allowed CORRECTION (surfaced, not
 *     blocked).
 *   - placeholder-detection.ts (looksLikePlaceholder): "[insert X]" / lorem.
 *   - copy-sanitize.ts (containsUuid, plus the SHARED host, autopublish and written-out
 *     proportion nets this file used to keep a smaller private copy of: it knew thirteen public
 *     suffixes where the drafter knew thirty-three, so an invented .wiki address passed both).
 *   - dash ban: no em or en dash ever reaches operator-facing copy.
 *   - destructive-change guard: an "edit" that guts the current value (empties
 *     it or truncates it to a fraction) is never presented as a safe rewrite.
 *
 * The verdict is the ONE answer: `ready` and `needs_review` are the stages a draft may earn, and
 * `rejected` earns none at all, so that draft is withdrawn rather than staged. PURE, no I/O.
 */

import {
  evaluateTitleMetaQuality,
  type DraftQualityResult,
  type DraftQualityStatus,
} from "@/domains/decision/drafts/draft-quality";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import type { ClassifiableSource } from "@/domains/decision/drafts/source-authority";
import { looksLikePlaceholder } from "./placeholder-detection";
import { containsUuid, AUTOPUBLISH_RE, CODE_SUFFIX, HOST_RE, SPELLED_PROPORTION_RE } from "./copy-sanitize";
import type { BundleComponent, BundleComponentKind, ChangeProposal, RecommendedChange } from "./contracts";
import { dangerousComponents, needsSourcePack } from "./contracts";

/** Quality statuses that are HARD failures, never actionable and always rejected.
 *  These are inventions / garbage / off-topic / malformed drafts: unsafe copy.
 *  NOTE the source HOLDS (`missing_source`, `needs_source_check`) are deliberately
 *  NOT here: a factual claim that just needs a citation is a `needs_review` hold
 *  ("add a source"), never presented as ready, but not the same as an invention. */
const REJECT_STATUSES: ReadonlySet<DraftQualityStatus> = new Set<DraftQualityStatus>([
  "generic_rejected",
  "relevance_rejected",
  "fact_risk",
  "unsupported_claim",
  "too_thin",
  "malformed",
  "unverified_claim",
]);

const DASH_RE = /[–—]/; // en-dash, em-dash
/** THE ONE PAGE, ONE STORY nets: a change may not hold this page's words in one sentence and miss them in the
 *  next, and a reading I took weeks ago is not what the page says while the operator is looking at it. */
const HOLDS_PAGE = /\bI (?:read|hold) this page's (?:stored words|own words|full body text)\b/i;
const MISSING_PAGE = /\bI do not hold this page's (?:full body text|own words|own opening words|own sections)\b/i;
const CURRENT_CLAIM = /\b(?:today|right now|currently|as it stands)\b/i;

/**
 * THE ROW'S OWN INTEGRITY, in ONE place, so the gate judging a fresh draft and the pass re-judging a stored one
 * ask exactly the same questions. Every one of these shipped to a paying operator on one live change: a cause
 * citing a comparison the receipt never carried, a page both held and not held in the same card, a dangerous
 * merge filed as a medium risk, and a June reading described as what the page says today. PURE.
 */
export function receiptIntegrityFailures(proposal: ChangeProposal, now: Date = new Date()): string[] {
  const bundle = proposal.bundle;
  if (!bundle) return [];
  const out: string[] = [];
  // A DOOR MAY REFUSE A CHANGE; IT MAY NEVER CRASH ON ONE: this runs on every read path, so a row missing an
  // array a fresh draft always carries is judged, never thrown on top of the operator as a 500.
  const some = <T,>(x: readonly T[] | undefined): readonly T[] => x ?? [];
  const items = some(bundle.receipt?.items), components = some(bundle.components);
  const keys = new Set(items.map((i) => i.key));
  const cited = [...components.flatMap((c) => some(c.evidenceKeys)), ...some(proposal.causeFinding?.evidenceKeys)];
  if (cited.some((k) => !keys.has(k))) out.push("Part of this change points at evidence I cannot show you, so I am not putting it in front of you.");
  // EVERYTHING THE OPERATOR READS ON THIS CHANGE, the copy itself included: a contradiction in the sentence
  // being pasted is the one they act on, so it may not hide from a check the notes around it pass.
  const says = [...some(proposal.limitations), ...some(bundle.risks), ...some(bundle.confidenceReasons), ...some(bundle.receipt?.missing),
    ...items.map((i) => i.fact), ...components.map((c) => `${c.after} ${c.objective ?? ""} ${c.mechanism ?? ""}`),
    ...(proposal.causeFinding ? [proposal.causeFinding.explanation, ...some(proposal.causeFinding.notConsidered).map((n) => n.missing)] : [])].join(" ");
  if (HOLDS_PAGE.test(says) && MISSING_PAGE.test(says)) out.push("I say two different things about whether I hold this page's own words, so I am not putting it in front of you.");
  if (dangerousComponents(components).length > 0 && (proposal.riskLevel !== "high" || proposal.status === "ready")) {
    out.push("This change moves or hides a page and it is filed as something lighter than that, so I am not putting it in front of you.");
  }
  // A READING IS CURRENT ONLY IF IT WAS TAKEN TODAY, and an UNDATED reading is not current either: skipping the
  // undated ones let the one line that carries no date say "today" and mean whenever it was last collected.
  const day = now.toISOString().slice(0, 10);
  for (const item of items) {
    const read = (item.observedAt ?? "").slice(0, 10);
    if (read === day || !CURRENT_CLAIM.test(item.fact)) continue;
    out.push(read ? `I call what I read on ${read} what this page says today, so I am not putting it in front of you.`
      : "I call a reading with no date on it what this page says today, so I am not putting it in front of you.");
  }
  return [...new Set(out)];
}

/** A receipt is a set of READINGS, and a reading goes out of date. Past this a stored change proves nothing
 *  current: the basis stamp only moves when the ACCOUNT changes, so without this a change stayed Ready forever
 *  on a profile nobody had edited. `proposalFingerprint` already carries each item's key, fact and date, so a
 *  redraft off moved evidence writes a new version; this is the half for the change nobody redrafts at all. */
const EVIDENCE_VALID_DAYS = 30;

/**
 * THE ONE ANSWER EVERY DOOR ASKS about a stored change, so a direct link can never render what the ranked
 * list refuses and no mutation can land on a change the screen would not show. It composes the row's own
 * integrity above with the four things only the account can answer: whose change this is, whether it was
 * drafted under the bar I hold right now, whether anyone is still being asked, and whether the readings
 * behind it still stand. PURE. Empty means this change is work. The new-page BRIEF bar (`validateProposal`)
 * stays out on purpose: it decides which briefs may become work and be SHOWN as work, so it rides the queue
 * and the detail page, where a page the operator has already BUILT is not up for reconsideration.
 */
export function actionableProposalFailures(
  p: ChangeProposal, ctx: { tenantId: string; currentBasis: string | null; now?: Date },
): string[] {
  const now = ctx.now ?? new Date();
  const out = [...receiptIntegrityFailures(p, now)];
  if (p.tenantId !== ctx.tenantId) out.push("This change was drafted for another account, so I am not putting it in front of you.");
  if (ctx.currentBasis == null || p.basis !== ctx.currentBasis) out.push("I raised the bar for what counts as worth your time, and this one no longer clears it, so I am not putting it in front of you.");
  if (p.status !== "ready" && p.status !== "needs_review") out.push("This one is not waiting on you any more, so I am not putting it in front of you.");
  if (staleReadings(p, now)) {
    out.push("The readings behind this change are too old to stand on now, so I am taking them again before I put it in front of you.");
  }
  return [...new Set(out)];
}

/** PURE: the newest of these readings, or null when none of them carries a date at all. An undated reading is
 *  not a fresh one and not a stale one either: it is a figure with no clock on it (a 90 day total, a pattern
 *  across a results page), so it neither keeps a component alive nor kills it. */
const newestReading = (items: readonly { observedAt: string | null }[]): number | null => {
  const read = items.map((i) => Date.parse(i.observedAt ?? "")).filter((t) => Number.isFinite(t));
  return read.length > 0 ? Math.max(...read) : null;
};

/**
 * IS THIS CHANGE STANDING ON COLD READINGS? PER COMPONENT, because a receipt is mixed by design and the whole
 * receipt's freshest date is not any one component's evidence: ONE AI answer taken this morning kept a body
 * rewrite alive on a page nobody had read in two months and a results page nobody had checked since. A
 * component is fresh only if the items ITS OWN evidenceKeys cite are inside the window, and the change is
 * only as fresh as its coldest component, because the operator applies all of them together.
 *
 * A proposal with NO BUNDLE has no receipt to read, so it ages on ITS OWN CLOCK: it was drafted from evidence
 * that day and nothing has re-derived it since. It used to be seeded with `now` and could never expire at
 * all, which left an atomic change Ready forever on a profile nobody had edited.
 */
function staleReadings(p: ChangeProposal, now: Date): boolean {
  const floor = now.getTime() - EVIDENCE_VALID_DAYS * 86_400_000;
  const receipt = p.bundle?.receipt;
  if (!receipt) { const drafted = Date.parse(p.createdAt ?? ""); return !Number.isFinite(drafted) || drafted < floor; }
  const components = p.bundle?.components ?? [];
  // A row carrying no component to ask (a legacy shape) still answers on the receipt as a whole rather than
  // silently passing, and an empty receipt falls back to the one date the producer wrote beside it.
  if (components.length === 0) return (newestReading(receipt.items.length ? receipt.items : [{ observedAt: receipt.freshestObservedAt }]) ?? -Infinity) < floor;
  const byKey = new Map(receipt.items.map((i) => [i.key, i]));
  const dates = components.map((c) => newestReading(c.evidenceKeys.map((k) => byKey.get(k)).filter((i) => !!i)));
  // NOTHING DATED ANYWHERE ON THE RECEIPT still ages. Real receipt keys carry no observation date at all (the page's own demand, the diagnosis I wrote, the pattern the
  // winners share), so per-component freshness on its own would have let a change whose every reading is undated stand for ever. It falls back to the day it was
  // drafted, exactly as a change with no receipt does. One dated reading anywhere hands the verdict back to the components.
  if (dates.every((d) => d == null)) { const drafted = Date.parse(p.createdAt ?? ""); return !Number.isFinite(drafted) || drafted < floor; }
  return dates.some((d) => d != null && d < floor); // an undated component beside a dated one ages with the change, never against its sibling
}

export type ProposalVerdict = "ready" | "needs_review" | "rejected";

export type ProposalValidation = {
  verdict: ProposalVerdict;
  /** The underlying draft-quality status (for debugging + UI notes). */
  qualityStatus: DraftQualityStatus;
  /** Plain-English reasons (why it was held or rejected). */
  reasons: string[];
  /** Unsupported-invention findings from factual entailment. Non-empty rejects. */
  factViolations: string[];
  /** Sourced corrections, surfaced WITH the proposal and never blocking. */
  corrections: string[];
  /** The hard-safety checks that tripped (placeholder/dash/uuid/destructive). */
  safetyFlags: string[];
  confidence: "high" | "medium" | "low";
};

/** Text fields the hard-safety scanners run over, per proposal kind. */
function operatorFacingText(proposal: ChangeProposal): string[] {
  const c = proposal.recommendedChange;
  if (c.kind === "existing_edit") return [c.after];
  return [c.proposedTitle, c.metaDescription, c.openingAnswer, ...c.outline, ...c.faqQuestions];
}

const NUMBER_RE = /\d[\d,.]*/g;
/** The proposal must say out loud that the operator is the one who publishes it. */
const MANUAL_RE = /\byou\b[^.]{0,80}\bpublish/i;
const digits = (s: string): string => s.replace(/,/g, "").replace(/\.$/, "");

/**
 * THE new-page gate (N4, 2026-07-28). A page brief is not quality-checked like a title
 * rewrite: there is no current value to compare it against and no page body to entail it
 * from. What CAN be checked is that it is a researched page rather than an idea somebody
 * had, so this asks exactly that and rejects everything that cannot show it: the earned
 * verdict it was built from, copy that is about this topic, an outline that is real and not
 * repeated, every component tracing to a receipt item, and no number, address or promise the
 * evidence does not carry. HISTORY FAILS HERE BY CONSTRUCTION: a brief drafted before this
 * contract carries no bundle, so it can never be shown as work. PURE.
 */
function evaluateNewPageBrief(
  proposal: ChangeProposal,
  change: Extract<RecommendedChange, { kind: "new_page" }>,
  evidenceText: string | null,
): DraftQualityResult {
  const bad = (reason: string): DraftQualityResult =>
    ({ status: "malformed", reasons: [reason], copyAllowed: false, canRegenerate: false, confidence: "low" });
  const bundle = proposal.bundle;
  const items = bundle?.receipt.items ?? [];
  // The earned verdict itself, carried as inspectable evidence beside the pages it compared.
  if (!bundle || !items.some((i) => i.key === "verdict" && i.kind === "diagnosis") || bundle.alternatives.length === 0) {
    return bad("I cannot show you the research that proved this page is missing, so I am not putting it in front of you.");
  }
  const keys = new Set(items.map((i) => i.key));
  if (bundle.components.some((c) => c.evidenceKeys.length === 0 || c.evidenceKeys.some((k) => !keys.has(k)))) {
    return bad("Part of this page cannot be traced back to anything I checked, so I am not putting it in front of you.");
  }
  const headings = change.outline.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (headings.length < 3 || new Set(headings).size !== headings.length) {
    return bad("This page's sections are too thin or repeat each other, so I am not putting it in front of you.");
  }
  const topic = new Set(proposal.primaryQuery.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const about = (t: string): boolean => topic.size === 0 || t.toLowerCase().split(/[^a-z0-9]+/).some((w) => topic.has(w));
  if (![change.proposedTitle, change.metaDescription, change.openingAnswer].every((t) => t.trim().length > 0 && about(t))) {
    return bad("This page's title, description or opening does not say what the page is about, so I am not putting it in front of you.");
  }
  const grounding = [evidenceText ?? "", ...items.map((i) => i.fact), ...proposal.evidence.hints].join(" ").toLowerCase();
  const copy = [...operatorFacingText(proposal), ...bundle.components.map((c) => c.after)].join(" ");
  if (AUTOPUBLISH_RE.test(copy) || SPELLED_PROPORTION_RE.test(copy) || proposal.publish !== "manual" || !MANUAL_RE.test([proposal.whyItMatters, ...bundle.risks].join(" "))) {
    return bad("This page does not say plainly that you are the one who publishes it, so I am not putting it in front of you.");
  }
  const grounded = new Set((grounding.match(NUMBER_RE) ?? []).map(digits));
  const stray = (copy.match(NUMBER_RE) ?? []).map(digits).find((n) => !grounded.has(n));
  if (stray) return bad(`This page quotes ${stray}, which is not a figure I actually hold, so I am not putting it in front of you.`);
  const strayHost = (copy.match(HOST_RE) ?? []).map((h) => h.toLowerCase()).filter((h) => !CODE_SUFFIX.test(h)).find((h) => !grounding.includes(h));
  if (strayHost) return bad(`This page names ${strayHost}, which is not a site I actually looked at, so I am not putting it in front of you.`);
  // Everything this gate can check is checked. The caution a brand new page deserves rides
  // on the bundle's own risks, where the operator reads it, not as a held status.
  return { status: "ready", reasons: [], copyAllowed: true, canRegenerate: true, confidence: "medium" };
}

/**
 * THE COMPONENT GATE (Phase 4). The seven original kinds are grandfathered exactly as
 * they stand, so every persisted bundle still validates. Every kind the complete change
 * universe added has to answer for itself before it can be shown as work:
 *   - it cites at least one receipt item (a component with no evidence is never emitted);
 *   - it says WHERE on the page it lands, WHAT it achieves, WHY that lever moves the
 *     diagnosed cause, and WHAT I will measure afterwards;
 *   - a change to factual content carries a source pack, because a corrected fact with
 *     nothing behind it is worse than the stale one it replaced;
 *   - a dangerous kind is marked dangerous, so it cannot slip through as a safe paste.
 * Returns operator-facing reasons, never validator vocabulary. PURE.
 */
const LEGACY_KINDS: ReadonlySet<BundleComponentKind> =
  new Set<BundleComponentKind>(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack"]);

/**
 * THE PROSE NET. The gate above decides danger by KIND, and a kind is a label somebody typed: a legacy
 * `section` component whose copy said "301 redirect this to the guide and noindex the old one" was a
 * redirect, a de-indexing and a merge, and it validated as a paste-ready section rewrite. So the proposed
 * copy itself is read: an instruction to move, hide, canonicalize, delete or merge a page, filed as
 * anything other than the kind that names that change, is a MISLABELLED change and is rejected. Bounded,
 * case insensitive, and matched on the proposal only, never on the current value it replaces.
 */
const MISLABELLED: ReadonlyArray<{ kind: BundleComponentKind; re: RegExp; what: string }> = [
  { kind: "redirect", re: /\b30[12]\s*(?:permanent\s*)?redirect|\bredirect(?:s|ed|ing)?\s+(?:this|that|the|it|to)\b/i,
    what: "sends this page's address somewhere else" },
  { kind: "noindex", re: /\bno[\s-]?index(?:ed|ing)?\b/i, what: "stops people finding this page in search" },
  { kind: "canonical", re: /\brel\s*=\s*["']?\s*canonical|\bcanonical\s+(?:tag|link|url)\b|\bcanonicali[sz]e/i,
    what: "points this page at another one as the real address" },
  { kind: "consolidation", re: /\b(?:delete|remove|merge|consolidate|combine|fold|retire)\s+(?:this|that|the)\s+(?:page|url|article|post)\b/i,
    what: "deletes this page or merges it into another" },
];

/** Held wording, flattened, so "Barrel Sizes" and "barrel  sizes" are one thing on both sides. */
const flatten = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

function componentFailures(components: readonly BundleComponent[], heldHeadings: readonly string[] = []): string[] {
  const out: string[] = [];
  const marked = new Set(components.filter((c) => c.risk === "dangerous"));
  for (const c of components) {
    const what = c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ");
    if (c.evidenceKeys.length === 0) { out.push(`I cannot show you anything behind the ${what}, so I am not putting it in front of you.`); continue; }
    // A REBUILD MAY NOT DROP A SECTION IN SILENCE. A page being replaced is the one change that can quietly
    // delete something ranking, so every section I hold has to survive into the draft OR be named as a loss
    // with its own reason. Unnamed is refused: nobody loses a section they were never told about.
    if (c.kind === "full_rewrite") {
      const draft = flatten(c.after);
      const named = flatten((c.preserves?.losses ?? []).map((l) => l.what).join(" | "));
      for (const heading of heldHeadings) {
        const held = flatten(heading);
        if (!held || draft.includes(held) || named.includes(held)) continue;
        out.push(`The rebuild drops "${heading.trim()}" and never says why, so I am not putting it in front of you.`);
      }
    }
    if (needsSourcePack(c) && !c.sourcePack) out.push(`The ${what} changes a fact and carries no sources to check it against, so I am not putting it in front of you.`);
    for (const m of MISLABELLED) {
      if (c.kind !== m.kind && m.re.test(c.after)) {
        out.push(`The ${what} ${m.what}, and it is filed as an ordinary edit instead of that change, so I am not putting it in front of you.`);
      }
    }
    if (!LEGACY_KINDS.has(c.kind)) {
      const owed = [!c.where && "where on the page it goes", !c.objective && "what it is meant to achieve",
        !c.mechanism && "why it fixes what I diagnosed", !c.measurementPlan && "what I will measure afterwards"].filter((x): x is string => !!x);
      if (owed.length > 0) out.push(`I cannot tell you ${owed.join(", ")} for the ${what}, so I am not putting it in front of you.`);
    }
  }
  // A dangerous lever that was not marked dangerous is a mislabelled change, and a
  // mislabelled change is exactly the one that gets pasted without a second look.
  for (const c of dangerousComponents(components)) {
    if (!marked.has(c)) out.push(`The ${c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ")} changes where this page lives or whether people can find it, and it is not marked as one that needs your confirmation, so I am not putting it in front of you.`);
  }
  return out;
}

/** Destructive-change guard: an existing-page edit that empties or guts the
 *  current value. A rewrite should improve the field, never delete it. */
function isDestructiveEdit(before: string | null, after: string): boolean {
  const b = (before ?? "").trim();
  const a = after.trim();
  if (!a) return true; // nothing left
  if (!b) return false; // no prior value to destroy
  // Truncating a substantial field to under a third of its length is a gut,
  // not a rewrite (title/meta rewrites stay in the same ballpark of length).
  if (b.length >= 30 && a.length < b.length * 0.34) return true;
  return false;
}

export type ValidateProposalOptions = {
  /** The target page's own body text, which turns ON factual entailment. */
  pageBodyText?: string | null;
  /** Flattened evidence text the draft may cite (numbers/facts). */
  evidenceText?: string | null;
  /** Dated, sourced facts on file (allow a correction). */
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** The draft's own cited sources (authority re-derived by the gate). */
  sources?: readonly ClassifiableSource[];
  /** This tenant's curated authoritative-domain allowlist. */
  authoritativeSourceDomains?: readonly string[];
  /** Content-context vocabulary override (defaults to the gate's own). */
  contextTokens?: string[];
  /** The sections this account's own page ACTUALLY carries, as held. A rebuild is checked against these:
   *  absent means I hold no outline for the page, so nothing is checked rather than everything passing. */
  heldHeadings?: readonly string[];
  now?: Date;
};

/**
 * Validate one ChangeProposal. Returns the verdict + the mapped lifecycle
 * status. A hard-safety trip or a factual violation ALWAYS rejects; a clean
 * quality "ready" draft is `proposed`; anything in between is `needs_review`.
 */
export function validateProposal(
  proposal: ChangeProposal,
  opts: ValidateProposalOptions = {},
): ProposalValidation {
  const change = proposal.recommendedChange;
  const texts = operatorFacingText(proposal);
  const query = proposal.primaryQuery;

  // ── hard-safety scanners (deterministic, no LLM) ────────────────────────────
  const safetyFlags: string[] = [];
  for (const t of texts) {
    if (looksLikePlaceholder(t)) safetyFlags.push("Contains a placeholder / template stub.");
    if (DASH_RE.test(t)) safetyFlags.push("Contains an em or en dash (banned in operator copy).");
    if (containsUuid(t)) safetyFlags.push("Leaks a raw id into operator copy.");
  }
  if (change.kind === "existing_edit" && isDestructiveEdit(change.before, change.after)) {
    safetyFlags.push("Rewrite deletes or guts the current value (destructive edit).");
  }

  // ── factual entailment (an invented number or entity is a violation) ────────
  // Only the EXISTING-page edit path runs entity-level entailment: it has a real
  // page body / current value to check a new claim against, so an invented
  // number or entity is a genuine violation (or a dated, sourced correction). A
  // brand-NEW page inherently introduces entities that are not yet on any page,
  // so entity-entailment there is pure noise; its ungrounded-NUMBER protection
  // is already enforced upstream by the drafter's numeric-fidelity firewall at
  // generation, so a persisted brief cannot carry an invented number.
  const entail = change.kind === "existing_edit"
    ? checkFactualEntailment({
        draftText: change.after,
        query,
        pageBodyText: opts.pageBodyText ?? null,
        evidenceText: opts.evidenceText ?? proposal.evidence.hints.join(" "),
        authoritativeFacts: opts.authoritativeFacts,
        nowYear: (opts.now ?? new Date()).getFullYear(),
      })
    : { entailed: true, violations: [], corrections: [], findings: [] };

  // ── draft-quality gate (generic/thin/relevance/source-authority) ────────────
  let quality: DraftQualityResult;
  if (change.kind === "existing_edit") {
    quality = evaluateTitleMetaQuality({
      before: change.before,
      after: change.after,
      field: change.field,
      query,
      contextTokens: opts.contextTokens,
      pageBodyText: opts.pageBodyText,
      evidenceText: opts.evidenceText,
      authoritativeFacts: opts.authoritativeFacts,
      sources: opts.sources,
      authoritativeSourceDomains: opts.authoritativeSourceDomains,
    });
  } else {
    quality = evaluateNewPageBrief(proposal, change, opts.evidenceText ?? null);
  }

  // ── the component gate + the two-step hold ──────────────────────────────────
  const components = proposal.bundle?.components ?? [];
  const componentFails = [...componentFailures(components, opts.heldHeadings ?? []),
    ...receiptIntegrityFailures(proposal, opts.now ?? new Date())];
  // THE TWO-STEP CONFIRMATION, in the one vocabulary this product already has: a
  // dangerous component can never read as ready, it is held for the operator to look at
  // and then act. There is no second flag and no second lifecycle.
  const dangerous = dangerousComponents(components);

  // ── compose the single verdict ──────────────────────────────────────────────
  // The two-step note is carried WHATEVER else the verdict turns out to be: the operator
  // has to read it before acting, and burying it behind another hold is how it gets missed.
  const reasons: string[] = [...quality.reasons, ...dangerous.map((c) =>
    `${c.label.trim() || c.kind.replace(/_/g, " ")}: this one changes where the page lives or whether people can find it, so read it once and confirm it before you make the change.`)];
  const factViolations = entail.violations;
  const corrections = entail.corrections;

  let verdict: ProposalVerdict;
  if (safetyFlags.length > 0 || factViolations.length > 0 || componentFails.length > 0 || REJECT_STATUSES.has(quality.status)) {
    verdict = "rejected";
    reasons.push(...safetyFlags, ...factViolations, ...componentFails);
  } else if (dangerous.length > 0) {
    verdict = "needs_review";
  } else if (quality.status === "ready" && quality.copyAllowed) {
    verdict = "ready";
  } else {
    // useful_but_needs_review / needs_source_check / not_quotable / stale_data_changed
    verdict = "needs_review";
  }

  return {
    verdict,
    qualityStatus: quality.status,
    reasons: [...new Set(reasons)],
    factViolations,
    corrections,
    safetyFlags,
    confidence: quality.confidence,
  };
}

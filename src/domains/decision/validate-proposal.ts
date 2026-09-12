/** decision/validate-proposal (CORE 100K decision kernel): the ONE validator every ChangeProposal passes through before it can be shown as actionable. It composes the existing, battle-tested safety gates into a single verdict, so there is exactly one place that decides "is this draft safe to put in front of a paying operator": - draft-quality.ts (evaluateTitleMetaQuality) covers generic/thin/off-topic/relevance/missing-source/source-authority. - factual-entailment.ts (checkFactualEntailment): an invented number or entity with no grounding is a VIOLATION and rejects the draft; a dated, sourced contradiction of the page is an allowed CORRECTION (surfaced, not blocked). - placeholder-detection.ts (looksLikePlaceholder): "[insert X]" / lorem. - copy-sanitize.ts (containsUuid, plus the SHARED host, autopublish and written-out proportion nets this file used to keep a smaller private copy of: it knew thirteen public suffixes where the drafter knew thirty-three, so an invented .wiki address passed both). - dash ban: no em or en dash ever reaches operator-facing copy. - destructive-change guard: an "edit" that guts the current value (empties it or truncates it to a fraction) is never presented as a safe rewrite. The verdict is the ONE answer: `ready` and `needs_review` are the stages a draft may earn, and `rejected` earns none at all, so that draft is withdrawn rather than staged. PURE, no I/O. */

import {
  evaluateTitleMetaQuality,
  type DraftQualityResult,
  type DraftQualityStatus,
} from "@/domains/decision/drafts/draft-quality";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import { validateSchemaToStrings } from "@/domains/evidence/pages/schema-validator";
import type { ClassifiableSource } from "@/domains/decision/drafts/source-authority";
import { looksLikePlaceholder } from "./placeholder-detection";
import { containsUuid, AUTOPUBLISH_RE, COPY_RULES, HOST_RE } from "./copy-sanitize";
import type { BundleComponent, BundleComponentKind, ChangeProposal, RecommendedChange } from "./contracts";
import { dangerousComponents, needsSourcePack } from "./contracts";
import { confirmedVersion } from "./completeness";

/** Quality statuses that are HARD failures, never actionable and always rejected.
 *  These are inventions / garbage / off-topic / malformed drafts: unsafe copy.
 *  NOTE the source HOLDS (`missing_source`, `needs_source_check`) are deliberately
 *  NOT here: a factual claim that just needs a citation is a `needs_review` hold
 *  ("add a source"), never presented as ready, but not the same as an invention. */
const REJECT_STATUSES: ReadonlySet<DraftQualityStatus> = new Set<DraftQualityStatus>([
  "generic_rejected",
  "relevance_rejected",
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

/**
 * THE ROW'S OWN INTEGRITY, in ONE place, so the gate judging a fresh draft and the pass re-judging a stored one
 * ask exactly the same questions. Every one of these shipped to a paying operator on one live change: a cause
 * citing a comparison the receipt never carried, a page both held and not held in the same card, a dangerous merge filed as a medium risk, and a June reading described as what the page says today. PURE.
 */
export function receiptIntegrityFailures(proposal: ChangeProposal): string[] {
  const bundle = proposal.bundle;
  if (!bundle) return [];
  const out: string[] = [];
  // A DOOR MAY REFUSE A CHANGE; IT MAY NEVER CRASH ON ONE: this runs on every read path, so a row missing an array a fresh draft always carries is judged, never thrown on top of the operator as a 500.
  const some = <T,>(x: readonly T[] | undefined): readonly T[] => x ?? [];
  const items = some(bundle.receipt?.items), components = some(bundle.components);
  const keys = new Set(items.map((i) => i.key));
  const cited = [...components.flatMap((c) => some(c.evidenceKeys)), ...some(proposal.causeFinding?.evidenceKeys)];
  if (cited.some((k) => !keys.has(k))) out.push("Part of this change points at evidence that is not on the receipt, so it stays held rather than offered.");
  // EVERYTHING THE OPERATOR READS ON THIS CHANGE, the copy itself included: a contradiction in the sentence being pasted is the one they act on, so it may not hide from a check the notes around it pass.
  const says = [...some(proposal.limitations), ...some(bundle.risks), ...some(bundle.confidenceReasons), ...some(bundle.receipt?.missing),
    ...items.map((i) => i.fact), ...components.map((c) => `${c.after} ${c.objective ?? ""} ${c.mechanism ?? ""}`),
    ...(proposal.causeFinding ? [proposal.causeFinding.explanation, ...some(proposal.causeFinding.notConsidered).map((n) => n.missing)] : [])].join(" ");
  if (HOLDS_PAGE.test(says) && MISSING_PAGE.test(says)) out.push("Two lines here disagree about whether this page's own words are on file, so it stays held rather than offered.");
  const danger = dangerousComponents(components).length > 0;
  if (danger && proposal.riskLevel !== "high") out.push("This change moves or hides a page and it is filed as something lighter than that, so it stays held rather than offered.");
  // STEP TWO OF THE TWO-STEP HOLD, ASKED ON EVERY READ. `ready` on a change that moves or hides a page used to be unreachable and therefore unforgeable, which also meant no redirect, merge, canonical or de-index could ever become work an operator was allowed to make. It is reachable now, through one confirmation of one exact version, and this is where that yes is checked rather than trusted: the stamp on the row must still name the version on the row. An edit to the copy, the pieces, the destination, the risk grade, the evidence or the basis moves the version, the stamp goes stale, and the change falls back behind the hold instead of standing ready on a yes given to other words.
  if (danger && proposal.status === "ready" && proposal.confirmedVersion !== confirmedVersion(proposal)) out.push("This change moves or hides a page and it has changed since you confirmed it, so it stays held until you read it again.");
  // A READING'S OWN DATE IS SAID, NOT HELD (owner's editorial policy, 2026-09-06). A receipt line offering a dated reading as what the page says today used to refuse the whole row here, and at the queue's door it took the change out of sight entirely, which buys nothing and hides finished work. The ONE readiness verdict names the date on the card as an advisory instead; a stale fact that CONTRADICTS a checked source is still a defect, and the canon's entailment is what catches it.
  return [...new Set(out)];
}

/**
 * THE ONE ANSWER EVERY DOOR ASKS about a stored change, so a direct link can never render what the ranked list refuses and no mutation can land on a change the screen would not show. It composes the row's own
 * integrity above with the four things only the account can answer: whose change this is, whether it was drafted under the bar I hold right now, whether anyone is still being asked, and whether the readings
 * behind it still stand. PURE. Empty means this change is work. The new-page BRIEF bar (`validateProposal`)
 * stays out on purpose: it decides which briefs may become work and be SHOWN as work, so it rides the queue and the detail page, where a page the operator has already BUILT is not up for reconsideration.
 */
export function actionableProposalFailures(
  p: ChangeProposal, ctx: { tenantId: string; currentBasis: string | null; now?: Date },
): string[] {
  const out = [...receiptIntegrityFailures(p)];
  if (p.tenantId !== ctx.tenantId) out.push("This change was drafted for another account, so it stays held rather than offered.");
  // THE BAR THAT ROSE IS DELETED, AND THE COLD-READING WINDOW WITH IT (owner's editorial policy, 2026-09-06). A basis stamp moving, and a receipt older than thirty days, each took a whole standing row out of the queue without a word about the work: 85 real opportunities the account had already paid to find left on a generation bump, and a change whose evidence had simply aged left on a clock. Neither is one of the eight defects Beacon must fix, so what remains here is exactly that: whose change this is, whether its own receipt holds together, and whether anybody is still being asked. Worth is the ranking's job and the reading's date is a caveat the card carries.
  if (p.status !== "ready" && p.status !== "needs_review") out.push("This one is not waiting on you any more, so it stays held rather than offered.");
  return [...new Set(out)];
}

type ProposalVerdict = "ready" | "needs_review" | "rejected";

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
  /** What the row must SAY about this change beside the copy: a structured-data warning that does not block,
   *  and the sentence an FAQ block owes about what its markup does and does not buy. Never a hold. */
  limitations: string[];
  confidence: "high" | "medium" | "low";
};

/** Text fields the hard-safety scanners run over, per proposal kind. STRUCTURED DATA IS SCANNED ON THE WORDS A
 *  READER WILL SEE, never on its punctuation: a colon between a JSON key and its value is not typography and a
 *  brace is not a placeholder, but an em dash inside an FAQ answer is copy that lands on the page. */
function operatorFacingText(proposal: ChangeProposal): string[] {
  const c = proposal.recommendedChange;
  if (c.kind === "existing_edit") return c.field === "schema" ? schemaVisible(c.after).visible : [c.after];
  return [c.proposedTitle, c.metaDescription, c.openingAnswer, ...c.outline, ...c.faqQuestions, ...(proposal.bundle?.components ?? []).filter((p) => p.kind === "section").map((p) => p.after)];
}

/** The fields of a block that assert something a reader can SEE on the page, per type. An Organization's own
 *  name and a breadcrumb's label describe the site, not the page's words, so neither is claimed for the page. */
const CLAIMED_ON_PAGE: Record<string, readonly string[]> = { Question: ["name"], Answer: ["text"], ImageObject: ["name", "caption"] };
/** WALK ONE BLOCK ONCE: the @types it declares and the strings it claims the page carries. */
function readSchema(node: unknown, types: Set<string>, visible: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) readSchema(n, types, visible); return; }
  const o = node as Record<string, unknown>, raw = o["@type"];
  for (const t of (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === "string")) {
    types.add(t);
    for (const f of CLAIMED_ON_PAGE[t] ?? []) { const v = o[f]; if (typeof v === "string" && v.trim()) visible.push(v.trim()); } }
  for (const v of Object.values(o)) if (v && typeof v === "object") readSchema(v, types, visible); }
/** The block as JSON, whatever wrapper travelled with it. `parsed` null means it is not readable JSON at all. */
function schemaVisible(after: string): { parsed: unknown; types: Set<string>; visible: string[] } {
  const types = new Set<string>(), visible: string[] = [];
  let parsed: unknown = null;
  try { parsed = JSON.parse(after.trim().replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim()); } catch { return { parsed: null, types, visible }; }
  readSchema(parsed, types, visible);
  return { parsed, types, visible }; }
/** FAQ RICH RESULTS ARE GONE FOR ALMOST EVERY SITE (Google, August 2023): the display is limited to well known
 *  authoritative government and health sites, so a card selling an FAQ block as a richer listing is selling
 *  this customer something Google will not give them. The markup still helps a machine read the page, which is
 *  exactly what the row may say instead. */
const RICH_CLAIM = /\brich (?:result|snippet)|\bricher (?:display|listing|result|search)|\benhanced result|\beligib\w*/i;
export const FAQ_SCHEMA_LIMIT = "FAQPage markup helps search engines and assistants read these questions and answers, and it does not change how Google displays the page.";

/** STRUCTURED DATA ANSWERS TO ITS OWN QUESTIONS. Every prose rule in this file fires on a JSON-LD block by
 *  construction, and both live schema rows were refused four times over for exactly that (raw markup, a
 *  length band written for a sentence, an entity check reading JSON keys, a link removal reading the old
 *  block's @context) while the one question that matters went unasked. These are the questions: does it
 *  PARSE, does it satisfy the same validator the crawler runs on live pages, does the page really carry every
 *  word this block claims for it, does it add a second block of a type the page already has, and does it
 *  promise a rich result Google stopped granting. */
function schemaFailures(p: ChangeProposal, change: Extract<RecommendedChange, { kind: "existing_edit" }>,
  opts: ValidateProposalOptions): { failures: string[]; limitations: string[] } {
  const { parsed, types, visible } = schemaVisible(change.after);
  if (parsed == null) return { failures: ["This structured data is not valid JSON, so no search engine could read it and nobody should paste it."], limitations: [] };
  if (types.size === 0) return { failures: ["This structured data names no type, so nothing in it tells a search engine what the page is."], limitations: [] };
  // THE VALIDATOR'S OWN WORDS, minus the dash Beacon never writes: these strings were written for a crawler's warning list and they land in front of the operator here.
  const warnings = validateSchemaToStrings(parsed).map((w) => w.replace(/\s*[–—]\s*/g, ", "));
  const failures = warnings.filter((w) => w.startsWith("schema_critical:")).map((w) => `This structured data is incomplete: ${w.slice("schema_critical:".length).trim()}`);
  const limitations = warnings.filter((w) => !w.startsWith("schema_critical:")).map((w) => w.replace(/^schema_\w+:\s*/, ""));
  // THE PAGE HAS TO REALLY SAY IT. Structured data marks up what a reader can see, so a question, an answer or
  // a caption that exists only inside the block is a claim about a page that does not make it.
  const banked = [opts.pageBodyText ?? "", ...(p.supportFacts ?? []).map((f) => f.fact)].join(" ");
  const carried = flatten(banked);
  const missing = visible.find((v) => !carried.includes(flatten(v)));
  if (missing) failures.push(`The page does not visibly carry "${missing.slice(0, 70)}", and structured data may only mark up words that are already on the page.`);
  // ONE BLOCK PER TYPE. A second FAQPage or ImageObject beside the one the page already carries reads to Google
  // as a mistake, never as more coverage. The page's own types come from the caller when it holds a snapshot,
  // else from the block this row banked as the page's current state.
  const live = new Set([...(opts.pageSchemaTypes ?? []), ...[...banked.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]!)]);
  const already = change.before == null ? [...types].find((t) => live.has(t)) : null;
  if (already) failures.push(`The page already carries a ${already} block, so this must replace it, not add a second one.`);
  if (types.has("FAQPage")) {
    const said = [p.opportunityType, p.whyItMatters, change.where ?? "", ...p.limitations, ...(p.claims ?? []).map((c) => c.text), ...(p.operatorSteps ?? [])].join(" ");
    if (RICH_CLAIM.test(said)) failures.push("This sells an FAQ block as a richer search listing, and since 2023 Google shows those only for well known government and health sites, so that is not a promise this change can make.");
    limitations.push(FAQ_SCHEMA_LIMIT);
  }
  return { failures, limitations };
}

const NUMBER_RE = /\d[\d,.]*/g;
/** The proposal must say out loud that the operator is the one who publishes it. */
const MANUAL_RE = /\byou\b[^.]{0,80}\bpublish/i;
const digits = (s: string): string => s.replace(/,/g, "").replace(/\.$/, "");

/**
 * THE new-page gate (N4, 2026-07-28). A page brief is not quality-checked like a title rewrite: there is no current value to compare it against and no page body to entail it
 * from. What CAN be checked is that it is a researched page rather than an idea somebody had, so this asks exactly that and rejects everything that cannot show it: the earned
 * verdict it was built from, copy that is about this topic, an outline that is real and not repeated, every component tracing to a receipt item, and no number, address or promise the
 * evidence does not carry. HISTORY FAILS HERE BY CONSTRUCTION: a brief drafted before this contract carries no bundle, so it can never be shown as work. PURE.
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
    return bad("The research that proved this page is missing is not on file, so it stays held rather than offered.");
  }
  const keys = new Set(items.map((i) => i.key));
  if (bundle.components.some((c) => c.evidenceKeys.length === 0 || c.evidenceKeys.some((k) => !keys.has(k)))) {
    return bad("Part of this page traces back to nothing that was checked, so it stays held rather than offered.");
  }
  const headings = change.outline.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (headings.length < 3 || new Set(headings).size !== headings.length) {
    return bad("This page's sections are too thin or repeat each other, so it stays held rather than offered.");
  }
  const topic = new Set(proposal.primaryQuery.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const about = (t: string): boolean => topic.size === 0 || t.toLowerCase().split(/[^a-z0-9]+/).some((w) => topic.has(w));
  if (![change.proposedTitle, change.metaDescription, change.openingAnswer].every((t) => t.trim().length > 0 && about(t))) {
    return bad("This page's title, description or opening does not say what the page is about, so it stays held rather than offered.");
  }
  const grounding = [evidenceText ?? "", ...items.map((i) => i.fact), ...proposal.evidence.hints].join(" ").toLowerCase();
  const copy = [...operatorFacingText(proposal), ...bundle.components.map((c) => c.after)].join(" ");
  if (AUTOPUBLISH_RE.test(copy) || COPY_RULES.proportion.test(copy) || proposal.publish !== "manual" || !MANUAL_RE.test([proposal.whyItMatters, ...bundle.risks].join(" "))) {
    return bad("This page does not say plainly that you are the one who publishes it, so it stays held rather than offered.");
  }
  const grounded = new Set((grounding.match(NUMBER_RE) ?? []).map(digits));
  // The one bare count a new page may carry: its own list length. "The 5 hardest languages" over exactly 5 sections is structure the draft holds, not a statistic; every other figure must come from evidence.
  // The source pack is excluded from the sweep: its URLs and read dates are code-built from evidence, and a digit inside a winning page's own address is not a claim this draft made.
  grounded.add(String(change.outline.length));
  const copyProse = [...operatorFacingText(proposal), ...bundle.components.filter((c) => c.kind !== "source_pack").map((c) => c.after)].join(" ");
  const stray = (copyProse.match(NUMBER_RE) ?? []).map(digits).find((n) => !grounded.has(n));
  if (stray) return bad(`This page quotes ${stray}, which no reading on file carries, so it stays held rather than offered.`);
  const strayHost = (copyProse.match(HOST_RE) ?? []).map((h) => h.toLowerCase()).filter((h) => !COPY_RULES.codeSuffix.test(h))
    .find((h) => !grounding.includes(h) && !grounding.includes(h.replace(/^www\./, "")));
  if (strayHost) return bad(`This page names ${strayHost}, which is not a site any reading on file looked at, so it stays held rather than offered.`);
  // Everything this gate can check is checked. The caution a brand new page deserves rides on the bundle's own risks, where the operator reads it, not as a held status.
  return { status: "ready", reasons: [], copyAllowed: true, canRegenerate: true, confidence: "medium" };
}

/** THE COMPONENT GATE (Phase 4). The seven original kinds are grandfathered exactly as they stand, so every persisted bundle still validates. Every kind the complete change universe added has to answer for itself before it can be shown as work: - it cites at least one receipt item (a component with no evidence is never emitted); - it says WHERE on the page it lands, WHAT it achieves, WHY that lever moves the diagnosed cause, and WHAT I will measure afterwards; - a change to factual content carries a source pack, because a corrected fact with nothing behind it is worse than the stale one it replaced; - a dangerous kind is marked dangerous, so it cannot slip through as a safe paste. Returns operator-facing reasons, never validator vocabulary. PURE. */
const LEGACY_KINDS: ReadonlySet<BundleComponentKind> =
  new Set<BundleComponentKind>(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack"]);

/**
 * THE PROSE NET. The gate above decides danger by KIND, and a kind is a label somebody typed: a legacy `section` component whose copy said "301 redirect this to the guide and noindex the old one" was a
 * redirect, a de-indexing and a merge, and it validated as a paste-ready section rewrite. So the proposed copy itself is read: an instruction to move, hide, canonicalize, delete or merge a page, filed as
 * anything other than the kind that names that change, is a MISLABELLED change and is rejected. Bounded, case insensitive, and matched on the proposal only, never on the current value it replaces.
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
    if (c.evidenceKeys.length === 0) { out.push(`Nothing on the receipt stands behind the ${what}, so it stays held rather than offered.`); continue; }
    // A REBUILD MAY NOT DROP A SECTION IN SILENCE. A page being replaced is the one change that can quietly delete something ranking, so every section I hold has to survive into the draft OR be named as a loss
    // with its own reason. Unnamed is refused: nobody loses a section they were never told about.
    if (c.kind === "full_rewrite") {
      const draft = flatten(c.after);
      const named = flatten((c.preserves?.losses ?? []).map((l) => l.what).join(" | "));
      for (const heading of heldHeadings) {
        const held = flatten(heading);
        if (!held || draft.includes(held) || named.includes(held)) continue;
        out.push(`The rebuild drops "${heading.trim()}" and never says why, so it stays held rather than offered.`);
      }
    }
    if (needsSourcePack(c) && !c.sourcePack) out.push(`The ${what} changes a fact and carries no sources to check it against, so it stays held rather than offered.`);
    for (const m of MISLABELLED) {
      if (c.kind !== m.kind && m.re.test(c.after)) {
        out.push(`The ${what} ${m.what}, and it is filed as an ordinary edit instead of that change, so it stays held rather than offered.`);
      }
    }
    if (!LEGACY_KINDS.has(c.kind)) {
      const owed = [!c.where && "where on the page it goes", !c.objective && "what it is meant to achieve",
        !c.mechanism && "why it fixes the diagnosed cause", !c.measurementPlan && "what gets measured afterwards"].filter((x): x is string => !!x);
      if (owed.length > 0) out.push(`The ${what} never says ${owed.join(", ")}, so it stays held rather than offered.`);
    }
  }
  // A dangerous lever that was not marked dangerous is a mislabelled change, and a mislabelled change is exactly the one that gets pasted without a second look.
  for (const c of dangerousComponents(components)) {
    if (!marked.has(c)) out.push(`The ${c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ")} changes where this page lives or whether people can find it, and it is not marked as one that needs your confirmation, so it stays held rather than offered.`);
  }
  return out;
}

/** THE $0 RE-ADMISSION OF A STORED SCHEMA ROW. Two live rows drafted JSON-LD into `field: "section"` before the
 *  typed treatment existed, so every prose rule in this file fired on them and the queue held them four times
 *  over for reasons that were never about structured data. Nothing in them needs rewriting: the block is
 *  written, its placement is stated, and the only thing missing is the type it should have been filed under.
 *  This converts ONE stored row in place, with no model and no spend: the script wrapper comes off, the field
 *  becomes `schema`, the rich-result promise Google withdrew in 2023 leaves the limitations and the honest
 *  sentence takes its place. Null when the row is not one of these, so a caller may run it over a whole
 *  queue. Idempotent: a row already typed `schema` converts to null, not to itself again. PURE. */
export function convertSectionToSchema(p: ChangeProposal): ChangeProposal | null {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit" || c.field === "schema") return null;
  const after = c.after.trim().replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
  if (!/^[[{]/.test(after)) return null;
  const { parsed, types } = schemaVisible(after);
  if (parsed == null || types.size === 0) return null;
  const kept = p.limitations.filter((l) => !RICH_CLAIM.test(l)); // AND THE SAME LINE IS NOT A CLAIM EITHER (falsifier, 2026-09-02): the FAQ row's own "FAQ rich results" claim asserted an outcome no source carries, so the row refused itself for ever on the very sentence this conversion exists to retire.
  const claims = (p.claims ?? []).filter((x) => !RICH_CLAIM.test(x.text));
  return { ...p, ...(p.claims ? { claims } : {}), recommendedChange: { ...c, field: "schema", after, where: c.where?.trim() || "Add this block to this page's own custom code, in the head of this page only. It adds no visible text and changes nothing a reader sees." },
    limitations: types.has("FAQPage") ? [...new Set([...kept, FAQ_SCHEMA_LIMIT])] : kept }; }

/** Destructive-change guard: an existing-page edit that empties or guts the
 *  current value. A rewrite should improve the field, never delete it. */
function isDestructiveEdit(before: string | null, after: string): boolean {
  const b = (before ?? "").trim();
  const a = after.trim();
  if (!a) return true; // nothing left
  if (!b) return false; // no prior value to destroy
  // Truncating a substantial field to under a third of its length is a gut, not a rewrite (title/meta rewrites stay in the same ballpark of length).
  if (b.length >= 30 && a.length < b.length * 0.34) return true;
  return false;
}

type ValidateProposalOptions = {
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
  /** The structured-data types the page ALREADY carries, off the caller's own snapshot. Absent means the row's
   *  own banked page copy is the only witness, so a duplicate is caught only where the block was banked. */
  pageSchemaTypes?: readonly string[];
  now?: Date;
};

/**
 * Validate one ChangeProposal. Returns the verdict + the mapped lifecycle status. A hard-safety trip or a factual violation ALWAYS rejects; a clean
 * quality "ready" draft is `proposed`; anything in between is `needs_review`.
 */
export function validateProposal(
  proposal: ChangeProposal,
  opts: ValidateProposalOptions = {},
): ProposalValidation {
  const change = proposal.recommendedChange;
  if (proposal.researchOnly === true && change.kind === "existing_edit") return { verdict: "needs_review", qualityStatus: "useful_but_needs_review", reasons: ["the exact copy is not written yet, so there is nothing here for the canon to read"], factViolations: [], corrections: [], safetyFlags: [], limitations: [], confidence: "low" }; // A BRIEF IS NOT OPERATOR COPY (D-036; operator, 2026-09-02): a research row's `after` is the INSTRUCTION for the work, and pointing the copy gates at it rejected 79 of 90 briefs as thin, generic or off-topic writing, which is a verdict about words nobody has written. The canon abstains and the row waits for the draft it is owed. A new-page BRIEF keeps its own gate (evaluateNewPageBrief) and is deliberately not covered here.
  const texts = operatorFacingText(proposal), query = proposal.primaryQuery;
  // STRUCTURED DATA IS JUDGED BY ITS OWN GATE, and by that gate ONLY: the prose rules below all read a JSON-LD
  // block as broken prose, so they are asked of every field except this one.
  const schema = change.kind === "existing_edit" && change.field === "schema" ? schemaFailures(proposal, change, opts) : null;

  // ── hard-safety scanners (deterministic, no LLM) ────────────────────────────
  const safetyFlags: string[] = [];
  for (const t of texts) {
    if (looksLikePlaceholder(t)) safetyFlags.push("Contains a placeholder / template stub.");
    if (DASH_RE.test(t)) safetyFlags.push("Contains an em or en dash (banned in operator copy).");
    if (containsUuid(t)) safetyFlags.push("Leaks a raw id into operator copy.");
    if (COPY_RULES.workflow.test(t)) safetyFlags.push("Contains writing instructions or page narration instead of publishable copy.");
  }
  // RAW MARKUP IS NOT PASTE COPY (operator, 2026-08-31). A stored link row from before the typed-anchor contract carried '<a href="...">iran eagle</a>' in a section body and the $0 replay promoted it: nothing typed owned the rule that operator copy is TEXT. A tag in `after` is malformed for every existing_edit field, because the anchor words travel typed (anchorText) and the customer pastes prose, never HTML. Schema-block rows are already held by their own "describes the work" gap; this only adds the honest second reason.
  if (change.kind === "existing_edit" && !schema && /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/i.test(change.after)) safetyFlags.push("Contains raw HTML markup, and operator copy is pasted as text.");
  if (change.kind === "existing_edit" && isDestructiveEdit(change.before, change.after)) {
    safetyFlags.push("Rewrite deletes or guts the current value (destructive edit).");
  }

  // ── factual entailment (an invented number or entity is a violation) ──────── Only the EXISTING-page edit path runs entity-level entailment: it has a real
  // page body / current value to check a new claim against, so an invented number or entity is a genuine violation (or a dated, sourced correction). A
  // brand-NEW page inherently introduces entities that are not yet on any page, so entity-entailment there is pure noise; its ungrounded-NUMBER protection
  // is already enforced upstream by the drafter's numeric-fidelity firewall at generation, so a persisted brief cannot carry an invented number.
  const entail = change.kind === "existing_edit" && !schema
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
  if (schema) {
    quality = schema.failures.length > 0
      ? { status: "malformed", reasons: schema.failures, copyAllowed: false, canRegenerate: true, confidence: "low" }
      : { status: "ready", reasons: [], copyAllowed: true, canRegenerate: true, confidence: "medium" };
  } else if (change.kind === "existing_edit") {
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
      authoritativeSourceDomains: opts.authoritativeSourceDomains, /* THE ROW'S OWN ADMITTED SUPPORT IS A CITED SOURCE, and it is read here rather than re-derived downstream (live 07:01Z): a `fact-` id is banked only from a reading `authorizedCorrections` admitted under the proportional bar, and it reaches the canon paired with the CLAIM that cites it, so a banked passage nothing stands on authorizes nothing and a reading one claim stands on never answers for another claim's figure. */ citedSupport: (proposal.claims ?? []).flatMap((c) => c.supportedBy.filter((id) => /^fact-/.test(id)).map((id) => ({ id, claim: c.text, fact: (proposal.supportFacts ?? []).find((f) => f.id === id)?.fact ?? "" }))).filter((s) => s.fact !== ""),
    });
  } else {
    quality = evaluateNewPageBrief(proposal, change, opts.evidenceText ?? null);
  }

  // ── the component gate + the two-step hold ──────────────────────────────────
  const components = proposal.bundle?.components ?? [];
  const componentFails = [...componentFailures(components, opts.heldHeadings ?? []),
    ...receiptIntegrityFailures(proposal)];
  // THE TWO-STEP CONFIRMATION, in the one vocabulary this product already has: a dangerous component can never read as ready, it is held for the operator to look at
  // and then act. There is no second flag and no second lifecycle.
  const dangerous = dangerousComponents(components);

  // ── compose the single verdict ────────────────────────────────────────────── The two-step note is carried WHATEVER else the verdict turns out to be: the operator
  // has to read it before acting, and burying it behind another hold is how it gets missed.
  const reasons: string[] = [...(quality.status === "ready" ? [] : quality.reasons), ...dangerous.map((c) =>
    `${c.label.trim() || c.kind.replace(/_/g, " ")}: this one changes where the page lives or whether people can find it, so read it once and confirm it before you make the change.`)];
  const factViolations = entail.violations;
  const corrections = entail.corrections;

  let verdict: ProposalVerdict;
  if (safetyFlags.length > 0 || factViolations.length > 0 || componentFails.length > 0 || REJECT_STATUSES.has(quality.status)) {
    verdict = "rejected";
    reasons.unshift(...safetyFlags, ...factViolations, ...componentFails);
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
    limitations: schema?.limitations ?? [],
    confidence: quality.confidence,
  };
}

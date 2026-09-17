/** decision/validate-proposal (CORE 100K decision kernel): the ONE validator every ChangeProposal passes through before it can be shown as actionable. It composes the existing, battle-tested safety gates into a single verdict, so there is exactly one place that decides "is this draft safe to put in front of a paying operator": - draft-quality.ts (evaluateTitleMetaQuality) covers generic/thin/off-topic/relevance/missing-source/source-authority. - factual-entailment.ts (checkFactualEntailment): an invented number or entity with no grounding is a VIOLATION and rejects the draft; a dated, sourced contradiction of the page is an allowed CORRECTION (surfaced, not blocked). - placeholder-detection.ts (looksLikePlaceholder): "[insert X]" / lorem. - copy-sanitize.ts (containsUuid, plus the SHARED host, autopublish and written-out proportion nets this file used to keep a smaller private copy of: it knew thirteen public suffixes where the drafter knew thirty-three, so an invented .wiki address passed both). - dash ban: no em or en dash ever reaches operator-facing copy. - destructive-change guard: an "edit" that guts the current value (empties it or truncates it to a fraction) is never presented as a safe rewrite. The verdict is the ONE answer: `ready` and `needs_review` are the stages a draft may earn, and `rejected` earns none at all, so that draft is withdrawn rather than staged. PURE, no I/O. */

import {
  evaluateTitleMetaQuality,
  type DraftQualityResult,
  type DraftQualityStatus,
} from "@/domains/decision/drafts/draft-quality";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import { SCHEMA } from "@/domains/evidence/pages/schema-validator";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { isCurrent } from "@/domains/evidence/freshness";
import type { EvidenceRequirement } from "./producers/contract";
import type { ClassifiableSource } from "@/domains/decision/drafts/source-authority";
import { looksLikePlaceholder } from "./placeholder-detection";
import { containsUuid, AUTOPUBLISH_RE, COPY_RULES, HOST_RE } from "./copy-sanitize";
import type { BundleComponent, BundleComponentKind, ChangeProposal, RecommendedChange } from "./contracts";
import { dangerousComponents, needsSourcePack } from "./contracts";
import { confirmedVersion } from "./completeness";

/** Unsafe quality statuses reject; missing citation is a review debt. */
const REJECT_STATUSES: ReadonlySet<DraftQualityStatus> = new Set<DraftQualityStatus>([
  "generic_rejected",
  "relevance_rejected",
  "unsupported_claim",
  "too_thin",
  "malformed",
  "unverified_claim",
]);

const DASH_RE = /[–—]/; // en-dash, em-dash
/** A receipt cannot both hold and lack the page words. */
const HOLDS_PAGE = /\bI (?:read|hold) this page's (?:stored words|own words|full body text)\b/i;
const MISSING_PAGE = /\bI do not hold this page's (?:full body text|own words|own opening words|own sections)\b/i;

/** Check receipt references, contradictory scope, danger and exact-version confirmation. */
export function receiptIntegrityFailures(proposal: ChangeProposal): string[] {
  const bundle = proposal.bundle;
  if (!bundle) return [];
  const out: string[] = [];
  const some = <T,>(x: readonly T[] | undefined): readonly T[] => x ?? [];
  const items = some(bundle.receipt?.items), components = some(bundle.components);
  const keys = new Set(items.map((i) => i.key));
  const cited = [...components.flatMap((c) => some(c.evidenceKeys)), ...some(proposal.causeFinding?.evidenceKeys)];
  if (cited.some((k) => !keys.has(k))) out.push("Part of this change points at evidence that is not on the receipt, so it stays held rather than offered.");
  const says = [...some(proposal.limitations), ...some(bundle.risks), ...some(bundle.confidenceReasons), ...some(bundle.receipt?.missing),
    ...items.map((i) => i.fact), ...components.map((c) => `${c.after} ${c.objective ?? ""} ${c.mechanism ?? ""}`),
    ...(proposal.causeFinding ? [proposal.causeFinding.explanation, ...some(proposal.causeFinding.notConsidered).map((n) => n.missing)] : [])].join(" ");
  if (HOLDS_PAGE.test(says) && MISSING_PAGE.test(says)) out.push("Two lines here disagree about whether this page's own words are on file, so it stays held rather than offered.");
  const danger = dangerousComponents(components).length > 0;
  if (danger && proposal.riskLevel !== "high") out.push("This change moves or hides a page and it is filed as something lighter than that, so it stays held rather than offered.");
  if (danger && proposal.status === "ready" && proposal.confirmedVersion !== confirmedVersion(proposal)) out.push("This change moves or hides a page and it has changed since you confirmed it, so it stays held until you read it again.");
  return [...new Set(out)];
}

/** Shared tenant, status and receipt-integrity checks for serving and mutations. */
export function actionableProposalFailures(
  p: ChangeProposal, ctx: { tenantId: string; currentBasis: string | null; now?: Date },
): string[] {
  const out = [...receiptIntegrityFailures(p)];
  if (p.tenantId !== ctx.tenantId) out.push("This change was drafted for another account, so it stays held rather than offered.");
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
  need?: EvidenceRequirement;
  schemaReplacement?: string;
};

/** Scan visible copy values, not JSON punctuation. */
function operatorFacingText(proposal: ChangeProposal): string[] {
  const c = proposal.recommendedChange;
  if (c.kind === "existing_edit") return c.field === "schema" ? schemaVisible(c.after).visible : [c.after];
  return [c.proposedTitle, c.metaDescription, c.openingAnswer, ...c.outline, ...c.faqQuestions, ...(proposal.bundle?.components ?? []).filter((p) => p.kind === "section").map((p) => p.after)];
}

/** Only these entity values assert visible page words. */
const CLAIMED_ON_PAGE: Record<string, readonly string[]> = { Question: ["name"], Answer: ["text"], ImageObject: ["name", "caption"] };
/** Resolve the same graph the crawler and live verifier read, retaining its visible entity values. */
function schemaVisible(after: string) {
  const graph = SCHEMA.read(after), types = new Set<string>(), visible: string[] = [];
  for (const node of graph.nodes) for (const type of SCHEMA.types(node)) {
    types.add(type);
    for (const field of CLAIMED_ON_PAGE[type] ?? []) {
      const value = node[field];
      if (typeof value === "string" && value.trim()) visible.push(value.trim());
    }
  }
  return { parsed: graph.value, graph, types, visible };
}
/** Google retired FAQ rich results on May 7, 2026. Markup describes content, never guaranteed visibility. */
const RICH_CLAIM = /\brich (?:result|snippet)|\bricher (?:display|listing|result|search)|\benhanced result|\beligib\w*/i;
const FAQ_SCHEMA_LIMIT = "This markup describes the page's published questions and answers, and it does not change how Google displays the page. No ranking or citation gain is promised.";

/** Visible FAQ associations require complete current HTML pairs, not a word bag or research. */
function schemaFailures(p: ChangeProposal, change: Extract<RecommendedChange, { kind: "existing_edit" }>,
  opts: ValidateProposalOptions): { failures: string[]; limitations: string[]; need?: EvidenceRequirement; schemaReplacement?: string } {
  const { parsed, graph, types, visible } = schemaVisible(change.after);
  if (parsed == null) return { failures: ["This structured data is not valid JSON, so no search engine could read it and nobody should paste it."], limitations: [] };
  if (types.size === 0) return { failures: ["This structured data names no type, so nothing in it tells a search engine what the page is."], limitations: [] };
  const warnings = SCHEMA.warnings(change.after).map((w) => w.replace(/\s*[–—]\s*/g, ", "));
  const failures = warnings.filter((w) => w.startsWith("schema_critical:")).map((w) => `This structured data is incomplete: ${w.slice("schema_critical:".length).trim()}`);
  if (change.before != null && (SCHEMA.read(change.before).unread || schemaVisible(change.before).types.size === 0)) failures.push("The existing block shown for replacement is not readable Schema.org JSON-LD. Identify the exact existing markup before replacing it; visible page text is not a schema block.");
  const limitations = warnings.filter((w) => !w.startsWith("schema_critical:")).map((w) => w.replace(/^schema_\w+:\s*/, ""));
  const published = opts.pageBodyText ?? "";
  const carried = COPY_RULES.flat(published);
  const pairs = SCHEMA.pairs(graph), pairedWords = new Set(pairs.flatMap((pair) => [pair.question, pair.answer]));
  const missing = visible.find((v) => !pairedWords.has(v) && !carried.includes(COPY_RULES.flat(v)));
  if (missing) failures.push(`The page does not visibly carry "${missing.slice(0, 70)}", and structured data may only mark up words that are already on the page.`);
  const capture = opts.pageCapture;
  const current = capture?.version === "current" && !!capture.contentHash && isCurrent("owned_page", capture.fetchedAt, (opts.now ?? new Date()).getTime())
    && !!p.pageUrl && !!capture.url && canonicalUrlKey(capture.url) === canonicalUrlKey(p.pageUrl);
  const held = current ? (capture.faqs ?? []).filter((pair) => pair.answerComplete === true && ["html_details", "html_section"].includes(pair.source)) : [];
  let unknown: string | undefined, mismatched = false;
  for (const pair of pairs) {
    const own = held.filter((visible) => COPY_RULES.flat(visible.question) === COPY_RULES.flat(pair.question));
    if (own.some((visible) => COPY_RULES.flat(visible.answer) === COPY_RULES.flat(pair.answer))) continue;
    const incomplete = current && capture.faqs?.some((visible) => COPY_RULES.flat(visible.question) === COPY_RULES.flat(pair.question) && visible.answerComplete !== true);
    if (!own.length || incomplete || new Set(own.map((visible) => COPY_RULES.flat(visible.answer))).size !== 1) { unknown ??= pair.question; continue; }
    mismatched = true;
    failures.push(`This structured data attaches the wrong answer to "${pair.question}". The current complete HTML pair carries a different answer.`);
  }
  const live = new Set([...(opts.pageSchemaTypes ?? []), ...[...published.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]!)]);
  const already = change.before == null ? [...types].find((t) => live.has(t)) : null;
  if (already) failures.push(`The page already carries a ${already} block, so this must replace it, not add a second one.`);
  if (types.has("FAQPage")) {
    const said = [p.opportunityType, p.whyItMatters, change.where ?? "", ...p.limitations, ...(p.claims ?? []).filter((claim) => !visible.some((value) => COPY_RULES.flat(value) === COPY_RULES.flat(claim.text))).map((c) => c.text), ...(p.operatorSteps ?? [])].join(" ");
    if (RICH_CLAIM.test(said)) failures.push("This sells an FAQ block as a richer search listing, but Google stopped showing FAQ rich results on May 7, 2026, so that is not a promise this change can make.");
    limitations.push(FAQ_SCHEMA_LIMIT);
  }
  if (unknown && !p.pageUrl) failures.push("This structured data has no target page URL, so its visible questions and answers cannot be checked.");
  const need: EvidenceRequirement | undefined = unknown && !!p.pageUrl && failures.every((why) => why.startsWith("This structured data attaches the wrong answer")) ? { kind: "page_source", query: unknown, url: p.pageUrl, proposalId: p.id, reasonCode: "schema_visible_pair_unconfirmed" } : undefined;
  const schemaReplacement = mismatched && !unknown ? SCHEMA.rewriteFaq(change.after, held) ?? undefined : undefined;
  return { failures, limitations, need, schemaReplacement };
}

const NUMBER_RE = /\d[\d,.]*/g;
/** The proposal must say out loud that the operator is the one who publishes it. */
const MANUAL_RE = /\byou\b[^.]{0,80}\bpublish/i;
const digits = (s: string): string => s.replace(/,/g, "").replace(/\.$/, "");

/** A new-page brief needs its earned diagnosis, traced components and grounded copy. */
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
  grounded.add(String(change.outline.length));
  const copyProse = [...operatorFacingText(proposal), ...bundle.components.filter((c) => c.kind !== "source_pack").map((c) => c.after)].join(" ");
  const stray = (copyProse.match(NUMBER_RE) ?? []).map(digits).find((n) => !grounded.has(n));
  if (stray) return bad(`This page quotes ${stray}, which no reading on file carries, so it stays held rather than offered.`);
  const strayHost = (copyProse.match(HOST_RE) ?? []).map((h) => h.toLowerCase()).filter((h) => !COPY_RULES.codeSuffix.test(h))
    .find((h) => !grounding.includes(h) && !grounding.includes(h.replace(/^www\./, "")));
  if (strayHost) return bad(`This page names ${strayHost}, which is not a site any reading on file looked at, so it stays held rather than offered.`);
  return { status: "ready", reasons: [], copyAllowed: true, canRegenerate: true, confidence: "medium" };
}

/** THE COMPONENT GATE (Phase 4). The seven original kinds are grandfathered exactly as they stand, so every persisted bundle still validates. Every kind the complete change universe added has to answer for itself before it can be shown as work: - it cites at least one receipt item (a component with no evidence is never emitted); - it says WHERE on the page it lands, WHAT it achieves, WHY that lever moves the diagnosed cause, and WHAT I will measure afterwards; - a change to factual content carries a source pack, because a corrected fact with nothing behind it is worse than the stale one it replaced; - a dangerous kind is marked dangerous, so it cannot slip through as a safe paste. Returns operator-facing reasons, never validator vocabulary. PURE. */
const LEGACY_KINDS: ReadonlySet<BundleComponentKind> =
  new Set<BundleComponentKind>(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack"]);

/** A structural instruction must use the kind that owns its safety hold. */
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

function componentFailures(components: readonly BundleComponent[], heldHeadings: readonly string[] = []): string[] {
  const out: string[] = [];
  const marked = new Set(components.filter((c) => c.risk === "dangerous"));
  for (const c of components) {
    const what = c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ");
    if (c.evidenceKeys.length === 0) { out.push(`Nothing on the receipt stands behind the ${what}, so it stays held rather than offered.`); continue; }
    if (c.kind === "full_rewrite") {
      const draft = COPY_RULES.flat(c.after);
      const named = COPY_RULES.flat((c.preserves?.losses ?? []).map((l) => l.what).join(" | "));
      for (const heading of heldHeadings) {
        const held = COPY_RULES.flat(heading);
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
  for (const c of dangerousComponents(components)) {
    if (!marked.has(c)) out.push(`The ${c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ")} changes where this page lives or whether people can find it, and it is not marked as one that needs your confirmation, so it stays held rather than offered.`);
  }
  return out;
}

/** Schema action metadata comes from its typed block, never inherited prose instructions or promises. */
export function convertSectionToSchema(p: ChangeProposal): ChangeProposal | null {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit" || p.bundle || !["ready", "needs_review"].includes(p.status)) return null;
  if (c.before != null && (SCHEMA.read(c.before).unread || schemaVisible(c.before).types.size === 0)) return null;
  const after = c.after.trim().replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
  if (!/^[[{]/.test(after)) return null;
  const { parsed, graph, types } = schemaVisible(after);
  if (parsed == null || types.size === 0) return null;
  const faq = types.has("FAQPage") && [...types].every((type) => ["FAQPage", "Question", "Answer"].includes(type)), action = c.before == null ? "Add" : "Replace";
  if (c.field === "schema" && !faq) return null;
  const kept = c.field === "schema" ? p.limitations : p.limitations.filter((l) => !RICH_CLAIM.test(l));
  const where = "In this page's own custom code, in the page head. This is JSON-LD, not visible page text.";
  const normalized: ChangeProposal = { ...p,
    opportunityType: /structured data/i.test(p.opportunityType) ? p.opportunityType : `${action} ${faq ? "FAQ" : [...types].sort().join(", ")} structured data`, /* THE PRODUCER'S OWN WORDS STAND WHEN THEY ALREADY SAY IT (2026-09-17): this repair rewrote the headline and the reason on every pass and the producer wrote them back on the next, two versions a pass on five rows for two days (469 versions); a repair is for rows minted before the words existed */
    whyItMatters: /structured data/i.test(p.whyItMatters ?? "") ? p.whyItMatters : faq ? `${((n) => `${n} question${n === 1 ? "" : "s"} and ${n === 1 ? "its answer" : "their answers"}`)(SCHEMA.pairs(graph).length)} from this page, in the form Google reads. ${FAQ_SCHEMA_LIMIT}`
      : "This block describes the page's content in machine-readable form. It does not rewrite the page or promise ranking or citation gains.",
    recommendedChange: { ...c, field: "schema", after, where },
    operatorSteps: [c.before == null
      ? "Add the complete block shown here to this page's own custom code. Do not replace unrelated markup."
      : "Find the exact existing block shown under Now and replace only that block with the complete replacement. Preserve unrelated markup.",
    `Do not paste JSON-LD into visible page text. Confirm ${faq ? "every question and answer" : "the represented content"} still matches the published page before applying it.`,
    "After publishing, check the live page and mark this change implemented. If the represented content changes later, its markup must be updated too."],
    ...(after !== c.after.trim() ? { previousCopy: { after: c.after.trim(), retiredBecause: "Schema action conversion removed the script wrapper without a model call", at: new Date().toISOString(), attempts: p.previousCopy?.attempts ?? 0 } } : {}),
    limitations: faq ? [...new Set([...kept, FAQ_SCHEMA_LIMIT])] : kept };
  return JSON.stringify(normalized) === JSON.stringify(p) ? null : normalized;
}

/** Refuse edits that empty or gut the current value. THE RATIO IS ASKED OF SECTION-SCALE REPLACEMENTS ONLY (Stage 3, 2026-09-14): a factual correction, and any replacement of a single sentence or a label:value line, is a point edit whose honest form is often shorter ("Meaning: Light." for "Meaning:Bright, radiant, or glowing."), and the length band and the preservation door hold what it may not drop. */
function isDestructiveEdit(before: string | null, after: string, pointEdit: boolean): boolean {
  const b = (before ?? "").trim(), a = after.trim();
  if (!a) return true; // nothing left
  return !!b && !pointEdit && b.length >= 30 && a.length < b.length * 0.34;
}

/** The same page words and dated capture reach drafting, replay and operator approval. */
export function canonTextOf(page: { content?: { title?: string | null; h1?: string | null; outline?: readonly string[] | null } | null } | null | undefined,
  body: ({ headings?: readonly string[] | null; passages?: readonly string[] | null; vocabulary?: string | null }
    & Partial<Pick<OwnedPageBody, "url" | "faqs" | "version" | "contentHash" | "fetchedAt" | "completeness">>) | null | undefined,
  evidence: readonly string[] = []) {
  const heads = [page?.content?.title ?? "", page?.content?.h1 ?? "", ...(page?.content?.outline ?? []), ...(body?.headings ?? [])].filter(Boolean);
  const said = ((body?.passages ?? []).length > 0 ? (body?.passages ?? []).join(" ") : body?.vocabulary ?? "").replace(/\b(?:top|bottom) of page/gi, " ");
  const pageBodyText = [...heads, said].filter(Boolean).join(" ");
  return { pageBodyText, evidenceText: [pageBodyText, ...evidence].filter(Boolean).join(" "), pageCapture: body ?? null };
}

type ValidateProposalOptions = {
  /** The target page's own body text, which turns ON factual entailment. */
  pageBodyText?: string | null;
  pageCapture?: Partial<Pick<OwnedPageBody, "url" | "faqs" | "version" | "contentHash" | "fetchedAt" | "completeness">> | null;
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

/** Compose one verdict; hard safety and factual violations always reject. */
export function validateProposal(
  proposal: ChangeProposal,
  opts: ValidateProposalOptions = {},
): ProposalValidation {
  const change = proposal.recommendedChange;
  if (proposal.researchOnly === true && change.kind === "existing_edit") return { verdict: "needs_review", qualityStatus: "useful_but_needs_review", reasons: ["the exact copy is not written yet, so there is nothing here for the canon to read"], factViolations: [], corrections: [], safetyFlags: [], limitations: [], confidence: "low" }; // A BRIEF IS NOT OPERATOR COPY (D-036; operator, 2026-09-02): a research row's `after` is the INSTRUCTION for the work, and pointing the copy gates at it rejected 79 of 90 briefs as thin, generic or off-topic writing, which is a verdict about words nobody has written. The canon abstains and the row waits for the draft it is owed. A new-page BRIEF keeps its own gate (evaluateNewPageBrief) and is deliberately not covered here.
  const texts = operatorFacingText(proposal), query = proposal.primaryQuery;
  // Structured data uses its own gate instead of prose quality rules.
  const schema = change.kind === "existing_edit" && change.field === "schema" ? schemaFailures(proposal, change, opts) : null;

  const safetyFlags: string[] = [];
  // THE WRITER'S RATIONALE REACHES THE CARD AS whyItMatters (review, 2026-09-14): the schema no longer scans it as prose, so the operator-facing door reads it here for a dash or a stub.
  if (looksLikePlaceholder(proposal.whyItMatters)) safetyFlags.push("Contains a placeholder / template stub."); if (DASH_RE.test(proposal.whyItMatters)) safetyFlags.push("Contains an em or en dash (banned in operator copy).");
  for (const t of texts) {
    if (looksLikePlaceholder(t)) safetyFlags.push("Contains a placeholder / template stub.");
    if (DASH_RE.test(t)) safetyFlags.push("Contains an em or en dash (banned in operator copy).");
    if (containsUuid(t)) safetyFlags.push("Leaks a raw id into operator copy.");
    if (COPY_RULES.workflow.test(t)) safetyFlags.push("Contains writing instructions or page narration instead of publishable copy.");
  }
  if (change.kind === "existing_edit" && !schema && /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/i.test(change.after)) safetyFlags.push("Contains raw HTML markup, and operator copy is pasted as text.");
  if (change.kind === "existing_edit" && isDestructiveEdit(change.before, change.after, proposal.changeFamily === "factual_correction" || COPY_RULES.originalUnits(change.before ?? "").length <= 1)) safetyFlags.push("Rewrite deletes or guts the current value (destructive edit).");

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

  let quality: DraftQualityResult;
  if (schema) {
    quality = schema.failures.length > 0
      ? { status: "malformed", reasons: schema.failures, copyAllowed: false, canRegenerate: true, confidence: "low" }
      : schema.need ? { status: "useful_but_needs_review", reasons: [`The current complete HTML question and answer for "${schema.need.query}" are not confirmed. Capture this page before changing or approving its schema.`], copyAllowed: false, canRegenerate: false, confidence: "low" }
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

  const components = proposal.bundle?.components ?? [];
  const componentFails = [...componentFailures(components, opts.heldHeadings ?? []),
    ...receiptIntegrityFailures(proposal)];
  const dangerous = dangerousComponents(components);

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
    ...(schema?.need ? { need: schema.need } : {}),
    ...(schema?.schemaReplacement ? { schemaReplacement: schema.schemaReplacement } : {}),
  };
}

/** Pure trust gate for atomic copy: preserve the target entity and require grounding for factual claims. Scoped editorial selections follow the shared publisher contract; unsupported measured rankings, dates, counts and entities remain held. A dated authoritative correction may contradict stale page copy. */
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import { hasQualifyingAuthoritativeSource, type ClassifiableSource } from "@/domains/decision/drafts/source-authority";
import { COPY_RULES } from "@/domains/decision/copy-sanitize";

export type DraftQualityStatus =
  | "ready"
  | "useful_but_needs_review"
  | "generic_rejected"
  | "relevance_rejected"
  | "unsupported_claim"
  | "too_thin"
  | "malformed"
  | "missing_source"
  | "unverified_claim";

export type DraftQualityResult = {
  status: DraftQualityStatus;
  reasons: string[];
  /** Safe to surface a one-click copy/paste button. Only ready + needs-review. */
  copyAllowed: boolean;
  /** Re-drafting this is likely to help (generic/thin/off-topic/malformed). */
  canRegenerate: boolean;
  confidence: "high" | "medium" | "low";
  /** N8 (2026-07-02, operator correction): plain-English lines for claims that CONTRADICT the target page's own text but are backed by a dated, authoritative source (a stale page being corrected, not an invention). Present only when the factual-entailment check ran AND found at least one correction; absent otherwise (never an empty array vs. "not checked" ambiguity - callers test for `undefined`). A draft can be "ready" AND carry corrections at the same time - corrections never block copy/publish, they are shown alongside it so the operator sees what changed and why. */
  corrections?: string[];
};

// ── shared vocabulary + helpers ───────────────────────────────────────────────

/** NO default vocabulary. A hardcoded vertical list here silently rejected every
 *  shallow draft for any account outside that vertical ("drops the page's core
 *  entity"), which is the founder-config leak in its purest form. Callers pass the
 *  candidate's OWN words; an empty list means the entity check cannot run and must
 *  not fabricate a verdict. */
const DEFAULT_CONTEXT_TOKENS: string[] = [];

/** Any non-Latin script carries its own subject words; token containment cannot judge it. */
const NON_LATIN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/** With no vocabulary from the caller there is nothing to check against, so the
 *  gate passes rather than inventing a verdict about words it was never given. */
function hasContext(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  if (NON_LATIN_SCRIPT.test(text)) return true;
  const lower = text.toLowerCase();
  return tokens.some((t) => lower.includes(t.toLowerCase()));
}

/** A specific count introduced in a title ("150+", "Top 50"), flag for verification. */
const COUNT_CLAIM = /\b\d{2,}\s*\+|\btop\s+\d+\b/i;

// ── title / meta (atomic edit) quality ────────────────────────────────────────

type EvaluateTitleInput = {
  before?: string | null;
  after: string | null | undefined;
  field?: "title" | "meta" | string;
  query?: string | null;
  contextTokens?: string[];
  /** Current claim evidence; targeting query alone cannot authorize measured superiority. */
  pageBodyText?: string | null;
  evidenceText?: string | null;
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** W5 (J-69): the draft's own cited sources, authority ALWAYS re-derived here through source-authority.ts and never trusted off the source's own field. Consulted only when the rewrite introduces a NEW specific fact `before` did not carry (the narrow SPECIFIC_FACT check below); a pure rephrase never reaches it. */
  sources?: readonly ClassifiableSource[];
  authoritativeSourceDomains?: readonly string[]; /** The cited checked finding must carry source identity as well as words. */ citedSupport?: readonly { id: string; claim: string; fact: string; qualified?: boolean }[];
};

/** Evaluate an atomic title/meta rewrite. */
export function evaluateTitleMetaQuality(input: EvaluateTitleInput): DraftQualityResult {
  const after = (input.after ?? "").trim();
  const before = (input.before ?? "").trim();
  const tokens = input.contextTokens ?? DEFAULT_CONTEXT_TOKENS;

  if (!after) {
    return { status: "malformed", reasons: ["No rewritten value."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  if (before && after.toLowerCase() === before.toLowerCase()) {
    return { status: "too_thin", reasons: ["Rewrite is identical to the current value."], copyAllowed: false, canRegenerate: true, confidence: "high" };
  }
  // Entity dropped: the rewrite no longer names the topic → orphans the page.
  if (!hasContext(after, tokens)) {
    return {
      status: "relevance_rejected",
      reasons: ["Rewrite drops the words this page is actually about."],
      copyAllowed: false,
      canRegenerate: true,
      confidence: "medium",
    };
  }
  /* A COUNT THE PAGE'S OWN CAPTURED WORDS ALREADY CARRY IS DELIVERED, NOT "TO CONFIRM" (probe, 2026-09-05). /iran-animals/green-sea-turtle stood held on a description saying "80+ year lifespan" while the page's own stored body says "Average Lifespan: 80+ years", so the canon asked a person to check a figure it had been handed. The packet is read first, exactly as the SPECIFIC_FACT rule below already reads it: every count in the line must appear as its own number in the page text or the banked evidence, matched on the digits so "80+", "80 plus" and "Top 50" against "50 entries" all count as delivered. A count nothing on file carries still asks. */ const packet = `${input.pageBodyText ?? ""} ${input.evidenceText ?? ""}`.replace(/\s+/g, " "), counts = after.match(new RegExp(COUNT_CLAIM.source, "gi")) ?? [], delivered = counts.length > 0 && counts.every((c) => { const d = /\d+/.exec(c)?.[0] ?? ""; return d !== "" && new RegExp(`(?<!\\d)${d}(?!\\d)`).test(packet); });
  if (COUNT_CLAIM.test(after) && !COUNT_CLAIM.test(before) && !delivered) {
    return {
      status: "useful_but_needs_review",
      reasons: ["Introduces a count (150+, Top 50) that this page's captured words do not carry, so confirm the page delivers it before publishing."],
      copyAllowed: true,
      canRegenerate: false,
      confidence: "medium",
    };
  }

  // Dated authority can justify a correction; query wording cannot certify objective superiority.
  let entailmentCorrections: string[] | undefined;
  const entailment = checkFactualEntailment({
    draftText: after,
    pageBodyText: input.pageBodyText,
    evidenceText: input.evidenceText,
    query: input.query ?? null,
    authoritativeFacts: input.authoritativeFacts,
  });
  if (!entailment.entailed) {
    return {
      status: "unverified_claim",
      reasons: entailment.violations,
      copyAllowed: false,
      canRegenerate: true,
      confidence: "high",
    };
  }
  if (entailment.corrections.length > 0) entailmentCorrections = entailment.corrections;
  const owed = COPY_RULES.specificFactDebt(input).map((x) => x.phrase);
  if (owed.length > 0 && !hasQualifyingAuthoritativeSource(after, input.sources, input.authoritativeSourceDomains)) {
    return {
      status: "missing_source",
      reasons: [`Introduces a new fact with no cited authoritative source yet ("${owed[0]}"). Add one before this is paste-ready.`],
      copyAllowed: false,
      canRegenerate: false,
      confidence: "medium",
    };
  }

  return {
    status: "ready",
    reasons: ["Entity-forward rewrite, no boilerplate or unsupported claim."],
    copyAllowed: true,
    canRegenerate: false,
    confidence: "high",
    ...(entailmentCorrections ? { corrections: entailmentCorrections } : {}),
  };
}

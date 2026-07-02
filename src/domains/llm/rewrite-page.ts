import "server-only";

import { evaluateSectionDraftQuality } from "@/domains/drafts/draft-quality";
import { callStructuredLLM, type CompleteFn } from "./structured-drafter";
import { buildWinnerFewShots } from "./winner-memory";
import { scorePageCitability } from "@/domains/citability/citability-score";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import type { SectionDraft, SectionSource } from "./schemas";

/**
 * llm/rewrite-page (BEACON 500 item 61, 2026-07-02) — agentic full-page
 * rewrites. Mirrors draft-full-page.ts's walker (item 55) but rewrites an
 * EXISTING page's sections instead of drafting a brand-new outline:
 *
 *   for each CURRENT section (heading + whatever old body text is known):
 *     ground the prompt on: the section's own old text (verbatim, so the
 *     rewrite must improve it, not invent a new topic), the queries it should
 *     answer, the competitor's "what wins" teardown, fanout sub-questions, and
 *     citability topFixes (item 26)
 *     -> callStructuredLLM("section_draft") -> evaluateSectionDraftQuality gate
 *        (item 55's section gate) -> on a failing/regeneratable section, retry
 *        ONCE with a sharpen note -> on a second failure, KEEP THE ORIGINAL
 *        TEXT VERBATIM. A rewrite NEVER ships a stub — an unimproved original
 *        section beats a fabricated or generic one.
 *
 * Numeric firewall: every number in a rewritten section must trace back to the
 * section's OWN old text or the grounding evidence packet — callStructuredLLM's
 * shared numeric-fidelity firewall enforces this against `grounded`, which this
 * module builds to include the original section body verbatim.
 *
 * Bounded: max MAX_REWRITE_SECTIONS sections per page, operator-triggered
 * (no nightly auto-rewriting), budget-gated + fail-closed via the shared
 * callStructuredLLM. ~$0.01-0.02/section, ~$0.03-0.06 for a typical 3-5
 * section page.
 *
 * PURE assembly (assembleRewrite) is fully unit-testable with no I/O; the
 * walker (rewritePageStructured) is the only async/paid piece and is
 * dependency-injected (CompleteFn) for zero-cost tests.
 */

export const MAX_REWRITE_SECTIONS = 8;

/** Dash normalization for anything that lands in the final assembled rewrite —
 *  belt-and-suspenders on top of structured-drafter's own sanitizeDashesDeep.
 *  Reuses the canonical enforcer so the HARD "no em/en dashes anywhere" rule
 *  holds at this seam too. */
export function stripDashes(text: string): string {
  return stripBannedDashes(text);
}

/** One CURRENT section of the page being rewritten, as best-known from the
 *  page snapshot / live body. `oldBody` is best-effort (a crawl sample or the
 *  live field text when available) — never fabricated; an empty string is
 *  honest when Beacon has no body text for this heading, only its heading. */
export type CurrentPageSection = {
  heading: string;
  oldBody: string;
};

export type RewritePageGroundingInput = {
  /** The topic / demand cluster this page targets. */
  topic: string;
  /** The competitor's deterministic "what wins" one-liner, if any. */
  competitorWhatWins?: string | null;
  /** The competitor's own outline headings, if any. */
  competitorOutline?: string[];
  /** Fan-out sub-questions this page must be able to answer. */
  fanoutQuestions?: string[];
  /** Concrete facts the team already established for this topic (GSC/EvidencePacket/gap evidence). */
  evidenceFacts?: string[];
  /** Tenant id — used ONLY for the item-30 few-shot injection. Optional. */
  tenantId?: string;
};

export type RewriteSectionOutcome =
  | { status: "rewritten"; heading: string; oldBody: string; section: SectionDraft; costUsd: number; retried: boolean }
  | { status: "kept_original"; heading: string; oldBody: string; reason: string; costUsd: number };

export type RewritePageResult =
  | { status: "off" }
  | { status: "blocked_budget"; reason: string }
  | {
      status: "rewritten";
      outcomes: RewriteSectionOutcome[];
      totalCostUsd: number;
      sectionsRewritten: number;
      sectionsKeptOriginal: number;
    };

const SECTION_SYSTEM_BASE =
  "You REWRITE one section of an existing page, given its current heading, its current body text, and everything " +
  'established about the page. Return ONLY a JSON object: "heading" (may lightly sharpen the given heading but must ' +
  'stay on the same topic), "body" (the REWRITTEN section text, 60-220 words, factual and direct, an IMPROVEMENT on ' +
  'the current text, never a smaller/thinner version of it), "sources" (array of {"kind","detail"}, at least one; kind ' +
  "is one of own_data|competitor_observation|fanout_question|keyword), \"containsNumber\" (true only if the body " +
  "actually states a number). " +
  "Ground EVERYTHING ONLY in the current section text and the facts, competitor notes, and sub-questions provided " +
  "below. Do NOT invent statistics, dates, prices, rankings, counts, or superlatives that are not already present in " +
  "the current text or the grounding. No marketing language. No em-dashes, no en-dashes (hyphens only). " +
  "Write FINISHED, publish-ready prose about the topic itself, as a reader sees it on the live page. Never write a " +
  "content plan: no 'this section will cover', no 'planned subsections'. " +
  "Keep everything true and useful from the current text; sharpen the framing, answer the sub-questions more " +
  "directly, and close gaps the competitor covers that this section does not.";

/** Build the grounded blob the numeric-fidelity firewall checks the rewritten
 *  section's numbers against — the union of the section's OWN old text plus
 *  everything true this walk is allowed to state. Old text comes FIRST so a
 *  number already on the page is always in-bounds for its own rewrite. */
function groundingBlob(oldBody: string, g: RewritePageGroundingInput): string {
  return [
    oldBody,
    g.topic,
    g.competitorWhatWins ?? "",
    (g.competitorOutline ?? []).join(" "),
    (g.fanoutQuestions ?? []).join(" "),
    (g.evidenceFacts ?? []).join(" "),
  ].join(" ");
}

/** A short "already covered" excerpt for one rewritten (or kept) section. */
function coveredExcerpt(heading: string, body: string): string {
  const words = body.trim().split(/\s+/).slice(0, 24).join(" ");
  return `${heading}: ${words}${body.trim().split(/\s+/).length > 24 ? "…" : ""}`;
}

/** One CURRENT section -> one gated rewritten SectionDraft, or the ORIGINAL
 *  text kept verbatim on failure. Retries once on a regeneratable quality-gate
 *  failure; NEVER falls back to a stub — a rewrite that can't be improved
 *  confidently simply stays as it was. */
async function rewriteOneSection(args: {
  current: CurrentPageSection;
  index: number;
  total: number;
  grounding: RewritePageGroundingInput;
  grounded: string;
  covered: string[];
  fewShots: string;
  complete?: CompleteFn;
  now?: Date;
}): Promise<RewriteSectionOutcome> {
  const { current, index, total, grounding, grounded, covered, fewShots, complete, now } = args;
  const { heading, oldBody } = current;

  const buildUser = (sharpen?: string) =>
    [
      `Page topic: "${grounding.topic}"`,
      `This is section ${index + 1} of ${total}. Current heading: "${heading}"`,
      oldBody
        ? `Current body text for this section (rewrite THIS, do not replace it with an unrelated topic):\n${oldBody}`
        : "(Beacon has no body text on file for this section, only its heading — write a grounded section for this heading using only the facts below.)",
      grounding.competitorWhatWins ? `What the cited competitor page has: ${grounding.competitorWhatWins}` : "",
      (grounding.competitorOutline ?? []).length ? `Competitor's own outline: ${grounding.competitorOutline!.slice(0, 12).join("; ")}` : "",
      (grounding.fanoutQuestions ?? []).length ? `Sub-questions AI is asked (answer these if relevant to THIS heading): ${grounding.fanoutQuestions!.slice(0, 10).join("; ")}` : "",
      (grounding.evidenceFacts ?? []).length ? `Facts the team already established: ${grounding.evidenceFacts!.join("; ")}` : "",
      covered.length ? `Already covered in other sections (do NOT repeat these; keep this section distinct):\n${covered.map((c) => `- ${c}`).join("\n")}` : "(This is the first section.)",
      sharpen ? `Your previous attempt was rejected: ${sharpen}. Write a stronger, more specific, page-relevant rewrite.` : "",
      "",
      "Return the JSON now.",
    ]
      .filter(Boolean)
      .join("\n");

  const attempt = async (sharpen?: string) =>
    callStructuredLLM({
      kind: "section_draft",
      system: SECTION_SYSTEM_BASE + fewShots,
      user: buildUser(sharpen),
      grounded,
      projectedCostUsd: 0.01,
      maxTokens: 1400,
      timeoutMs: 45_000,
      complete,
      now,
    });

  let totalCost = 0;
  const keepOriginal = (reason: string, costUsd: number): RewriteSectionOutcome => ({
    status: "kept_original",
    heading: stripDashes(heading),
    oldBody: stripDashes(oldBody),
    reason,
    costUsd,
  });

  const first = await attempt();
  if (first.status === "blocked_budget" || first.status === "off") {
    return keepOriginal(first.status === "off" ? "AI drafting is off" : "budget reached", 0);
  }
  if (first.status === "drafted") {
    totalCost += first.costUsd;
    const q = evaluateSectionDraftQuality({ heading: first.value.heading, body: first.value.body, sourceCount: first.value.sources.length });
    if (q.status === "ready" || q.status === "useful_but_needs_review") {
      return { status: "rewritten", heading: stripDashes(heading), oldBody: stripDashes(oldBody), section: first.value, costUsd: totalCost, retried: false };
    }
    if (!q.canRegenerate) {
      return keepOriginal(q.reasons[0] ?? q.status, totalCost);
    }
    const second = await attempt(q.reasons[0] ?? q.status);
    if (second.status === "drafted") {
      totalCost += second.costUsd;
      const q2 = evaluateSectionDraftQuality({ heading: second.value.heading, body: second.value.body, sourceCount: second.value.sources.length });
      if (q2.status === "ready" || q2.status === "useful_but_needs_review") {
        return { status: "rewritten", heading: stripDashes(heading), oldBody: stripDashes(oldBody), section: second.value, costUsd: totalCost, retried: true };
      }
      return keepOriginal(q2.reasons[0] ?? q2.status, totalCost);
    }
    if (second.status === "validation_failed") totalCost += second.costUsd;
    return keepOriginal("could not produce a valid rewrite on retry", totalCost);
  }

  // first.status === "validation_failed"
  totalCost += first.costUsd;
  const second = await attempt("your previous output failed validation; return ONLY valid JSON with a grounded, specific rewrite");
  if (second.status === "drafted") {
    totalCost += second.costUsd;
    const q2 = evaluateSectionDraftQuality({ heading: second.value.heading, body: second.value.body, sourceCount: second.value.sources.length });
    if (q2.status === "ready" || q2.status === "useful_but_needs_review") {
      return { status: "rewritten", heading: stripDashes(heading), oldBody: stripDashes(oldBody), section: second.value, costUsd: totalCost, retried: true };
    }
    return keepOriginal(q2.reasons[0] ?? q2.status, totalCost);
  }
  if (second.status === "validation_failed") totalCost += second.costUsd;
  return keepOriginal("could not produce a valid rewrite", totalCost);
}

/**
 * Walk the CURRENT page's sections one by one into gated rewrites (or kept
 * originals). Sequential ON PURPOSE — each section sees prior sections' output
 * so rewrites stay distinct from each other. Capped at MAX_REWRITE_SECTIONS.
 */
export async function rewritePageStructured(
  sections: CurrentPageSection[],
  grounding: RewritePageGroundingInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<RewritePageResult> {
  const capped = sections.filter((s) => (s.heading ?? "").trim()).slice(0, MAX_REWRITE_SECTIONS);
  if (capped.length === 0) {
    return { status: "rewritten", outcomes: [], totalCostUsd: 0, sectionsRewritten: 0, sectionsKeptOriginal: 0 };
  }

  // item 30: house few-shots for this tenant's own measured winners for the
  // "content" family (rewrites sharpen existing content, same lever family the
  // debate uses for content edits). item 26: citability topFixes derived from
  // the first section's old text (best available "current copy" proxy).
  const fewShotsWinners = grounding.tenantId ? await buildWinnerFewShots(grounding.tenantId, "content").catch(() => "") : "";
  const citability = scorePageCitability(capped[0]?.oldBody ?? "");
  const citabilityNote =
    citability.topFixes.length > 0
      ? `\n\nPatterns AI-answer engines quote most (apply where relevant, never force one): ${citability.topFixes.join(" ")}`
      : "";
  const fewShots = fewShotsWinners + citabilityNote;

  const outcomes: RewriteSectionOutcome[] = [];
  const covered: string[] = [];
  let totalCostUsd = 0;

  for (let i = 0; i < capped.length; i += 1) {
    const current = capped[i]!;
    const grounded = groundingBlob(current.oldBody, grounding);
    const outcome = await rewriteOneSection({
      current,
      index: i,
      total: capped.length,
      grounding,
      grounded,
      covered,
      fewShots,
      complete: opts.complete,
      now: opts.now,
    });
    outcomes.push(outcome);
    totalCostUsd += outcome.costUsd;
    covered.push(
      outcome.status === "rewritten"
        ? coveredExcerpt(outcome.section.heading, outcome.section.body)
        : coveredExcerpt(outcome.heading, outcome.oldBody),
    );
  }

  const sectionsRewritten = outcomes.filter((o) => o.status === "rewritten").length;
  const sectionsKeptOriginal = outcomes.filter((o) => o.status === "kept_original").length;
  return { status: "rewritten", outcomes, totalCostUsd, sectionsRewritten, sectionsKeptOriginal };
}

// ── assembly: the side-by-side review shape ───────────────────────────────

export type AssembledRewriteSection = {
  heading: string;
  oldBody: string;
  /** The NEW body text: the rewrite when one landed, or the old body verbatim
   *  when the section was kept original (old === new, nothing to accept). */
  newBody: string;
  changed: boolean;
  sources: SectionSource[];
  containsNumber: boolean;
  keptReason: string | null;
};

export type AssembledRewrite = {
  sections: AssembledRewriteSection[];
  stats: { sectionsRewritten: number; sectionsKeptOriginal: number; totalCostUsd: number };
};

/**
 * Assemble the walk's outcomes into the side-by-side review shape. Dash-
 * stripped at every text field. PURE — no I/O.
 */
export function assembleRewrite(
  result: Extract<RewritePageResult, { status: "rewritten" }>,
): AssembledRewrite {
  const sections: AssembledRewriteSection[] = result.outcomes.map((o) => {
    if (o.status === "rewritten") {
      return {
        heading: stripDashes(o.section.heading),
        oldBody: stripDashes(o.oldBody),
        newBody: stripDashes(o.section.body),
        changed: true,
        sources: o.section.sources.map((s) => ({ kind: s.kind, detail: stripDashes(s.detail) })),
        containsNumber: o.section.containsNumber,
        keptReason: null,
      };
    }
    return {
      heading: stripDashes(o.heading),
      oldBody: stripDashes(o.oldBody),
      newBody: stripDashes(o.oldBody),
      changed: false,
      sources: [],
      containsNumber: false,
      keptReason: o.reason,
    };
  });
  return {
    sections,
    stats: { sectionsRewritten: result.sectionsRewritten, sectionsKeptOriginal: result.sectionsKeptOriginal, totalCostUsd: result.totalCostUsd },
  };
}

// ── persistence (projected, under the move_drafts 12k content cap) ───────────

const MAX_PERSIST_CHARS = 11_500;
const PERSIST_VERSION = 1;

export type PersistedRewriteDraft = {
  v: number;
  sections: AssembledRewriteSection[];
  stats: { sectionsRewritten: number; sectionsKeptOriginal: number; totalCostUsd: number };
};

/** Serialize an assembled rewrite for move_drafts (kind=page_rewrite). Returns
 *  null when the compact payload still exceeds the cap — never truncates to a
 *  malformed/half JSON (an honest "too big to persist" beats corrupt data). */
export function serializeRewriteDraft(page: AssembledRewrite): string | null {
  const compact: PersistedRewriteDraft = { v: PERSIST_VERSION, sections: page.sections, stats: page.stats };
  const content = JSON.stringify(compact);
  return content.length <= MAX_PERSIST_CHARS ? content : null;
}

/** Parse a persisted page_rewrite row back into its compact shape. Fail-soft → null. */
export function deserializeRewriteDraft(content: string | null | undefined): PersistedRewriteDraft | null {
  if (!content) return null;
  try {
    const obj = JSON.parse(content) as PersistedRewriteDraft;
    if (!obj || obj.v !== PERSIST_VERSION || !Array.isArray(obj.sections)) return null;
    return obj;
  } catch {
    return null;
  }
}

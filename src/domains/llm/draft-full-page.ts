import "server-only";

import { evaluateSectionDraftQuality } from "@/domains/drafts/draft-quality";
import { callStructuredLLM, type CompleteFn } from "./structured-drafter";
import { buildWinnerFewShots } from "./winner-memory";
import { scorePageCitability } from "@/domains/citability/citability-score";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import type { SectionDraft, SectionSource } from "./schemas";

/**
 * llm/draft-full-page (BEACON 500 item 55, 2026-07-02) — the section-by-section
 * outline-to-draft pipeline. CreatePageBriefSchema stops at an outline (titles,
 * meta, opening answer, H2 headings, FAQ questions); nothing before this walked
 * the outline into an actual paste-ready page. This module does that:
 *
 *   for each outline heading (max MAX_SECTIONS):
 *     ground the prompt on: the brief's own opening/outline, the competitor's
 *     "what wins" teardown + outline, fanout sub-questions, this tenant's own
 *     measured winner few-shots (item 30), and citability topFixes (item 26)
 *     -> callStructuredLLM("section_draft") -> evaluateSectionDraftQuality gate
 *     -> on a failing/regeneratable section, retry ONCE with a sharpen note
 *     -> on a second failure, fall back to an HONEST outline stub (never silently
 *        drop the section, never ship a rejected draft as if it were fine).
 *
 * Sections accumulate a running "already covered" context (prior headings + a
 * short excerpt of each prior body) so section N does not repeat section N-1 —
 * the single most common failure mode of independent per-section LLM calls.
 *
 * Bounded: max MAX_SECTIONS sections per page, one operator click per page (no
 * nightly auto-drafting this cycle — see the New Pages card button). Every call
 * goes through the existing budget-gated, fail-closed callStructuredLLM.
 *
 * PURE assembly (assembleDraftPage) is fully unit-testable with no I/O; the
 * walker (draftFullPageStructured) is the only async/paid piece and is
 * dependency-injected (CompleteFn) for zero-cost tests.
 */

export const MAX_SECTIONS = 8;

/** Dash normalization for anything that lands in the final assembled artifact —
 *  belt-and-suspenders on top of structured-drafter's own sanitizeDashesDeep,
 *  since assembly also stitches in the brief's title/meta/FAQ (already sanitized
 *  by the create-page-brief drafter, but a defensive strip here costs nothing
 *  and guarantees the HARD "no em/en dashes anywhere" rule holds at the seam).
 *  Reuses the canonical enforcer (src/lib/copy/strip-dashes.ts) rather than a
 *  local reimplementation. */
export function stripDashes(text: string): string {
  return stripBannedDashes(text);
}

export type FullPageBriefInput = {
  /** The persisted CreatePageBrief fields this walk drafts sections for. */
  proposedTitle: string;
  metaDescription: string;
  openingAnswer: string;
  /** H2 outline headings (already capped upstream; this walker re-caps to MAX_SECTIONS). */
  outline: string[];
  faqQuestions: string[];
};

export type FullPageGroundingInput = {
  /** The topic / demand cluster this page targets (for the prompt + firewall grounding). */
  topic: string;
  /** The competitor's deterministic "what wins" one-liner (competitor-page-audit.ts), if any. */
  competitorWhatWins?: string | null;
  /** The competitor's own outline headings (competitor-page-audit.ts facts.outline), if any. */
  competitorOutline?: string[];
  /** Fan-out sub-questions this page must be able to answer (Profound fanouts / EvidencePacket demand.fanoutSeeds). */
  fanoutQuestions?: string[];
  /** Concrete facts the team already established for this topic (GSC/EvidencePacket/gap evidence) — the numeric-fidelity grounding. */
  evidenceFacts?: string[];
  /** Tenant id — used ONLY to look up this tenant's own measured "create_page"
   *  winners for the item-30 few-shot injection. Optional; omitting it just
   *  means no few-shot examples (never an error). */
  tenantId?: string;
};

export type SectionOutcome =
  | { status: "drafted"; section: SectionDraft; costUsd: number; retried: boolean }
  | { status: "fallback_stub"; section: SectionDraft; costUsd: number; reason: string };

export type DraftFullPageResult =
  | { status: "off" }
  | { status: "blocked_budget"; reason: string }
  | {
      status: "drafted";
      outcomes: SectionOutcome[];
      totalCostUsd: number;
      sectionsDrafted: number;
      sectionsFallback: number;
    };

const SECTION_SYSTEM_BASE =
  "You write ONE section of an encyclopedia / content page, given the section heading and everything already " +
  'established about the page. Return ONLY a JSON object: "heading" (the section heading, may lightly refine the ' +
  'given one but must stay on the same topic), "body" (the section text, 60-220 words, factual and direct), ' +
  '"sources" (array of {"kind","detail"}, at least one; kind is one of own_data|competitor_observation|fanout_question|keyword: ' +
  'own_data = a fact the team already established about this site/topic, competitor_observation = something noted from the ' +
  "cited competitor page, fanout_question = this section answers a real sub-question AI is asked, keyword = grounded in search " +
  'demand data), "containsNumber" (true only if the body actually states a number). ' +
  "Ground EVERYTHING ONLY in the facts, competitor notes, and sub-questions provided below. Do NOT invent statistics, dates, " +
  "prices, rankings, counts, or superlatives. No marketing language. No em-dashes, no en-dashes (hyphens only). " +
  "Do NOT repeat a claim, sentence, or heading already covered in a prior section; each section must add NEW ground. " +
  "Write FINISHED, publish-ready prose about the topic itself, as a reader sees it on the live page. Never write a content plan: " +
  "no 'this section will cover', no 'planned subsections', no 'intended readers', no describing the page or its structure. " +
  "If the grounding is too thin to state facts, describe the topic qualitatively (scope, roles, relationships) in direct prose. " +
  "Open the section by naming the concrete sub-topic, never a context-free dictionary definition.";

/** Build the grounded blob the numeric-fidelity firewall checks every section's
 *  numbers against — the union of everything true this walk is allowed to state. */
function groundingBlob(g: FullPageGroundingInput, brief: FullPageBriefInput): string {
  return [
    g.topic,
    brief.proposedTitle,
    brief.openingAnswer,
    brief.outline.join(" "),
    brief.faqQuestions.join(" "),
    g.competitorWhatWins ?? "",
    (g.competitorOutline ?? []).join(" "),
    (g.fanoutQuestions ?? []).join(" "),
    (g.evidenceFacts ?? []).join(" "),
  ].join(" ");
}

/** A short "already covered" excerpt for one drafted (or fallback) section — used
 *  to build the accumulating no-repeat context for later sections. Capped short
 *  so the running context stays cheap even at 8 sections. */
function coveredExcerpt(s: SectionDraft): string {
  const words = s.body.trim().split(/\s+/).slice(0, 24).join(" ");
  return `${s.heading}: ${words}${s.body.trim().split(/\s+/).length > 24 ? "…" : ""}`;
}

/** Deterministic honest fallback when a section can't be drafted confidently
 *  after one retry — an outline stub, NEVER a fabricated or rejected draft. */
function fallbackStub(heading: string, reason: string): SectionDraft {
  return {
    heading: stripDashes(heading).slice(0, 160) || "Section",
    body: stripDashes(
      `I could not draft this section confidently. Here is what it should cover: ${heading}. Reason: ${reason}.`,
    ).slice(0, 1200),
    sources: [{ kind: "own_data", detail: "Outline heading from the create-page brief." }],
    containsNumber: false,
  };
}

/** One outline heading -> one gated SectionDraft. Retries once on a
 *  regeneratable quality-gate failure (not just an LLM/JSON failure — that
 *  retry already happens inside callStructuredLLM); falls back to an honest
 *  stub on a second failure or a non-regeneratable rejection. */
async function draftOneSection(args: {
  heading: string;
  index: number;
  total: number;
  grounding: FullPageGroundingInput;
  grounded: string;
  covered: string[];
  fewShots: string;
  complete?: CompleteFn;
  now?: Date;
}): Promise<SectionOutcome> {
  const { heading, index, total, grounding, grounded, covered, fewShots, complete, now } = args;

  const buildUser = (sharpen?: string) =>
    [
      `Page topic: "${grounding.topic}"`,
      `This is section ${index + 1} of ${total}. Section heading: "${heading}"`,
      grounding.competitorWhatWins ? `What the cited competitor page has: ${grounding.competitorWhatWins}` : "",
      (grounding.competitorOutline ?? []).length ? `Competitor's own outline: ${grounding.competitorOutline!.slice(0, 12).join("; ")}` : "",
      (grounding.fanoutQuestions ?? []).length ? `Sub-questions AI is asked (answer these if relevant to THIS heading): ${grounding.fanoutQuestions!.slice(0, 10).join("; ")}` : "",
      (grounding.evidenceFacts ?? []).length ? `Facts the team already established: ${grounding.evidenceFacts!.join("; ")}` : "",
      covered.length ? `Already covered in earlier sections (do NOT repeat these; add new ground):\n${covered.map((c) => `- ${c}`).join("\n")}` : "(This is the first section.)",
      sharpen ? `Your previous attempt was rejected: ${sharpen}. Write a stronger, more specific, page-relevant section.` : "",
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

  const first = await attempt();
  if (first.status === "blocked_budget" || first.status === "off") {
    // Bubble the exact status up to the caller by throwing a typed marker —
    // handled in draftFullPageStructured, which checks budget/gate ONCE up
    // front so this path is defensive only (kept honest, never silently stubbed).
    return { status: "fallback_stub", section: fallbackStub(heading, first.status === "off" ? "AI drafting is off" : "budget reached"), costUsd: 0, reason: first.status };
  }
  if (first.status === "drafted") {
    totalCost += first.costUsd;
    const q = evaluateSectionDraftQuality({ heading: first.value.heading, body: first.value.body, sourceCount: first.value.sources.length });
    if (q.status === "ready" || q.status === "useful_but_needs_review") {
      return { status: "drafted", section: first.value, costUsd: totalCost, retried: false };
    }
    if (!q.canRegenerate) {
      return { status: "fallback_stub", section: fallbackStub(heading, q.reasons[0] ?? q.status), costUsd: totalCost, reason: q.status };
    }
    // Regeneratable quality failure (generic/thin/malformed) — retry once with a sharpen note.
    const second = await attempt(q.reasons[0] ?? q.status);
    if (second.status === "drafted") {
      totalCost += second.costUsd;
      const q2 = evaluateSectionDraftQuality({ heading: second.value.heading, body: second.value.body, sourceCount: second.value.sources.length });
      if (q2.status === "ready" || q2.status === "useful_but_needs_review") {
        return { status: "drafted", section: second.value, costUsd: totalCost, retried: true };
      }
      return { status: "fallback_stub", section: fallbackStub(heading, q2.reasons[0] ?? q2.status), costUsd: totalCost, reason: q2.status };
    }
    if (second.status === "validation_failed") totalCost += second.costUsd;
    return { status: "fallback_stub", section: fallbackStub(heading, "could not produce a valid draft on retry"), costUsd: totalCost, reason: "validation_failed" };
  }

  // first.status === "validation_failed" (callStructuredLLM already retried its
  // own JSON/schema/firewall failure internally) — one more quality-layer retry
  // before falling back, matching the "retries once then falls back" contract.
  totalCost += first.costUsd;
  const second = await attempt("your previous output failed validation; return ONLY valid JSON with a grounded, specific section");
  if (second.status === "drafted") {
    totalCost += second.costUsd;
    const q2 = evaluateSectionDraftQuality({ heading: second.value.heading, body: second.value.body, sourceCount: second.value.sources.length });
    if (q2.status === "ready" || q2.status === "useful_but_needs_review") {
      return { status: "drafted", section: second.value, costUsd: totalCost, retried: true };
    }
    return { status: "fallback_stub", section: fallbackStub(heading, q2.reasons[0] ?? q2.status), costUsd: totalCost, reason: q2.status };
  }
  if (second.status === "validation_failed") totalCost += second.costUsd;
  return { status: "fallback_stub", section: fallbackStub(heading, "could not produce a valid draft"), costUsd: totalCost, reason: "validation_failed" };
}

/**
 * Walk a create-page brief's outline section by section into gated SectionDrafts.
 * Sequential (not parallel) ON PURPOSE — each section sees the prior sections'
 * headings/excerpts so it doesn't repeat them. Capped at MAX_SECTIONS; the
 * caller (assembleDraftPage) turns the outcomes into the paste-ready page.
 */
export async function draftFullPageStructured(
  brief: FullPageBriefInput,
  grounding: FullPageGroundingInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<DraftFullPageResult> {
  const headings = brief.outline.filter((h) => (h ?? "").trim()).slice(0, MAX_SECTIONS);
  if (headings.length === 0) return { status: "drafted", outcomes: [], totalCostUsd: 0, sectionsDrafted: 0, sectionsFallback: 0 };

  const grounded = groundingBlob(grounding, brief);

  // item 30: house few-shots for this tenant's own measured new-page winners
  // (the ExperimentFamily lever for create_page/new_page ships is "new_page").
  // item 26: citability topFixes, derived from the brief's own opening text (the
  // best available "what does our current best copy look like" proxy pre-draft).
  const fewShotsWinners = grounding.tenantId ? await buildWinnerFewShots(grounding.tenantId, "new_page").catch(() => "") : "";
  const citability = scorePageCitability(brief.openingAnswer || "");
  const citabilityNote =
    citability.topFixes.length > 0
      ? `\n\nPatterns AI-answer engines quote most (apply where relevant, never force one): ${citability.topFixes.join(" ")}`
      : "";
  const fewShots = fewShotsWinners + citabilityNote;

  const outcomes: SectionOutcome[] = [];
  const covered: string[] = [];
  let totalCostUsd = 0;

  for (let i = 0; i < headings.length; i += 1) {
    const outcome = await draftOneSection({
      heading: headings[i]!,
      index: i,
      total: headings.length,
      grounding,
      grounded,
      covered,
      fewShots,
      complete: opts.complete,
      now: opts.now,
    });
    outcomes.push(outcome);
    totalCostUsd += outcome.costUsd;
    covered.push(coveredExcerpt(outcome.section));
  }

  const sectionsDrafted = outcomes.filter((o) => o.status === "drafted").length;
  const sectionsFallback = outcomes.filter((o) => o.status === "fallback_stub").length;
  return { status: "drafted", outcomes, totalCostUsd, sectionsDrafted, sectionsFallback };
}

// ── assembly: paste-ready full page ───────────────────────────────────────────

export type AssembledDraftPage = {
  title: string;
  meta: string;
  sections: Array<{ heading: string; body: string; sources: SectionSource[]; containsNumber: boolean }>;
  faq: string[];
  /** Deduped, numbered list of every distinct source detail across all sections. */
  sourcesAppendix: Array<{ n: number; kind: SectionSource["kind"]; detail: string }>;
  /** Full paste-ready markdown: title, meta as a comment, sections, FAQ, sources. */
  markdown: string;
  /** How many sections came from a real drafted output vs. an honest fallback stub. */
  stats: { sectionsDrafted: number; sectionsFallback: number; totalCostUsd: number };
};

/**
 * Assemble the brief + drafted sections into a single paste-ready page: title,
 * meta, sections (each carrying its own sources), an optional FAQ, and a
 * deduped sources appendix. Dash-stripped at every text field (the HARD "no
 * em/en dashes anywhere" rule applies to generated drafts too). PURE — no I/O.
 */
export function assembleDraftPage(
  brief: FullPageBriefInput,
  result: Extract<DraftFullPageResult, { status: "drafted" }>,
): AssembledDraftPage {
  const title = stripDashes(brief.proposedTitle);
  const meta = stripDashes(brief.metaDescription);
  const sections = result.outcomes.map((o) => ({
    heading: stripDashes(o.section.heading),
    body: stripDashes(o.section.body),
    sources: o.section.sources.map((s) => ({ kind: s.kind, detail: stripDashes(s.detail) })),
    containsNumber: o.section.containsNumber,
  }));
  const faq = brief.faqQuestions.map((q) => stripDashes(q));

  // Dedup sources by (kind, detail) across all sections, numbered in first-seen order.
  const seen = new Map<string, { n: number; kind: SectionSource["kind"]; detail: string }>();
  let n = 1;
  for (const s of sections) {
    for (const src of s.sources) {
      const key = `${src.kind}::${src.detail.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, { n, kind: src.kind, detail: src.detail });
        n += 1;
      }
    }
  }
  const sourcesAppendix = [...seen.values()];

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`<!-- Meta description: ${meta} -->`);
  lines.push("");
  lines.push(stripDashes(brief.openingAnswer));
  lines.push("");
  for (const s of sections) {
    lines.push(`## ${s.heading}`);
    lines.push("");
    lines.push(s.body);
    lines.push("");
  }
  if (faq.length > 0) {
    lines.push("## Frequently asked questions");
    lines.push("");
    for (const q of faq) lines.push(`- ${q}`);
    lines.push("");
  }
  if (sourcesAppendix.length > 0) {
    lines.push("## Sources");
    lines.push("");
    for (const s of sourcesAppendix) lines.push(`${s.n}. (${s.kind}) ${s.detail}`);
    lines.push("");
  }

  return {
    title,
    meta,
    sections,
    faq,
    sourcesAppendix,
    markdown: stripDashes(lines.join("\n").trim()),
    stats: { sectionsDrafted: result.sectionsDrafted, sectionsFallback: result.sectionsFallback, totalCostUsd: result.totalCostUsd },
  };
}

// ── persistence (projected, under the move_drafts 12k content cap) ───────────

const MAX_PERSIST_CHARS = 11_500;
const PERSIST_VERSION = 1;

/** Compact persisted shape — the sections array only (title/meta/faq are already
 *  in the create_page_brief draft; re-persisting them here would waste the cap).
 *  serializeFullPageDraft/deserializeFullPageDraft round-trip this. */
export type PersistedFullPageDraft = {
  v: number;
  sections: Array<{ heading: string; body: string; sources: SectionSource[]; containsNumber: boolean }>;
  stats: { sectionsDrafted: number; sectionsFallback: number; totalCostUsd: number };
};

/** Serialize an assembled page's sections for move_drafts (kind=full_page_draft).
 *  Returns null when the compact payload still exceeds the cap (never truncates
 *  to a malformed/half JSON — an honest "too big to persist" beats corrupt data). */
export function serializeFullPageDraft(page: AssembledDraftPage): string | null {
  const compact: PersistedFullPageDraft = { v: PERSIST_VERSION, sections: page.sections, stats: page.stats };
  const content = JSON.stringify(compact);
  return content.length <= MAX_PERSIST_CHARS ? content : null;
}

/** Parse a persisted full_page_draft row back into its compact shape. Fail-soft → null. */
export function deserializeFullPageDraft(content: string | null | undefined): PersistedFullPageDraft | null {
  if (!content) return null;
  try {
    const obj = JSON.parse(content) as PersistedFullPageDraft;
    if (!obj || obj.v !== PERSIST_VERSION || !Array.isArray(obj.sections)) return null;
    return obj;
  } catch {
    return null;
  }
}

/** Re-assemble a full paste-ready page from a persisted compact draft + the
 *  (already-persisted, separately-cheap) create_page_brief fields. Pure. */
export function reassembleFromPersisted(brief: FullPageBriefInput, persisted: PersistedFullPageDraft): AssembledDraftPage {
  const fakeResult: Extract<DraftFullPageResult, { status: "drafted" }> = {
    status: "drafted",
    outcomes: persisted.sections.map((s) => ({
      status: "drafted" as const,
      section: { heading: s.heading, body: s.body, sources: s.sources, containsNumber: s.containsNumber },
      costUsd: 0,
      retried: false,
    })),
    totalCostUsd: persisted.stats.totalCostUsd,
    sectionsDrafted: persisted.stats.sectionsDrafted,
    sectionsFallback: persisted.stats.sectionsFallback,
  };
  return assembleDraftPage(brief, fakeResult);
}

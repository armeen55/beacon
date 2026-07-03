/**
 * info-gain-gate (2026-07-03, BEACON_500 R8 / N5 - the information-gain law).
 *
 * PURE / no I/O / no LLM. Given a create-page draft or brief (title, outline,
 * answer block, FAQ) and the teardown evidence for its topic (the cited
 * competitors' stored headings, FAQ questions, and content terms from
 * competitor-page-audit.ts), score what this page would ADD that the winners
 * do not already say:
 *
 *   - NOVEL SECTIONS: draft outline headings with no competitor equivalent by
 *     distinguishing-token overlap (a heading is novel only when it shares
 *     ZERO distinguishing tokens with EVERY competitor heading/FAQ question -
 *     a deliberately strong claim, so "novel" is never inflated).
 *   - NOVEL FACTS: draft answer-block sentences carrying at least two
 *     distinguishing tokens that appear NOWHERE in any competitor extract
 *     (title, meta, H1, outline, FAQ, top content terms combined).
 *   - ORIGINAL ASSETS: tables, datasets, tools, calculators the draft plans
 *     that no cited winner has (competitor hasToolOrCalculator / heading scan).
 *
 * Verdicts (the three-way law):
 *   adds_something   >= 2 novel sections OR >= 3 novel fact sentences
 *   thin_addition    at least one novel section/fact/asset, below that bar
 *   duplicate_of_serp nothing novel at all - the page would only restate
 *                     what the cited winners already say
 *   unchecked        no teardown evidence for the topic, or no draft to score
 *                     - the gate is then a NO-OP (never block on missing data,
 *                     never fake a check; pinned byte-identical in tests).
 *
 * Every verdict carries one plain sentence naming the strongest novel
 * contribution or the strongest overlap, e.g. "This would mostly repeat what
 * wikipedia.org already says about Persian cats; the one new angle is a
 * section on Care Costs." Beacon voice: first person where natural, concrete
 * counts, no dashes, no lab words.
 *
 * `gateCreatePageInfoGain` is the HARD gate the create-page pipeline
 * (load-graph.ts) runs over its create_page Moves:
 *   duplicate_of_serp -> reclassified to edit_page at the known owned URL when
 *                        one exists, else DROPPED with the honest reason
 *   thin_addition     -> kept but DEMOTED below every adds_something row
 *   adds_something    -> kept, with the verdict attached for the card
 *   unchecked         -> untouched (no attach, no reorder)
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";

export type InfoGainVerdict =
  | "adds_something"
  | "thin_addition"
  | "duplicate_of_serp"
  | "unchecked";

/** The draft/brief side of the comparison. All fields optional - a brief with
 *  neither an outline nor an answer cannot be scored (verdict "unchecked"). */
export type InfoGainDraft = {
  title?: string | null;
  outline?: readonly string[] | null;
  /** The opening/answer block prose (novel-fact sentences come from here). */
  answer?: string | null;
  faqQuestions?: readonly string[] | null;
};

/** One cited competitor's stored teardown extract. Structural subset of
 *  CompetitorPageFacts (competitor-page-audit.ts) so callers can pass audits
 *  directly without this module importing a server-only file at runtime. */
export type CompetitorExtract = {
  url?: string | null;
  domain?: string | null;
  title?: string | null;
  metaDescription?: string | null;
  h1?: string | null;
  outline?: readonly string[] | null;
  faqQuestions?: readonly string[] | null;
  topTerms?: readonly string[] | null;
  hasToolOrCalculator?: boolean;
};

export type InfoGainResult = {
  verdict: InfoGainVerdict;
  /** Draft outline headings no competitor covers (original casing). */
  novelSections: string[];
  /** Draft answer sentences whose distinguishing tokens no competitor has. */
  novelFactSentences: string[];
  /** Planned tables/datasets/tools no cited winner has. */
  originalAssets: string[];
  /** The competitor domain sharing the most ground with the draft, or null. */
  strongestOverlapDomain: string | null;
  /** ONE plain sentence for the card (dash-free, Beacon voice). */
  sentence: string;
  /** How many competitor extracts were actually compared. */
  sourceCount: number;
};

/** The compact per-move attachment the pipeline carries onto surviving Moves. */
export type InfoGainSummary = {
  verdict: InfoGainVerdict;
  sentence: string;
  novelSections: string[];
  novelFactCount: number;
  originalAssets: string[];
  sourceCount: number;
};

const ADDS_MIN_NOVEL_SECTIONS = 2;
const ADDS_MIN_NOVEL_FACTS = 3;
/** A novel-fact sentence must carry at least this many distinguishing tokens
 *  absent from every competitor extract (one stray rare word is not a fact). */
const MIN_NOVEL_TOKENS_PER_FACT = 2;
/** And be substantive prose, not a fragment. */
const MIN_FACT_SENTENCE_WORDS = 6;
const MAX_LISTED = 6;

const TOOL_ASSET = /\b(calculator|converter|quiz|interactive (?:map|tool|chart)|tool)\b/i;
const DATA_ASSET = /\b(table|chart|dataset|checklist|timeline|worksheet)\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

function domainLabel(e: CompetitorExtract): string {
  if (e.domain) return e.domain;
  try {
    const u = e.url ?? "";
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return "the cited pages";
  }
}

function usableExtract(e: CompetitorExtract | null | undefined): e is CompetitorExtract {
  if (!e) return false;
  return Boolean(
    (e.outline && e.outline.length > 0) ||
      (e.faqQuestions && e.faqQuestions.length > 0) ||
      e.title ||
      e.h1 ||
      (e.topTerms && e.topTerms.length > 0),
  );
}

/** Every distinguishing token across one competitor's stored extract. */
function extractCorpusTokens(e: CompetitorExtract): Set<string> {
  const parts: string[] = [];
  if (e.title) parts.push(e.title);
  if (e.metaDescription) parts.push(e.metaDescription);
  if (e.h1) parts.push(e.h1);
  for (const h of e.outline ?? []) parts.push(h);
  for (const q of e.faqQuestions ?? []) parts.push(q);
  for (const t of e.topTerms ?? []) parts.push(t);
  return new Set(topicTokens(parts.join(" ")));
}

/** Competitor heading/FAQ token sets, for the novel-section check. */
function extractHeadingTokenSets(e: CompetitorExtract): Set<string>[] {
  const out: Set<string>[] = [];
  for (const h of [...(e.outline ?? []), ...(e.faqQuestions ?? [])]) {
    const toks = new Set(topicTokens(h));
    if (toks.size > 0) out.push(toks);
  }
  return out;
}

function smallCount(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return n >= 0 && n < words.length ? words[n]! : String(n);
}

/**
 * Score what a draft ADDS over the cited winners. Deterministic, pure.
 * `topicLabel` names the topic in the sentence (falls back to the draft title).
 */
export function scoreInfoGain(
  draft: InfoGainDraft | null | undefined,
  competitors: readonly (CompetitorExtract | null | undefined)[],
  opts: { topicLabel?: string | null } = {},
): InfoGainResult {
  const extracts = (competitors ?? []).filter(usableExtract);
  const topic = (opts.topicLabel ?? draft?.title ?? "this topic").trim() || "this topic";

  const unchecked = (why: string): InfoGainResult => ({
    verdict: "unchecked",
    novelSections: [],
    novelFactSentences: [],
    originalAssets: [],
    strongestOverlapDomain: null,
    sentence: why,
    sourceCount: extracts.length,
  });

  if (extracts.length === 0) {
    return unchecked(
      `I have not read the winning pages for ${topic} yet, so I cannot score what this page would add.`,
    );
  }

  const outline = (draft?.outline ?? []).map((h) => (h ?? "").trim()).filter(Boolean);
  const answer = (draft?.answer ?? "").trim();
  if (outline.length === 0 && !answer) {
    return unchecked(
      `There is no draft for ${topic} to compare yet, so I cannot score what this page would add.`,
    );
  }

  const headingSetsPerCompetitor = extracts.map(extractHeadingTokenSets);
  const corpusPerCompetitor = extracts.map(extractCorpusTokens);
  const combinedCorpus = new Set<string>();
  for (const c of corpusPerCompetitor) for (const t of c) combinedCorpus.add(t);

  // Novel sections: zero shared distinguishing tokens with EVERY competitor
  // heading/FAQ question.
  const novelSections: string[] = [];
  for (const heading of outline) {
    const toks = topicTokens(heading);
    if (toks.length === 0) continue;
    const covered = headingSetsPerCompetitor.some((sets) =>
      sets.some((set) => toks.some((t) => set.has(t))),
    );
    if (!covered) novelSections.push(heading);
  }

  // Novel facts: answer sentences with >= 2 distinguishing tokens absent from
  // every competitor extract.
  const novelFactSentences: string[] = [];
  for (const sentence of splitSentences(answer)) {
    if (wordCount(sentence) < MIN_FACT_SENTENCE_WORDS) continue;
    const toks = topicTokens(sentence);
    const novel = toks.filter((t) => !combinedCorpus.has(t));
    if (novel.length >= MIN_NOVEL_TOKENS_PER_FACT) novelFactSentences.push(sentence);
  }

  // Original assets: planned tables/datasets/tools no cited winner has.
  const originalAssets: string[] = [];
  const anyCompetitorTool = extracts.some((e) => e.hasToolOrCalculator === true);
  for (const heading of outline) {
    const toolMatch = heading.match(TOOL_ASSET);
    if (toolMatch && !anyCompetitorTool) {
      originalAssets.push(heading);
      continue;
    }
    const dataMatch = heading.match(DATA_ASSET);
    if (dataMatch) {
      const assetToken = topicTokens(dataMatch[1] ?? "")[0];
      if (assetToken && !combinedCorpus.has(assetToken)) originalAssets.push(heading);
    }
  }

  // Strongest overlap: the competitor sharing the most draft tokens.
  const draftTokens = new Set(
    topicTokens([draft?.title ?? "", ...outline, answer, ...(draft?.faqQuestions ?? [])].join(" ")),
  );
  let strongestOverlapDomain: string | null = null;
  let bestShared = -1;
  extracts.forEach((e, i) => {
    let shared = 0;
    for (const t of corpusPerCompetitor[i]!) if (draftTokens.has(t)) shared += 1;
    if (shared > bestShared) {
      bestShared = shared;
      strongestOverlapDomain = domainLabel(e);
    }
  });

  const verdict: InfoGainVerdict =
    novelSections.length >= ADDS_MIN_NOVEL_SECTIONS || novelFactSentences.length >= ADDS_MIN_NOVEL_FACTS
      ? "adds_something"
      : novelSections.length + novelFactSentences.length + originalAssets.length >= 1
        ? "thin_addition"
        : "duplicate_of_serp";

  const strongestNovel =
    novelSections.length > 0
      ? `a section on "${novelSections[0]}"`
      : originalAssets.length > 0
        ? `"${originalAssets[0]}"`
        : novelFactSentences.length > 0
          ? `the fact "${novelFactSentences[0]!.slice(0, 90)}"`
          : null;

  let sentence: string;
  if (verdict === "adds_something") {
    const parts: string[] = [];
    if (novelSections.length > 0)
      parts.push(`${smallCount(novelSections.length)} section${novelSections.length === 1 ? "" : "s"}`);
    if (novelFactSentences.length > 0)
      parts.push(`${smallCount(novelFactSentences.length)} fact${novelFactSentences.length === 1 ? "" : "s"}`);
    sentence = `This page adds ${parts.join(" and ")} the ${smallCount(extracts.length)} cited winner${extracts.length === 1 ? "" : "s"} do not cover; the strongest new contribution is ${strongestNovel}.`;
  } else if (verdict === "thin_addition") {
    sentence = `This would mostly repeat what ${strongestOverlapDomain} already says about ${topic}; the one new angle is ${strongestNovel}.`;
  } else {
    sentence = `This would mostly repeat what ${strongestOverlapDomain} already says about ${topic}, and I found nothing it adds that the cited pages do not already say.`;
  }

  return {
    verdict,
    novelSections: novelSections.slice(0, MAX_LISTED),
    novelFactSentences: novelFactSentences.slice(0, MAX_LISTED),
    originalAssets: originalAssets.slice(0, MAX_LISTED),
    strongestOverlapDomain,
    sentence,
    sourceCount: extracts.length,
  };
}

/** Compact attachment from a full result. */
export function toInfoGainSummary(r: InfoGainResult): InfoGainSummary {
  return {
    verdict: r.verdict,
    sentence: r.sentence,
    novelSections: r.novelSections,
    novelFactCount: r.novelFactSentences.length,
    originalAssets: r.originalAssets,
    sourceCount: r.sourceCount,
  };
}

// ── the HARD gate over create_page Moves ─────────────────────────────────────

export type InfoGainMoveInput = {
  draft: InfoGainDraft | null;
  extracts: CompetitorExtract[];
};

export type InfoGainChange = {
  demandKey: string;
  label: string;
  action: "dropped" | "reclassified" | "demoted";
  verdict: InfoGainVerdict;
  reason: string;
};

export type InfoGainGateResult = {
  moves: MoveCandidate[];
  changes: InfoGainChange[];
};

/**
 * The N5 hard gate. Runs over the pipeline's Moves AFTER the ownership gate +
 * sibling collapse. A create_page Move with no scored input (no brief yet, or
 * no torn-down competitors) is untouched; when NOTHING can be scored the
 * ORIGINAL array reference is returned (byte-identical no-op, pinned).
 */
export function gateCreatePageInfoGain(
  moves: readonly MoveCandidate[],
  inputsByDemandKey: ReadonlyMap<string, InfoGainMoveInput>,
): InfoGainGateResult {
  const changes: InfoGainChange[] = [];
  const out: MoveCandidate[] = [];
  let touched = false;
  const thinMoves: MoveCandidate[] = [];
  const addsScores: number[] = [];

  for (const m of moves) {
    if (m.gap !== "create_page") {
      out.push(m);
      continue;
    }
    const input = inputsByDemandKey.get(m.demandKey);
    const result = scoreInfoGain(input?.draft ?? null, input?.extracts ?? [], { topicLabel: m.label });
    if (result.verdict === "unchecked") {
      out.push(m);
      continue;
    }

    touched = true;
    if (result.verdict === "duplicate_of_serp") {
      if (m.ownedUrl) {
        const reclassified: MoveCandidate = {
          ...m,
          gap: "edit_page",
          rationale: `${result.sentence} Strengthen the existing page instead of creating a new one.`,
          infoGain: toInfoGainSummary(result),
        };
        out.push(reclassified);
        changes.push({ demandKey: m.demandKey, label: m.label, action: "reclassified", verdict: result.verdict, reason: result.sentence });
      } else {
        changes.push({ demandKey: m.demandKey, label: m.label, action: "dropped", verdict: result.verdict, reason: result.sentence });
      }
      continue;
    }

    const kept: MoveCandidate = { ...m, infoGain: toInfoGainSummary(result) };
    out.push(kept);
    if (result.verdict === "thin_addition") thinMoves.push(kept);
    else addsScores.push(kept.score);
  }

  if (!touched) return { moves: moves as MoveCandidate[], changes };

  // Demote every thin_addition create_page row below every adds_something row.
  if (thinMoves.length > 0 && addsScores.length > 0) {
    const minAdds = Math.min(...addsScores);
    const needDemotion = thinMoves.filter((t) => t.score >= minAdds).sort((a, b) => b.score - a.score);
    if (needDemotion.length > 0) {
      const step = Math.abs(minAdds) * 0.02 + 0.001;
      needDemotion.forEach((t, i) => {
        t.score = minAdds - step * (i + 1);
        changes.push({
          demandKey: t.demandKey,
          label: t.label,
          action: "demoted",
          verdict: "thin_addition",
          reason: t.infoGain?.sentence ?? "Adds too little beyond what the cited winners already say.",
        });
      });
      out.sort((a, b) => b.score - a.score);
    }
  }

  return { moves: out, changes };
}

// ── caller-side input builders (pure; the pipeline's audits + drafts in) ─────

/** Structural subset of CompetitorPageAudit so this module never runtime-
 *  imports the server-only audit store. */
export type AuditLike = {
  url: string;
  domain?: string | null;
  fetchStatus: string;
  facts: {
    title?: string | null;
    metaDescription?: string | null;
    h1?: string | null;
    outline?: readonly string[] | null;
    faqQuestions?: readonly string[] | null;
    topTerms?: readonly string[] | null;
    hasToolOrCalculator?: boolean;
  } | null;
};

export function auditToExtract(a: AuditLike): CompetitorExtract | null {
  if (a.fetchStatus !== "ok" || !a.facts) return null;
  return {
    url: a.url,
    domain: a.domain ?? null,
    title: a.facts.title ?? null,
    metaDescription: a.facts.metaDescription ?? null,
    h1: a.facts.h1 ?? null,
    outline: a.facts.outline ?? [],
    faqQuestions: a.facts.faqQuestions ?? [],
    topTerms: a.facts.topTerms ?? [],
    hasToolOrCalculator: a.facts.hasToolOrCalculator ?? false,
  };
}

/** Parse a persisted create_page_brief (llm/schemas CreatePageBrief JSON) into
 *  the comparison shape. Malformed content -> null (verdict stays unchecked;
 *  never fake a check off a broken draft). */
export function parseBriefForInfoGain(content: string | null | undefined): InfoGainDraft | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content) as Record<string, unknown>;
    const draft: InfoGainDraft = {
      title: typeof v.proposedTitle === "string" ? v.proposedTitle : null,
      answer: typeof v.openingAnswer === "string" ? v.openingAnswer : null,
      outline: Array.isArray(v.outline) ? (v.outline.filter((s) => typeof s === "string") as string[]) : [],
      faqQuestions: Array.isArray(v.faqQuestions)
        ? (v.faqQuestions.filter((s) => typeof s === "string") as string[])
        : [],
    };
    if ((draft.outline?.length ?? 0) === 0 && !draft.answer) return null;
    return draft;
  } catch {
    return null;
  }
}

/**
 * Build the per-move inputs for `gateCreatePageInfoGain` from what the
 * pipeline already has in hand: the shared competitor-audit cache (keyed by
 * canonicalized URL) and the persisted move drafts map
 * (`${demandKey}::create_page_brief`). Pure; the caller passes its own URL
 * canonicalizer so this module stays dependency-free.
 */
export function buildCreatePageInfoGainInputs(args: {
  moves: readonly MoveCandidate[];
  auditsByUrl: ReadonlyMap<string, AuditLike>;
  drafts: ReadonlyMap<string, { content: string }>;
  canonicalize?: (url: string) => string | null;
}): Map<string, InfoGainMoveInput> {
  const canon = args.canonicalize ?? ((u: string) => u);
  const out = new Map<string, InfoGainMoveInput>();
  for (const m of args.moves) {
    if (m.gap !== "create_page") continue;
    const extracts: CompetitorExtract[] = [];
    for (const url of m.competitorUrls ?? []) {
      const audit = args.auditsByUrl.get(canon(url) ?? url) ?? args.auditsByUrl.get(url);
      const extract = audit ? auditToExtract(audit) : null;
      if (extract) extracts.push(extract);
    }
    const draft = parseBriefForInfoGain(args.drafts.get(`${m.demandKey}::create_page_brief`)?.content);
    out.set(m.demandKey, { draft, extracts });
  }
  return out;
}

/**
 * Topic-keyed extract matching for the page factory (whose candidates carry a
 * topic/title, not competitor URLs). An entry matches when EVERY
 * distinguishing token of the smaller side appears in the larger (the same
 * strict subset rule the ownership registry's resolveOwner uses), so "Persian
 * Cat Care Cost" matches a torn-down "persian cat care cost guide" keyword but
 * never an unrelated page sharing one generic word. Dedupes by URL, caps at 5.
 */
export function extractsForTopic(
  topic: string,
  entries: readonly { topics: readonly string[]; extract: CompetitorExtract }[],
): CompetitorExtract[] {
  const topicSet = new Set(topicTokens(topic));
  if (topicSet.size === 0) return [];
  const out: CompetitorExtract[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const matched = entry.topics.some((t) => {
      const entrySet = new Set(topicTokens(t));
      if (entrySet.size === 0) return false;
      const [smaller, larger] =
        entrySet.size <= topicSet.size ? [entrySet, topicSet] : [topicSet, entrySet];
      for (const tok of smaller) if (!larger.has(tok)) return false;
      return true;
    });
    if (!matched) continue;
    const key = (entry.extract.url ?? "").toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(entry.extract);
    if (out.length >= 5) break;
  }
  return out;
}

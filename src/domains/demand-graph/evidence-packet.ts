/**
 * evidence-packet (2026-06-24, Step 4) — the Source-of-Truth EvidencePacket: one
 * object per Move that fuses demand (graph) + competitor teardown (Step 3) + the
 * tenant's own page + the deterministic gaps + a grounded draft SKELETON + a
 * proof plan + a stable evidenceHash.
 *
 * PURE / deterministic / no I/O / no LLM. The draft is a grounded skeleton
 * (titles formatted from the real query, sections from the competitor outline +
 * Profound fanouts, schema from what the competitor has and you lack) — never
 * fabricated prose. LLM enrichment is a later, explicitly-gated step; until then
 * `draft.kind === "deterministic_skeleton"`. This is what every surface renders
 * and what Step 5 materializes into an AtomicChangePack. Pinned by
 * evidence-packet.test.ts.
 */

import { createHash } from "node:crypto";
import type { MoveCandidate, MoveComponents, ConfidenceLevel, GapKind } from "./build-graph";
import type { CompetitorPageFacts } from "./competitor-page-audit";
import { whatWins } from "./competitor-page-audit";
import { bestTitle } from "./ctr-title-scorer";

/** Structural facts both owned + competitor pages expose, for comparison. */
export type PageStructureFacts = {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2Count: number;
  outline: string[];
  schemaTypes: string[];
  hasFaq: boolean;
  hasAnswerBlock: boolean;
  wordCount: number;
};

export type GapKindDetail =
  | "missing_page"
  | "missing_answer_block"
  | "missing_faq"
  | "thin_content"
  | "missing_schema"
  | "weak_title"
  | "weak_meta"
  | "missing_tool"
  | "ux_friction";

export type EvidenceGap = { kind: GapKindDetail; detail: string };

export type DraftSkeleton = {
  kind: "deterministic_skeleton" | "llm";
  titleSuggestion: string | null;
  metaBrief: string | null;
  /** Sections to cover (competitor outline + fanout questions) — grounded. */
  outline: string[];
  /** Instruction for the answer block (NOT a fabricated answer). */
  answerBlockBrief: string | null;
  /** FAQ questions to answer (fanouts + competitor questions). */
  faqQuestions: string[];
  /** Schema types the competitor has that you lack. */
  schemaRecommendations: string[];
  /** When the gap is a tool/calculator. */
  assetSpec: string | null;
  note: string;
};

export type EvidencePacket = {
  move: {
    key: string;
    gapType: GapKind;
    label: string;
    confidence: ConfidenceLevel;
    score: number;
    components: MoveComponents;
    signals: string[];
  };
  demand: {
    /** Fused demand weight (GSC impressions/volume + AI-ask). For create_page
     *  candidates this is an AI-attention proxy, NOT measured search volume —
     *  `basis` says which, so the number is never silently mislabeled. */
    demandWeight: number;
    basis: "gsc" | "ai_attention" | "mixed";
    queries: string[];
    fanoutSeeds: string[];
  };
  competitor: {
    topUrl: string | null;
    domain: string | null;
    fetchStatus: string | null;
    facts: CompetitorPageFacts | null;
    whatWins: string;
    /** 0–1 query-token overlap with the cited page. */
    relevance: number;
    /** True when AI cited the page but it's off-topic for the query (not inherited). */
    looselyMatched: boolean;
    otherUrls: string[];
  };
  yourPage: {
    url: string | null;
    facts: PageStructureFacts | null;
    gsc: { clicks: number; impressions: number; ctr: number; position: number | null } | null;
    dollarValue: number;
    friction: number;
  };
  gaps: EvidenceGap[];
  draft: DraftSkeleton;
  proofPlan: { metrics: string[]; windowsDays: number[]; controls: string };
  evidenceHash: string;
};

export type BuildEvidencePacketInput = {
  move: MoveCandidate;
  brand: string;
  /** Owned page structural facts (from the latest snapshot), or null. */
  ownedFacts: PageStructureFacts | null;
  ownedGsc: EvidencePacket["yourPage"]["gsc"];
  /** The top competitor's deterministic teardown audit, when available. */
  competitor: { url: string; domain: string; fetchStatus: string; facts: CompetitorPageFacts | null } | null;
  /** Profound fanout sub-questions for this cluster, if any. */
  fanoutSeeds?: string[];
};

function clampTitle(s: string): string {
  return s.length <= 60 ? s : s.slice(0, 57).trimEnd() + "…";
}

const TITLE_WEAK_MIN = 15;

const REL_STOP = new Set(["and", "the", "for", "with", "your", "you", "are", "best", "top"]);
/** simple plural fold so "flags"≈"flag", "names"≈"name" (avoids over-suppression). */
function depluralize(w: string): string {
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}
function qTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !REL_STOP.has(t)).map(depluralize);
}
/** 0–1: share of (≥3-char) query tokens present in the competitor page's
 *  title/topTerms/outline, by EXACT (depluralized) TOKEN match — substring
 *  matching would let "iran" pass on "irani"/"flagship" and defeat the gate.
 *  Guards against off-topic AI-cited pages (borrowed-Profound-account noise)
 *  driving the draft — e.g. a "top cultural tours" page cited for "iran flag". */
export function competitorRelevance(query: string, facts: CompetitorPageFacts | null): number {
  if (!facts) return 0;
  const q = qTokens(query);
  if (!q.length) return 0;
  const hay = new Set(
    [facts.title ?? "", ...(facts.topTerms ?? []), ...(facts.outline ?? [])]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(depluralize),
  );
  return q.filter((t) => hay.has(t)).length / q.length;
}
const REL_MIN = 0.6;

export function buildEvidencePacket(input: BuildEvidencePacketInput): EvidencePacket {
  const { move, brand, ownedFacts, competitor } = input;
  const cFacts = competitor?.facts ?? null;
  const fanoutSeeds = (input.fanoutSeeds ?? move.fanoutSeeds ?? []).slice(0, 10);
  const primaryQuery = move.label;

  // Relevance gate: only let an on-topic competitor drive the draft + comparative
  // gaps. AI-cited pages can be tangential (the borrowed Profound account cites
  // loosely) — a low-relevance page is shown honestly but labeled, not inherited.
  const relevance = competitorRelevance(primaryQuery, cFacts);
  const competitorOnTopic = !!cFacts && relevance >= REL_MIN;
  const looselyMatched = !!cFacts && !competitorOnTopic;

  // ── deterministic gap detection (owned vs competitor) ──
  const gaps: EvidenceGap[] = [];
  const hasOwned = !!ownedFacts;

  if (move.gap === "create_page" || !hasOwned) {
    gaps.push({
      kind: "missing_page",
      detail: competitor
        ? `No owned page; AI cites ${competitor.domain} (and ${move.competitorUrls.length - 1} more) for "${primaryQuery}".`
        : `No owned page for "${primaryQuery}" despite demand.`,
    });
  } else {
    // answer block: keyed off the (reliable) move type — owned snapshots carry no
    // explicit answer-block flag, so we don't false-positive on edit_page rows.
    if (move.gap === "answer_block") {
      gaps.push({
        kind: "missing_answer_block",
        detail: competitorOnTopic && cFacts?.hasAnswerBlock
          ? `${competitor!.domain} leads with a direct answer block and AI cites them, not you — add a concise, extractable answer to "${primaryQuery}".`
          : `AI cites competitors, not you — add a concise, extractable answer to "${primaryQuery}".`,
      });
    }
    if (competitorOnTopic && (cFacts?.hasFaq || (cFacts?.faqQuestionCount ?? 0) > 0) && !ownedFacts!.hasFaq) {
      gaps.push({ kind: "missing_faq", detail: `${competitor!.domain} has a FAQ (${cFacts!.faqQuestionCount} Qs); your page has none.` });
    }
    // thin content (only vs an on-topic competitor)
    if (competitorOnTopic && cFacts && cFacts.wordCount > 0 && ownedFacts!.wordCount > 0 && cFacts.wordCount >= ownedFacts!.wordCount * 1.5) {
      gaps.push({ kind: "thin_content", detail: `Thin vs competitor: ${ownedFacts!.wordCount}w you vs ${cFacts.wordCount}w ${competitor!.domain} (${cFacts.h2Count} sections).` });
    }
    // missing schema (only vs an on-topic competitor)
    const missingSchema = competitorOnTopic ? (cFacts?.schemaTypes ?? []).filter((t) => !ownedFacts!.schemaTypes.includes(t)) : [];
    if (missingSchema.length > 0) {
      gaps.push({ kind: "missing_schema", detail: `Competitor uses schema you lack: ${missingSchema.slice(0, 4).join(", ")}.` });
    }
    // weak title/meta (GSC-driven edit)
    if (move.gap === "edit_page") {
      if (!ownedFacts!.title || ownedFacts!.title.length < TITLE_WEAK_MIN) {
        gaps.push({ kind: "weak_title", detail: `Title is missing/short; under-clicked at position ${input.ownedGsc?.position ?? "?"}.` });
      } else {
        gaps.push({ kind: "weak_title", detail: `Ranks (#${input.ownedGsc?.position ?? "?"}) but under-clicked — tighten title to "${primaryQuery}".` });
      }
      if (!ownedFacts!.metaDescription) gaps.push({ kind: "weak_meta", detail: `No meta description — add one that promises the answer.` });
    }
  }
  // friction
  if (move.gap === "fix_experience" || move.components.friction >= 15) {
    gaps.push({ kind: "ux_friction", detail: `Clarity friction ${move.components.friction} on a high-demand page — fix dead/rage clicks before chasing traffic.` });
  }
  // tool / asset (only vs an on-topic competitor)
  if (competitorOnTopic && cFacts?.hasToolOrCalculator && !(ownedFacts && /calculator|tool|converter|quiz|estimator/i.test(ownedFacts.title ?? ""))) {
    gaps.push({ kind: "missing_tool", detail: `${competitor!.domain} offers an interactive tool/calculator for this topic; you don't.` });
  }

  // ── deterministic draft skeleton (grounded; NO fabricated prose, NO LLM) ──
  const outline: string[] = [];
  // Only inherit the competitor's outline when it's on-topic; otherwise the draft
  // is built from Profound fanouts alone (never an off-topic page's structure).
  for (const h of (competitorOnTopic ? cFacts?.outline : []) ?? []) {
    if (outline.length >= 12) break;
    if (h && !outline.includes(h)) outline.push(h);
  }
  for (const q of fanoutSeeds) {
    if (outline.length >= 14) break;
    if (!outline.includes(q)) outline.push(q);
  }
  const faqQuestions = [...new Set([...(competitorOnTopic ? cFacts?.faqQuestions ?? [] : []), ...fanoutSeeds])].slice(0, 8);
  const schemaRecommendations = (competitorOnTopic ? cFacts?.schemaTypes ?? [] : []).filter((t) => !(ownedFacts?.schemaTypes ?? []).includes(t)).slice(0, 6);
  const isCreate = move.gap === "create_page" || !hasOwned;
  const hasToolGap = gaps.some((g) => g.kind === "missing_tool");

  const draft: DraftSkeleton = {
    kind: "deterministic_skeleton",
    titleSuggestion: clampTitle(bestTitle(primaryQuery, brand)),
    metaBrief: `Write a ~150-char meta description that directly answers "${primaryQuery}" and promises the page's value.`,
    outline,
    answerBlockBrief:
      gaps.some((g) => g.kind === "missing_answer_block") || isCreate
        ? `Open with a 40–60 word direct answer to "${primaryQuery}" (the AEO answer-block pattern competitors win with).`
        : null,
    faqQuestions,
    schemaRecommendations,
    assetSpec: hasToolGap
      ? `Spec an interactive tool for "${primaryQuery}" (inputs → outputs) — competitor ${input.competitor?.domain ?? ""} has one; it earns links + citations.`
      : null,
    note: "Deterministic skeleton from grounded facts (competitor teardown + Profound fanouts). LLM drafting is a later, gated step.",
  };

  // ── proof plan ──
  const metrics: string[] = [];
  if (isCreate) metrics.push("new-page clicks", "Profound citations");
  else if (move.gap === "answer_block") metrics.push("Profound citations", "position");
  else if (move.gap === "edit_page") metrics.push("CTR", "clicks");
  else if (move.gap === "fix_experience") metrics.push("Clarity dead/rage clicks", "engaged sessions");
  if (move.components.dollarValue > 0) metrics.push("GA4 conversions");

  const packetCore = {
    k: move.demandKey,
    s: move.score,
    c: move.components,
    cf: cFacts ? { t: cFacts.title, w: cFacts.wordCount, h: cFacts.h2Count, sc: cFacts.schemaTypes, faq: cFacts.hasFaq, ab: cFacts.hasAnswerBlock } : null,
    of: ownedFacts ? { t: ownedFacts.title, w: ownedFacts.wordCount, sc: ownedFacts.schemaTypes } : null,
    g: gaps.map((g) => g.kind),
    d: { o: outline, f: faqQuestions, s: schemaRecommendations },
  };
  const evidenceHash = createHash("sha256").update(JSON.stringify(packetCore)).digest("hex").slice(0, 16);

  return {
    move: {
      key: move.demandKey,
      gapType: move.gap,
      label: move.label,
      confidence: move.confidence,
      score: move.score,
      components: move.components,
      signals: move.signals,
    },
    demand: {
      demandWeight: move.components.demand,
      basis: move.signals.includes("GSC")
        ? move.signals.includes("AI")
          ? "mixed"
          : "gsc"
        : "ai_attention",
      queries: [],
      fanoutSeeds,
    },
    competitor: {
      topUrl: competitor?.url ?? move.competitorUrls[0] ?? null,
      domain: competitor?.domain ?? null,
      fetchStatus: competitor?.fetchStatus ?? null,
      facts: cFacts,
      whatWins: looselyMatched
        ? "Loosely matched — AI cited this page but it's off-topic for the query; confirm the real winner with live SERP (DataForSEO)."
        : whatWins(cFacts),
      relevance,
      looselyMatched,
      otherUrls: move.competitorUrls.slice(1, 5),
    },
    yourPage: {
      url: move.ownedUrl,
      facts: ownedFacts,
      gsc: input.ownedGsc,
      dollarValue: move.components.dollarValue,
      friction: move.components.friction,
    },
    gaps,
    draft,
    proofPlan: {
      metrics: metrics.length ? metrics : ["clicks"],
      windowsDays: [7, 14, 28],
      controls: "comparable same-type Iranopedia pages, unchanged in the window",
    },
    evidenceHash,
  };
}

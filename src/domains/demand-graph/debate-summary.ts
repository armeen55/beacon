/**
 * debate-summary (2026-06-25, Sprint 6 · plan P1/P15 transparency) — PURE.
 *
 * The plan's trust principle: "it must feel like a TEAM argued the decision, not
 * 'good keyword, do it.'" The specialists already emit SpecialistOpinions and the
 * router already debates them; this turns those opinions into a render-ready,
 * plain-language debate summary any surface can drop in (read-only). No I/O, no
 * score logic — it only *describes* what the specialists said.
 *
 * Pinned by debate-summary.test.ts.
 */

import type { Specialist, SpecialistOpinion, ObjectionKind } from "./specialist-opinions";

/** Operator-language names — never raw connector keys in the UI. */
export const SPECIALIST_LABELS: Record<Specialist, string> = {
  gsc: "Search demand",
  ga4: "Revenue",
  clarity: "Visitor behavior",
  profound: "AI citations",
  dataforseo: "Live Google results",
  wix: "Publishing",
  llm: "Strategist",
  commerce_asset: "Commerce strategist",
};

const OBJECTION_LABELS: Record<ObjectionKind, string> = {
  fix_ux_first: "Fix the page experience first",
  cant_outrank_serp: "This search looks hard to win right now",
  already_ranks: "You already rank — improve the page, don't make a new one",
  not_pushable: "Can't be published automatically on this site",
  off_topic_competitor: "The competitor match is weak",
  no_measured_demand: "No proven search demand yet",
  thin_evidence: "Not enough evidence yet",
};

export type DebateVoice = { specialist: Specialist; label: string; claim: string; confidencePct: number };
export type DebateObjection = { specialist: Specialist; label: string; kind: ObjectionKind; reason: string; severity: "veto" | "downgrade"; detail: string };

export type DebateSummary = {
  /** one-line skim, e.g. "5 specialists weighed in · 1 raised a concern (1 blocking)" */
  headline: string;
  /** supporting voices, strongest conviction first */
  voices: DebateVoice[];
  /** every objection raised, blocking (veto) first */
  objections: DebateObjection[];
  hasVeto: boolean;
  /** average conviction of the voices, 0..100 (0 when silent) */
  consensusPct: number;
};

/** Turn raw specialist opinions into a render-ready debate. PURE. */
export function summarizeSpecialistDebate(opinions: SpecialistOpinion[]): DebateSummary {
  const valid = (opinions ?? []).filter((o) => o && o.claim);

  const voices: DebateVoice[] = valid
    .map((o) => ({
      specialist: o.specialist,
      label: SPECIALIST_LABELS[o.specialist] ?? o.specialist,
      claim: o.claim,
      confidencePct: Math.round(Math.min(1, Math.max(0, o.confidence ?? 0)) * 100),
    }))
    .sort((a, b) => b.confidencePct - a.confidencePct);

  const objections: DebateObjection[] = valid
    .flatMap((o) =>
      (o.objections ?? []).map((ob) => ({
        specialist: o.specialist,
        label: SPECIALIST_LABELS[o.specialist] ?? o.specialist,
        kind: ob.kind,
        reason: OBJECTION_LABELS[ob.kind] ?? ob.kind,
        severity: ob.severity,
        detail: ob.detail,
      })),
    )
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "veto" ? -1 : 1));

  const hasVeto = objections.some((o) => o.severity === "veto");
  const consensusPct = voices.length ? Math.round(voices.reduce((s, v) => s + v.confidencePct, 0) / voices.length) : 0;

  const vetoCount = objections.filter((o) => o.severity === "veto").length;
  const headline =
    voices.length === 0
      ? "No specialist had enough data to weigh in yet"
      : `${voices.length} specialist${voices.length === 1 ? "" : "s"} weighed in` +
        (objections.length
          ? ` · ${objections.length} raised a concern${vetoCount ? ` (${vetoCount} blocking)` : ""}`
          : " · no objections");

  return { headline, voices, objections, hasVeto, consensusPct };
}

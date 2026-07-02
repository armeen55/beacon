/**
 * debate-summary (2026-06-25, Sprint 6 · plan P1/P15 transparency) - PURE.
 *
 * The plan's trust principle: "it must feel like a TEAM argued the decision, not
 * 'good keyword, do it.'" The specialists already emit SpecialistOpinions and the
 * router already debates them; this turns those opinions into a render-ready,
 * plain-language debate summary any surface can drop in (read-only). No I/O, no
 * score logic - it only *describes* what the specialists said.
 *
 * 2026-07-01 (FINAL PREMIUM PLAN item 39): this is also the chokepoint where
 * robotic template phrasing dies. Every claim and objection detail runs through
 * `humanizeDebateLine` before it reaches a surface: "3 competitor page(s)" becomes
 * "3 competitor pages" (and "1 ..." becomes "a competitor page"), snake_case
 * tokens become spaced words, SHOUTING enum words become lowercase, and lab
 * tokens (SERP, UGC, connector names) become plain words.
 *
 * Pinned by debate-summary.test.ts.
 */

import type { Specialist, SpecialistOpinion, ObjectionKind } from "./specialist-opinions";

/** Operator-language names - never raw connector keys in the UI. */
export const SPECIALIST_LABELS: Record<Specialist, string> = {
  gsc: "Search demand",
  ga4: "Revenue",
  clarity: "Visitor behavior",
  profound: "AI citations",
  dataforseo: "Live Google results",
  wix: "Publishing",
  llm: "Strategist",
  commerce_asset: "Commerce strategist",
  seasonal: "Seasonal timing",
};

const OBJECTION_LABELS: Record<ObjectionKind, string> = {
  fix_ux_first: "Fix the page experience first",
  cant_outrank_serp: "This search looks hard to win right now",
  already_ranks: "You already rank - improve the page, don't make a new one",
  not_pushable: "Can't be published automatically on this site",
  off_topic_competitor: "The competitor match is weak",
  no_measured_demand: "No proven search demand yet",
  thin_evidence: "Not enough evidence yet",
  seasonal_demand_cliff: "Timing risk - a seasonal wave is about to drop off",
};

/** Initialisms the operator reads as words - these stay uppercase. */
const KEEP_CAPS = new Set(["AI", "CTR", "SEO", "AEO", "GSC", "URL", "FAQ", "CMS", "UX", "API", "ROI", "OK"]);

/** Lab and connector tokens that read robotic mid-sentence - swapped for plain words.
 *  The grammar-aware "SERP is" swap must run before the bare "SERP" swap. */
const PLAIN_SWAPS: Array<[RegExp, string]> = [
  [/\bSERP is\b/g, "The search results are"],
  [/\bSERPs?\b/g, "search results"],
  [/\bUGC\b/g, "forum"],
  [/\bDataForSEO\b/g, "Live Google results"],
  [/\bClarity\b/g, "Visitor behavior"],
];

/**
 * Item 39 - make one template-emitted line read like a person wrote it. PURE, idempotent
 * on already-clean strings, so it is safe at the source AND on persisted records at render.
 *   1. "1 competitor page(s)" -> "a competitor page"; "3 competitor page(s)" -> "3 competitor pages"
 *   2. any leftover bare "word(s)" -> the plural
 *   3. snake_case tokens (never URL or path segments) -> spaced words
 *   4. lab tokens -> plain words, then leftover SHOUTING enum words -> lowercase
 */
export function humanizeDebateLine(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;

  // 1) counted "(s)" templates, up to three words between the count and the noun.
  s = s.replace(
    /(\d[\d,]*)\s+((?:[A-Za-z][A-Za-z-]*\s+){0,3}?)([A-Za-z][A-Za-z-]*)\(s\)/g,
    (_m, n: string, mid: string, noun: string) => {
      const count = Number(n.replace(/,/g, ""));
      if (count === 1) {
        const first = mid.trim() || noun;
        const article = /^[aeiou]/i.test(first) ? "an" : "a";
        return `${article} ${mid}${noun}`;
      }
      return `${n} ${mid}${noun}s`;
    },
  );

  // 2) bare "word(s)" with no count in front -> plural.
  s = s.replace(/([A-Za-z][A-Za-z-]*)\(s\)/g, "$1s");

  // 3) snake_case tokens -> spaced words. The token must start a line or follow
  //    whitespace/quote/paren, so URL and path segments are never touched.
  s = s.replace(
    /(^|[\s("'])((?:[A-Za-z0-9]+_)+[A-Za-z0-9]+)(?=[\s)"'.,;:!?]|$)/g,
    (_m, pre: string, tok: string) => pre + tok.replace(/_/g, " "),
  );

  // 4) plain words for lab tokens, then de-shout leftover ALL-CAPS enum words.
  for (const [re, plain] of PLAIN_SWAPS) s = s.replace(re, plain);
  s = s.replace(/\b[A-Z]{2,}\b/g, (w) => (KEEP_CAPS.has(w) ? w : w.toLowerCase()));

  return s;
}

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

  // Fallbacks are operator-friendly strings, not the raw enum key - a typo'd
  // specialist/objection key never leaks a machine token into the UI. Claims and
  // details are humanized here (item 39) so no surface ever renders "page(s)".
  const voices: DebateVoice[] = valid
    .map((o) => ({
      specialist: o.specialist,
      label: SPECIALIST_LABELS[o.specialist] ?? "Another specialist",
      claim: humanizeDebateLine(o.claim),
      confidencePct: Math.round(Math.min(1, Math.max(0, o.confidence ?? 0)) * 100),
    }))
    .sort((a, b) => b.confidencePct - a.confidencePct);

  const objections: DebateObjection[] = valid
    .flatMap((o) =>
      (o.objections ?? []).map((ob) => ({
        specialist: o.specialist,
        label: SPECIALIST_LABELS[o.specialist] ?? "Another specialist",
        kind: ob.kind,
        reason: OBJECTION_LABELS[ob.kind] ?? "Flagged a concern",
        severity: ob.severity,
        detail: humanizeDebateLine(ob.detail),
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

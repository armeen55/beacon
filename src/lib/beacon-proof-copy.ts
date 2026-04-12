/**
 * Static copy for Tier 1A proof layer — methodology and operator-facing explanations.
 * Keep factual; avoid absolute claims without qualifiers.
 */

export const BEACON_METHODOLOGY = {
  title: "How Beacon forms this view",
  crawlFindings:
    "Findings under “Since last scan” come from comparing two consecutive full-site crawls of your public HTML (titles, meta, headings, schema signals, and selected guardrails). They describe what changed on the page, not whether Google or AI rankings moved.",
  recommendations:
    "The top move is built from your imported visibility sample (citation/mention rows), page structure from the latest crawl, and — when present — validated change records. It is a prioritized suggestion, not a guarantee of outcomes.",
  visibilitySample:
    "Visibility numbers are aggregated from imported result rows (by date and AI platform). When the citation index was built before your last crawl finished, the sample can lag behind your live HTML — Beacon calls that out explicitly.",
  attribution:
    "Attribution (under Changes → Attribution) links visibility shifts to changelog entries by timing and topic overlap. It shows correlation and best-fit causes, not proof of causation.",
} as const;

export function pagesProofSubtitle(): string {
  return "Same crawl basis as Today: consecutive HTML snapshots and optional guardrails. Observation links appear only when the run is indexed.";
}

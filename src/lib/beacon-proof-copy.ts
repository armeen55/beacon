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
    "Visibility numbers are aggregated from imported result rows (by date and AI platform). When the citation index was built before your last crawl finished, the sample can lag behind your most recent crawled HTML — Beacon calls that out explicitly.",
  attribution:
    "Attribution (under Changes → Attribution) links visibility shifts to changelog entries by timing and topic overlap. It identifies the strongest correlates, not proven causes — no A/B test or holdout exists.",
} as const;

export function pagesProofSubtitle(): string {
  return "Same crawl basis as Today: consecutive HTML snapshots and optional guardrails. Observation links appear only when the run is indexed.";
}

/**
 * Short bullets for Layer-2 collapsed disclosures on Market (`/competitors`).
 * Wording aligned with methodology §Citation Share / sample quality / directional scope.
 */
export const LAYER2_MARKET_METHODOLOGY_BULLETS: readonly string[] = [
  "Citation Share is the share of citations mentioning your domain within your imported observation set — not total AI “market share.” The KPI always shows the denominator (of N observations).",
  "Numbers come from your tracked prompt bank and sampled citation rows; they describe what Beacon measured, not every possible answer on the web.",
  "Sample quality (limited / moderate / strong) reflects observation count — thin samples make percentages volatile; treat them as directional.",
  "Treat rankings here as directional within your sample, not a census of the whole market.",
  "Beacon does not know real-time model outputs, your true share of all AI queries, or whether platforms indexed your latest site changes.",
];

/**
 * Short bullets for Layer-2 collapsed disclosures on Changes list (`/changes` Outcomes).
 * Wording aligned with methodology §verdicts / strongest correlate / BEACON_METHODOLOGY.attribution.
 */
export const LAYER2_CHANGES_METHODOLOGY_BULLETS: readonly string[] = [
  "“Strongest correlate” means timing, topic, URL, and platform alignment scored highly — it is match evidence, not proof the change caused the visibility shift.",
  BEACON_METHODOLOGY.attribution,
  "Match counts and topic counts summarize how many linked visibility events and which themes Beacon used; the observation window is the date range of imported results.",
  "When coverage is partial or stale, Beacon softens labels and scope lines so thin or older data is not read as complete truth.",
  "Beacon does not know causal ROI, ranking impact, or outcomes beyond what your imported visibility rows show.",
];

/** Footnote for Today / Market local strips — Tier 1.1j proof-layer alignment. */
export const BEACON_LOCAL_SURFACE_FOOTNOTE =
  "Based on imported or synced data. May not reflect full platform data. No automatic syncing.";

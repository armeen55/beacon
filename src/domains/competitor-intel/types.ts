/**
 * 2026-06-09 — Competitor Intel types ("steal this move" + "why them,
 * not you").
 *
 * The join layer over three existing substrates:
 *   • competitor-monitoring (sitemap-level page changes),
 *   • pages/competitor-page-snapshots (their page STRUCTURE),
 *   • prompt-answer-observations (citation_urls = every URL each AI
 *     answer cited, competitor URLs included — schema v2.2 Commit 7).
 *
 * Copy discipline: everything customer-facing here is TEMPORAL-
 * ASSOCIATIVE, never causal — "they added it June 2; AI started citing
 * it 6 days later" states two dated facts. No "caused"/"drove"/
 * "because", no revenue/$ claims (same posture as the outcome surfaces).
 */

import type { SimulationActionType } from "@/domains/product/whatif-types";

// ── Citation series (per competitor URL) ──────────────────────────────

export type CompetitorUrlDailyCount = {
  /** UTC date YYYY-MM-DD. */
  date: string;
  count: number;
  /** Distinct platforms that cited the URL that day. */
  platforms: string[];
};

export type CompetitorUrlCitationSeries = {
  /** Canonicalized URL (canonicalizeCitationUrl). */
  url: string;
  /** Normalized competitor host, e.g. "supplehomesinc.com". */
  domain: string;
  displayName: string;
  daily: CompetitorUrlDailyCount[];
  total: number;
};

// ── Structural changes (their page changed shape) ─────────────────────

export type CompetitorStructuralChangeKind =
  | "faq_added"
  | "faq_expanded"
  | "section_added"
  | "title_changed"
  | "meta_added";

export type CompetitorStructuralChange = {
  url: string;
  domain: string;
  displayName: string;
  kind: CompetitorStructuralChangeKind;
  /** Plain-English fragment, e.g. `added an FAQ (6 questions)`. */
  detail: string;
  /** ISO timestamp of the fetch that detected the change. */
  capturedAt: string;
};

// ── Moves (a change joined with its citation aftermath) ───────────────

export type CompetitorMoveTier =
  /** Window complete (or enough signal): citations rose after the move. */
  | "proven"
  /** Some AI pickup already, below the proven bar or window incomplete. */
  | "early"
  /** Move is recent; still inside the post window with no pickup yet. */
  | "watching"
  /** Post window complete; no AI pickup. */
  | "quiet";

export type CompetitorMoveKind =
  | "new_page"
  | "updated_page"
  | CompetitorStructuralChangeKind;

export type CompetitorMoveAction = {
  actionType: SimulationActionType;
  /** Customer-facing CTA label, e.g. "Add an FAQ to your matching page". */
  label: string;
};

export type CompetitorMove = {
  /** Stable: `${domain}|${url}|${movedAtDate}|${kind}`. */
  id: string;
  domain: string;
  displayName: string;
  url: string;
  path: string;
  /** UTC date (YYYY-MM-DD) the move landed (lastmod / capture date). */
  movedAtDate: string;
  kind: CompetitorMoveKind;
  /** Plain-English fragment of what they did. */
  whatTheyDid: string;
  tier: CompetitorMoveTier;
  /** Citations of the URL in the preDays before the move. */
  preCount: number;
  /** Citations of the URL in the postDays on/after the move. */
  postCount: number;
  /** Days from the move to the first on/after citation, if any. */
  daysToFirstCitation: number | null;
  windowDays: number;
  /** Full customer line (associative copy). */
  line: string;
  /** The equivalent move for this tenant. */
  action: CompetitorMoveAction;
};

// ── Why-them forensics ────────────────────────────────────────────────

export type StructureGap = {
  dimension:
    | "no_equivalent_page"
    | "faq"
    | "pricing_language"
    | "section_coverage"
    | "meta_description";
  /** What their page has. */
  theirs: string;
  /** What our page has (or lacks). */
  ours: string;
  /** Plain-English gap sentence. */
  sentence: string;
};

export type WhyThemPromptRow = {
  promptText: string;
  platform: string;
  /** Last time this prompt's answer cited them (ISO). */
  lastSeen: string;
  /** Their 1-indexed citation position in that answer. */
  theirRank: number;
  /** Our citation rank in that answer, null = we weren't cited. */
  ourRank: number | null;
  /** Their page was the FIRST citation in that answer (rank 1). */
  theyWereFirst: boolean;
};

export type DescriptorContrast = {
  /** Words AI uses near their mentions (top, deduped). */
  theirs: string[];
  /** Words AI uses near our mentions (top, deduped). */
  ours: string[];
};

export type WhyThemReport = {
  domain: string;
  displayName: string;
  /** Their most-cited page (canonical URL) this report centers on. */
  theirUrl: string;
  theirTitle: string | null;
  /** Citations of their URL across the analyzed window. */
  theirCitationTotal: number;
  /** Our closest equivalent page, null when no honest match. */
  equivalentPageUrl: string | null;
  gaps: StructureGap[];
  prompts: WhyThemPromptRow[];
  descriptors: DescriptorContrast;
};

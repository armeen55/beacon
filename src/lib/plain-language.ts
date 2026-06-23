/**
 * Plain-language system (casual-user audit, Phase 1 + 2).
 *
 * ONE source of truth for turning SEO/AEO jargon into words a non-technical
 * business owner ("Sara") understands. The 923-item audit found ~334 jargon
 * issues alone; centralizing the vocabulary here stops the same term being
 * rewritten 50 different ways across pages.
 *
 * Internal code identifiers, data keys, and types DO NOT change — only the
 * strings shown to a user. Import these constants/helpers into UI; never
 * hand-write a plain label that already lives here.
 *
 * Companion: confidence-labels.ts (confidence/verdict display) and
 * beacon-proof-copy.ts (proof wording). Keep all three aligned.
 */

// ---------------------------------------------------------------------------
// 1. Metric metadata — every number a user sees gets a plain label, a
//    timeframe-agnostic explanation, and which direction is good. The <Metric>
//    component (components/ui/metric.tsx) renders these so no number is naked.
// ---------------------------------------------------------------------------

export type GoodDirection = "higher" | "lower" | "neutral";

export type MetricMeta = {
  /** Plain-English label shown to the user (replaces CTR / impressions / etc.). */
  label: string;
  /** One-line explanation for a tooltip / "what is this?". */
  explain: string;
  /** Which way is good, so the UI can color/annotate good vs bad. */
  good: GoodDirection;
};

export type MetricKey =
  | "clicks"
  | "impressions"
  | "ctr"
  | "position"
  | "sessions"
  | "engagedSessions"
  | "conversions"
  | "searchVolume"
  | "keywordsRanked"
  | "quickWins"
  | "frustratedClicks"
  | "deadClicks"
  | "aiMentions"
  | "aiRecommended"
  | "mentionRate"
  | "visibilityScore"
  | "clicksAtStake";

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  clicks: {
    label: "Visits from Google",
    explain: "How many people clicked through to your site from Google search.",
    good: "higher",
  },
  impressions: {
    label: "Times shown on Google",
    explain: "How many times your site appeared in Google search results.",
    good: "higher",
  },
  ctr: {
    label: "Click rate",
    explain: "Of the people who saw you on Google, the share who clicked. Higher is better.",
    good: "higher",
  },
  position: {
    label: "Average Google rank",
    explain: "Your typical spot in Google results. 1 is the top; lower numbers are better.",
    good: "lower",
  },
  sessions: {
    label: "Visits",
    explain: "How many visits your site got in this period.",
    good: "higher",
  },
  engagedSessions: {
    label: "Engaged visits",
    explain: "Visits where someone actually stuck around or did something, not an instant bounce.",
    good: "higher",
  },
  conversions: {
    label: "Sign-ups or sales",
    explain: "Visits that turned into the action you care about (a lead, sale, or sign-up).",
    good: "higher",
  },
  searchVolume: {
    label: "Monthly searches",
    explain: "Roughly how many times a month people search these words.",
    good: "higher",
  },
  keywordsRanked: {
    label: "Searches you rank for",
    explain: "How many different searches your site currently shows up for on Google.",
    good: "higher",
  },
  quickWins: {
    label: "Almost on page 1",
    explain: "Searches where you are close to Google's first page; a small push could get you there.",
    good: "higher",
  },
  frustratedClicks: {
    label: "Frustrated clicks",
    explain: "Visitors who clicked the same spot repeatedly, usually because something did not work.",
    good: "lower",
  },
  deadClicks: {
    label: "Clicks that did nothing",
    explain: "Visitors who clicked something that is not actually clickable.",
    good: "lower",
  },
  aiMentions: {
    label: "Times AI mentioned you",
    explain: "How often AI assistants named your business when people asked about businesses like yours.",
    good: "higher",
  },
  aiRecommended: {
    label: "Times AI recommended you first",
    explain: "How often AI assistants named your business first, ahead of competitors.",
    good: "higher",
  },
  mentionRate: {
    label: "How often AI mentions you",
    explain: "Out of the AI answers we checked, the share that named your business.",
    good: "higher",
  },
  visibilityScore: {
    label: "AI mention score",
    explain: "How often AI assistants mention you across the questions we track. Higher is better.",
    good: "higher",
  },
  clicksAtStake: {
    label: "Visits you could win back",
    explain: "A rough estimate of extra visits from Google if you fix this. An estimate, not a promise.",
    good: "higher",
  },
};

export function metricMeta(key: MetricKey): MetricMeta {
  return METRIC_META[key];
}

// ---------------------------------------------------------------------------
// 2. Term glossary — jargon -> plain label + one-line definition. Use the
//    label inline; surface the definition in a tooltip or the Help glossary.
//    Keep ONE entry per concept; do not invent page-local synonyms.
// ---------------------------------------------------------------------------

export type GlossaryEntry = { plain: string; define: string };

export const TERM_GLOSSARY: Record<string, GlossaryEntry> = {
  ctr: { plain: "click rate", define: "Of the people who saw you on Google, the share who clicked." },
  impressions: { plain: "times shown on Google", define: "How many times you appeared in Google results." },
  avg_position: { plain: "average Google rank", define: "Your typical spot in Google results; 1 is best." },
  serp: { plain: "Google results page", define: "The page of results Google shows for a search." },
  aeo: { plain: "AI search", define: "Showing up when people ask AI assistants like ChatGPT." },
  seo: { plain: "getting found on Google", define: "Helping the right people find you in search." },
  schema: { plain: "Google-readable page info", define: "Hidden info that helps Google and AI understand your page." },
  json_ld: { plain: "Google-readable page info", define: "A standard way to add machine-readable details to a page." },
  change_pack: { plain: "suggested edits", define: "Beacon's drafted changes for one page, ready for you to review." },
  answer_block: { plain: "short answer at the top", define: "A clear, direct answer placed at the top of a page." },
  proof_window: { plain: "result checks", define: "We re-check the page after 1, 2, and 4 weeks to see if it helped." },
  controls: { plain: "similar pages we did not change", define: "Comparable pages used as a yardstick so we know it was your edit that helped." },
  baseline: { plain: "where the page started", define: "The page's numbers before you made the change." },
  cannibalization: { plain: "two pages competing", define: "Two of your own pages competing for the same Google search." },
  rage_clicks: { plain: "frustrated clicks", define: "Repeated angry clicks, usually on something that does not work." },
  dead_clicks: { plain: "clicks that did nothing", define: "Clicks on something that is not actually clickable." },
  striking_distance: { plain: "almost on page 1", define: "Searches where you are close to Google's first page." },
  lift: { plain: "change vs similar pages", define: "How much better (or worse) this page did than comparable pages." },
  primary: { plain: "named first", define: "The AI recommended this business first, ahead of others." },
  citation: { plain: "AI mention", define: "An AI assistant naming or linking your business in its answer." },
};

export function plainTerm(key: string): string {
  return TERM_GLOSSARY[key]?.plain ?? key;
}

// ---------------------------------------------------------------------------
// 3. Brand + headline copy used across the shell (audit: wordmark, nav).
// ---------------------------------------------------------------------------

/** The one-line promise under the Beacon wordmark. Replaces the jargon
 *  "Review-gated SEO & AEO operator" (audit #272/#276/#282). */
export const BEACON_TAGLINE = "See how people find you on Google and AI, and what to fix next.";

/** Standing reassurance that nothing publishes without approval (audit: many
 *  pages, trust). Reuse verbatim so the promise reads the same everywhere. */
export const NOTHING_GOES_LIVE_NOTE =
  "Nothing changes on your live site unless you approve it.";

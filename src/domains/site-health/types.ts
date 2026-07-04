/**
 * site-health types (BEACON_500 P16, 2026-07-03) - the onboarding-intelligence
 * READ layer.
 *
 * Three generic, deterministic site-health facts Beacon can state for ANY
 * tenant from data it already has (no new fetch, no LLM, $0):
 *   1. AiCrawlerBlockFact - which AI assistants (and Google's crawler) the site
 *      tells not to read it, named plainly. The single most important AEO fact:
 *      a site that blocks the assistants can never be recommended by them.
 *   2. JsShellFact - a page whose real content only appears after JavaScript
 *      runs, so the HTML the crawler first receives looks nearly empty.
 *   3. CmsFact - the CMS / site platform Beacon detected, as a capability fact
 *      ("You are on Wix. I can push SEO fields here, and draft the rest for you
 *      to paste.").
 *
 * These are READ-SIDE facts (informational). The Move-emitting side of the
 * robots-block and JS-shell checks already lives in the recommendation-
 * intelligence trigger family (robots_blocks_ai_bots + js_shell_content); this
 * domain is the plain-English READ surface that names the specifics the generic
 * Move copy leaves out (exactly which bots, which platform). Every detector is
 * empty-safe: it returns null when there is nothing true to say.
 *
 * PURE / no I/O. No em or en dashes anywhere (hard rule). No lab jargon on the
 * customer sentence: "AI assistants", "Google's crawler", not "GPTBot jargon"
 * (the bot name is only used when we name the blocked crawler plainly).
 */

/** A crawler Beacon reasons about, with the plain name shown to a human and the
 *  raw bot token used only when we name a blocked crawler plainly. */
export type CrawlerBlockEntry = {
  /** Plain, customer-safe label, e.g. "ChatGPT (GPTBot)". */
  label: string;
  /** The raw bot / directive token, e.g. "GPTBot". Operator trace + plain name. */
  bot: string;
  /** True when this crawler is an AI assistant (vs Google's classic crawler). */
  isAi: boolean;
};

/**
 * The AI-crawler-block fact. Non-null ONLY when at least one crawler is blocked.
 * When every crawler is allowed (or unknown) the detector returns null so the
 * surface hides itself entirely.
 */
export type AiCrawlerBlockFact = {
  /** Every blocked crawler, plain-named, AI assistants first. */
  blocked: CrawlerBlockEntry[];
  /** True when Google's classic crawler is among the blocked set. */
  googleBlocked: boolean;
  /** Count of blocked AI assistants (subset of `blocked`). */
  aiBlockedCount: number;
  /** Ready-to-render, first-person, dash-free customer sentence. */
  headline: string;
  /** Operator-only structured trace of the raw signals used. */
  operatorEvidence: string;
};

/**
 * The JS-shell fact. Non-null ONLY when the page's source HTML reads like a
 * shell (near-empty body behind a client app). Empty when the page renders real
 * HTML.
 */
export type JsShellFact = {
  /** The page path Beacon is talking about, e.g. "/app". */
  path: string;
  /** Ready-to-render, first-person, dash-free, honest-about-the-heuristic copy. */
  headline: string;
  /** Operator-only structured trace. */
  operatorEvidence: string;
};

/** The platforms Beacon can name from snapshot signals. `unknown` is never
 *  emitted (the detector returns null instead) - it exists so the union is
 *  exhaustive for a future need. */
export type CmsPlatform =
  | "Wix"
  | "Squarespace"
  | "Shopify"
  | "WordPress"
  | "Webflow"
  | "Ghost"
  | "Duda"
  | "HubSpot"
  | "Drupal"
  | "Joomla";

/** How Beacon can help on a given platform - drives the second sentence. */
export type CmsPushCapability = "push_and_draft" | "draft_only";

/**
 * The CMS / platform fact. Non-null ONLY when Beacon recognizes the platform
 * from a snapshot signal. Undetectable -> null (the surface hides).
 */
export type CmsFact = {
  platform: CmsPlatform;
  /** How Beacon can act on this platform. */
  capability: CmsPushCapability;
  /** Which snapshot signal proved it (operator trace + honesty). */
  detectedFrom: "generator_meta" | "schema_type" | "url_marker" | "body_marker";
  /** Ready-to-render, first-person, dash-free capability sentence. */
  headline: string;
  /** Operator-only structured trace. */
  operatorEvidence: string;
};

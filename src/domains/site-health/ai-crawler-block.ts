/**
 * ai-crawler-block (BEACON_500 P16 v1 381, 2026-07-03) - THE most important
 * onboarding-intelligence fact.
 *
 * Reads the ALREADY-PARSED robots.txt allow/deny signals Beacon carries on
 * every OwnedUrlIndexability (gptbot_allowed, claudebot_allowed,
 * perplexitybot_allowed, google_extended_allowed, googlebot_allowed) and states,
 * in plain English, exactly which AI assistants (and Google's crawler) the site
 * tells not to read it. A site that blocks the assistants can never be
 * recommended by them, no matter how good the content is.
 *
 * PURE / no I/O ($0 - reuses signals another lane already loaded). Empty-safe:
 * returns null when every crawler is allowed or unknown (allowed !== false), so
 * the surface hides itself entirely. No em or en dashes (hard rule). The bot
 * token is named plainly ("GPTBot") only inside the blocked-crawler label, per
 * the operator directive to "name the blocked bot plainly".
 */

import type { OwnedUrlIndexability } from "@/domains/indexability/types";

import type { AiCrawlerBlockFact, CrawlerBlockEntry } from "./types";

/** The crawler roster, AI assistants first (the order they appear in copy). */
const AI_CRAWLERS: ReadonlyArray<{ bot: string; assistant: string }> = [
  { bot: "GPTBot", assistant: "ChatGPT" },
  { bot: "ClaudeBot", assistant: "Claude" },
  { bot: "PerplexityBot", assistant: "Perplexity" },
  { bot: "Google-Extended", assistant: "Google's AI answers" },
];

/** "ChatGPT (GPTBot)" - the plain label that names the blocked crawler plainly. */
function aiLabel(assistant: string, bot: string): string {
  return assistant + " (" + bot + ")";
}

/**
 * Join a list of names into readable prose: "A", "A and B", "A, B and C".
 * No Oxford comma, dash-free.
 */
function joinNames(names: ReadonlyArray<string>): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return names[0] + " and " + names[1];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/**
 * Build the AI-crawler-block fact for a site from ONE representative
 * indexability record (robots.txt is site-wide, so any owned URL's parsed
 * robots signals answer the question). Returns null when nothing is blocked.
 * Pure.
 */
export function detectAiCrawlerBlock(
  indexability: Pick<OwnedUrlIndexability, "signals">,
): AiCrawlerBlockFact | null {
  const robots = indexability.signals.robots_txt;

  const blocked: CrawlerBlockEntry[] = [];
  for (const c of AI_CRAWLERS) {
    const allowed = allowedFor(robots, c.bot);
    if (allowed === false) {
      blocked.push({ label: aiLabel(c.assistant, c.bot), bot: c.bot, isAi: true });
    }
  }
  const googleBlocked = robots.googlebot_allowed === false;
  if (googleBlocked) {
    blocked.push({ label: "Google's crawler (Googlebot)", bot: "Googlebot", isAi: false });
  }

  if (blocked.length === 0) return null;

  const aiBlockedCount = blocked.filter((b) => b.isAi).length;
  const headline = buildHeadline(blocked, aiBlockedCount, googleBlocked);
  const operatorEvidence =
    "site_health.ai_crawler_block: gptbot_allowed=" +
    String(robots.gptbot_allowed) +
    "; claudebot_allowed=" +
    String(robots.claudebot_allowed) +
    "; perplexitybot_allowed=" +
    String(robots.perplexitybot_allowed) +
    "; google_extended_allowed=" +
    String(robots.google_extended_allowed) +
    "; googlebot_allowed=" +
    String(robots.googlebot_allowed) +
    "; blocked=" +
    blocked.map((b) => b.bot).join(",");

  return { blocked, googleBlocked, aiBlockedCount, headline, operatorEvidence };
}

/** Map a bot token to its parsed allow/deny boolean on the robots signal. */
function allowedFor(
  robots: OwnedUrlIndexability["signals"]["robots_txt"],
  bot: string,
): boolean | null {
  switch (bot) {
    case "GPTBot":
      return robots.gptbot_allowed;
    case "ClaudeBot":
      return robots.claudebot_allowed;
    case "PerplexityBot":
      return robots.perplexitybot_allowed;
    case "Google-Extended":
      return robots.google_extended_allowed;
    default:
      return null;
  }
}

/**
 * The plain-English sentence. Names exactly which crawlers are blocked, then the
 * so-what and the next step. First person, concrete, dash-free, no lab jargon
 * (the bot names appear only inside the plainly-named blocked-crawler labels).
 */
function buildHeadline(
  blocked: ReadonlyArray<CrawlerBlockEntry>,
  aiBlockedCount: number,
  googleBlocked: boolean,
): string {
  const aiLabels = blocked.filter((b) => b.isAi).map((b) => b.label);
  const names = joinNames(blocked.map((b) => b.label));

  if (aiBlockedCount > 0 && !googleBlocked) {
    return (
      "Your site tells AI assistants not to read it (" +
      joinNames(aiLabels) +
      (aiBlockedCount === 1 ? " is" : " are") +
      " blocked in robots.txt). They literally cannot see you, so they can never recommend you. Unblock them."
    );
  }
  if (aiBlockedCount > 0 && googleBlocked) {
    return (
      "Your site tells both AI assistants and Google's crawler not to read it (" +
      names +
      " are blocked in robots.txt). They literally cannot see you, so they can never index or recommend you. Unblock them."
    );
  }
  // Google-only block (no AI bots blocked).
  return (
    "Your site tells Google's crawler not to read it (" +
    names +
    " is blocked in robots.txt). Without Google, AI answers that lean on Google cannot reach your pages either. Unblock it."
  );
}

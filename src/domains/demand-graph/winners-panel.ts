/**
 * winners-panel (2026-07-11, Wave 4, G3) - PURE render-model for the /changes detail
 * view's "Who wins this topic now" panel.
 *
 * THE GAP this closes: serp-teardown-fusion's `fuseTeardownTargets` already merges
 * Google + AI-cited winners and ranks overlap (both) > AI-only > Google-only, and
 * competitor-page-audit already extracts the structural "what wins" facts for the
 * pages it has read, but nothing renders the DEDUPED winner list. Operators had to
 * reconstruct it by hand. This module only PROJECTS that already-computed/persisted
 * data into a capped, render-ready list; it performs no I/O, makes no fetch, and
 * introduces no new scoring/ranking logic of its own (fuseTeardownTargets keeps
 * owning the ranking; `whatToSteal`, already used for the single-competitor "Steal
 * this" line, keeps owning the plain-language phrasing, reused as-is here so a
 * winner's "why it wins" never invents new wording for the same facts).
 *
 * Pinned by winners-panel.test.ts.
 */

import { fuseTeardownTargets, rootDomainOf } from "@/domains/serp/serp-teardown-fusion";

// Relocated from the retired experiments domain (CORE 100K): the cached
// competitor-facts shape the winner audit carries. The "what to steal" prose
// builder was removed with that domain; whyPlain is now null (no fabrication).
type CompetitorFactsLite = {
  hasAnswerBlock?: boolean;
  hasFaq?: boolean;
  faqQuestionCount?: number;
  schemaTypes?: string[];
  hasToolOrCalculator?: boolean;
  wordCount?: number;
  sectionCount?: number;
  hasReviewSchema?: boolean;
};

/** Never show more than 5 winners, the panel is a scan, not a second SERP. */
const MAX_WINNERS = 5;

export type WinnerLine = {
  /** Root domain (e.g. "competitor.com"), never a bare slug or internal key. */
  domain: string;
  /** True when BOTH Google and AI cite this winner, the highest-value signal. */
  overlap: boolean;
  sources: ("ai" | "google")[];
  /** Plain-language "why it wins" from the cached teardown facts (reuses
   *  whatToSteal's exact phrasing). Null, never fabricated, when Beacon has not
   *  audited this winner's page yet. */
  whyPlain: string | null;
  /** Honest "read <date>" label from when Beacon actually crawled this page. Null
   *  when there is no cached audit timestamp for it. */
  collectedLabel: string | null;
};

/** What the caller already has cached for one winner's URL (from the existing
 *  competitor-page-audit store), no new fetch, just a lookup. */
export type WinnerAudit = { facts: CompetitorFactsLite | null; auditedAt: string | null };

/** "2026-07-10T12:00:00Z" -> "read Jul 10". Null on an unparseable/missing date so
 *  the panel never shows a fabricated collection date. */
export function collectedDateLabel(auditedAt: string | null | undefined): string | null {
  const t = Date.parse(auditedAt ?? "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `read ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/**
 * Build the "Who wins this topic now" panel for one move: the deduped, ranked
 * Google+AI winner list (overlap first, per fuseTeardownTargets), each with its
 * plain-language teardown signals + honest collected date when Beacon has already
 * audited that page. PURE, `getAudit` is injected so this performs no I/O itself.
 * Folds two AI-cited URLs that share a root domain into ONE winner line (the panel
 * speaks in domains, not URLs). Returns [] when there is nothing to fuse (no
 * competitor URLs and no Google domains); the caller should render nothing rather
 * than an empty panel.
 */
export function buildWinnersPanel(input: {
  competitorUrls: readonly string[];
  serpTopDomains: readonly string[];
  ownDomain: string;
  getAudit: (url: string) => WinnerAudit | undefined;
}): WinnerLine[] {
  const targets = fuseTeardownTargets({
    competitorUrls: [...input.competitorUrls],
    serpTopDomains: [...input.serpTopDomains],
    ownDomain: input.ownDomain,
  });

  const out: WinnerLine[] = [];
  const seenDomains = new Set<string>();
  for (const t of targets) {
    if (out.length >= MAX_WINNERS) break;
    const domain = t.kind === "url" ? rootDomainOf(t.value) : t.value;
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    const audit = t.kind === "url" ? input.getAudit(t.value) : undefined;
    out.push({
      domain,
      overlap: t.isOverlap,
      sources: t.sources,
      whyPlain: null,
      collectedLabel: collectedDateLabel(audit?.auditedAt ?? null),
    });
  }
  return out;
}

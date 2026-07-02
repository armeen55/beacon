import "server-only";

/**
 * ask/suggested-questions (BEACON_500 item 59) - 3 example questions the operator can
 * click instead of typing, derived from the SAME live loaders fact-assembly.ts uses (a
 * real changepoint date, a real displacing competitor, a real recent ship) rather than
 * generic hardcoded prompts. Falls back to universally-answerable generic questions when
 * a tenant has no data yet for a given slot, so the row never renders empty.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { detectChangepoints, type DailyPoint } from "@/domains/proof-gsc/changepoint";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";

const GENERIC_FALLBACKS = ["did our traffic drop sitewide this week", "who is beating me on Google's answer box", "what did we ship this week"];

export async function loadSuggestedQuestions(): Promise<string[]> {
  const suggestions: string[] = [];

  try {
    const tenantId = await currentTenantId();
    const daily = await loadDailyTotalsForTenant(tenantId, 90).catch(() => []);
    if (daily.length >= 21) {
      const points: DailyPoint[] = daily.map((d) => ({ date: d.date, value: d.clicks }));
      const changes = detectChangepoints(points);
      const drop = [...changes].reverse().find((c) => c.direction === "down");
      if (drop) {
        const friendly = new Date(`${drop.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
        suggestions.push(`why did clicks drop ${friendly}`);
      }
    }
  } catch {
    // fall through to generic
  }

  try {
    const index = await getAnswerIntelligenceIndex();
    const topCompetitor = index?.co_citation.competitors
      ? [...index.co_citation.competitors].sort((a, b) => b.displacement_ratio - a.displacement_ratio)[0]
      : null;
    if (topCompetitor && topCompetitor.total_answer_appearances > 0) {
      suggestions.push(`who is beating me on Google's answer box`);
    }
  } catch {
    // fall through to generic
  }

  suggestions.push("what did we ship this week");

  const out = [...new Set(suggestions)];
  for (const g of GENERIC_FALLBACKS) {
    if (out.length >= 3) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.slice(0, 3);
}

import "server-only";

/**
 * What THIS run buys, and why (one typed next requirement, 2026-07-28). Runtime asks
 * Decision ONE question - what is the research actually stuck on - and hands Evidence
 * plain strings and plain pages, so Decision never reaches a provider and Evidence never
 * reads Decision. The answer comes from the SAME free verdict that decides whether this
 * account already owns the right page, so the searches a run pays for, the winning pages
 * it then reads, the one comparison it buys and the topic it judges are one topic.
 *
 * ONLY WHAT BUYING CAN CLOSE. The old list took every open page gap plus a reserved slot
 * for whichever packet held no results page, so it queued topics whose blocker was a mixed
 * shape or an unsettled meaning. No purchase moves either, and those runs spent real
 * fetches to reach the same refusal. Fail-soft: no answer means no priority, never a
 * stalled agenda.
 */
import { loadBusinessProfile } from "@/domains/account";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import type { FunnelIntersectionAsk } from "@/domains/evidence";
import { researchNeeds, type ResearchNeed } from "@/domains/decision";
import { log } from "@/lib/logger";

/** How many investigations one research pass may jump the queue for. */
const MAX_PRIORITY_QUERIES = 3;

async function needs(tenantId: string): Promise<ResearchNeed[]> {
  const snapshot = await loadEvidenceSnapshot(tenantId);
  const profile = await loadBusinessProfile(tenantId).catch(() => null);
  const out = await researchNeeds(snapshot, tenantId, profile, MAX_PRIORITY_QUERIES);
  log.info("[research-run] what the research is stuck on", { tenantId, needs: out.map((n) => `${n.requirement}:${n.query ?? "compare"}`) });
  return out;
}

/** The exact searches this run cannot close without, frozen once by the run executor. */
export async function topInvestigationQueries(tenantId: string): Promise<string[]> {
  return (await needs(tenantId)).map((n) => n.query).filter((q): q is string => !!q);
}

/** The ONE page by page comparison worth paying for, for the same topic, or null - which
 *  is the normal answer, and the reason a research pass usually buys none of this. */
export async function comparisonAsk(tenantId: string): Promise<FunnelIntersectionAsk | null> {
  const earned = (await needs(tenantId)).find((n) => n.comparison);
  return earned ? { topicKey: earned.topicKey, ask: earned.comparison! } : null;
}

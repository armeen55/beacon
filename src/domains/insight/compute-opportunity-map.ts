import "server-only";

import {
  loadGscPageSignalsForTenant,
  loadGscDecaySignalsForTenant,
  type GscPageSignal,
  type GscDecaySignal,
} from "@/domains/recommendation-intelligence/gsc-page-signals";
import {
  loadClarityPageSignalsForTenant,
  type ClarityPageSignal,
} from "@/domains/recommendation-intelligence/clarity-page-signals";
import {
  loadGa4PageValuesForTenant,
  ga4ValueWeight,
  type Ga4PageValue,
} from "@/domains/recommendation-intelligence/ga4-page-values";
import {
  loadPageSurgeonSummaries,
  type PageSurgeonSummary,
} from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import {
  loadGscCannibalizationForTenant,
  type GscCannibalizationCase,
} from "@/domains/recommendation-intelligence/gsc-cannibalization";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  buildOpportunity,
  rankOpportunities,
  type OpportunityItem,
  type OpportunityPageInput,
} from "./opportunity";
import { actionLabel } from "./page-primary";

function toPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

/**
 * Build the ranked Opportunity Map for a tenant — the operator's "which pages
 * need action first" surface. PURE COMPOSITION over already-synced signals:
 * GSC (per-page + decay), SEMrush (striking distance), Clarity (friction), GA4
 * (value weight), and Page Surgeon (does a Change Pack already exist?). No new
 * computation, NO paid pulls — every input is a cached/synced read. Fail-soft
 * per source (a dead source contributes an empty map, never throws).
 */
export async function loadOpportunityMap(
  tenantId: string,
  now: Date = new Date(),
): Promise<OpportunityItem[]> {
  const [gsc, decay, clarity, ga4, summaries, cannibal] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId, now).catch(
      () => new Map<string, GscPageSignal>(),
    ),
    loadGscDecaySignalsForTenant(tenantId, now).catch(
      () => new Map<string, GscDecaySignal>(),
    ),
    loadClarityPageSignalsForTenant(tenantId, now).catch(
      () => new Map<string, ClarityPageSignal>(),
    ),
    loadGa4PageValuesForTenant(tenantId, now).catch(
      () => new Map<string, Ga4PageValue>(),
    ),
    loadPageSurgeonSummaries(tenantId).catch(
      () => ({}) as Record<string, PageSurgeonSummary>,
    ),
    loadGscCannibalizationForTenant(tenantId, now).catch(
      () => [] as GscCannibalizationCase[],
    ),
  ]);

  const canon = (u: string) => canonicalizeCitationUrl(u) ?? u;

  // Cannibalization is a QUERY-level signal; attach it to the LEAD (best-ranking)
  // page so the Opportunity Map row + its Workbench CTA point at the page the
  // cluster should consolidate toward. One lead page can top several cannibalized
  // queries — keep the worst (most impressions) as primary + count the rest.
  const cannibalByLead = new Map<string, OpportunityPageInput["cannibalization"]>();
  const casesByLead = new Map<string, GscCannibalizationCase[]>();
  for (const c of cannibal) {
    const lead = canon(c.leadUrl);
    const list = casesByLead.get(lead) ?? [];
    list.push(c);
    casesByLead.set(lead, list);
  }
  for (const [lead, list] of casesByLead) {
    list.sort((a, b) => b.totalImpressions - a.totalImpressions);
    const worst = list[0];
    cannibalByLead.set(lead, {
      query: worst.query,
      urlCount: worst.urlCount,
      combinedImpressions: worst.totalImpressions,
      combinedClicks: worst.totalClicks,
      // competingUrls is sorted best-position-first, so [0] is the lead URL.
      leadImpressions: worst.competingUrls[0]?.impressions ?? worst.totalImpressions,
      leadClicks: worst.competingUrls[0]?.clicks ?? worst.totalClicks,
      bestPosition: worst.bestPosition,
      additionalCases: list.length - 1,
    });
  }

  // Clarity is keyed by raw `url`; re-key by canonical URL for joining.
  const clarityByCanon = new Map<string, ClarityPageSignal>();
  for (const c of clarity.values()) clarityByCanon.set(canon(c.url), c);

  // Union of canonical page URLs across every source.
  const urls = new Set<string>();
  for (const k of gsc.keys()) urls.add(k);
  for (const k of decay.keys()) urls.add(k);
  for (const k of clarityByCanon.keys()) urls.add(k);
  for (const k of ga4.keys()) urls.add(k);
  for (const k of cannibalByLead.keys()) urls.add(k);

  const items: OpportunityItem[] = [];
  for (const url of urls) {
    const g = gsc.get(url);
    const d = decay.get(url);
    const cl = clarityByCanon.get(url);
    const ga = ga4.get(url);
    const path = toPath(url);

    const input: OpportunityPageInput = {
      canonUrl: url,
      path,
      gsc: g
        ? {
            clicks90d: g.clicks90d,
            impressions90d: g.impressions90d,
            ctr90d: g.ctr90d,
            position90d: g.position90d,
            topQuery: g.topQueries?.[0]?.query,
          }
        : undefined,
      decay: d ? { clicksNow: d.clicksNow, clicksPrior: d.clicksPrior } : undefined,
      // SEMrush striking-distance removed Phase F.1 (the GSC striking-distance trigger
      // serves the rec queue). The /opportunities striking kind is dormant until
      // re-sourced from GSC.
      clarity: cl
        ? {
            sessions: cl.sessions,
            deadClicks: cl.deadClicks,
            rageClicks: cl.rageClicks,
          }
        : undefined,
      cannibalization: cannibalByLead.get(url),
      importance: ga4ValueWeight(ga),
      hasChangePack: summaries[path]?.hasPack === true,
      // When a Change Pack exists, its primary action is the canonical
      // per-page action every surface agrees on (supersedes the diagnosis lever).
      packHeadlineAction: summaries[path]?.hasPack
        ? actionLabel(summaries[path].headlineAction)
        : null,
      // Phase 1 broad scan has no SERP-feature data ⇒ "unknown" (the guard then
      // downgrades top-5 low-CTR pages rather than over-claiming a title fix).
      serpStatus: "unknown",
    };

    const opp = buildOpportunity(input);
    if (opp) items.push(opp);
  }

  return rankOpportunities(items);
}

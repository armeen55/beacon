import "server-only";

/** decision/producers/demand-recovery - THE COLLAPSE, TURNED INTO WORK. The site fell from 1.18M monthly
 *  impressions to 213k and every queue this product ever built was scored against the fallen baseline,
 *  because nothing read the sixteen months of history Google serves for free. This producer reads the
 *  canonical demand units (evidence/demand-units), takes the LARGEST PROVEN LOSSES the account's own history
 *  records, and mints one card per lost audience naming exactly what was earned, when, on which page, what
 *  is earned now, and where Google moved the audience when it did. A card whose page still stands routes
 *  through the ONE editor for its treatment; a swapped or split audience is a coordination card that names
 *  every page involved. Every number traces to the aggregate rows; nothing here is a model's guess. */

import { log } from "@/lib/logger";
import { loadCanonicalDemandUnits } from "@/domains/evidence/demand-unit-loader";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
import type { TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import type { ChangeProposal } from "@/domains/decision/contracts";

/** Lost clicks per month before a unit is worth a card, and how many cards one pass mints. */
const MIN_LOST_PER_MONTH = 20, MAX_CARDS = 5;

const pathOf = (url: string): string => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const n = (x: number): string => Math.round(x).toLocaleString("en-US");

export type DemandRecoveryRun = { cards: ChangeProposal[]; complete: boolean;
  window: { earlyDays: number; earlyFrom: string | null; earlyTo: string | null };
  /** The largest losses this pass measured, card or not: the collapse explanation, on the receipt. */
  losses: { unit: string; lostPerMonth: number; priorPage: string | null; currentPage: string | null; swapped: boolean }[] };

export async function demandRecoveryCards(input: { tenantId: string; snapshot: EvidenceSnapshot; now: Date;
  curve?: Pick<TenantCtrCurve, "expectedCtrAt"> }): Promise<DemandRecoveryRun> {
  const { tenantId, snapshot, now } = input;
  const none: DemandRecoveryRun = { cards: [], complete: false, window: { earlyDays: 0, earlyFrom: null, earlyTo: null }, losses: [] };
  try {
    const { units, historyWindow } = await loadCanonicalDemandUnits(tenantId, snapshot, input.curve, now);
    // UNDER A MONTH OF PRE-WINDOW HISTORY, THIS PRODUCER SAYS SO AND MINTS NOTHING: a loss needs a before.
    if (historyWindow.earlyDays < 30) return { ...none, complete: true, window: historyWindow };
    const owned = new Set(snapshot.ownedPages.map((p) => canonicalUrlKey(p.url)));
    const lost = units.filter((u) => (u.history?.lostClicksPerMonth ?? 0) >= MIN_LOST_PER_MONTH);
    const losses = lost.slice(0, 20).map((u) => ({ unit: u.label, lostPerMonth: u.history!.lostClicksPerMonth,
      priorPage: u.history!.priorTopPage, currentPage: u.history!.currentTopPage, swapped: u.history!.pageSwapped }));
    const cards: ChangeProposal[] = [];
    for (const u of lost.slice(0, MAX_CARDS)) {
      const h = u.history!;
      const home = h.currentTopPage ?? h.priorTopPage;
      if (!home || !owned.has(canonicalUrlKey(home))) continue;
      const path = pathOf(home);
      const phrasings = u.vocabulary.slice(0, 6).map((v) => `"${v}"`).join(", ");
      const windowLine = `${historyWindow.earlyFrom} to ${historyWindow.earlyTo}`;
      const story = `Searches for ${u.label} earned this site about ${n(h.earlyClicksPerDay * 30)} clicks a month over ${windowLine} and earn about ${n(h.recentClicksPerDay * 30)} now: ${n(h.lostClicksPerMonth)} clicks a month walked away.`;
      const moved = h.pageSwapped ? ` Google moved the audience: ${pathOf(h.priorTopPage!)} earned it then, ${pathOf(h.currentTopPage ?? home)} is shown now.` : "";
      const hints = [story.trim() + moved,
        `People search this as: ${phrasings}`,
        ...(u.volume?.searchVolume ? [`"${u.label}" carries ${n(u.volume.searchVolume)} searches a month${u.volume.intent ? ` (${u.volume.intent})` : ""}`] : []),
        ...(u.serp ? [`The pages winning it now: ${u.serp.winners.slice(0, 3).map((w) => w.domain).join(", ")}`] : []),
        ...u.tensions];
      cards.push({
        id: `${tenantId}::${path.toLowerCase()}::existing_edit::demand_recovery`, tenantId, kind: "existing_edit",
        pagePath: path, pageUrl: home, pageLabel: path, primaryQuery: u.label,
        opportunityType: h.pageSwapped
          ? `Win back "${u.label}": ${n(h.lostClicksPerMonth)} clicks a month left, and Google moved the audience between your pages`
          : `Win back "${u.label}" on ${path}: ${n(h.lostClicksPerMonth)} clicks a month left since ${historyWindow.earlyTo}`,
        changeFamily: "section", status: "needs_review",
        recommendedChange: { kind: "existing_edit", field: "section", before: null,
          after: `Rebuild this page's answer for "${u.label}" so it says, in the searchers' own words (${phrasings}), what it said when it earned ${n(h.earlyClicksPerDay * 30)} clicks a month.` },
        researchOnly: true, research: { missing: "The exact restored copy is not written yet.",
          next: h.pageSwapped ? "Both pages this audience moved between get read side by side, then the coordinated wording lands here."
            : "The exact wording lands on this card once the editor writes it from the page's own stored copy and this history." },
        whyItMatters: story + moved, operatorSteps: [], estimatedEffortMinutes: 30, riskLevel: "low",
        confidence: historyWindow.earlyDays >= 120 ? "medium" : "low",
        limitations: ["Measured from this account's own Search Console history, aggregated per query over the two windows named above."],
        evidence: { query: u.label, hints, evidenceRefCount: Math.max(1, Math.min(u.queries.length, hints.length)) },
        impactScore: h.lostClicksPerMonth, upsidePerMonth: h.lostClicksPerMonth,
        demandImpressions90d: u.audience.impressions90d || null,
        publish: "manual", createdAt: now.toISOString(),
      });
    }
    log.info("[demand-recovery] the collapse, measured", { tenantId, earlyDays: historyWindow.earlyDays,
      lostUnits: lost.length, cards: cards.length, top: losses[0] ?? null });
    return { cards, complete: true, window: historyWindow, losses };
  } catch (e) {
    log.warn("[demand-recovery] pass could not read the units; nothing minted and nothing swept", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return none;
  }
}

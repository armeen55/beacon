import "server-only";

import { cache } from "react";

import { currentTenantId, currentTenantSlug } from "@/lib/tenant-context";
import { normalizeUrl } from "@/lib/url/normalize";
import { loadDailyClicksByPathsForTenant } from "@/domains/proof-gsc/daily-series";
import { loadGscPageSignalsForTenant, type GscQuerySignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { anonymizedQueryShare, anonymizedShareNote } from "@/domains/gsc/anonymized-share";
import type { DailyClicks } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadClarityPageSignalsForTenant, type ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadPageContentSnapshot, type PageContentSnapshot } from "@/domains/recommendation-intelligence/page-freshness";
import { loadCrawlCitationFunnel } from "@/domains/ai-visibility/load-crawl-citation-funnel";
import { funnelPathKey, type PageFunnel } from "@/domains/ai-visibility/crawl-citation-funnel";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { proofMaturityLabel } from "@/domains/proof-gsc/measure-lifecycle";
import { loadChangesView } from "../../changes-data";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
// Dossier honesty (2026-07-11) - name the zero-click trap plainly when this page's own numbers
// show it, so the dossier never leaves it unexplained while the demand read sits right there.
import { isZeroClickTrap, ZERO_CLICK_TRAP_REASON_GENERAL } from "@/domains/changes/zero-click-trap";

/**
 * page-dossier-data (BEACON_500 item 54, carry-over 87) - the "everything the team
 * knows about one page" composition loader for /page/[...path]. Pure composition:
 * every read here calls an EXISTING tenant-wide or bounded loader and filters to the
 * one page in memory. No new query logic, no new tables, no new I/O shapes.
 *
 * Every field is fail-soft: one source failing never blanks the others (each source
 * is wrapped in its own catch), and the dossier always renders SOMETHING - honest
 * empty bands rather than a crashed page.
 */

export type DossierChangeRecord = ShippedChangeRecord;

export type DossierMove = {
  id: string;
  opportunityType: string;
  recommendation: string;
  status: CanonicalChange["status"];
  evidenceStrength: CanonicalChange["evidenceStrength"];
  estimatedEffortMinutes: number;
  measurementHeadline: string | null;
};

/** Retired with the daily-experiment plan (Core 100K): the dossier no longer surfaces a
 *  "planned pick" band, so `currentPlanPick` is always null. Kept on the type (and the
 *  section's conditional) so the section self-hides rather than the consumer breaking. */
export type DossierPlanPick = {
  id: string;
  lever: string;
  targetQuery: string;
  whyNow: string;
  isAccepted: boolean;
};

export type PageDossier = {
  /** Normalized path (the route's own identity key). */
  path: string;
  /** Best-known page label (title-cased slug, or the ledger/queries page label). */
  pageLabel: string;
  /** Whether ANY source recognized this page at all. */
  hasAnyData: boolean;
  /** Best-known full live URL for this page (GSC signal wins, then the current
   *  change/plan pick, then the most recent shipped-change record) so the header
   *  can link straight to the real site. Null when no source has ever seen a full
   *  URL for this path (e.g. a page that only exists as a proposal). */
  liveUrl: string | null;

  chart: {
    daily: DailyClicks[];
    /** Ship dates (YYYY-MM-DD) to mark on the chart, from the proof ledger. */
    shipMarkers: string[];
  };

  queries: {
    topQueries: GscQuerySignal[];
    /** R17a (v1 492) - non-null when a big slice of this page's Google traffic
     *  comes from queries Google hides ("About a third of this page's Google
     *  traffic comes from searches Google keeps private. ..."). Honest
     *  accounting for the table below it; self-hides under the threshold. */
    anonymizedNote: string | null;
  };

  content: PageContentSnapshot | null;

  teamReads: {
    demand: { clicks90d: number; impressions90d: number; ctr90d: number; position90d: number } | null;
    friction: ClarityPageSignal | null;
    funnel: PageFunnel | null;
  };

  history: DossierChangeRecord[];

  currentMove: DossierMove | null;
  currentPlanPick: DossierPlanPick | null;
  /** Dossier honesty (2026-07-11) - set when this page's top query is a zero-click trap (ranks
   *  well, real impressions, near-zero clicks): the honest sentence naming why more work here is
   *  unlikely to pay off, shown in the Current recommendation area so the trap is never left
   *  unexplained beside the numbers. Null when the page's top query is not trapped. */
  trapNote: string | null;
};

/** Title-case a path's final slug for an honest, human page label when no richer
 *  label is available from any source. Pure. */
function labelFromPath(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? "";
  const words = slug.replace(/[-_]+/g, " ").trim();
  if (!words) return "Home page";
  return words.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Does a stored page URL/path match the dossier's normalized path? Compares
 *  normalized forms so a bare path and a full URL both match the same page. */
function matchesPath(candidate: string | null | undefined, path: string): boolean {
  if (!candidate) return false;
  return (normalizeUrl(candidate) ?? candidate) === path;
}

/** History rows for this path, newest first, each carrying an honest maturity
 *  label alongside the raw record so the section never has to re-derive it. */
function historyForPath(records: ShippedChangeRecord[], path: string): ShippedChangeRecord[] {
  return records
    .filter((r) => matchesPath(r.path, path) || matchesPath(r.page, path))
    .sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
}

async function loadDossierUncached(tenantId: string, path: string): Promise<PageDossier> {
  const [
    dailyByPath,
    gscSignals,
    claritySignals,
    slug,
    ledger,
    changesView,
  ] = await Promise.all([
    loadDailyClicksByPathsForTenant(tenantId, [path]).catch(() => new Map<string, DailyClicks[]>()),
    loadGscPageSignalsForTenant(tenantId).catch(() => new Map()),
    loadClarityPageSignalsForTenant(tenantId).catch(() => new Map<string, ClarityPageSignal>()),
    currentTenantSlug().catch(() => ""),
    loadProofLedgerCached(tenantId).catch(() => [] as ShippedChangeRecord[]),
    loadChangesView().catch(() => null),
  ]);

  // GSC page signals are keyed by canonicalized full URL - find the one whose
  // normalized path matches ours.
  let gscEntry: { page: string; clicks90d: number; impressions90d: number; ctr90d: number; position90d: number; topQueries: GscQuerySignal[]; queryVisibleImpressions90d?: number } | null = null;
  for (const sig of gscSignals.values()) {
    if (matchesPath(sig.page, path)) {
      gscEntry = sig;
      break;
    }
  }

  // Clarity signals are keyed by canonicalized URL too.
  let clarityEntry: ClarityPageSignal | null = null;
  for (const sig of claritySignals.values()) {
    if (matchesPath(sig.url, path)) {
      clarityEntry = sig;
      break;
    }
  }

  // The AI funnel is per-tenant with an ownNeedle gate; skip cheaply without a slug.
  let funnelEntry: PageFunnel | null = null;
  if (slug) {
    const funnel = await loadCrawlCitationFunnel(tenantId, slug).catch(() => null);
    funnelEntry = funnel?.pages.find((p) => funnelPathKey(p.pagePath) === path) ?? null;
  }

  const history = historyForPath(ledger, path);
  const shipMarkers = history.map((r) => r.shippedAt.slice(0, 10)).sort();

  const daily = dailyByPath.get(path) ?? [];

  // Current recommendation: prefer the canonical Changes list (the single worklist
  // truth), falling back to null when nothing targets this page.
  const change = changesView?.changes.find((c) => matchesPath(c.pagePath, path) || matchesPath(c.pageUrl, path)) ?? null;
  const currentMove: DossierMove | null = change
    ? {
        id: change.id,
        opportunityType: change.opportunityType,
        recommendation: change.recommendation,
        status: change.status,
        evidenceStrength: change.evidenceStrength,
        estimatedEffortMinutes: change.estimatedEffortMinutes,
        measurementHeadline: change.measurementHeadline,
      }
    : null;

  // Current plan pick retired with the daily-experiment plan (Core 100K): the dossier's
  // "current recommendation" now comes from the canonical Changes list alone.
  const currentPlanPick: DossierPlanPick | null = null;

  // Prefer the worklist label when present (it may carry a richer name). Raw labels are
  // often lowercase slug words ("cities") which read fine inline on a card but not as this
  // page's headline, so title-case ONLY when the label has no uppercase at all; an
  // already-curated label ("Cities of Iran") passes untouched.
  const rawLabel = change?.pageLabel || labelFromPath(path);
  const pageLabel = /\p{Lu}/u.test(rawLabel) ? rawLabel : rawLabel.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

  // Best-known full URL for the "visit the live page" link: GSC's own canonical
  // URL wins (it is Google's crawl of the real page), then whatever the worklist
  // already resolved, then the most recent shipped-change record.
  const liveUrl = gscEntry?.page || change?.pageUrl || history[0]?.page || null;

  const content = liveUrl ? await loadPageContentSnapshot(tenantId, liveUrl).catch(() => null) : null;

  const hasAnyData =
    daily.length > 0 ||
    !!gscEntry ||
    !!clarityEntry ||
    !!funnelEntry ||
    history.length > 0 ||
    !!currentMove ||
    !!currentPlanPick ||
    !!content;

  // R17a (v1 492) - the anonymized-query note: page-total impressions include
  // the queries Google hides; the visible query-grain sum does not. Both
  // numbers already live on the loaded signal - a pure ratio, no new read.
  const anonymizedNote = gscEntry
    ? anonymizedShareNote(
        anonymizedQueryShare(gscEntry.impressions90d, gscEntry.queryVisibleImpressions90d ?? null),
      )
    : null;

  // Dossier honesty (2026-07-11) - the zero-click trap named from this page's OWN top query (the
  // same signal build-canonical-changes.ts trips the trap on), so a trapped page never shows its
  // demand numbers next to a silent, unexplained recommendation. The general sentence fits any
  // lever the dossier might otherwise imply is worth doing here.
  const topTrapQuery = [...(gscEntry?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
  const trapNote =
    topTrapQuery &&
    isZeroClickTrap({
      topQueryPosition: topTrapQuery.position,
      topQueryImpressions90d: topTrapQuery.impressions,
      topQueryClicks90d: topTrapQuery.clicks,
    })
      ? ZERO_CLICK_TRAP_REASON_GENERAL
      : null;

  return {
    path,
    pageLabel,
    hasAnyData,
    liveUrl,
    chart: { daily, shipMarkers },
    queries: { topQueries: gscEntry?.topQueries ?? [], anonymizedNote },
    content,
    teamReads: {
      demand: gscEntry
        ? { clicks90d: gscEntry.clicks90d, impressions90d: gscEntry.impressions90d, ctr90d: gscEntry.ctr90d, position90d: gscEntry.position90d }
        : null,
      friction: clarityEntry,
      funnel: funnelEntry,
    },
    history,
    currentMove,
    currentPlanPick,
    trapNote,
  };
}

/** Request-memoized per (tenantId, path) - every underlying source is ALREADY
 *  request-cached or a single bounded read, so this just avoids re-running the
 *  in-memory filter/join twice on one render. */
export const loadPageDossier = cache(
  async (path: string): Promise<PageDossier> => {
    const tenantId = await currentTenantId();
    return loadDossierUncached(tenantId, path);
  },
);

/** Turn a Next.js catch-all route's path segments into the dossier's normalized
 *  path key (mirrors normalizeUrl's contract: lowercased, leading slash, no
 *  trailing slash). Exported for tests + the route file. */
export function pathFromSegments(segments: string[]): string {
  const joined = "/" + segments.map((s) => decodeURIComponent(s)).join("/");
  return normalizeUrl(joined) ?? "/";
}

export { labelFromPath, proofMaturityLabel };

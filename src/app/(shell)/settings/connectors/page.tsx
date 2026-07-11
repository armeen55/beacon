import { getConnectorInfo, getGoogleConnectorToken } from "@/lib/connector-store";
import { getWixUrlMap } from "@/lib/connectors/wix/url-map";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { formatLastRefreshedCopy } from "@/lib/connectors/gsc/expiry-handler";
import {
  loadGscReadiness,
  describeGscReadiness,
  type GscReadinessVerdict,
  type GscReadinessTone,
} from "@/lib/connectors/gsc/readiness";
// R17a (ingestion gaps, v1 266) - one honest line when days are missing INSIDE
// the covered Google range (a sync hole, not Google's normal lag). The nightly
// sync re-pulls the same dates this line names.
import { loadGscIngestionGapReport } from "@/domains/gsc/load-ingestion-gaps";
import { ingestionGapLine } from "@/domains/gsc/ingestion-gaps";
import { currentTenantId } from "@/lib/tenant-context";
import { latestRefreshBySource } from "@/domains/ops/refresh-runs-store";
import { PageHeader } from "@/components/data/page-header";
import { ConnectorsClient, type LastSyncState, type RefreshLedgerFacts } from "./connectors-client";
import { PublishingModeCard } from "./publishing-mode-card";
import { AutopilotCard } from "./autopilot-card";
import { CronHealthPanel } from "./cron-health-panel";
import { loadCronHealthView } from "@/domains/ops/cron-health-view";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";

export const dynamic = "force-dynamic";

// W2-A (2026-07-02) - FP1 always-paint floor: this page awaits eight connector-store
// reads before it can render anything; one wedged Supabase read (each 522 is ~30s)
// used to hold the whole stream open forever. The reads are gathered into one loader
// below and raced as a unit; past the deadline the page says so honestly instead.
const CONNECTORS_DEADLINE_MS = 15_000;

/** Everything the page body needs, loaded exactly as before - just gathered into one
 *  bounded unit. Behavior of each individual read is unchanged. */
async function loadConnectorsPageData() {
  // Awaited as a function call (not a JSX tag) so the async panel resolves before
  // render - renderToStaticMarkup in the route tests cannot handle a suspending child.
  const cronHealthPanel = await CronHealthPanel();
  // GSC is the v1 Google card. GBP card is deferred (Section 7 wire-up).
  // GA4 card added in Slice 9.A1β (2026-05-18) — consumes the GA4
  // connector substrate that shipped in Slice 9.A1α (commit e88a060).
  // Each provider reads independently — each card renders its own
  // state without cross-provider coupling.
  const googleGsc = await getConnectorInfo("google_gsc");
  const googleGa4 = await getConnectorInfo("google_ga4");
  const yelp = await getConnectorInfo("yelp");
  // North-star onboarding (2026-06-11): self-serve Wix connection card.
  const wix = await getConnectorInfo("wix");
  // Connect-cards slice (2026-06-12): the END-STATE contract — every
  // data source connects HERE, self-serve.
  const profound = await getConnectorInfo("profound");
  const clarity = await getConnectorInfo("clarity");
  const cfg = await getBusinessConfigForCurrentTenant();
  // Selected GBP location lives on the (deferred) google_gbp token. Read
  // it so a returning GBP card can immediately show the saved selection.
  const gbpTok = await getGoogleConnectorToken("gbp");

  // T0b (2026-07-03) - how many pages Wix's url map covers right now. A
  // connected-but-zero-mapped Wix can't publish a single change; the fix
  // line on the Wix card (recovery-actions.ts) reads this to decide whether
  // to show the "map your pages first" recovery sentence.
  const wixUrlMapCount = wix.status === "connected"
    ? await getWixUrlMap().then((m) => m.length).catch(() => 0)
    : 0;

  // J5 (2026-05-18) — when the GSC connector is in soft-disconnected
  // state (status="disconnected" but expires_at is populated from the
  // preserved token row), render the "Last refreshed at X days ago"
  // tooltip server-side. The formatter is `server-only` so it can't
  // ship to the client bundle directly.
  // "Last refreshed X days ago" must reflect the actual data SYNC time, not the
  // OAuth token's expires_at (those diverge — a token can expire long after the
  // last sync). Drive off last_synced_at and show nothing if it never synced.
  const gscSyncedMs = googleGsc.last_synced_at
    ? Date.parse(googleGsc.last_synced_at)
    : NaN;
  const gscStaleCopy =
    googleGsc.status === "disconnected" && Number.isFinite(gscSyncedMs)
      ? formatLastRefreshedCopy({
          lastSyncedMs: gscSyncedMs,
          now: Date.now(),
        })
      : null;

  // MAX_SEO_AEO Phase 4 (2026-06-16) — GSC readiness surfacing. READ-ONLY:
  // composes the resolved property + backfill window + freshness + a hard
  // "not ready" verdict from the persisted token state + synced rows (no live
  // Google call). Soft-fail: any loader error degrades to a coherent
  // not_connected verdict so the page never crashes. Pages stay thin — the
  // verdict logic + plain-English copy live in the loader/presenter.
  let gscReadiness: {
    verdict: GscReadinessVerdict;
    headline: string;
    detail: string;
    tone: GscReadinessTone;
    property: string | null;
  };
  // R17a (v1 266) - the missing-days line for the GSC card. Null (self-hides)
  // when nothing is missing inside the covered range, when GSC never synced,
  // or on any read error. Never blocks the page.
  let gscGapLine: string | null = null;
  try {
    const tid = await currentTenantId();
    const readiness = await loadGscReadiness(tid);
    const described = describeGscReadiness(readiness);
    gscReadiness = {
      verdict: readiness.verdict,
      headline: described.headline,
      detail: described.detail,
      tone: described.tone,
      property: readiness.property,
    };
    if (readiness.verdict === "ready") {
      const gapReport = await loadGscIngestionGapReport(tid).catch(() => null);
      gscGapLine = gapReport ? ingestionGapLine(gapReport) : null;
    }
  } catch {
    gscReadiness = {
      verdict: "not_connected",
      headline: "Not connected",
      detail:
        "Connect Google Search Console so Beacon can see what people search to find you.",
      tone: "idle",
      property: null,
    };
  }

  // Slice 9.A1β (2026-05-18) — GA4 stale copy mirrors GSC's pattern.
  // Server-side render keeps the formatting helper inlined (the GSC
  // helper says "GSC" verbatim; the GA4 surface needs "Google
  // Analytics" wording, so a separate helper lives here).
  const ga4SyncedMs = googleGa4.last_synced_at
    ? Date.parse(googleGa4.last_synced_at)
    : NaN;
  const ga4StaleCopy =
    googleGa4.status === "disconnected" && Number.isFinite(ga4SyncedMs)
      ? formatGa4StaleCopy({
          lastSyncedMs: ga4SyncedMs,
          now: Date.now(),
        })
      : null;

  // FP10a (2026-07-02) - one summary strip fact instead of the same three
  // facts stated five-plus times across the page. "N of M connected" counts
  // the five self-serve sources that actually render a card on this page
  // (GSC, GA4, Wix, Profound, Clarity); Yelp is removed from the UI
  // (2026-06-18) and GBP is deferred, so neither counts toward M.
  const connectedCount = [googleGsc, googleGa4, wix, profound, clarity].filter(
    (c) => c.status === "connected",
  ).length;
  const totalCount = 5;

  // BUG 3 (2026-07-11): per-source refresh-ledger facts for the "last pulled /
  // data through / result" strip. Read-only, fail-soft: any error self-hides the
  // strip rather than blocking the page. Sourced from the SAME ledger the cron,
  // manual, and on-use refresh paths all record into.
  let refreshLedger: RefreshLedgerFacts = {};
  try {
    const tid = await currentTenantId();
    const latest = await latestRefreshBySource(tid);
    const facts: RefreshLedgerFacts = {};
    for (const key of ["gsc", "ga4", "clarity", "profound"] as const) {
      const row = latest[key];
      if (row != null) {
        facts[key] = {
          lastPulled: row.started_at,
          dataThrough: row.latest_data_date,
          result: row.result,
          reason: row.failure_category,
        };
      }
    }
    refreshLedger = facts;
  } catch {
    refreshLedger = {};
  }

  // "Last night's sync" reads the same sync-connectors cron job the health
  // panel below renders in full - one source of truth, not a second story.
  let lastSyncState: LastSyncState = "none";
  let lastSyncHeadline = "I have not run yet.";
  try {
    const jobs = await loadCronHealthView();
    const syncJob = jobs.find((j) => j.job === "sync-connectors");
    if (syncJob?.lastRun) {
      lastSyncState = syncJob.lastRun.ok ? "ok" : "issues";
      lastSyncHeadline = syncJob.headline;
    }
  } catch {
    // Soft-fail: the health panel below will show its own honest state;
    // the summary strip just falls back to "none".
  }

  return {
    cronHealthPanel,
    googleGsc,
    googleGa4,
    yelp,
    wix,
    profound,
    clarity,
    cfg,
    gbpTok,
    gscStaleCopy,
    gscReadiness,
    gscGapLine,
    ga4StaleCopy,
    connectedCount,
    totalCount,
    lastSyncState,
    lastSyncHeadline,
    wixUrlMapCount,
    refreshLedger,
  };
}

// FP10a (2026-07-02) - the per-connector "what it feeds" line now lives once
// on each connector's own row (see connectors-client.tsx SOURCE_SUMMARY), so
// this description stays a single plain sentence instead of repeating each
// source's story here too.
const CONNECTORS_DESCRIPTION =
  "The tools your business already uses, so I can see what's happening and tell you what to do next.";

export default async function ConnectorsPage() {
  const raced = await loadWithDeadline(loadConnectorsPageData(), CONNECTORS_DEADLINE_MS);
  if (raced.timedOut) {
    return (
      <div>
        <PageHeader title="Connect your tools" description={CONNECTORS_DESCRIPTION} />
        <HonestDelay />
      </div>
    );
  }
  const {
    cronHealthPanel,
    googleGsc,
    googleGa4,
    yelp,
    wix,
    profound,
    clarity,
    cfg,
    gbpTok,
    gscStaleCopy,
    gscReadiness,
    gscGapLine,
    ga4StaleCopy,
    connectedCount,
    totalCount,
    lastSyncState,
    lastSyncHeadline,
    wixUrlMapCount,
    refreshLedger,
  } = raced.data;

  return (
    <div>
      <PageHeader title="Connect your tools" description={CONNECTORS_DESCRIPTION} />
      <ConnectorsClient
        google={googleGsc}
        googleSelectedLocation={
          gbpTok?.selected_location_id
            ? { id: gbpTok.selected_location_id, name: gbpTok.selected_location_name ?? "Location" }
            : null
        }
        ga4={googleGa4}
        yelp={yelp}
        wix={wix}
        profound={profound}
        clarity={clarity}
        configYelpBusinessId={cfg.yelpBusinessId ?? ""}
        gscStaleCopy={gscStaleCopy}
        gscReadiness={gscReadiness}
        gscGapLine={gscGapLine}
        ga4StaleCopy={ga4StaleCopy}
        connectedCount={connectedCount}
        totalCount={totalCount}
        lastSyncState={lastSyncState}
        lastSyncHeadline={lastSyncHeadline}
        wixUrlMapCount={wixUrlMapCount}
        refreshLedger={refreshLedger}
      />
      {/* Armed publishing (2026-06-16) — opt in to one-click live publishing
          for safe, mapped, high-confidence edits. Default stays two-click. */}
      <div className="mt-6">
        <PublishingModeCard />
      </div>
      {/* Trust-budget autopilot (2026-07-01, item 1) - opt in to a weekly
          budget of auto-shipped changes from proven change types. Default OFF. */}
      <div className="mt-6">
        <AutopilotCard />
      </div>
      {/* Cron health panel (2026-07-03, item 85) - "I showed up every night this
          week" for every scheduled job, plus any 3+ night failure streaks. */}
      <div className="mt-6">
        {cronHealthPanel}
      </div>
    </div>
  );
}

/**
 * Slice 9.A1β (2026-05-18) — GA4 staleness copy. Mirrors
 * `formatLastRefreshedCopy` from `gsc/expiry-handler.ts` but uses
 * "Google Analytics" wording for the customer-vocab-safe surface.
 * Kept inline (Server Component file) so it stays server-only
 * without adding a sibling module under `src/lib/connectors/ga4/`
 * (the substrate is locked from modification in 9.A1β).
 */
function formatGa4StaleCopy(args: {
  lastSyncedMs: number;
  now: Date | number;
}): string {
  const nowMs = args.now instanceof Date ? args.now.getTime() : args.now;
  const diffMs = Math.max(0, nowMs - args.lastSyncedMs);
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return "Google Analytics data last refreshed less than a day ago.";
  }
  if (days === 1) {
    return "Google Analytics data last refreshed 1 day ago. Reconnect to refresh.";
  }
  return `Google Analytics data last refreshed ${days} days ago. Reconnect to refresh.`;
}

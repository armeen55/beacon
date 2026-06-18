import { getConnectorInfo, getGoogleConnectorToken } from "@/lib/connector-store";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { formatLastRefreshedCopy } from "@/lib/connectors/gsc/expiry-handler";
import {
  loadGscReadiness,
  describeGscReadiness,
  type GscReadinessVerdict,
  type GscReadinessTone,
} from "@/lib/connectors/gsc/readiness";
import { currentTenantId } from "@/lib/tenant-context";
import { PageHeader } from "@/components/data/page-header";
import { ConnectorsClient } from "./connectors-client";
import { PublishingModeCard } from "./publishing-mode-card";

export const dynamic = "force-dynamic";

export default async function ConnectorsPage() {
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
  const semrush = await getConnectorInfo("semrush");
  const profound = await getConnectorInfo("profound");
  const clarity = await getConnectorInfo("clarity");
  const cfg = await getBusinessConfigForCurrentTenant();
  // Selected GBP location lives on the (deferred) google_gbp token. Read
  // it so a returning GBP card can immediately show the saved selection.
  const gbpTok = await getGoogleConnectorToken("gbp");

  // J5 (2026-05-18) — when the GSC connector is in soft-disconnected
  // state (status="disconnected" but expires_at is populated from the
  // preserved token row), render the "Last refreshed at X days ago"
  // tooltip server-side. The formatter is `server-only` so it can't
  // ship to the client bundle directly.
  const gscStaleCopy =
    googleGsc.status === "disconnected" &&
    typeof googleGsc.expires_at === "number"
      ? formatLastRefreshedCopy({
          expiresAtMs: googleGsc.expires_at,
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
  const ga4StaleCopy =
    googleGa4.status === "disconnected" &&
    typeof googleGa4.expires_at === "number"
      ? formatGa4StaleCopy({
          expiresAtMs: googleGa4.expires_at,
          now: Date.now(),
        })
      : null;

  return (
    <div>
      <PageHeader
        title="Connectors"
        description="Connect the tools your business already uses so Beacon can see what's happening and suggest what to do next. Connect Google so Beacon sees what people search to find you. Connect Google Analytics to see what visitors do on your site. Connect Clarity to see where visitors get stuck. Connect Wix so approved edits can publish to your site. Connect the rest as you're ready — or import a spreadsheet instead under Settings → Import."
      />
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
        semrush={semrush}
        profound={profound}
        clarity={clarity}
        configYelpBusinessId={cfg.yelpBusinessId ?? ""}
        gscStaleCopy={gscStaleCopy}
        gscReadiness={gscReadiness}
        ga4StaleCopy={ga4StaleCopy}
      />
      {/* Armed publishing (2026-06-16) — opt in to one-click live publishing
          for safe, mapped, high-confidence edits. Default stays two-click. */}
      <div className="mt-6">
        <PublishingModeCard />
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
  expiresAtMs: number;
  now: Date | number;
}): string {
  const nowMs = args.now instanceof Date ? args.now.getTime() : args.now;
  const diffMs = Math.max(0, nowMs - args.expiresAtMs);
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return "Google Analytics data last refreshed less than a day ago.";
  }
  if (days === 1) {
    return "Google Analytics data last refreshed 1 day ago. Reconnect to refresh.";
  }
  return `Google Analytics data last refreshed ${days} days ago. Reconnect to refresh.`;
}

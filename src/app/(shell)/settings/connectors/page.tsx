import { getConnectorInfo, getGoogleConnectorToken } from "@/lib/connector-store";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { formatLastRefreshedCopy } from "@/lib/connectors/gsc/expiry-handler";
import { PageHeader } from "@/components/data/page-header";
import { ConnectorsClient } from "./connectors-client";

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
        description="Search Console (GSC) read access plus optional Yelp pulls. Manual CSV/JSON import under Settings → Import remains available regardless of connector status."
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
        configYelpBusinessId={cfg.yelpBusinessId ?? ""}
        gscStaleCopy={gscStaleCopy}
        ga4StaleCopy={ga4StaleCopy}
      />
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

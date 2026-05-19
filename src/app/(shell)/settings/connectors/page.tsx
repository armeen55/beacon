import { getConnectorInfo, getGoogleConnectorToken } from "@/lib/connector-store";
import { getBusinessConfig } from "@/lib/business-config";
import { formatLastRefreshedCopy } from "@/lib/connectors/gsc/expiry-handler";
import { PageHeader } from "@/components/data/page-header";
import { ConnectorsClient } from "./connectors-client";

export const dynamic = "force-dynamic";

export default async function ConnectorsPage() {
  // GSC is the v1 Google card. GBP card is deferred (Section 7 wire-up).
  // Both providers still read independently so the GBP card returning
  // requires no callsite change here.
  const googleGsc = await getConnectorInfo("google_gsc");
  const yelp = await getConnectorInfo("yelp");
  const cfg = getBusinessConfig();
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
        yelp={yelp}
        configYelpBusinessId={cfg.yelpBusinessId ?? ""}
        gscStaleCopy={gscStaleCopy}
      />
    </div>
  );
}

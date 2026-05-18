import { getConnectorInfo, getGoogleConnectorToken } from "@/lib/connector-store";
import { getBusinessConfig } from "@/lib/business-config";
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
      />
    </div>
  );
}

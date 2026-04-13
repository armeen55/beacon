import { getConnectorInfo, getGoogleConnectorToken } from "@/lib/connector-store";
import { getBusinessConfig } from "@/lib/business-config";
import { PageHeader } from "@/components/data/page-header";
import { ConnectorsClient } from "./connectors-client";

export const dynamic = "force-dynamic";

export default function ConnectorsPage() {
  const google = getConnectorInfo("google");
  const yelp = getConnectorInfo("yelp");
  const cfg = getBusinessConfig();
  const gTok = getGoogleConnectorToken();

  return (
    <div>
      <PageHeader
        title="Review connectors"
        description="Optional Google Business Profile and Yelp pulls (Sync now). Based on imported or synced data; may not reflect full platform data; no automatic syncing. Manual CSV/JSON import under Settings → Import remains available regardless of connector status."
      />
      <ConnectorsClient
        google={google}
        googleSelectedLocation={
          gTok?.selected_location_id
            ? { id: gTok.selected_location_id, name: gTok.selected_location_name ?? "Location" }
            : null
        }
        yelp={yelp}
        configYelpBusinessId={cfg.yelpBusinessId ?? ""}
      />
    </div>
  );
}

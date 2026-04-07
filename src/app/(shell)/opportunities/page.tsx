import {
  opportunities,
  briefs,
  competitors,
  competitorSnapshots,
} from "@/lib/seed-data.server";
import { OpportunitiesClient } from "./opportunities-client";

export default function OpportunitiesPage() {
  return (
    <OpportunitiesClient
      opportunities={opportunities}
      briefs={briefs}
      competitors={competitors}
      competitorSnapshots={competitorSnapshots}
    />
  );
}

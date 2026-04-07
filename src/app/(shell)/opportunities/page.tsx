import {
  opportunities,
  briefs,
  competitors,
  competitorSnapshots,
  changelogEntries,
} from "@/lib/seed-data.server";
import { candidateLinks } from "@/domains/attribution/store";
import { OpportunitiesClient } from "./opportunities-client";

export default function OpportunitiesPage() {
  const candidateLinkCounts: Record<string, number> = {};
  const confirmedLinkCounts: Record<string, number> = {};

  for (const opp of opportunities) {
    const oppChangeIds = new Set(
      changelogEntries
        .filter((c) => c.opportunity_id === opp.id)
        .map((c) => c.id)
    );
    const links = candidateLinks.filter((cl) => oppChangeIds.has(cl.change_id));
    candidateLinkCounts[opp.id] = links.length;
    confirmedLinkCounts[opp.id] = links.filter(
      (cl) => cl.status === "confirmed"
    ).length;
  }

  return (
    <OpportunitiesClient
      opportunities={opportunities}
      briefs={briefs}
      competitors={competitors}
      competitorSnapshots={competitorSnapshots}
      candidateLinkCounts={candidateLinkCounts}
      confirmedLinkCounts={confirmedLinkCounts}
    />
  );
}

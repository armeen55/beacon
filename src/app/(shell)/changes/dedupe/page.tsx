import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { changelogEntries } from "@/lib/seed-data.server";
import { findDuplicatePairs } from "@/domains/changelog/dedupe";
import { DedupeReview, type SerializedPair } from "./dedupe-client";

export default async function DedupePage() {
  const pairs = findDuplicatePairs(changelogEntries);
  const serialized: SerializedPair[] = pairs.map((p) => ({
    keeper: {
      id: p.keeper.id,
      timestamp: p.keeper.timestamp,
      source: p.keeper.source_system,
      url: p.keeper.url,
      assetName: p.keeper.asset_name,
      description: p.keeper.change_description,
    },
    archiveCandidate: {
      id: p.archiveCandidate.id,
      timestamp: p.archiveCandidate.timestamp,
      source: p.archiveCandidate.source_system,
      url: p.archiveCandidate.url,
      assetName: p.archiveCandidate.asset_name,
      description: p.archiveCandidate.change_description,
    },
    sharedTokens: p.sharedTokens,
    keeperOnlyTokens: p.keeperOnlyTokens,
    daysApart: p.daysApart,
  }));

  return (
    <div>
      <PageHeader
        title="Review possible duplicates"
        description="Beacon found these CSV summaries that look like they describe the same edits as your PDF entries. Archive the summaries so your changelog is clean."
      />
      <div className="mb-5 flex items-center gap-3 text-[12px]">
        <Link
          href="/changes"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Changes
        </Link>
        <span className="text-border">·</span>
        <span className="text-muted-foreground">
          Archived entries stay on disk and can be restored — nothing is permanently deleted.
        </span>
      </div>
      <DedupeReview pairs={serialized} />
    </div>
  );
}

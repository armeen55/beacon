import { results, changelogEntries, opportunities } from "@/lib/seed-data.server";
import { ResultsClient } from "./results-client";

export default function ResultsPage() {
  return (
    <ResultsClient
      results={results}
      changelogEntries={changelogEntries}
      opportunities={opportunities}
    />
  );
}

export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { loadKeywordLibrary } from "@/domains/research/keyword-library";
import { KeywordsTableClient } from "./keywords-table-client";

/**
 * /research/keywords: the Keywords library (MASTER PLAN v2 UX2 first slice,
 * the operator's own idea): EVERY keyword Beacon has ever researched, merged
 * from cache, in one sortable table. No new paid calls happen on this page.
 * loadKeywordLibrary only reads what earlier work already stored.
 */
export default async function KeywordsPage() {
  let library;
  try {
    library = await loadKeywordLibrary();
  } catch {
    return (
      <div className="max-w-6xl space-y-6">
        <PageHeader title="Keywords" description="Every keyword I have researched for you, in one place." />
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          I could not load your keyword library just now. Refresh in a moment.
        </p>
      </div>
    );
  }

  const coverageLine =
    library.total === 0
      ? "I do not have any researched keywords yet. Connect Google Search Console or run a keyword check to start building this list."
      : `I have real search-volume numbers for ${library.volumeCoverage.toLocaleString()} of ${library.total.toLocaleString()} keywords. The rest show Google's own numbers (times shown, clicks, position) until I check their market volume.`;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Keywords"
        description="Every keyword I have researched for you, from Google Search Console, market-volume checks, competitor gaps, and live Google readings, in one sortable list."
      />
      <p className="text-sm text-gray-600 dark:text-neutral-400">{coverageLine}</p>
      <KeywordsTableClient rows={library.rows} worklistBaseHref="/worklist" />
    </div>
  );
}

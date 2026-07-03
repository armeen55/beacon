export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { loadKeywordLibrary, summarizeKeywordLibrary } from "@/domains/research/keyword-library";
import { KeywordsTableClient } from "./keywords-table-client";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
// R14b (receipts everywhere) - the hero numbers' one-line receipt, from the
// newest lastChecked stamp the loaded rows ALREADY carry. No new reads.
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";

/**
 * /research/keywords: the Keywords library (MASTER PLAN v2 UX2 first slice,
 * the operator's own idea): EVERY keyword Beacon has ever researched, merged
 * from cache, in one sortable table. No new paid calls happen on this page.
 * loadKeywordLibrary only reads what earlier work already stored.
 */

// W2-A (2026-07-02) - FP1 always-paint floor: the library merge fans across several
// cached stores; one wedged Supabase read (each 522 is ~30s) used to hold this page's
// stream open forever. Past the deadline the page says so honestly and the abandoned
// merge keeps warming the cache for the next visit.
const KEYWORDS_DEADLINE_MS = 15_000;

export default async function KeywordsPage() {
  let library;
  try {
    const raced = await loadWithDeadline(loadKeywordLibrary(), KEYWORDS_DEADLINE_MS);
    if (raced.timedOut) {
      return (
        <div className="max-w-6xl space-y-6">
          <PageHeader title="Keywords" description="Every keyword I have researched for you, in one place." />
          <HonestDelay />
        </div>
      );
    }
    library = raced.data;
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

  // FP7 hero synthesis line (2026-07-02): one sentence answering "so what"
  // before the table, using whichever real stat is strongest for this
  // tenant right now (winnable gaps, then owned coverage, then total volume).
  const heroLine = summarizeKeywordLibrary(library);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Keywords"
        description="Every keyword I have researched for you, from Google Search Console, market-volume checks, competitor gaps, and live Google readings, in one sortable list."
      />
      {heroLine && <p className="text-base font-semibold text-gray-900 dark:text-neutral-100">{heroLine}</p>}
      <p className="text-sm text-gray-600 dark:text-neutral-400">{coverageLine}</p>
      {/* R14b (receipts everywhere) - when this library was last checked, from the
          rows' own newest stamp. Self-hides when no row carries one yet. */}
      <ReceiptLine
        line={buildReceiptLine({
          source: "your Search Console data and my market volume checks",
          checkedAt: library.rows.reduce<string | null>(
            (latest, r) =>
              r.lastChecked && Number.isFinite(Date.parse(r.lastChecked)) && (latest == null || r.lastChecked > latest)
                ? r.lastChecked
                : latest,
            null,
          ),
          nowMs: Date.now(),
        })}
      />
      <KeywordsTableClient rows={library.rows} worklistBaseHref="/changes" />
    </div>
  );
}

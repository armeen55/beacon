export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/data/page-header";
import { loadKeywordLibrary, summarizeKeywordLibrary } from "@/domains/research/keyword-library";
import { KeywordsTableClient } from "./keywords-table-client";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
// R17a (striking-distance portfolio, v1 267) - the hero's second line: how many
// searches sit just below the top and what a push is worth, from the SAME
// loader the Today demand band reads (one number, two surfaces).
import { loadStrikingPortfolio } from "@/domains/gsc/load-striking-portfolio";
// R17b (back-of-results register, v1 428) - searches where the site ranks 30th
// to 100th with real demand: invisible everywhere else, each one a page idea.
// Self-hiding section; the same loader feeds the question universe.
import { loadBackOfResultsRegister } from "@/domains/gsc/load-back-of-results";
// R17c (v1 138) - a budgeted check of whether Google has actually indexed the
// tenant's highest-demand owned pages (a page can rank yet still be missing
// from Google's index). Bounded to GSC_INSPECT_PER_RENDER_LIMIT, self-hiding.
import { loadIndexationSweep } from "@/domains/gsc/load-indexation-sweep";
// R17c (v1 491 + 493) - the total Google footprint roll-up (pages x searches x
// appearances, $0 from synced data) and the Google Discover probe (a separate
// feed that self-hides when the property has no Discover data).
import { loadGscFootprint } from "@/domains/gsc/load-footprint";
import { loadDiscoverPresence } from "@/domains/gsc/load-footprint";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { currentTenantId } from "@/lib/tenant-context";
// R14b (receipts everywhere) - the hero numbers' one-line receipt, from the
// newest lastChecked stamp the loaded rows ALREADY carry. No new reads.
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
import { serverNowMs } from "@/lib/server-clock";

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
  const raced = await loadWithDeadline(loadKeywordLibrary(), KEYWORDS_DEADLINE_MS).catch(() => null);
  if (raced == null) {
    return (
      <div className="max-w-6xl space-y-6">
        <PageHeader title="Keywords" description="Every keyword I have researched for you, in one place." />
        <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          I could not load your keyword library just now. Refresh in a moment.
        </p>
      </div>
    );
  }
  if (raced.timedOut) {
    return (
      <div className="max-w-6xl space-y-6">
        <PageHeader title="Keywords" description="Every keyword I have researched for you, in one place." />
        <HonestDelay />
      </div>
    );
  }
  const library = raced.data;

  const coverageLine =
    library.total === 0
      ? "I do not have any researched keywords yet. Connect Google Search Console or run a keyword check to start building this list."
      : `I have real search-volume numbers for ${library.volumeCoverage.toLocaleString()} of ${library.total.toLocaleString()} keywords. The rest show Google's own numbers (times shown, clicks, position) until I check their market volume.`;

  // FP7 hero synthesis line (2026-07-02): one sentence answering "so what"
  // before the table, using whichever real stat is strongest for this
  // tenant right now (winnable gaps, then owned coverage, then total volume).
  const heroLine = summarizeKeywordLibrary(library);

  // R17a (v1 267) - the portfolio second line. Deadline-bounded + fail-soft:
  // no Search Console data or a slow read just means the line stays silent.
  const portfolio = await valueWithDeadline(
    currentTenantId()
      .then((tid) => loadStrikingPortfolio(tid))
      .catch(() => null),
    null,
  );

  // R17b (v1 428) - the deep-rank register. Deadline-bounded + fail-soft:
  // nothing in the 30-100 band just means the section never renders.
  const backOfResults = await valueWithDeadline(
    currentTenantId()
      .then((tid) => loadBackOfResultsRegister(tid))
      .catch(() => null),
    null,
  );

  // R17c (v1 138) - the budgeted indexation sweep. Deadline-bounded + fail-soft:
  // no GSC data, no property, or every top page already indexed just means the
  // line stays silent (never a bare "0 not indexed").
  const indexationSweep = await valueWithDeadline(
    currentTenantId()
      .then((tid) => loadIndexationSweep(tid))
      .catch(() => null),
    null,
  );

  // R17c (v1 491 + 493) - the total footprint roll-up ($0) and the Discover
  // probe (one bounded read behind a 12h cache). Both deadline-bounded +
  // fail-soft: no data just means the line stays silent.
  const [footprint, discover] = await Promise.all([
    valueWithDeadline(
      currentTenantId().then((tid) => loadGscFootprint(tid)).catch(() => null),
      null,
    ),
    valueWithDeadline(
      currentTenantId().then((tid) => loadDiscoverPresence(tid)).catch(() => null),
      null,
    ),
  ]);
  const portfolioLine = portfolio
    ? `${portfolio.headline}${portfolio.sizingLine ? ` ${portfolio.sizingLine}` : ""}`
    : null;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Keywords"
        description="Every keyword I have researched for you, from Google Search Console, market-volume checks, competitor gaps, and live Google readings, in one sortable list."
      />
      {heroLine && <p className="text-base font-semibold text-gray-900 dark:text-neutral-100">{heroLine}</p>}
      {/* R17c (v1 491) - the total Google footprint: how much of Google the
          site occupies right now (pages x searches x appearances). The one
          presence number no individual row adds up to. Self-hides without GSC. */}
      {footprint?.line && <p className="text-sm text-muted-foreground tabular-nums">{footprint.line}</p>}
      {/* R17c (v1 493) - the Google Discover presence, when the property has
          Discover data. Self-hides honestly when Discover returns nothing. */}
      {discover?.line && <p className="text-sm text-muted-foreground tabular-nums">{discover.line}</p>}
      {/* R17a (v1 267) - the striking-distance portfolio: the one number the
          individual rows below never add up to. Self-hides without GSC data. */}
      {portfolioLine && <p className="text-sm text-muted-foreground tabular-nums">{portfolioLine}</p>}
      {/* R17c (v1 138) - the budgeted indexation sweep: top pages Google has
          not indexed yet (they earn no traffic no matter how good). Self-hides
          when every checked page is indexed. */}
      {indexationSweep?.line && (
        <p className="text-sm font-medium text-status-warning tabular-nums">{indexationSweep.line}</p>
      )}
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
          nowMs: serverNowMs(),
        })}
      />
      <KeywordsTableClient rows={library.rows} worklistBaseHref="/changes" />
      {/* R17b (v1 428) - the back-of-results register: proven demand where the
          site ranks too deep to ever earn a click. Self-hides without rows. */}
      {backOfResults ? (
        <section aria-label="Searches where you rank deep but still get seen" className="space-y-2">
          <SectionHeader
            title="Deep in the results but people still see you"
            count={backOfResults.queries.length}
            sub={backOfResults.subLine}
          />
          <Card padding="md">
            <ul className="space-y-3">
              {backOfResults.queries.map((q) => (
                <li key={q.query}>
                  <p className="text-body font-medium text-foreground">{q.query}</p>
                  <p className="text-meta text-muted-foreground tabular-nums">{q.line}</p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

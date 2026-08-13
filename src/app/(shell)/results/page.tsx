import { Suspense } from "react";

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { scheduleAutoMeasure } from "@/domains/measurement";
import { loadResultsLedgerSurface } from "./results-ledger-data";
import { buildResultsView, type ShipmentPresentation } from "./results-presentation";
import { ResultsRows } from "./results-rows-client";
import { RecomputeLedgerButton, RecordAnyPageForm } from "./proof-ledger-client";
import { ResultsTimeline } from "../changes/results-timeline";

/**
 * Results (CORE 100K) - three numbers at the top, then one line per change. Every page is compared
 * to similar pages that were not changed, and a read nobody has finished is never sold as an
 * answer. Read-only apart from recording a change and re-checking the numbers.
 */
export const dynamic = "force-dynamic";

export default async function ProofPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await (searchParams ?? Promise.resolve<Record<string, string | string[] | undefined>>({}));
  const initialPage = typeof params.page === "string" ? params.page : "";
  const tenantId = await currentTenantId();
  const { access } = await requireReadyAccount(tenantId);
  if (access.kind === "suspended") redirect("/");
  // A LEDGER I COULD NOT READ IS NOT AN EMPTY ONE. Both failure doors (the loader's own and this one) land on
  // `unavailable`, which renders as an outage with a way to retry rather than "no changes are being measured".
  const surface = await loadResultsLedgerSurface().catch(() => ({ shipments: [] as ShipmentPresentation[], computedAt: null, checkedAgo: null, unavailable: true }));
  const shipments = surface.shipments;
  const view = buildResultsView(shipments);
  const anyClosed = shipments.some((s) => s.read.windows.some((w) => w.state === "closed"));

  // Settle due rows in the background (never blocks this render).
  if (shipments.length > 0) scheduleAutoMeasure(tenantId);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
        {shipments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* The export has always worked and nothing linked it, so every number here stayed inside the screen. */}
            <a href="/results/export" className="text-[11px] font-medium text-accent-primary underline underline-offset-2">Download spreadsheet</a>
            <RecomputeLedgerButton
              disabled={!anyClosed}
              disabledReason={anyClosed ? undefined : "No read has closed yet. Google reports a few days behind."}
            />
          </div>
        ) : null}
      </div>

      {surface.unavailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800" data-results-unavailable="true">
          Your measured changes could not be read just now, so none is not the answer. Reload this
          page to read them again.
        </div>
      ) : shipments.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-5">
          <p className="mb-3 text-[13px] text-muted-foreground">
            Nothing is being measured yet. Record a change to check how the page does over the next
            7, 14 and 28 days against similar pages.
          </p>
          <RecordAnyPageForm initialPage={initialPage} />
        </div>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap items-start gap-x-10 gap-y-4">
            <div>
              <div className={`tabular-nums font-semibold tracking-tight ${view.header.worked.isCount ? "text-4xl" : "text-xl"}`}>
                {view.header.worked.value}
              </div>
              <div className="mt-0.5 text-[13px] text-foreground/80">wins banked</div>
              <div className="text-[11px] text-muted-foreground">{view.header.worked.sub}</div>
            </div>
            <div>
              <div className={`font-semibold tracking-tight tabular-nums ${view.header.clicks.positive ? "text-4xl text-emerald-700" : "text-xl text-muted-foreground"}`}>
                {view.header.clicks.value}
              </div>
              <div className="mt-0.5 text-[13px] text-foreground/80">clicks, wins minus losses</div>
              <div className="text-[11px] text-muted-foreground">{view.header.clicks.note ?? ""}</div>
            </div>
            <div>
              <div className={`font-semibold tracking-tight tabular-nums ${view.header.appearances.positive ? "text-4xl text-emerald-700" : "text-xl text-muted-foreground"}`}>
                {view.header.appearances.value}
              </div>
              <div className="mt-0.5 text-[13px] text-foreground/80">appearances in Google, wins minus losses</div>
              <div className="text-[11px] text-muted-foreground">{view.header.appearances.note ?? ""}</div>
            </div>
            <div>
              <div className={`font-semibold tracking-tight tabular-nums ${view.header.reading.isCount ? "text-4xl text-foreground/70" : "text-xl text-muted-foreground"}`}>{view.header.reading.value}</div>
              <div className="mt-0.5 text-[13px] text-foreground/80">still reading</div>
              <div className="text-[11px] text-muted-foreground">{view.header.reading.sub}</div>
            </div>
          </div>
          <p className="mb-5 mt-3 text-[12px] text-muted-foreground">
            {view.header.window} Every number here is an estimated lift: each page is compared to similar pages that were not changed.{surface.checkedAgo ? ` Checked ${surface.checkedAgo}.` : ""}
          </p>

          <ResultsRows view={view} />
        </>
      )}

      {shipments.length > 0 ? (
        <details className="my-6 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">
            Record a change Beacon did not track
          </summary>
          <div className="mt-3">
            <RecordAnyPageForm initialPage={initialPage} />
          </div>
        </details>
      ) : null}

      <details className="mb-4">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">
          Every change, listed
        </summary>
        <Suspense fallback={null}>
          <ResultsTimeline />
        </Suspense>
      </details>

      <p className="text-[12px] text-muted-foreground">
        How often AI assistants name you is on{" "}
        <Link href="/visibility" className="font-medium text-accent-primary underline underline-offset-2">Visibility</Link>.
      </p>
    </div>
  );
}

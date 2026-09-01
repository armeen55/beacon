import Link from "next/link";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { scheduleAutoMeasure } from "@/domains/measurement";
import { loadResultsLedgerSurface } from "./results-ledger-data";
import { buildResultsBrain } from "./results-brain";
import { ResultsBrain } from "./results-brain-client";
import { buildResultsView, type ShipmentPresentation } from "./results-presentation";
import { ResultsRows } from "./results-rows-client";
import { RecomputeLedgerButton, RecordAnyPageForm } from "./proof-ledger-client";
import { monthDayLabel } from "@/components/data/receipt-line";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { readCustomerSurface } from "../surface-release";

/**
 * Results - THE ARGUMENT, THEN THE MEMORY. The page opens on what Beacon believes about each kind of work, how sure it may be,
 * the evidence behind the selected thought and what it is waiting to read; every change ever marked done stays beneath it as
 * "All changes". ONE READ: the saved surface holds every fact the belief is computed from, so the belief paints from saved
 * truth and never waits on a live ledger read. Read-only apart from recording a change and re-checking the numbers.
 */
export const dynamic = "force-dynamic";

export default async function ProofPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await (searchParams ?? Promise.resolve<Record<string, string | string[] | undefined>>({}));
  const initialPage = typeof params.page === "string" ? params.page : "";
  const tenantId = await currentTenantId();
  const { access } = await requireReadyAccount(tenantId);
  if (access.kind === "suspended") redirect("/");
  // A LEDGER I COULD NOT READ IS NOT AN EMPTY ONE: both failure doors land on `unavailable`, rendered as an outage with a retry.
  const surface = await loadResultsLedgerSurface().catch(() => ({ shipments: [] as ShipmentPresentation[], computedAt: null, checkedAgo: null, unavailable: true }));
  const shipments = surface.shipments, now = new Date();
  // THE ONE THING TO DO COMES FROM THE SAVED RELEASE, never a live queue join: the finished-change count Changes itself serves, read once with a short deadline, null when unavailable.
  const release = await loadWithDeadline(readCustomerSurface(tenantId), 1_500).catch(() => null);
  const brain = buildResultsBrain(shipments, now, { ready: release?.data?.changes.summary.ready ?? null }), view = buildResultsView(shipments, now);
  const firstLive = monthDayLabel(shipments.map((p) => p.implementedAt).filter((d): d is string => !!d).sort()[0] ?? null);
  const anyClosed = shipments.some((s) => s.read.windows.some((w) => w.state === "closed"));
  if (shipments.length > 0) scheduleAutoMeasure(tenantId); // settles due rows in the background, never on this render
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
        {shipments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <a href="/results/export" className="text-[11px] font-medium text-accent-primary underline underline-offset-2">Download spreadsheet</a>
            <RecomputeLedgerButton disabled={!anyClosed} disabledReason={anyClosed ? undefined : "No read has closed yet. Google reports a few days behind."} />
          </div>
        ) : null}
      </div>

      {surface.unavailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800" data-results-unavailable="true">
          Your measured changes could not be read just now, so none is not the answer. Reload this page to read them again.
        </div>
      ) : shipments.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-5">
          <p className="mb-3 text-[13px] text-muted-foreground">Nothing is being measured yet. Record a change to check how the page does over the next 7, 14 and 28 days against similar pages.</p>
          <RecordAnyPageForm initialPage={initialPage} />
        </div>
      ) : (
        <>
          <ResultsBrain model={brain} checkedAgo={surface.checkedAgo ?? null} />
          {/* THE MEMORY, SECOND. Every change marked done, in its own words, with the same filters and rows as before; nobody needs it to understand the belief above. */}
          <details className="mt-8 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5" data-results-all-changes="true">
            <summary className="cursor-pointer text-[13px] font-medium text-foreground">All changes ({shipments.length})</summary>
            <p className="mb-2 mt-1 text-[12px] text-muted-foreground">Google numbers are estimated lifts against pages that were not changed; a change judged on AI answers is compared against this account&apos;s own unaffected questions. Historical rows were marked done before live checks began{firstLive ? ` on ${firstLive}` : ""} and are context only.</p>
            <ResultsRows view={view} />
          </details>
        </>
      )}

      {shipments.length > 0 ? (
        <details className="my-6 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Record a change Beacon did not track</summary>
          <div className="mt-3"><RecordAnyPageForm initialPage={initialPage} /></div>
        </details>
      ) : null}
      <p className="text-[12px] text-muted-foreground">How often AI assistants name you is on <Link href="/visibility" className="font-medium text-accent-primary underline underline-offset-2">Visibility</Link>.</p>
    </div>
  );
}

import { Suspense } from "react";

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { scheduleAutoMeasure } from "@/domains/measurement";
import { bundleReads, splitReads, type BundleRead } from "@/domains/measurement";
import { loadResultsLedgerSurface } from "./results-ledger-data";
import { ResultCard } from "./results-ledger-card";
import type { ShipmentPresentation } from "./results-presentation";
import { RecomputeLedgerButton, RecordAnyPageForm } from "./proof-ledger-client";
import { ResultsTimeline } from "../changes/results-timeline";

/**
 * Results (CORE 100K) - every change I made and whether it helped. Each change is
 * compared to how the page did before and to similar pages I did not change. I
 * never claim clean causality from this observational data. Read-only.
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
  const surface = await loadResultsLedgerSurface().catch(() => ({ shipments: [] as ShipmentPresentation[], computedAt: null, checkedAgoLine: null, unavailable: true }));
  const shipments = surface.shipments;
  const reads = shipments.map((s) => s.read);
  const checkedAgo = surface.checkedAgoLine ?? null;

  // Settle due rows in the background (never blocks this render).
  if (reads.length > 0) scheduleAutoMeasure(tenantId);

  // The kernel's bandOf owns maturity now: "won" is 28-day evidence only and
  // "promising" is the earlier improvement band, on every surface at once.
  const bands = splitReads(shipments);
  const bundles = bundleReads(reads);
  // A win read on the 56 day follow up did NOT settle at 28 days, so the band cannot promise
  // every row in it was called across the full 28 and no further.
  const winsBlurb = bands.won.some((s) => s.read.basisDay === 56)
    ? "These changes beat their comparison pages over their full window: 28 days, or the 56 day follow up where one was owed. Real, measured gains."
    : "These changes beat their comparison pages across the full 28 days. Real, measured gains.";
  const anyClosed = reads.some((r) => r.windows.some((w) => w.state === "closed"));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Every change you have made and whether it helped. I compare each page to how it did
            before, and to similar pages you did not change. These are honest directional reads, not
            proof of cause.
          </p>
          {reads.length > 0 && checkedAgo ? (
            <p className="mt-1 text-[11px] text-muted-foreground/80 tabular-nums">{checkedAgo}</p>
          ) : null}
        </div>
        {reads.length > 0 ? (
          <RecomputeLedgerButton
            disabled={!anyClosed}
            disabledReason={anyClosed ? undefined : "No check window has closed yet. Google reports a few days behind."}
          />
        ) : null}
      </div>

      {/* Phase 7: the AI trend lives on Visibility now, with its engine, question and citation drill-downs. */}
      <p className="mb-5 text-[13px] text-muted-foreground">How often AI assistants name you, question by question and assistant
        by assistant, is on <Link href="/visibility" className="font-medium text-accent-primary underline underline-offset-2">Visibility</Link>.</p>

      {surface.unavailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-[13px] text-amber-800" data-results-unavailable="true">
          I could not read your measured changes just now, so I am not telling you there are none. Reload this
          page and I will read them again.
        </div>
      ) : reads.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-6 text-[13px] text-muted-foreground">
          No changes are being measured yet. Record a change below and I will check how it does over
          the next 7, 14, and 28 days against similar pages.
        </div>
      ) : (
        <>
          {bundles.length > 0 ? <BundleCallouts bundles={bundles} /> : null}
          <Band title="Wins" tone="text-emerald-700" shipments={bands.won} blurb={winsBlurb} />
          <Band title="Promising" tone="text-emerald-600" shipments={bands.promising} blurb="These are moving up, but their 28 day window has not closed yet. I will call them when it does." />
          <Band title="What I learned" tone="text-foreground/70" shipments={bands.learned} blurb="These settled without a clear gain. That tells us which lever to try next on pages like these." />
          <Band title="Still measuring" tone="text-muted-foreground" shipments={bands.measuring} blurb="Still collecting data or waiting on Google. Nothing to do here until a read lands." />
        </>
      )}

      <details className="my-6 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
        <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">
          Record a change I did not track
        </summary>
        <div className="mt-3">
          <RecordAnyPageForm initialPage={initialPage} />
        </div>
      </details>

      <details className="mb-6">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">
          See the raw change log
        </summary>
        <Suspense fallback={null}>
          <ResultsTimeline />
        </Suspense>
      </details>
    </div>
  );
}

function Band({ title, tone, shipments, blurb }: { title: string; tone: string; shipments: ShipmentPresentation[]; blurb: string }) {
  if (shipments.length === 0) return null;
  return (
    <div className="mt-5">
      <h2 className={`text-[12px] font-semibold uppercase tracking-wide ${tone}`}>
        {title} ({shipments.length})
      </h2>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">{blurb}</p>
      <div className="space-y-2">
        {shipments.map((s) => (
          <ResultCard key={s.read.id} shipment={s} />
        ))}
      </div>
    </div>
  );
}

function BundleCallouts({ bundles }: { bundles: BundleRead[] }) {
  return (
    <div className="mb-4 space-y-2">
      {bundles.map((b) => (
        // One page can carry two separate stretches of work, so the cluster's own members name the row, never the path alone.
        <div key={b.changeIds.join("|")} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <span className="font-semibold">{b.path}:</span> {b.headline}
        </div>
      ))}
    </div>
  );
}

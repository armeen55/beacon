import { Suspense } from "react";

import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { scheduleAutoMeasure } from "@/domains/measurement";
import { bundleReads, splitReads, type BundleRead, type KernelRead } from "@/domains/measurement";
import { ledgerCheckedAgoLine, loadResultsLedgerSurface } from "./results-ledger-data";
import { ResultCard } from "./results-ledger-card";
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
  const surface = await loadResultsLedgerSurface().catch(() => ({ reads: [] as KernelRead[], computedAt: null }));
  const reads = surface.reads;
  const checkedAgo = ledgerCheckedAgoLine(surface.computedAt, Date.now());

  // Settle due rows in the background (never blocks this render).
  if (reads.length > 0) scheduleAutoMeasure(tenantId);

  const bands = splitReads(reads.map((read) => ({ read })));
  // The kernel's bandOf owns maturity now: "won" is 28-day evidence only and
  // "promising" is the earlier improvement band, on every surface at once.
  const won = bands.won.map((b) => b.read);
  const promising = bands.promising.map((b) => b.read);
  const learned = bands.learned.map((b) => b.read);
  const measuring = bands.measuring.map((b) => b.read);
  const bundles = bundleReads(reads);
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

      {reads.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-6 text-[13px] text-muted-foreground">
          No changes are being measured yet. Record a change below and I will check how it does over
          the next 7, 14, and 28 days against similar pages.
        </div>
      ) : (
        <>
          {bundles.length > 0 ? <BundleCallouts bundles={bundles} /> : null}
          <Band title="Wins" tone="text-emerald-700" reads={won} blurb="These changes beat their comparison pages across the full 28 days. Real, measured gains." />
          <Band title="Promising" tone="text-emerald-600" reads={promising} blurb="These are moving up, but their 28 day window has not closed yet. I will call them when it does." />
          <Band title="What I learned" tone="text-foreground/70" reads={learned} blurb="These settled without a clear gain. That tells us which lever to try next on pages like these." />
          <Band title="Still measuring" tone="text-muted-foreground" reads={measuring} blurb="Still collecting data or waiting on Google. Nothing to do here until a read lands." />
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

function Band({ title, tone, reads, blurb }: { title: string; tone: string; reads: KernelRead[]; blurb: string }) {
  if (reads.length === 0) return null;
  return (
    <div className="mt-5">
      <h2 className={`text-[12px] font-semibold uppercase tracking-wide ${tone}`}>
        {title} ({reads.length})
      </h2>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">{blurb}</p>
      <div className="space-y-2">
        {reads.map((read) => (
          <ResultCard key={read.id} read={read} />
        ))}
      </div>
    </div>
  );
}

function BundleCallouts({ bundles }: { bundles: BundleRead[] }) {
  return (
    <div className="mb-4 space-y-2">
      {bundles.map((b) => (
        <div key={b.path} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <span className="font-semibold">{b.path}:</span> {b.headline}
        </div>
      ))}
    </div>
  );
}

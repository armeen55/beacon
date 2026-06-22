import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

/**
 * Operator-only GSC Proof ledger surface for /changes (Phase 5, Path B). Read-only.
 * Surfaces the newest still-measuring change as a full "active experiment" card
 * (what changed, when it ships a verdict, the baseline it's measured against), plus
 * a compact roll-up of every tracked change. Links to the full ledger on /proof.
 * Renders null for customers / empty ledger so the customer timeline is untouched.
 * Mounted in a Suspense boundary.
 */
export async function ProofLedgerStrip() {
  if (!isOperatorModeServer()) return null;
  let ledger;
  try {
    const tenantId = await currentTenantId();
    ledger = await loadProofLedger(tenantId);
  } catch {
    return null;
  }
  if (!ledger || ledger.length === 0) return null;

  const measuring = ledger.filter((l) => l.verdict === "measuring").length;
  const won = ledger.filter((l) => l.verdict === "won").length;
  const lost = ledger.filter((l) => l.verdict === "lost").length;
  const inconclusive = ledger.filter((l) => l.verdict === "inconclusive").length;

  // Primary active item: the newest change still measuring (else the newest).
  // Ledger is already sorted newest-ship-first.
  const active = ledger.find((l) => l.verdict === "measuring") ?? ledger[0];

  // Every OTHER tracked change gets a compact row, so "7 shipped & tracked"
  // actually SHOWS 7 (operator confusion 2026-06-22: only the single active
  // card was rendered, so the page read as "one change" despite the count).
  const rest = active ? ledger.filter((l) => l.id !== active.id) : [];

  return (
    <div className="mb-4 space-y-2.5">
      {active ? <ActiveExperimentCard rec={active} /> : null}

      {rest.length > 0 ? (
        <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-surface-inset/20">
          {rest.map((rec) => (
            <CompactExperimentRow key={rec.id} rec={rec} />
          ))}
        </div>
      ) : null}

      <Link
        href="/proof"
        prefetch={false}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-2.5 text-[12px] hover:border-border"
      >
        <span className="font-semibold text-foreground">Proof ledger</span>
        <span className="text-muted-foreground">{ledger.length} shipped &amp; tracked</span>
        {measuring > 0 ? <span className="text-blue-700">{measuring} measuring</span> : null}
        {won > 0 ? <span className="text-emerald-700">{won} won</span> : null}
        {lost > 0 ? <span className="text-rose-700">{lost} lost</span> : null}
        {inconclusive > 0 ? (
          <span className="text-muted-foreground">{inconclusive} inconclusive</span>
        ) : null}
        <span className="ml-auto text-accent-primary">Open Proof →</span>
      </Link>
    </div>
  );
}

/** One-line summary of a tracked change beyond the highlighted active card. */
function CompactExperimentRow({ rec }: { rec: ShippedChangeRecord }) {
  const nextCheck = rec.windows.filter((w) => !w.ran).map((w) => w.checkOn).sort()[0] ?? null;
  const verdictColor =
    rec.verdict === "won"
      ? "text-emerald-700"
      : rec.verdict === "lost"
        ? "text-rose-700"
        : rec.verdict === "measuring"
          ? "text-blue-700"
          : "text-muted-foreground";
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
      <span className={`text-[10px] font-medium uppercase tracking-wide ${verdictColor}`}>
        {rec.verdict.replace(/_/g, " ")}
      </span>
      <span className="font-medium text-foreground">{rec.path}</span>
      <span className="text-[11px] text-muted-foreground">
        {rec.actionType.replace(/_/g, " ")} · shipped {rec.shippedAt.slice(0, 10)}
      </span>
      {rec.verifiedLive ? (
        <span className="text-[10px] font-medium text-emerald-700">✓ live</span>
      ) : null}
      {rec.verdict === "measuring" && nextCheck ? (
        <span className="ml-auto text-[11px] text-muted-foreground">verdict {nextCheck}</span>
      ) : null}
    </div>
  );
}

function ActiveExperimentCard({ rec }: { rec: ShippedChangeRecord }) {
  const nextCheck = rec.windows.filter((w) => !w.ran).map((w) => w.checkOn).sort()[0] ?? null;
  // Controls actually used in the latest run window; falls back to the assigned
  // count while still measuring (no window has run yet).
  const basis = rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const controlsCount = basis?.controlsUsed ?? rec.controlPages.length;
  const baseline = rec.baseline ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 };
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-700">
          {rec.verdict.replace(/_/g, " ")}
        </span>
        <span className="text-[14px] font-semibold text-foreground">{rec.path}</span>
        <span className="text-[11px] text-muted-foreground">
          {rec.actionType.replace(/_/g, " ")} · shipped {rec.shippedAt.slice(0, 10)}
        </span>
        {rec.verifiedLive ? (
          <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            ✓ verified live
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-[12px] text-foreground/80">
        {`Measuring this change against ${controlsCount} comparable untreated page${controlsCount === 1 ? "" : "s"}.`}{" "}
        {nextCheck ? (
          <>
            First verdict opens <span className="font-medium">{nextCheck}</span>.
          </>
        ) : (
          <>All check-in windows have closed.</>
        )}
      </p>

      {rec.after ? (
        <p className="mt-2 text-[11px] text-foreground/85">
          <span className="font-medium text-foreground/70">New copy:</span> {rec.after}
        </p>
      ) : null}

      {rec.targetQueries.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Target queries
          </span>
          {rec.targetQueries.slice(0, 6).map((q) => (
            <span
              key={q}
              className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] text-foreground/70"
            >
              {q}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Baseline (28d before):{" "}
        {baseline.impressions > 0
          ? `${baseline.clicks.toLocaleString()} clicks · ${baseline.impressions.toLocaleString()} impressions · ${(baseline.ctr * 100).toFixed(2)}% CTR · pos ${baseline.position.toFixed(1)}`
          : "no Search data in the baseline window yet"}
      </p>

      <Link
        href="/proof"
        prefetch={false}
        className="mt-2.5 inline-block text-[11px] font-medium text-accent-primary hover:underline"
      >
        See the windows and roll it back on Proof →
      </Link>
    </div>
  );
}

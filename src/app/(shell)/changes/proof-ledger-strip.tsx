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

  return (
    <div className="mb-4 space-y-2.5">
      {active ? <ActiveExperimentCard rec={active} /> : null}

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

function ActiveExperimentCard({ rec }: { rec: ShippedChangeRecord }) {
  const nextCheck = rec.windows.filter((w) => !w.ran).map((w) => w.checkOn).sort()[0] ?? null;
  const controlsCount = rec.controlPages.length;
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
        Measuring this change against {controlsCount} comparable untreated page
        {controlsCount === 1 ? "" : "s"}.{" "}
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
        Baseline (28d before): {rec.baseline.clicks.toLocaleString()} clicks ·{" "}
        {rec.baseline.impressions.toLocaleString()} impressions ·{" "}
        {(rec.baseline.ctr * 100).toFixed(2)}% CTR · pos {rec.baseline.position.toFixed(1)}
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

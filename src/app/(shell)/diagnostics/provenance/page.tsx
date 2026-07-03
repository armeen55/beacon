import "server-only";

/**
 * /diagnostics/provenance (BEACON_500 R13 / N3, 2026-07-03) - operator-only
 * window into the claim-level provenance graph: every factual claim Beacon
 * has mined from the stored pages (numbers, dates, is-a definitions), each
 * linked to its sources, dates, reliability, and affected pages.
 *
 * Read-only: reads the nightly-persisted "claim-graph" store rows for the
 * current tenant ($0, no scan, no paid call). Shows the counts by status and
 * the conflicting list - the same conflicts the claim_conflict trigger feeds
 * the pipeline (capped there at 3; uncapped here so the operator sees the
 * whole backlog). Operator-gated; no writes.
 */

import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadClaimGraphForTenant } from "@/domains/provenance/claim-graph-loader";
import {
  findClaimConflicts,
  bestSourceOf,
  formatClaimSourceLine,
  type ClaimRecord,
} from "@/domains/provenance/claim-graph";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ClaimRecord["status"], string> = {
  consistent: "Consistent",
  conflicting: "Conflicting",
  unverified: "Unverified",
};

const STATUS_CLASS: Record<ClaimRecord["status"], string> = {
  consistent: "text-status-success",
  conflicting: "text-status-danger",
  unverified: "text-muted-foreground",
};

const VOLATILITY_LABEL: Record<ClaimRecord["volatilityClass"], string> = {
  fast: "changes fast (dates, years)",
  slow: "changes slowly (counts, figures)",
  static: "stays put (definitions)",
};

export default async function ProvenanceDiagnosticsPage() {
  // OPERATOR GATE - must precede every data read.
  if (!(await isOperatorModeServer())) return notFound();

  const tenantId = await currentTenantId();
  const records = await loadClaimGraphForTenant(tenantId);
  const conflicts = findClaimConflicts(records);
  const nowIso = new Date().toISOString();

  const byStatus: Record<ClaimRecord["status"], number> = { consistent: 0, conflicting: 0, unverified: 0 };
  const byVolatility: Record<ClaimRecord["volatilityClass"], number> = { fast: 0, slow: 0, static: 0 };
  for (const r of records) {
    byStatus[r.status]++;
    byVolatility[r.volatilityClass]++;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Fact provenance</h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          Every factual claim I found on your pages, linked to its source, date, and reliability. I rebuild
          this nightly from your stored page text, competitor reads, and the changes you shipped.
        </p>
      </div>

      {records.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No claims tracked yet. The graph fills in after the next nightly sync reads your stored pages.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-2xl font-semibold tabular-nums text-foreground">{records.length}</div>
              <div className="text-sm text-muted-foreground">claims tracked</div>
            </div>
            {(Object.keys(byStatus) as ClaimRecord["status"][]).map((status) => (
              <div key={status} className="rounded-xl border border-border bg-card p-4">
                <div className={`text-2xl font-semibold tabular-nums ${STATUS_CLASS[status]}`}>{byStatus[status]}</div>
                <div className="text-sm text-muted-foreground">{STATUS_LABEL[status].toLowerCase()}</div>
              </div>
            ))}
          </div>

          <div className="text-sm text-muted-foreground">
            {(Object.keys(byVolatility) as ClaimRecord["volatilityClass"][])
              .filter((v) => byVolatility[v] > 0)
              .map((v) => `${byVolatility[v]} ${VOLATILITY_LABEL[v]}`)
              .join(" · ")}
          </div>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              Pages that disagree {conflicts.length > 0 ? `(${conflicts.length})` : ""}
            </h2>
            {conflicts.length === 0 ? (
              <p className="mt-2 text-sm text-foreground-secondary">
                No conflicts right now. Your pages agree with each other on every claim I track.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {conflicts.map((c) => (
                  <li key={c.subjectKey} className="rounded-xl border border-status-danger/20 bg-status-danger-bg/30 p-3 text-sm">
                    <span className="font-medium text-foreground">
                      Two of your pages disagree about {c.subjectLabel}
                    </span>
                    <span className="text-foreground-secondary">
                      {" "}({c.a.value} on {c.a.pagePath}, {c.b.value} on {c.b.pagePath}). Pick one and I will keep
                      them consistent.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">Sample of tracked claims</h2>
            <ul className="mt-2 space-y-1.5">
              {records.slice(0, 25).map((r) => {
                const best = bestSourceOf(r);
                return (
                  <li key={r.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <span className={`mr-2 font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    <span className="text-foreground">{r.claimText}</span>
                    {best ? (
                      <span className="text-muted-foreground"> {formatClaimSourceLine(best, nowIso)}</span>
                    ) : null}
                    {r.affectedPages.length > 1 ? (
                      <span className="text-muted-foreground"> Appears on {r.affectedPages.length} pages.</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {records.length > 25 ? (
              <p className="mt-2 text-sm text-muted-foreground">Showing the first 25 of {records.length} claims.</p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * /diagnostics/errors (BEACON_500 R7 / N39, 2026-07-03) - the operator's view
 * of the production error spine (src/lib/obs/error-ledger.ts). Every wired
 * catch point (nightly sync phases, background surface refreshes, staging and
 * publish actions, the AI draft gateway) records here instead of vanishing
 * into rotated function logs.
 *
 * Operator-only: the /diagnostics layout 404s non-operators once for every
 * route under it. Shows the most recent 50 recorded failures for this site,
 * grouped by where + what, with counts and the most recent time.
 */

import { PageHeader } from "@/components/data/page-header";
import { currentTenantId } from "@/lib/tenant-context";
import { listAppErrorsForTenant, groupAppErrors } from "@/lib/obs/error-ledger";
import { fmtPacific } from "@/domains/ops/deadman";
import { serverNowMs } from "@/lib/server-clock";

export const dynamic = "force-dynamic";

export default async function ErrorsDiagnosticsPage() {
  const tenantId = await currentTenantId();
  const rows = await listAppErrorsForTenant(tenantId);
  const recent = rows.slice(0, 50);
  const groups = groupAppErrors(recent);
  const nowMs = serverNowMs();
  const last24h = rows.filter((r) => {
    const t = Date.parse(r.at);
    return Number.isFinite(t) && nowMs - t <= 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Recent failures"
        description="When something I run in the background fails, I record it here instead of losing it. I keep the most recent 200 failures for this site and show the last 50, grouped by where they happened."
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Recorded failures
            </div>
            <div className="text-base font-bold tabular-nums">{rows.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              In the last 24 hours
            </div>
            <div className="text-base font-bold tabular-nums">{last24h}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Distinct problems (last 50)
            </div>
            <div className="text-base font-bold tabular-nums">{groups.length}</div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has failed recently. When something breaks in the background, it
          shows up here with what happened, where, and when.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div
              key={`${g.route} ${g.message}`}
              className="rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {g.route}
                  <span className="text-muted-foreground/60"> during </span>
                  {g.action}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {g.count === 1 ? "once" : `${g.count} times`}, last {fmtPacific(g.lastAt)}
                </span>
              </div>
              <p className="mt-1 min-w-0 break-words text-[13px] leading-relaxed text-foreground">
                {g.message || "(no error message)"}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        These are failures I already worked around, so nothing on your site broke
        because of them. When one keeps repeating, the fix usually starts on the
        Connections page in Settings.
      </p>
    </div>
  );
}

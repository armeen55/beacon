import { listProofPlan } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Page Surgeon — PROOF PLAN (operator-only, PS6). NOT A/B testing. For every
 * REVIEWED change (approve / needs_edit) this lays out exactly how it will be
 * proven: the measurement window (7 / 14 / 28-day check-ins from the decision),
 * the GSC metrics that will be re-checked with today's baseline, and the control
 * pages chosen for a diff-in-diff. No cron, no writes — the loop the operator (or
 * a later runner) executes to prove a shipped edit actually moved the number.
 */
export default async function PageSurgeonProof() {
  const { rows } = await listProofPlan();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold tracking-tight">Page Surgeon — proof plan</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Every change you approved or flagged for edit, with the plan to prove it
        worked: when to re-check (7 / 14 / 28 days), which Google Search metrics to
        compare against today&apos;s baseline, and the comparable untreated pages
        used as controls. Nothing here publishes or runs on a schedule.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-[13px] text-muted-foreground">
          No reviewed changes yet. Approve a draft on{" "}
          <span className="font-mono">/diagnostics/page-surgeon/review</span> and it
          will appear here with its measurement plan.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((r) => {
            const path = r.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
            return (
              <li key={r.pageUrl} className="rounded-lg border border-border/60 bg-surface-inset/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{path}</span>
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${r.verdict === "approve" ? "bg-status-success/15 text-status-success" : "bg-amber-500/15 text-amber-600"}`}>
                    {r.verdict === "approve" ? "Approved" : "Needs edit"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{r.headlineAction}</span>
                </div>

                <p className="mt-2 text-[11px] text-muted-foreground">
                  Decided {new Date(r.decidedAt).toLocaleDateString()} · check-ins:{" "}
                  <span className="text-foreground/80">{r.windows.checkIn7}</span> ·{" "}
                  <span className="text-foreground/80">{r.windows.checkIn14}</span> ·{" "}
                  <span className="text-foreground/80">{r.windows.checkIn28}</span>
                </p>

                {r.metricsToCheck.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[11px] font-medium text-foreground/80">Metrics to re-check (baseline today):</p>
                    <ul className="ml-4 mt-0.5 list-disc text-[11px] text-muted-foreground">
                      {r.metricsToCheck.map((m, i) => (
                        <li key={i}>{m.label}: <span className="text-foreground/80">{m.baseline}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                {r.controlPaths.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Controls (diff-in-diff): {r.controlPaths.join(", ")}
                  </p>
                )}
                {r.measurementPlan && (
                  <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-medium text-foreground/80">Plan:</span> {r.measurementPlan}</p>
                )}
                {r.note && (
                  <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-medium text-foreground/80">Note:</span> {r.note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

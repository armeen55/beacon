import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofPlan } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import type { ReviewVerdict } from "@/domains/recommendation-intelligence/page-surgeon/review-store";

/**
 * Proof / Learning — operator-OS rebuild, surface (6). Every REVIEWED change
 * with its 7/14/28-day measurement windows, the GSC metrics to re-check (with
 * today's baseline), and the control pages for a diff-in-diff. Read-only; this
 * promotes loadProofPlan out of /diagnostics into the product nav.
 */
export const dynamic = "force-dynamic";

const VERDICT_STYLE: Record<ReviewVerdict, string> = {
  approve: "border-emerald-300 bg-emerald-50 text-emerald-700",
  needs_edit: "border-amber-300 bg-amber-50 text-amber-700",
  reject: "border-border bg-muted/40 text-muted-foreground",
};

function toPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

export default async function ProofPage() {
  if (!isOperatorModeServer()) notFound();
  const tenantId = await currentTenantId();
  const rows = await loadProofPlan(tenantId).catch(() => []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Proof &amp; Learning</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Every reviewed change and how we&apos;ll know if it worked — measured
          against today&apos;s baseline and comparable untreated pages.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No reviewed changes to measure yet. Approve a Change Pack in the
          Workbench and ship it — its 7/14/28-day proof windows appear here.
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div
              key={r.pageUrl}
              className="rounded-lg border border-border/60 bg-background p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-foreground">
                  {toPath(r.pageUrl)}
                </span>
                <span
                  className={
                    "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                    VERDICT_STYLE[r.verdict]
                  }
                >
                  {r.verdict.replace("_", " ")}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {r.headlineAction.replace(/_/g, " ")}
                </span>
              </div>

              {/* Measurement windows */}
              <div className="mt-2 flex flex-wrap gap-4 text-[12px]">
                {(
                  [
                    ["7-day", r.windows.checkIn7],
                    ["14-day", r.windows.checkIn14],
                    ["28-day", r.windows.checkIn28],
                  ] as const
                ).map(([label, date]) => (
                  <span key={label} className="text-muted-foreground">
                    <span className="font-medium text-foreground/80">{label}:</span>{" "}
                    {date}
                  </span>
                ))}
              </div>

              {/* Baseline metrics to re-check */}
              {r.metricsToCheck.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {r.metricsToCheck.map((m, i) => (
                    <li key={i} className="text-[12px] text-muted-foreground">
                      <span className="text-foreground/80">{m.label}</span> — baseline{" "}
                      <span className="tabular-nums">{m.baseline}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {r.controlPaths.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  Controls (diff-in-diff): {r.controlPaths.length} comparable
                  untreated page{r.controlPaths.length === 1 ? "" : "s"}.
                </p>
              ) : null}

              {r.note ? (
                <p className="mt-2 text-[12px] text-foreground/80">{r.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

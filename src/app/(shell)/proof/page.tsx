import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofPlan } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import type { ReviewVerdict } from "@/domains/recommendation-intelligence/page-surgeon/review-store";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import {
  proofOutcomeSentence,
  type GscProofVerdict,
} from "@/domains/proof-gsc/measure";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  RecordShippedButton,
  RecomputeLedgerButton,
  RecordAnyPageForm,
} from "./proof-ledger-client";

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

const OUTCOME_STYLE: Record<GscProofVerdict, string> = {
  won: "border-emerald-300 bg-emerald-50 text-emerald-700",
  lost: "border-rose-300 bg-rose-50 text-rose-700",
  inconclusive: "border-border bg-muted/40 text-muted-foreground",
  measuring: "border-blue-300 bg-blue-50 text-blue-700",
  insufficient_data: "border-border bg-muted/40 text-muted-foreground",
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
  const [rows, ledger] = await Promise.all([
    loadProofPlan(tenantId).catch(() => []),
    loadProofLedger(tenantId).catch(() => [] as ShippedChangeRecord[]),
  ]);
  const recordedPaths = new Set(ledger.map((l) => l.path));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proof &amp; Learning</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Every reviewed change and how we&apos;ll know if it worked, measured
            against the before/after baseline and comparable untreated pages.
          </p>
        </div>
        {ledger.length > 0 ? <RecomputeLedgerButton /> : null}
      </div>

      {/* Record a shipped change for ANY page (manual-ship companion). */}
      <div className="mb-6">
        <RecordAnyPageForm />
      </div>

      {/* ── Measured outcomes (shipped changes being tracked vs controls) ── */}
      {ledger.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Measured outcomes
          </h2>
          <div className="space-y-2.5">
            {ledger.map((rec) => (
              <LedgerCard key={rec.id} rec={rec} />
            ))}
          </div>
        </div>
      ) : null}

      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        Approved &amp; ready to ship
      </h2>

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

              {/* Manual ship → start measuring. Works even with manual Wix. */}
              <div className="mt-3 border-t border-border/40 pt-2.5">
                <RecordShippedButton
                  pageUrl={r.pageUrl}
                  alreadyRecorded={recordedPaths.has(toPath(r.pageUrl))}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerCard({ rec }: { rec: ShippedChangeRecord }) {
  const sentence = proofOutcomeSentence({
    verdict: rec.verdict,
    confidence: rec.confidence,
    basis: rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null,
  });
  return (
    <div className="rounded-lg border border-border/60 bg-background p-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-foreground">{rec.path}</span>
        <span
          className={
            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
            OUTCOME_STYLE[rec.verdict]
          }
        >
          {rec.verdict.replace(/_/g, " ")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {rec.actionType.replace(/_/g, " ")} · shipped {rec.shippedAt.slice(0, 10)}
        </span>
      </div>

      <p className="mt-1.5 text-[12px] text-foreground/80">{sentence}</p>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Baseline (28d before): {rec.baseline.clicks.toLocaleString()} clicks ·{" "}
        {rec.baseline.impressions.toLocaleString()} impressions ·{" "}
        {(rec.baseline.ctr * 100).toFixed(2)}% CTR · pos {rec.baseline.position.toFixed(1)}
      </p>

      {/* Per-window diff-in-diff vs controls. */}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {rec.windows.map((w) => (
          <span
            key={w.day}
            className={w.ran ? "text-foreground/80" : "text-muted-foreground/60"}
          >
            <span className="font-medium">{w.day}d</span>{" "}
            {w.ran ? (
              <>
                lift {w.adjustedLift >= 0 ? "+" : ""}
                {w.adjustedLift} clicks ({w.controlsUsed} controls)
              </>
            ) : (
              <>opens {w.checkOn}</>
            )}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/70">
        Observational (treated page vs comparable untreated pages) — directional, not a
        controlled experiment.
      </p>
    </div>
  );
}

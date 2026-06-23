import { Suspense } from "react";
import { notFound } from "next/navigation";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { ResultsTimeline } from "../changes/results-timeline";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofPlan } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import type { ReviewVerdict } from "@/domains/recommendation-intelligence/page-surgeon/review-store";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { computeOutcomePriorDiagnostics } from "@/domains/recommendation-intelligence/outcome-prior";
import {
  pickProofMetric,
  proofOutcomeSentence,
  formatWindowLift,
  type GscProofVerdict,
} from "@/domains/proof-gsc/measure";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  RecordShippedButton,
  RecomputeLedgerButton,
  RecordAnyPageForm,
  RollbackCopyButton,
  RecrawlButton,
  ExcludeFromLearningButton,
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

export default async function ProofPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // IA consolidation (2026-06-23): available to everyone, no operator gate.
  const params = await (searchParams ??
    Promise.resolve<Record<string, string | string[] | undefined>>({}));
  const initialPage = typeof params.page === "string" ? params.page : "";
  const tenantId = await currentTenantId();
  const [rows, ledger] = await Promise.all([
    loadProofPlan(tenantId).catch(() => []),
    loadProofLedger(tenantId).catch(() => [] as ShippedChangeRecord[]),
  ]);
  const recordedPaths = new Set(ledger.map((l) => l.path));

  // Recompute only does something once a measurement window has closed. Until
  // then, gate the button + tell the operator when the first check opens.
  const anyWindowReady = ledger.some((l) => l.windows.some((w) => w.ran));
  const earliestCheck = ledger
    .flatMap((l) => l.windows.filter((w) => !w.ran).map((w) => w.checkOn))
    .sort()[0];

  // Operator-only: which action types past results are nudging Beacon toward /
  // away from (the prior that steers ranking). Lets the operator SEE a skew and
  // use "Exclude from learning" on a mis-measured result. Only types with a
  // trusted prior or an excluded result are worth showing.
  const learningDiag = isOperatorModeServer()
    ? computeOutcomePriorDiagnostics(ledger).filter(
        (d) => d.prior !== null || d.excluded > 0,
      )
    : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Every change you have made and whether it helped. We compare each page
            to how it did before, and to similar pages you did not change.
          </p>
        </div>
        {ledger.length > 0 ? (
          <RecomputeLedgerButton
            disabled={!anyWindowReady}
            disabledReason={
              anyWindowReady
                ? undefined
                : earliestCheck
                  ? `First check opens ${earliestCheck}`
                  : undefined
            }
          />
        ) : null}
      </div>

      {/* Record a shipped change for ANY page (manual-ship companion). Prefills
          the page from a ?page= hand-off (e.g. the Workbench "Record this
          change" link) so recording doesn't mean re-typing the path. */}
      <div className="mb-6">
        <RecordAnyPageForm initialPage={initialPage} />
      </div>

      {/* ── Measured outcomes (shipped changes being tracked vs controls) ── */}
      {ledger.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Measured outcomes
          </h2>
          {/* Dollar-ROI honesty (gap #1): show what proof CAN measure. Revenue is
              only claimed if GA4 actually returns it; this property has no revenue
              events, so we say so once rather than imply dollars per card. */}
          {!ledger.some((l) => l.trafficOutcome?.hasRevenue) ? (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Each change is measured on Search (clicks, rank, click rate) and GA4 traffic
              (sessions, conversions). No revenue events are configured in GA4, so
              proof shows traffic and conversions, not dollars.
            </p>
          ) : null}
          <WhatHappensNext />
          <div className="mt-3 space-y-2.5">
            {ledger.map((rec) => (
              <LedgerCard key={rec.id} rec={rec} />
            ))}
          </div>
        </div>
      ) : null}

      {/* ── What Beacon has learned (operator-only): per-action_type prior that
          steers ranking, so a skew is visible and excludable. ── */}
      {learningDiag.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            What Beacon has learned
          </h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            How your past results nudge which fixes Beacon suggests first. If a result
            looks mis-measured, use &ldquo;Exclude from learning&rdquo; on it below.
          </p>
          <ul className="space-y-1">
            {learningDiag.map((d) => (
              <li key={d.actionType} className="text-[12px] text-foreground/80">
                <span className="font-medium">{d.actionType.replace(/_/g, " ")}</span>:{" "}
                {d.won} worked, {d.lost} did not
                {d.excluded > 0 ? `, ${d.excluded} excluded` : ""}
                {d.prior !== null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    &rarr; Beacon now{" "}
                    {d.prior > 0
                      ? `favors this (+${Math.round(d.prior * 100)}%)`
                      : d.prior < 0
                        ? `is cautious here (${Math.round(d.prior * 100)}%)`
                        : "is neutral"}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {" "}
                    &rarr; not enough results yet to change ranking
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Your changes timeline (IA consolidation 2026-06-23) ──
          The former /changes proof timeline, embedded here so Results is the
          ONE place for "what changed / is it measuring / did it work". Its own
          Suspense boundary (heavy changelog + scorecard + URL-history compute)
          so it never blocks the ledger above; header suppressed (this page's
          "Results" header already covers it). */}
      <div className="mb-6">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Your changes
        </h2>
        <Suspense fallback={null}>
          <ResultsTimeline />
        </Suspense>
      </div>

      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        Approved &amp; ready to ship
      </h2>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No reviewed changes to measure yet. Make a change in the
          Workbench and ship it. Its 7/14/28-day proof windows appear here.
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
                      <span className="text-foreground/80">{m.label}</span>, baseline{" "}
                      <span className="tabular-nums">{m.baseline}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {r.controlPaths.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  Compared against {r.controlPaths.length} similar page
                  {r.controlPaths.length === 1 ? "" : "s"} you did not change.
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

/**
 * Plain-English explainer for the operator: what measuring means, when the first
 * verdict lands, and the honest limits of an observational comparison.
 */
function WhatHappensNext() {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5">
      <div className="text-[12px] font-semibold text-foreground">What happens next</div>
      <ul className="mt-1.5 space-y-1 text-[11px] text-foreground/75">
        <li>
          • Google takes time to recrawl and re-rank. The first check opens{" "}
          <span className="font-medium">7 days</span> after you shipped, then again at 14
          and 28 days.
        </li>
        <li>
          • At each check Beacon compares this page (visits, click rate, or Google
          rank, depending on the change) to similar pages you did not change, then
          tells you whether it{" "}
          <span className="font-medium">helped</span>,{" "}
          <span className="font-medium">did not help</span>, or showed{" "}
          <span className="font-medium">no clear change</span>.
        </li>
        <li>
          • This compares your page to similar pages, so it is a strong signal, not
          a lab-perfect guarantee. Google data is naturally a bit noisy.
        </li>
      </ul>
    </div>
  );
}

function metricsLine(rec: ShippedChangeRecord): string {
  const b = rec.baseline ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 };
  // No impressions = no Search data in the baseline window; "pos 0.0" is an
  // impossible rank, so say so honestly instead of rendering zeros.
  if (b.impressions <= 0) return "No Google data yet for the period before this change.";
  return `${b.clicks.toLocaleString()} visits from Google, shown ${b.impressions.toLocaleString()} times, ${(b.ctr * 100).toFixed(2)}% click rate, ranked about #${b.position.toFixed(1)}`;
}

function LedgerCard({ rec }: { rec: ShippedChangeRecord }) {
  // Judge a meta/title test on CTR, a content test on position, else clicks, so
  // every line on this card reads in the unit that actually moved.
  const metric = pickProofMetric(rec.actionType);
  const basis = rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const sentence = proofOutcomeSentence({
    verdict: rec.verdict,
    confidence: rec.confidence,
    basis,
    metric,
  });
  // Report the controls actually used in the basis window; fall back to assigned
  // count only before any window has run (measuring state).
  const controlsCount = basis?.controlsUsed ?? rec.controlPages.length;
  return (
    <div className="rounded-lg border border-border/60 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-foreground">{rec.path}</span>
        <span
          className={
            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
            OUTCOME_STYLE[rec.verdict]
          }
        >
          {/* Calm, plain verdict words instead of a loud WON/LOST (audit #111). */}
          {(
            {
              won: "Helped",
              lost: "Did not help",
              inconclusive: "No clear change",
              measuring: "Still measuring",
              insufficient_data: "Not enough data yet",
            } as Record<string, string>
          )[rec.verdict] ?? rec.verdict.replace(/_/g, " ")}
        </span>
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
        <span className="font-medium text-foreground/60">Search:</span> {sentence}
      </p>

      {/* Dollar-ROI proof (gap #1): the GA4 traffic + conversion outcome next to
          the Search verdict. Revenue is honestly absent for this property, so the
          label never implies money (see the header note). */}
      {rec.trafficOutcome ? (
        <p className="mt-1 text-[12px] text-foreground/80">
          {rec.trafficOutcome.label}
        </p>
      ) : null}

      {/* What actually changed (before → after). */}
      {rec.before || rec.after ? (
        <div className="mt-2.5 space-y-1.5 rounded-md border border-border/40 bg-surface-inset/30 p-2.5">
          {rec.before ? (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/70">Before:</span> {rec.before}
            </p>
          ) : null}
          {rec.after ? (
            rec.after.trim().startsWith("{") || rec.after.includes('"@context"') ? (
              <div className="text-[11px] text-foreground/85">
                <span className="font-medium text-foreground/70">What changed:</span>{" "}
                Added structured data that helps Google and AI understand this page.
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    View technical code
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-inset/50 p-2 text-[10px] leading-snug text-muted-foreground">
                    {rec.after}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-[11px] text-foreground/85">
                <span className="font-medium text-foreground/70">After:</span> {rec.after}
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {/* Target queries we expect this to move. */}
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
        Baseline (28d before): {metricsLine(rec)}
      </p>

      {/* Per-window diff-in-diff vs controls, with the check-in dates. */}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {rec.windows.map((w) => (
          <span
            key={w.day}
            className={w.ran ? "text-foreground/80" : "text-muted-foreground/60"}
          >
            <span className="font-medium">{w.day}d</span>{" "}
            {w.ran ? (
              <>
                lift {formatWindowLift(metric, w)} ({w.controlsUsed} control
                {w.controlsUsed === 1 ? "" : "s"})
              </>
            ) : (
              <>opens {w.checkOn}</>
            )}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {`Compared against ${controlsCount} comparable untreated page${controlsCount === 1 ? "" : "s"} on the same site.`}{" "}
        Observational, directional, not a controlled experiment.
      </p>

      {rec.notes ? (
        <p className="mt-2 text-[11px] text-foreground/70">
          <span className="font-medium text-foreground/60">Notes:</span> {rec.notes}
        </p>
      ) : null}

      {/* Operator: mark a manual Search Console recrawl request (speeds re-indexing). */}
      <div className="mt-2.5">
        <RecrawlButton recordId={rec.id} requestedAt={rec.recrawlRequestedAt} />
      </div>

      {/* Operator: exclude a settled (or already-excluded) result from learning so a
          mis-attributed win/loss stops skewing future ranking. */}
      {rec.verdict === "won" ||
      rec.verdict === "lost" ||
      rec.operatorVerdictOverride === "inconclusive" ? (
        <div className="mt-1.5">
          <ExcludeFromLearningButton
            recordId={rec.id}
            excluded={rec.operatorVerdictOverride === "inconclusive"}
          />
        </div>
      ) : null}

      {/* Manual rollback: copy the before text back into the CMS. */}
      {rec.before ? (
        <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5">
          <RollbackCopyButton before={rec.before} />
          <span className="text-[10px] text-muted-foreground">
            Beacon never auto-reverts a live page.
          </span>
        </div>
      ) : null}
    </div>
  );
}

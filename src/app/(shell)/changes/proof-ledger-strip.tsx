import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  splitLedgerLifecycle,
  excludeRevertBookkeeping,
  type LedgerLifecycleStage,
} from "@/domains/changes/lifecycle-counts";
import { verdictSchedule } from "@/domains/proof-gsc/verdict-schedule";
import { monthDayLabel } from "@/components/data/receipt-line";

/**
 * Operator-only GSC Proof ledger surface for /changes (Phase 5, Path B). Read-only.
 * Surfaces the newest still-measuring change as a full "active experiment" card
 * (what changed, when it ships a verdict, the baseline it's measured against), plus
 * a compact roll-up of every tracked change. Links to the full ledger on /results.
 * Renders null for customers / empty ledger so the customer timeline is untouched.
 * Mounted in a Suspense boundary.
 *
 * Wave 3A (2026-07-10): the counts, the per-row status label, the active-card pick, and
 * every date come from the canonical selectors (splitLedgerLifecycle / verdictSchedule),
 * never from the raw stored `verdict` string or a bespoke checkOn walk. So "3 measuring"
 * here lands on exactly 3 In flight rows on Results, and a 7-day "won" is never shown as
 * Helped before its window matures. Revert bookkeeping is excluded from every count and
 * from the rendered list, so a ship plus its revert reads as one change.
 */

/** Plain, honest status for a canonical lifecycle stage. A measuring change never claims a
 *  result; only a mature win reads "Helped" and only a mature loss reads "Did not help". */
const STAGE_LABEL: Record<LedgerLifecycleStage, string> = {
  won: "Helped",
  learned: "Did not help",
  measuring: "Measuring",
};

function stageColor(stage: LedgerLifecycleStage): string {
  return stage === "won"
    ? "text-emerald-700"
    : stage === "learned"
      ? "text-rose-700"
      : "text-blue-700";
}

export async function ProofLedgerStrip() {
  if (!isOperatorModeServer()) return null;
  let ledger: ShippedChangeRecord[] | null = null;
  try {
    const tenantId = await currentTenantId();
    // P0-B W1: render path serves the persisted/snapshot ledger (no re-measure on GET).
    ledger = await loadProofLedgerCached(tenantId);
  } catch {
    return null;
  }
  if (!ledger || ledger.length === 0) return null;

  const now = new Date();
  const split = splitLedgerLifecycle(ledger, now);
  const stageById = new Map<string, LedgerLifecycleStage>();
  for (const r of split.won) stageById.set(r.id, "won");
  for (const r of split.learned) stageById.set(r.id, "learned");
  for (const r of split.measuring) stageById.set(r.id, "measuring");

  // Revert bookkeeping never shows as a tracked change (bug #14) - the same rule the counts
  // use, so the rendered list length and the roll-up count can never disagree.
  const realLedger = excludeRevertBookkeeping(ledger);
  const measuring = split.measuring.length;
  const helped = split.won.length;
  const notHelped = split.learned.length;
  const tracked = realLedger.length;

  // Primary active item: the newest change still measuring (else the newest tracked change).
  // realLedger is already sorted newest-ship-first.
  const active =
    realLedger.find((l) => stageById.get(l.id) === "measuring") ?? realLedger[0] ?? null;

  // Every OTHER tracked change gets a compact row, so "N we are tracking" actually SHOWS N
  // (operator confusion 2026-06-22: only the single active card was rendered).
  const rest = active ? realLedger.filter((l) => l.id !== active.id) : [];

  return (
    <div className="mb-4 space-y-2.5">
      {active ? (
        <ActiveExperimentCard rec={active} stage={stageById.get(active.id) ?? "measuring"} now={now} />
      ) : null}

      {rest.length > 0 ? (
        <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-surface-inset/20">
          {rest.map((rec) => (
            <CompactExperimentRow key={rec.id} rec={rec} stage={stageById.get(rec.id) ?? "measuring"} now={now} />
          ))}
        </div>
      ) : null}

      <Link
        href="/results"
        prefetch={false}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-surface-inset/30 px-4 py-2.5 text-[12px] hover:border-border"
      >
        <span className="font-semibold text-foreground">
          {tracked} {tracked === 1 ? "change" : "changes"} we are tracking
        </span>
        {measuring > 0 ? <span className="text-blue-700">{measuring} still measuring</span> : null}
        {helped > 0 ? <span className="text-emerald-700">{helped} helped</span> : null}
        {notHelped > 0 ? <span className="text-rose-700">{notHelped} did not help</span> : null}
        <span className="ml-auto text-accent-primary">Check results &rarr;</span>
      </Link>
    </div>
  );
}

/** The soonest future first-read date for ONE change, canonical + UTC. Null unless the
 *  change is still measuring with a checkpoint ahead. */
function nextReadLabel(rec: ShippedChangeRecord, stage: LedgerLifecycleStage, now: Date): string | null {
  if (stage !== "measuring") return null;
  return monthDayLabel(verdictSchedule([rec], now).firstReadOn);
}

/** One-line summary of a tracked change beyond the highlighted active card. */
function CompactExperimentRow({
  rec,
  stage,
  now,
}: {
  rec: ShippedChangeRecord;
  stage: LedgerLifecycleStage;
  now: Date;
}) {
  const nextRead = nextReadLabel(rec, stage, now);
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
      <span className={`text-[10px] font-medium uppercase tracking-wide ${stageColor(stage)}`}>
        {STAGE_LABEL[stage]}
      </span>
      <span className="font-medium text-foreground">{rec.path}</span>
      <span className="text-[11px] text-muted-foreground">
        {rec.actionType.replace(/_/g, " ")} · shipped {rec.shippedAt.slice(0, 10)}
      </span>
      {rec.verifiedLive ? (
        <span className="text-[10px] font-medium text-emerald-700">✓ live</span>
      ) : null}
      {nextRead ? (
        <span className="ml-auto text-[11px] text-muted-foreground">verdict {nextRead}</span>
      ) : null}
    </div>
  );
}

function ActiveExperimentCard({
  rec,
  stage,
  now,
}: {
  rec: ShippedChangeRecord;
  stage: LedgerLifecycleStage;
  now: Date;
}) {
  const nextRead = nextReadLabel(rec, stage, now);
  // Controls actually used in the latest run window; falls back to the assigned
  // count while still measuring (no window has run yet).
  const basis = rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const controlsCount = basis?.controlsUsed ?? rec.controlPages.length;
  const baseline = rec.baseline ?? { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 };
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-700">
          {STAGE_LABEL[stage]}
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
        {`We compared this page to ${controlsCount} similar page${controlsCount === 1 ? "" : "s"} we did not change, so we can tell whether your change caused the results.`}{" "}
        {nextRead ? (
          <>
            We will know if this worked by <span className="font-medium">{nextRead}</span>.
          </>
        ) : (
          <>All the result checks are done.</>
        )}
      </p>

      {rec.after ? (
        <p className="mt-2 text-[11px] text-foreground/85">
          <span className="font-medium text-foreground/70">What changed:</span>{" "}
          {/* Never dump raw JSON-LD code at the user (audit #78/#99) — summarize
              structured-data edits in plain English; show real copy otherwise. */}
          {rec.after.trim().startsWith("{") || rec.after.includes('"@context"')
            ? "Added structured data that helps Google and AI understand this page."
            : rec.after}
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
        Before this change (last 28 days):{" "}
        {baseline.impressions > 0
          ? `${baseline.clicks.toLocaleString()} ${baseline.clicks === 1 ? "visit" : "visits"} from Google, ranked around #${baseline.position.toFixed(1)}`
          : "no Google data yet for the period before this change"}
      </p>

      <Link
        href="/results"
        prefetch={false}
        className="mt-2.5 inline-block text-[11px] font-medium text-accent-primary hover:underline"
      >
        See the results and how to undo this &rarr;
      </Link>
    </div>
  );
}

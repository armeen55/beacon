import "server-only";

/**
 * /diagnostics/proof-engine — operator-only aggregate window into the causal
 * Proof Engine (2026-06-11 dream shift).
 *
 * The customer /changes/[id] drilldown shows ONE change's causal proof. This
 * is the operator's whole-tenant view: the status histogram across every
 * attributed change, the top causally-proven wins (plain-English), and the
 * per-bucket forecast base rates the Move Forecast reads. It's the artifact
 * the founder uses to validate + trust + sell the wedge ("Beacon proved these
 * N changes drove citations") — and the fastest way to confirm the nightly
 * Proof Engine is producing real `computed` outcomes for a tenant.
 *
 * Read-only: reads the durably-persisted `change_outcomes_v2` (via
 * loadAllChangeOutcomes, which hydrates from Supabase on hosted). Operator-
 * gated; no writes, no paid API.
 */

import { notFound } from "next/navigation";
import Link from "next/link";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadAllChangeOutcomes } from "@/domains/attribution/change-outcome-store";
import type { StoredChangeOutcome } from "@/domains/attribution/change-outcome-store";
import { buildProofSentence } from "@/domains/attribution/proof-sentence";
import {
  buildCausalSelfForecast,
  type CausalSelfForecast,
} from "@/domains/attribution/causal-self-forecast";

export const dynamic = "force-dynamic";

const TONE_CLASS: Record<string, string> = {
  helping: "text-status-success",
  hurting: "text-status-danger",
  flat: "text-foreground-secondary",
  watching: "text-status-warning",
  none: "text-muted-foreground",
};

export default async function ProofEngineDiagnosticPage() {
  // OPERATOR GATE — must precede every data read.
  if (!(await isOperatorModeServer())) return notFound();

  const tenantId = await currentTenantId();
  let outcomes: StoredChangeOutcome[] = [];
  let readError: string | null = null;
  try {
    outcomes = await loadAllChangeOutcomes();
  } catch (e) {
    readError = e instanceof Error ? e.message : String(e);
  }

  // Status histogram across every attributed change.
  const byStatus: Record<string, number> = {};
  for (const o of outcomes) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const statusRows = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);

  // Top causally-proven wins (computed + positive lift), ranked.
  const wins = outcomes
    .filter(
      (o) =>
        o.status === "computed" &&
        !!o.computed?.overall &&
        o.computed.overall.adjusted_lift > 0,
    )
    .sort(
      (a, b) =>
        b.computed!.overall!.adjusted_lift - a.computed!.overall!.adjusted_lift,
    )
    .slice(0, 10);

  // Per-bucket forecast base rates (the Move Forecast's reference classes).
  const computedBuckets = Array.from(
    new Set(
      outcomes.filter((o) => o.status === "computed").map((o) => o.primary_bucket),
    ),
  ).sort();
  const forecasts = computedBuckets
    .map((b) => buildCausalSelfForecast(outcomes, { primary_bucket: b }))
    .filter((f): f is CausalSelfForecast => f !== null);

  const computedCount = byStatus["computed"] ?? 0;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-base font-semibold tracking-tight">
          Proof Engine — tenant view
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Causal diff-in-differences outcomes for{" "}
          <span className="font-mono">{tenantId}</span>. Read-only;
          recomputed nightly. {outcomes.length} attributed change
          {outcomes.length === 1 ? "" : "s"} · {computedCount} causally
          computed.
        </p>
      </header>

      {readError && (
        <p className="rounded-md border border-status-warning/40 bg-status-warning/5 px-4 py-3 text-[12px] text-status-warning">
          Couldn&apos;t read outcomes: {readError}
        </p>
      )}

      {outcomes.length === 0 && !readError && (
        <p className="rounded-md border border-border bg-surface-inset/40 px-4 py-3 text-[13px] text-muted-foreground">
          No attributed changes yet. The Proof Engine runs nightly per tenant
          (after generation); outcomes appear here once it has run against this
          tenant&apos;s changelog + citation history.
        </p>
      )}

      {/* Status histogram */}
      {statusRows.length > 0 && (
        <section className="rounded-lg border border-border bg-surface px-5 py-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Outcome status
          </h2>
          <table className="mt-2 w-full text-[12px]">
            <tbody>
              {statusRows.map(([status, n]) => (
                <tr key={status} className="border-b border-border/30 last:border-b-0">
                  <td className="py-1 font-mono">{status}</td>
                  <td className="py-1 text-right tabular-nums">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Top proven wins */}
      {wins.length > 0 && (
        <section className="rounded-lg border border-status-success/30 bg-status-success/[0.04] px-5 py-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-status-success">
            Top causally-proven wins
          </h2>
          <ul className="mt-3 space-y-3">
            {wins.map((o) => {
              const proof = buildProofSentence(o);
              return (
                <li key={o.source_id} className="border-b border-border/20 pb-2 last:border-b-0">
                  <Link
                    href={`/changes/${encodeURIComponent(o.source_id)}`}
                    className="group block"
                  >
                    <p className={`text-[13px] font-medium leading-snug ${TONE_CLASS[proof.tone]}`}>
                      {proof.headline}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                      {o.primary_bucket} · {o.url ?? "(no url)"} · +
                      {o.computed!.overall!.adjusted_lift} cit/day ·{" "}
                      {o.confidence}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Per-bucket forecast base rates */}
      {forecasts.length > 0 && (
        <section className="rounded-lg border border-border bg-surface px-5 py-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Move Forecast base rates (per bucket)
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            What the &quot;before you ship&quot; forecast reads when a new edit
            of each kind is proposed.
          </p>
          <table className="mt-2 w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-1 font-medium">Bucket</th>
                <th className="text-right py-1 font-medium">Helped / N</th>
                <th className="text-right py-1 font-medium">Rate</th>
                <th className="text-right py-1 font-medium">Typical lift</th>
                <th className="text-right py-1 font-medium">Band</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.map((f) => (
                <tr key={f.primary_bucket} className="border-b border-border/30 last:border-b-0">
                  <td className="py-1 font-mono">{f.primary_bucket}</td>
                  <td className="py-1 text-right tabular-nums">
                    {f.helpedCount} / {f.sampleSize}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {Math.round(f.helpingRate * 100)}%
                  </td>
                  <td className="py-1 text-right tabular-nums text-muted-foreground">
                    {f.typicalRelativeLift != null
                      ? `+${Math.round(f.typicalRelativeLift * 100)}%`
                      : "—"}
                  </td>
                  <td className="py-1 text-right text-[10px] text-muted-foreground">
                    {f.seeded ? "seeded" : "stable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

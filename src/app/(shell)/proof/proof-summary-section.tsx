import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  isMatureOutcome,
  type MeasurementPresentation,
} from "@/domains/proof-gsc/measurement-maturity";

/**
 * proof-summary-section (2026-06-25; Move 2) — "Proof at a glance" for /proof. Counts
 * are MATURITY-STRATIFIED: only changes that reached the 28-day window with sufficient
 * data count as final outcomes (Helped / No clear lift / Did not help). Everything
 * earlier stays in "Measuring" — a 7-day signal is never tallied as a win or loss, so
 * the scoreboard can't read "2 no-lift" when those are only 7-day checkpoints. Read-only.
 */

function prettyPath(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? path;
  return slug.replace(/[-_]+/g, " ").trim() || path;
}

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

export async function ProofSummarySection() {
  let records;
  let latestGsc: string | null = null;
  try {
    const tenantId = await currentTenantId();
    records = await loadProofLedgerCached(tenantId);
    latestGsc = await readLastFinalizedDate(tenantId).catch(() => null);
  } catch {
    return null;
  }
  if (!records.length) return null;

  const now = new Date();
  const overlaps = detectMeasurementOverlaps(records.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const presOf = (r: (typeof records)[number]): MeasurementPresentation => {
    const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
    return buildMeasurementPresentation({
      shippedAt: r.shippedAt,
      now,
      latestGscDate: latestGsc,
      windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
      verdict: r.verdict,
      controlsUsed: basisWin?.controlsUsed ?? 0,
      baselineImpressions: r.baseline?.impressions ?? 0,
      overlap: overlaps.get(r.id) ?? null,
      live: true,
    });
  };

  const counts = { measuring: 0, helped: 0, noLift: 0, didNotHelp: 0, attributionLimited: 0 };
  const wins: { path: string; actionType: string; confidence: string }[] = [];
  for (const r of records) {
    const p = presOf(r);
    if (p.attributionQuality === "limited") counts.attributionLimited += 1;
    if (!isMatureOutcome(p.maturity)) {
      counts.measuring += 1;
      continue;
    }
    if (p.verdict === "helped") {
      counts.helped += 1;
      wins.push({ path: r.path, actionType: r.actionType, confidence: p.confidence });
    } else if (p.verdict === "did_not_help") counts.didNotHelp += 1;
    else counts.noLift += 1;
  }
  const matureTotal = counts.helped + counts.noLift + counts.didNotHelp;

  return (
    <section className="rounded-3xl border border-gray-200 bg-gradient-to-br from-emerald-50/40 via-white to-sky-50/40 p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Proof at a glance</h2>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          What your shipped changes actually drove — re-measured against Search Console vs control pages.
          Only changes that reach the full 28-day window count as final results; the rest are still measuring.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(counts.measuring)} label="Measuring" accent="text-amber-600" />
        <StatTile value={String(counts.helped)} label="Helped" accent="text-emerald-600" />
        <StatTile value={String(counts.noLift)} label="No clear lift" accent="text-gray-500" />
        <StatTile value={String(counts.didNotHelp)} label="Did not help" accent="text-rose-500" />
      </div>
      {counts.attributionLimited > 0 ? (
        <p className="mt-3 text-xs text-amber-700">
          {counts.attributionLimited} measurement{counts.attributionLimited === 1 ? "" : "s"} are directional only —
          another edit overlapped the same page, so attribution is weakened.
        </p>
      ) : null}

      {matureTotal === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No mature results yet — your active changes are still collecting data. Search Console needs the full
          28-day window before a final verdict lands.
        </p>
      ) : wins.length > 0 ? (
        <div className="mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">Confirmed wins (28-day)</div>
          <ul className="mt-2 space-y-1.5">
            {wins.slice(0, 6).map((w, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-800">{prettyPath(w.path)}</span>
                <span className="text-xs text-emerald-700">
                  {w.actionType.replace(/_/g, " ")} · {w.confidence} confidence ✓
                </span>
              </li>
            ))}
          </ul>
          {wins.length > 6 ? (
            <p className="mt-2 text-xs text-gray-500">
              + {wins.length - 6} more confirmed {wins.length - 6 === 1 ? "win" : "wins"} (showing the top 6)
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">
          {matureTotal} mature {matureTotal === 1 ? "result" : "results"} so far — none cleared the win bar.
        </p>
      )}
    </section>
  );
}

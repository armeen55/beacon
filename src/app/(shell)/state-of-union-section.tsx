import Link from "next/link";

import { currentTenantId } from "@/lib/tenant-context";
import { loadStateOfUnion } from "@/domains/insight/compute-state-of-union";
import type { StateOfUnionVerdict } from "@/domains/insight/state-of-union";
import { workbenchHref } from "@/domains/insight/workbench-route";

const VERDICT_ACCENT: Record<StateOfUnionVerdict, string> = {
  ranking_better_losing_clicks: "border-amber-300 bg-amber-50",
  declining: "border-rose-300 bg-rose-50",
  growing: "border-emerald-300 bg-emerald-50",
  healthy: "border-border bg-muted/40",
  no_data: "border-border bg-muted/40",
};

function Stat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { pct: number; goodWhenUp: boolean } | null;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[20px] font-semibold tabular-nums text-foreground">
          {value}
        </span>
        {delta ? (
          <span
            className={
              "text-[12px] font-medium tabular-nums " +
              ((delta.pct >= 0) === delta.goodWhenUp
                ? "text-emerald-600"
                : "text-rose-600")
            }
          >
            {delta.pct >= 0 ? "▲" : "▼"} {Math.abs(delta.pct)}%
          </span>
        ) : null}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/**
 * State of the Union — operator-OS rebuild, surface (1). The executive
 * briefing card at the top of Briefing. Operator-gated by the caller. Read-
 * only; every figure traces to a real source. Renders null when there's no
 * data yet (the existing dashboard sections take over).
 */
export async function StateOfUnionSection() {
  const tenantId = await currentTenantId();
  let sou;
  try {
    sou = await loadStateOfUnion(tenantId);
  } catch {
    return null; // fail-soft parity with ProofLedgerStrip: never throw into the dashboard
  }
  if (!sou.hasData || !sou.headline) return null;

  const h = sou.headline;

  return (
    <section className="space-y-4">
      {/* Headline verdict */}
      <div className={"rounded-xl border p-5 " + VERDICT_ACCENT[h.verdict]}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            State of the Union
          </span>
          <Link
            href="/opportunities"
            prefetch={false}
            className="text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
          >
            {sou.opportunityCount} opportunities →
          </Link>
        </div>
        <h2 className="mt-2 text-[19px] font-semibold leading-snug text-foreground">
          {h.headline}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{h.subline}</p>
        <div className="mt-4 flex flex-wrap gap-8">
          <Stat
            label="clicks (28d)"
            value={h.clicks28d.toLocaleString()}
            // Don't show a colored ▲/▼ delta when the headline calls it steady —
            // the badge would claim a direction the verdict explicitly denies.
            delta={h.verdict === "healthy" ? null : { pct: h.clicksDeltaPct, goodWhenUp: true }}
          />
          <Stat label="impressions (90d)" value={h.impressions90d.toLocaleString()} />
          <Stat label="avg position" value={h.avgPosition90d.toFixed(1)} />
        </div>
      </div>

      {/* Two-column: bleeding vs rising */}
      <div className="grid gap-3 md:grid-cols-2">
        <BriefList
          title="Fix first: bleeding pages"
          tone="rose"
          empty="No CTR leaks or decaying pages right now."
          rows={sou.bleedingPages.map((o) => ({
            title: o.title,
            sub: o.why,
            metric: o.estClicksAtStake > 0 ? `~${o.estClicksAtStake.toLocaleString()} clicks` : "",
          }))}
        />
        <BriefList
          title="Rising demand & momentum"
          tone="emerald"
          empty="No striking-distance or rising pages yet."
          rows={sou.risingOpportunities.map((o) => ({
            title: o.title,
            sub: o.why,
            metric: o.estClicksAtStake > 0 ? `~${o.estClicksAtStake.toLocaleString()}` : "",
          }))}
        />
      </div>

      {/* Whole-site gaps + winners */}
      <div className="grid gap-3 md:grid-cols-3">
        {sou.schemaAeoGap ? (
          <div className="rounded-lg border border-border/60 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              AEO / schema gap
            </div>
            <div className="mt-1 text-[15px] font-semibold text-foreground">
              {sou.schemaAeoGap.faqCovered}/{sou.schemaAeoGap.faqTotal} pages have FAQ schema
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {sou.schemaAeoGap.thinPages} thin pages (&lt;300 words). A visible
              Q&amp;A + structured data can support answer extraction, it&rsquo;s
              machine-readable support, not a guaranteed rich result.
            </p>
          </div>
        ) : null}
        <div className="rounded-lg border border-border/60 p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Winning pages
          </div>
          <ul className="mt-1 space-y-0.5">
            {sou.winningClusters.slice(0, 4).map((w) => (
              <li
                key={w.path}
                className="flex justify-between gap-2 text-[12px] text-foreground"
              >
                <span className="truncate">{w.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {w.clicks90d.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border/60 p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            UX friction
          </div>
          <div className="mt-1 text-[15px] font-semibold text-foreground">
            {sou.frictionPageCount} page{sou.frictionPageCount === 1 ? "" : "s"}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {sou.frictionPages[0]
              ? `${sou.frictionPages[0].title}: ${
                  sou.frictionPages[0].evidenceBySource.find(
                    (e) => e.source === "clarity",
                  )?.line ?? sou.frictionPages[0].why
                }`
              : "No dead-click hotspots detected."}
          </p>
        </div>
      </div>

      {/* Next best actions */}
      {sou.nextBestActions.length > 0 ? (
        <div className="rounded-lg border border-border/60 p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Do next
          </div>
          <ol className="mt-1.5 space-y-2">
            {sou.nextBestActions.map((a, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-foreground">
                <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="min-w-0">
                  <Link
                    href={workbenchHref(a.path)}
                    prefetch={false}
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {a.headline}
                  </Link>{" "}
                  <span className="font-mono text-[11px] text-muted-foreground/70">
                    {a.path}
                  </span>
                  {a.serpGuardLabel ? (
                    <span className="ml-1.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      ⚠ {a.serpGuardLabel}
                    </span>
                  ) : null}
                  {a.estClicksAtStake > 0 ? (
                    a.kind === "friction" ? (
                      // Friction's number is Clarity dead/rage clicks, not
                      // recoverable search clicks — label its own unit, drop the
                      // CTR-gap confidence framing.
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {a.estClicksAtStake.toLocaleString()} frustrated clicks (Clarity, {a.estWindow})
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        ~{a.estClicksAtStake.toLocaleString()} est. clicks at stake over{" "}
                        {a.estWindow} · {a.estConfidence} confidence
                      </span>
                    )
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Data sources strip */}
      <div className="flex flex-wrap gap-2">
        {sou.sources.map((s) => (
          <span
            key={s.key}
            title={s.unlocks}
            className={
              "rounded-full border px-2.5 py-1 text-[11px] " +
              (s.connected
                ? s.daysStale != null && s.daysStale > 2
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-border bg-muted/40 text-muted-foreground")
            }
          >
            {s.label}: {s.note}
          </span>
        ))}
      </div>
    </section>
  );
}

function BriefList({
  title,
  tone,
  rows,
  empty,
}: {
  title: string;
  tone: "rose" | "emerald";
  rows: { title: string; sub: string; metric: string }[];
  empty: string;
}) {
  const dot = tone === "rose" ? "bg-rose-500" : "bg-emerald-500";
  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="flex items-center gap-1.5">
        <span className={"h-1.5 w-1.5 rounded-full " + dot} />
        <span className="text-[12px] font-semibold text-foreground">{title}</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.slice(0, 4).map((r, i) => (
            <li key={i} className="text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium text-foreground">{r.title}</span>
                {r.metric ? (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.metric}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-muted-foreground">{r.sub}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";

import { currentTenantId } from "@/lib/tenant-context";
import { loadStateOfUnion } from "@/domains/insight/compute-state-of-union";
import type { StateOfUnion, StateOfUnionVerdict } from "@/domains/insight/state-of-union";
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
            How your business is doing
          </span>
          <Link
            href="/opportunities"
            prefetch={false}
            className="text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
          >
            {sou.opportunityCount} things you could improve →
          </Link>
        </div>
        <h2 className="mt-2 text-[19px] font-semibold leading-snug text-foreground">
          {h.headline}
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{h.subline}</p>
        <div className="mt-4 flex flex-wrap gap-8">
          <Stat
            label="Visits from Google (28 days)"
            value={h.clicks28d.toLocaleString()}
            // Don't show a colored ▲/▼ delta when the headline calls it steady —
            // the badge would claim a direction the verdict explicitly denies.
            delta={h.verdict === "healthy" ? null : { pct: h.clicksDeltaPct, goodWhenUp: true }}
          />
          <Stat label="Times shown on Google (90 days)" value={h.impressions90d.toLocaleString()} />
          <Stat label="Average Google rank (90 days)" value={h.avgPosition90d.toFixed(1)} />
        </div>
      </div>

      {/* Lead with the plan — the operator's first read is "what do I do today", */}
      {/* not the diagnostics. The supporting detail lives below under "the full picture". */}
      <PlanBlock actions={sou.nextBestActions} verdict={h.verdict} held={sou.heldForMeasurement} />

      {/* The full picture — supporting evidence behind the plan. */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          The full picture
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Two-column: bleeding vs rising */}
      <div className="grid gap-3 md:grid-cols-2">
        <BriefList
          title="Fix first: pages losing visitors"
          tone="rose"
          empty="No pages losing visitors right now."
          rows={sou.bleedingPages.map((o) => ({
            title: o.title,
            sub: o.why,
            metric: o.estClicksAtStake > 0 ? `~${o.estClicksAtStake.toLocaleString()} visits` : "",
          }))}
        />
        <BriefList
          title="Pages on the rise"
          tone="emerald"
          empty="No pages close to ranking higher yet."
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
              Help AI answer questions about you
            </div>
            <div className="mt-1 text-[15px] font-semibold text-foreground">
              {sou.schemaAeoGap.faqCovered} of {sou.schemaAeoGap.faqTotal} pages have a clear Q&amp;A section
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {sou.schemaAeoGap.thinPages} {sou.schemaAeoGap.thinPages === 1 ? "page is" : "pages are"} short on
              content. Adding a clear question-and-answer section helps Google and AI
              tools understand and recommend your pages.
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
            Where visitors get stuck
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
              : "No spots where visitors are getting stuck."}
          </p>
        </div>
      </div>

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

/**
 * The plan — the hero of the briefing. Leads the page so the operator's first
 * read is "here is what to do today", not the diagnostics. Each row links to the
 * page's Workbench. Carries an explicit caught-up state so leading with the plan
 * never renders a blank top-of-page.
 */
function PlanBlock({
  actions,
  verdict,
  held,
}: {
  actions: StateOfUnion["nextBestActions"];
  verdict: StateOfUnionVerdict;
  /** Ranked opportunities held out of the plan because they're mid-measurement. */
  held: number;
}) {
  if (actions.length === 0) {
    // The plan is empty only when there are zero ranked opportunities. Don't
    // claim "caught up" when the verdict above says Search is declining — that
    // contradiction (broad sub-threshold erosion: a site-wide dip with no single
    // page tripping a per-page fix-now threshold) misreads as "no problem".
    const siteDeclining =
      verdict === "declining" || verdict === "ranking_better_losing_clicks";
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Today&rsquo;s plan
        </div>
        {held > 0 ? (
          // Every fix-now page is currently mid-measurement — a GOOD state (you
          // did the work), not "nothing to do". Changing them again now would
          // corrupt the running experiments.
          <>
            <p className="mt-2 text-[15px] font-medium text-foreground">
              You&rsquo;ve shipped fixes for your top pages. {held} {held === 1 ? "is" : "are"} measuring now.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Hold off changing them again until results land. The next moves appear
              as those windows close or new pages slip.{" "}
              <Link href="/proof" prefetch={false} className="text-foreground underline-offset-2 hover:underline">
                See what&rsquo;s measuring &rarr;
              </Link>
            </p>
          </>
        ) : siteDeclining ? (
          <>
            <p className="mt-2 text-[15px] font-medium text-foreground">
              No single page tripped a fix-now threshold, but Search is slipping site-wide.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              The dip is spread thin across many pages. Refresh your strongest pages,
              or connect more sources (SEMrush, Clarity) so Beacon can pinpoint where to act.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[15px] font-medium text-foreground">
              You&rsquo;re caught up. No must-do moves right now.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Beacon will surface the next move as new Search data lands.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-foreground/15 bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Today&rsquo;s plan
        </span>
        <span className="text-[12px] font-medium text-muted-foreground">
          {actions.length} {actions.length === 1 ? "move" : "moves"} that matter most
        </span>
      </div>
      <ol className="mt-3 space-y-2.5">
        {actions.map((a, i) => (
          <li key={i}>
            <Link
              href={workbenchHref(a.path)}
              prefetch={false}
              className="group flex items-start gap-3 rounded-lg border border-transparent p-2 -mx-2 transition-colors hover:border-border hover:bg-muted/40"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[12px] font-semibold tabular-nums text-background">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[14px] font-semibold leading-snug text-foreground group-hover:underline">
                    {a.headline}
                  </span>
                  {a.hasChangePack ? (
                    <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      Change Pack ready
                    </span>
                  ) : null}
                  {a.serpGuardLabel ? (
                    <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      &#9888; {a.serpGuardLabel}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/70">
                  {a.path}
                </span>
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
                      {a.estWindow} &middot; {a.estConfidence} confidence
                    </span>
                  )
                ) : null}
              </span>
              <span className="mt-0.5 shrink-0 self-center text-[13px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                Open &rarr;
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {held > 0 ? (
        <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
          {held} more {held === 1 ? "page is" : "pages are"} measuring a recent change and held from the plan until results land.{" "}
          <Link href="/proof" prefetch={false} className="text-foreground underline-offset-2 hover:underline">
            See what&rsquo;s measuring &rarr;
          </Link>
        </p>
      ) : null}
    </div>
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

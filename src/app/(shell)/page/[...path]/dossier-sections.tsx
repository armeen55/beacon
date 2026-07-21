import Link from "next/link";

import { formatMetric, formatMetricCompact } from "@/lib/format-metric";
import { maturityLabelForRecord } from "@/domains/proof-gsc/measure-lifecycle";
import { loadPageDossier } from "./page-dossier-data";
import { DossierChart } from "./dossier-chart";

/**
 * dossier-sections (BEACON_500 item 54) - server-rendered bands for the page dossier.
 * Each section calls the SAME cached `loadPageDossier` (react cache dedupes to one
 * composition per request) and renders its own slice, so every band can stream
 * behind its own Suspense boundary without re-reading anything.
 */

const CARD = "rounded-lg border border-border/60 bg-background p-4";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export async function DossierChartSection({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  if (dossier.chart.daily.length < 5) {
    return (
      <div className={CARD}>
        <div className={LABEL}>Clicks over time</div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          I do not have enough days of search data for this page yet. Once Google Search Console reports at least
          5 days, I will chart it here.
        </p>
      </div>
    );
  }
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <div className={LABEL}>Clicks over time</div>
        {dossier.chart.shipMarkers.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {dossier.chart.shipMarkers.length} shipped change{dossier.chart.shipMarkers.length === 1 ? "" : "s"} marked
          </span>
        ) : null}
      </div>
      <div className="mt-2">
        <DossierChart daily={dossier.chart.daily} shipMarkers={dossier.chart.shipMarkers} />
      </div>
    </div>
  );
}

export async function DossierQueriesSection({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  const queries = dossier.queries.topQueries;
  return (
    <div className={CARD}>
      <div className={LABEL}>Top queries</div>
      {/* R17a (v1 492) - honest accounting when a big slice of this page's
          Google traffic comes from queries Google keeps private: the table
          below covers only what Google shows. Self-hides under the threshold. */}
      {dossier.queries.anonymizedNote ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{dossier.queries.anonymizedNote}</p>
      ) : null}
      {queries.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          I have not matched any Google search queries to this page yet. That usually means it is new or gets very
          little search traffic so far.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="border-b border-border/40 text-left text-[11px] text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">Query</th>
                <th scope="col" className="py-1 pr-3 font-medium">Clicks</th>
                <th scope="col" className="py-1 pr-3 font-medium">Impressions</th>
                <th scope="col" className="py-1 font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr key={q.query} className="border-b border-border/20 last:border-0">
                  <td className="py-1.5 pr-3 break-words font-medium text-foreground">{q.query}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{formatMetric(q.clicks)}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{formatMetric(q.impressions)}</td>
                  <td className="py-1.5 tabular-nums text-muted-foreground">{q.position > 0 ? q.position.toFixed(1) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function daysAgoLabel(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export async function DossierContentSection({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  const content = dossier.content;
  if (!content) {
    return (
      <div className={CARD}>
        <div className={LABEL}>Content on the page</div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          I have not crawled this page yet, so I cannot show its title, meta description, or headline here.
        </p>
      </div>
    );
  }
  const freshness = daysAgoLabel(content.fetchedAt);
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <div className={LABEL}>Content on the page</div>
        {freshness ? <span className="text-[11px] text-muted-foreground">Last crawled {freshness}</span> : null}
      </div>
      <dl className="mt-2 space-y-2">
        <div>
          <dt className="text-[11px] font-medium text-muted-foreground">Title tag</dt>
          <dd className="text-[13px] text-foreground">{content.title || "Not found"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-muted-foreground">Meta description</dt>
          <dd className="text-[13px] text-foreground">{content.metaDescription || "Not found"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-muted-foreground">Headline (H1)</dt>
          <dd className="text-[13px] text-foreground">{content.h1 || "Not found"}</dd>
        </div>
      </dl>
      {content.wordCount > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{formatMetric(content.wordCount)} words on the page.</p>
      ) : null}
    </div>
  );
}

export async function DossierTeamReadsSection({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  const { demand, friction, funnel } = dossier.teamReads;
  const cards: { key: string; label: string; body: React.ReactNode }[] = [];

  if (demand) {
    cards.push({
      key: "demand",
      label: "Search demand",
      body: (
        <p className="text-[13px] leading-relaxed text-foreground">
          {formatMetric(demand.clicks90d)} clicks and {formatMetric(demand.impressions90d)} impressions over the last
          90 days, average position {demand.position90d > 0 ? demand.position90d.toFixed(1) : "unknown"}.
        </p>
      ),
    });
  }

  if (friction && friction.sessions > 0) {
    const ragePct = Math.round(friction.rageRate * 100);
    const deadPct = Math.round(friction.deadRate * 100);
    cards.push({
      key: "friction",
      label: "Visitor friction",
      body: (
        <p className="text-[13px] leading-relaxed text-foreground">
          Out of {formatMetric(friction.sessions)} sessions, {ragePct}% had a rage click and {deadPct}% had a dead
          click. {ragePct >= 5 || deadPct >= 5 ? "That is high enough to be worth a look." : "That is within a normal range."}
        </p>
      ),
    });
  }

  if (funnel) {
    cards.push({
      key: "funnel",
      label: "AI visibility",
      body: <p className="text-[13px] leading-relaxed text-foreground">{funnel.bottleneckSentence}</p>,
    });
  }

  return (
    <div className={CARD}>
      <div className={LABEL}>What the team knows</div>
      {cards.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          None of the team have a read on this page yet. Connect more data sources or check back after the next
          refresh.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {cards.map((c) => (
            <div key={c.key}>
              <div className="text-[11px] font-medium text-muted-foreground">{c.label}</div>
              {c.body}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export async function DossierHistorySection({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  const history = dossier.history;
  return (
    <div className={CARD}>
      <div className={LABEL}>History of changes</div>
      {history.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          I have not shipped any change on this page yet. Once one ships, I will track its before and after here.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {history.map((r) => {
            const basis = r.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
            // Review fix 3 (2026-07-11): the SHARED calibration-aware label, so a
            // quarantined win reads "No clear change yet" here exactly as it does
            // on Results and in Ask - never "Helped" on one surface only.
            const label = maturityLabelForRecord(r, basis?.day ?? null);
            return (
              <div key={r.id} className="rounded-md border border-border/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">{r.actionType.replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-muted-foreground">shipped {r.shippedAt.slice(0, 10)}</span>
                  <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    {label}
                  </span>
                </div>
                {r.before || r.after ? (
                  <div className="mt-1.5 grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-2">
                    {r.before ? <div><span className="font-medium text-foreground">Before:</span> {r.before}</div> : null}
                    {r.after ? <div><span className="font-medium text-foreground">After:</span> {r.after}</div> : null}
                  </div>
                ) : null}
                <Link href="/results" className="mt-1.5 inline-block text-[11px] font-medium text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
                  See the receipts in Results
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export async function DossierCurrentMoveSection({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  const { currentMove, currentPlanPick, trapNote } = dossier;
  if (!currentMove && !currentPlanPick && !trapNote) {
    return (
      <div className={CARD}>
        <div className={LABEL}>Current recommendation</div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Nothing is queued for this page right now. That is not necessarily bad news, it may already be in good
          shape.
        </p>
      </div>
    );
  }
  return (
    <div className={CARD}>
      <div className={LABEL}>Current recommendation</div>
      <div className="mt-2 space-y-3">
        {/* Dossier honesty (2026-07-11) - name the zero-click trap plainly right where the numbers
            live, so a strong-position, no-click page never shows a silent recommendation. */}
        {trapNote ? (
          <p className="text-[13px] leading-relaxed text-foreground">{trapNote}</p>
        ) : null}
        {currentMove ? (
          <div>
            <div className="text-[13px] font-medium text-foreground">{currentMove.opportunityType}</div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{currentMove.recommendation}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              ~{formatMetricCompact(currentMove.estimatedEffortMinutes)} min
              {currentMove.measurementHeadline ? ` - ${currentMove.measurementHeadline}` : ""}
            </p>
            <Link href="/changes" className="mt-1 inline-block text-[11px] font-medium text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
              Open in Changes
            </Link>
          </div>
        ) : null}
        {currentPlanPick ? (
          <div>
            <div className="text-[13px] font-medium text-foreground">
              {currentPlanPick.isAccepted ? "Picked for today" : "Planned pick (not yet accepted)"}
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{currentPlanPick.whyNow}</p>
            <Link href="/changes" className="mt-1 inline-block text-[11px] font-medium text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
              Open in Changes
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

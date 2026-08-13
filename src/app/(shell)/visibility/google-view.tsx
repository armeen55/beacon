import Link from "next/link";
import { Panel } from "./parts";
import { DataTable } from "./table";
import type { googleView } from "./visibility-view";

/**
 * The Google workspace: what Search Console has actually reported, at three grains you can act on. Headline
 * numbers over a stretch you choose against the stretch before it, the line itself, then EVERY page and
 * EVERY search Google named, ranked and sortable.
 *
 * Nothing here is a forecast and nothing is a score. Every table sorts client side over numbers already
 * computed on the server, so no click on this screen asks Google for anything.
 */

const RANGES = [7, 28, 84];
const METRICS = [{ key: "clicks", label: "Clicks" }, { key: "impressions", label: "Appearances" }, { key: "ctr", label: "Click rate" }];

/** One row of choices as links, so the choice lives in the address bar and a screen can be sent to somebody. */
function Choices({ options }: { options: Array<{ href: string; label: string; active: boolean }> }) {
  return (
    <div className="inline-flex items-center rounded-full bg-surface-inset/60 p-0.5 ring-1 ring-border/40">
      {options.map((o) => (
        <Link key={o.label} href={o.href} scroll={false} aria-current={o.active ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${o.active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function GoogleWorkspace({ view, range, metric }: {
  view: ReturnType<typeof googleView>; range: number; metric: string;
}) {
  if (view.limitation) {
    return (
      <Panel title="Google">
        <p className="text-[13px] leading-relaxed text-muted-foreground">{view.limitation}</p>
        <Link href="/settings/connectors" className="mt-2 inline-block text-[13px] font-semibold text-accent-primary underline underline-offset-2">Open Connections</Link>
      </Panel>
    );
  }
  const at = (over: Record<string, string | number>): string =>
    `?${new URLSearchParams({ view: "google", range: String(range), metric, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) }).toString()}`;
  return (
    <div className="space-y-4">
      <Panel title="Where Google has you" note={view.watermark} tiles={view.tiles} chart={view.chart}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Choices options={METRICS.map((m) => ({ href: at({ metric: m.key }), label: m.label, active: metric === m.key }))} />
          <Choices options={RANGES.map((d) => ({ href: at({ range: d }), label: `${d} days`, active: range === d }))} />
        </div>}>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{view.coverage}</p>
      </Panel>
      <Panel title="Every page, and which way it is moving">
        {view.pages ? <DataTable columns={view.pages.columns} rows={view.pages.rows} empty={view.pages.empty} note={view.pages.note} tall /> : null}
      </Panel>
      <Panel title="Every search Google named">
        {view.queries ? <DataTable columns={view.queries.columns} rows={view.queries.rows} empty={view.queries.empty} note={view.queries.note} tall /> : null}
      </Panel>
    </div>
  );
}

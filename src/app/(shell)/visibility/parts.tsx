/**
 * TrendChart - ONE substantial line over a chosen stretch of days, with the stretch before it drawn behind
 * as the comparison. Pure SVG on the server, no chart library and no client JavaScript.
 *
 * A DAY I NEVER READ IS A HOLE IN THE LINE, never a zero: a null point breaks the path, so a quiet day can
 * never read as a collapse. The comparison line is aligned by POSITION in its own window, which is what
 * "against the stretch before" means; the two windows are always the same width or there is no comparison.
 */

const W = 760, H = 210, PAD_L = 44, PAD_R = 12, PAD_T = 16, PAD_B = 26;

const xAt = (i: number, n: number): number => PAD_L + (n <= 1 ? (W - PAD_L - PAD_R) / 2 : (i / (n - 1)) * (W - PAD_L - PAD_R));
const yAt = (v: number, max: number): number => PAD_T + (H - PAD_T - PAD_B) - (max <= 0 ? 0 : (v / max) * (H - PAD_T - PAD_B));

/** A path that STOPS at every gap and starts again after it. */
function pathOf(values: Array<number | null>, max: number): string {
  let d = "", open = false;
  values.forEach((v, i) => {
    if (v == null) { open = false; return; }
    d += `${open ? " L" : `${d ? " " : ""}M`}${xAt(i, values.length).toFixed(1)},${yAt(v, max).toFixed(1)}`;
    open = true;
  });
  return d;
}

type Chart = { label: string; percent: boolean; points: Array<{ day: string; label: string; value: number | null }>;
  prior: Array<number | null> | null; priorLabel: string | null };

const TONE: Record<string, string> = { up: "text-status-success", down: "text-status-danger", flat: "text-muted-foreground" };

/**
 * ONE block of this workspace: a heading, an optional band of headline numbers each naming what it was
 * counted over, an optional chart, and whatever else belongs under it. Every headline number carries its
 * OWN basis line, because a percentage with no denominator beside it is the oldest lie in this business.
 */
export function Panel({ title, note, tiles, chart, actions, children }: {
  title: string; note?: string | null; tiles?: Array<{ label: string; value: string; basis: string; delta: string | null; tone: "up" | "down" | "flat" }>;
  chart?: Chart | null; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-raised px-4 py-3.5" data-visibility-panel={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-foreground/70">{title}</h2>
        {actions}
      </div>
      {note ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{note}</p> : null}
      {tiles && tiles.length > 0 ? (
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-border bg-surface-inset/50 px-3 py-2.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t.label}</dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="text-[22px] font-semibold tabular-nums leading-none tracking-tight text-foreground">{t.value}</span>
                {t.delta ? <span className={`text-[12px] font-semibold tabular-nums ${TONE[t.tone]}`}>{t.delta}</span> : null}
              </dd>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t.basis}</p>
            </div>
          ))}
        </dl>
      ) : null}
      {chart ? <div className="mt-3"><TrendChart chart={chart} /></div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function TrendChart({ chart, height = H }: { chart: Chart; height?: number }) {
  const values = chart.points.map((p) => p.value);
  const prior = chart.prior && chart.prior.length === values.length ? chart.prior : null;
  const real = [...values, ...(prior ?? [])].filter((v): v is number => v != null);
  if (real.length === 0) {
    return <p className="px-1 py-6 text-[13px] text-muted-foreground">Not one day in this stretch has been read closely enough to draw a line. A line is never drawn out of nothing.</p>;
  }
  const max = chart.percent ? Math.max(0.1, Math.min(1, Math.max(...real) * 1.25)) : Math.max(1, ...real) * 1.1;
  const fmt = (v: number): string => chart.percent ? `${Math.round(v * 100)}%` : Math.round(v).toLocaleString("en-US");
  const n = values.length;
  const ticks = [...new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1])].filter((i) => i >= 0 && i < n);
  const area = values.map((v, i) => (v == null ? null : `${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`)).filter((s): s is string => !!s);
  const firstReal = values.findIndex((v) => v != null), lastReal = n - 1 - [...values].reverse().findIndex((v) => v != null);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${chart.label} per day`} className="w-full" style={{ maxHeight: `${height}px` }}>
        <defs>
          <linearGradient id="vis-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yAt(max * f, max)} y2={yAt(max * f, max)} stroke="currentColor" strokeOpacity={f === 0 ? 0.18 : 0.07} />
            <text x={PAD_L - 8} y={yAt(max * f, max) + 3} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.45" className="tabular-nums">{fmt(max * f)}</text>
          </g>
        ))}
        {prior ? <path d={pathOf(prior, max)} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.6" strokeDasharray="4 4" strokeLinecap="round" /> : null}
        {area.length > 1 ? <path d={`M${xAt(firstReal, n).toFixed(1)},${yAt(0, max).toFixed(1)} L${area.join(" L")} L${xAt(lastReal, n).toFixed(1)},${yAt(0, max).toFixed(1)} Z`} fill="url(#vis-fill)" /> : null}
        <path d={pathOf(values, max)} fill="none" stroke="var(--color-chart-1)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {/* EVERY DAY ANSWERS FOR ITSELF ON HOVER, however long the stretch: a dense line drew no dots at all,
            so a reader could see the shape and never the date or the number behind any point of it. */}
        {values.map((v, i) => v == null ? null : (
          <circle key={chart.points[i]!.day} cx={xAt(i, n)} cy={yAt(v, max)} r={n > 40 ? 4 : 2.6} fill="var(--background)"
            fillOpacity={n > 40 ? 0 : 1} stroke="var(--color-chart-1)" strokeWidth={n > 40 ? 0 : 1.4}>
            <title>{`${chart.points[i]!.label}: ${fmt(v)}`}</title>
          </circle>
        ))}
        {ticks.map((i) => (
          <text key={i} x={xAt(i, n)} y={height - 8} fontSize="10" fill="currentColor" fillOpacity="0.45"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{chart.points[i]!.label}</text>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--color-chart-1)" }} />{chart.label}</span>
        {prior && chart.priorLabel ? <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-current opacity-40" />{chart.priorLabel}</span> : null}
        {values.some((v) => v == null) ? <span>A day with nothing to compute this from leaves a gap. A gap is never filled in.</span> : null}
      </figcaption>
    </figure>
  );
}

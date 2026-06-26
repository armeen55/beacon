/**
 * trend-radar/spike-detector (2026-06-25, Sprint 6 · plan P7) — PURE.
 *
 * The weekly-trend substrate already buckets trailing weeks + classifies
 * growing/flat/declining at ±8% drift (`today-trend-rows.ts`). The plan's P7
 * Trend Radar calls out the NET-NEW piece: a *spike/anomaly* threshold — a sharp
 * week-over-week jump (default ≥35%) that signals a time-boxed opportunity (a
 * query/topic suddenly heating up), distinct from slow drift.
 *
 * This module turns weekly series into ranked SpikeSignals. Deterministic, $0,
 * no I/O. Fail-closed: needs ≥2 weeks + a real prior baseline (no divide-by-zero
 * guesses; a 0→N emergence is flagged separately as `emerging`, never as a % jump).
 */

export type WeeklySeries = {
  /** the thing trending — a query, topic, or page label */
  label: string;
  /** trailing weekly values, OLDEST → NEWEST (e.g. impressions or clicks per week) */
  weeks: number[];
  /** optional context carried through to the signal (url, cluster, etc.) */
  meta?: Record<string, string | number | null>;
};

export type SpikeSignal = {
  label: string;
  kind: "spike" | "emerging" | "collapse";
  recentValue: number;
  priorValue: number;
  /** week-over-week change vs the prior baseline; null for `emerging` (0 baseline) */
  jumpPct: number | null;
  severity: "high" | "medium";
  meta?: Record<string, string | number | null>;
};

export type SpikeOptions = {
  /** min WoW jump to count as a spike (fraction, default 0.35 = +35%) */
  spikeThreshold?: number;
  /** jump at/above this → severity high (default 1.0 = +100%) */
  highThreshold?: number;
  /** min recent value to bother flagging (filters noise on tiny numbers) */
  minRecent?: number;
  /** how many trailing weeks to average for the prior baseline (default 1 = last week) */
  baselineWeeks?: number;
  /** also surface sharp collapses (recent ≤ -spikeThreshold vs prior) */
  includeCollapse?: boolean;
};

const DEFAULTS = { spikeThreshold: 0.35, highThreshold: 1.0, minRecent: 10, baselineWeeks: 1, includeCollapse: false };

/** Detect spikes/emergence/collapse across many weekly series. PURE. Sorted by magnitude. */
export function detectSpikes(series: WeeklySeries[], opts: SpikeOptions = {}): SpikeSignal[] {
  const o = { ...DEFAULTS, ...opts };
  const out: SpikeSignal[] = [];

  for (const s of series) {
    const w = s.weeks.filter((n) => Number.isFinite(n));
    if (w.length < 2) continue;
    const recent = w[w.length - 1];
    if (recent < o.minRecent && recent > -o.minRecent) {
      // tiny recent value — only interesting if it's a genuine emergence from 0
      // handled below; otherwise skip noise
    }
    const baseSlice = w.slice(Math.max(0, w.length - 1 - o.baselineWeeks), w.length - 1);
    const prior = baseSlice.length ? baseSlice.reduce((a, b) => a + b, 0) / baseSlice.length : 0;

    // Emergence: no prior demand, now real demand → time-boxed new opportunity.
    if (prior <= 0) {
      if (recent >= o.minRecent) {
        out.push({ label: s.label, kind: "emerging", recentValue: recent, priorValue: 0, jumpPct: null, severity: recent >= o.minRecent * 5 ? "high" : "medium", meta: s.meta });
      }
      continue;
    }

    const jump = (recent - prior) / prior;
    if (recent >= o.minRecent && jump >= o.spikeThreshold) {
      out.push({ label: s.label, kind: "spike", recentValue: recent, priorValue: Math.round(prior), jumpPct: jump, severity: jump >= o.highThreshold ? "high" : "medium", meta: s.meta });
    } else if (o.includeCollapse && prior >= o.minRecent && jump <= -o.spikeThreshold) {
      out.push({ label: s.label, kind: "collapse", recentValue: recent, priorValue: Math.round(prior), jumpPct: jump, severity: jump <= -o.highThreshold ? "high" : "medium", meta: s.meta });
    }
  }

  // rank: high before medium, then by absolute magnitude (emerging ranks by recent value)
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    const am = a.jumpPct === null ? a.recentValue : Math.abs(a.jumpPct);
    const bm = b.jumpPct === null ? b.recentValue : Math.abs(b.jumpPct);
    return bm - am;
  });
}

/** One-line human summary of a spike (for cards). PURE. */
export function describeSpike(sig: SpikeSignal): string {
  if (sig.kind === "emerging") return `New demand: ${sig.recentValue.toLocaleString()} this week (none before) — act while it's fresh`;
  const pct = sig.jumpPct === null ? "" : `${sig.jumpPct >= 0 ? "+" : ""}${Math.round(sig.jumpPct * 100)}%`;
  if (sig.kind === "collapse") return `Dropping fast: ${pct} week-over-week (${sig.priorValue.toLocaleString()} → ${sig.recentValue.toLocaleString()})`;
  return `Heating up: ${pct} week-over-week (${sig.priorValue.toLocaleString()} → ${sig.recentValue.toLocaleString()})`;
}

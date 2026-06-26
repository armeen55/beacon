/**
 * referral-signals (2026-06-25, Sprint 6) — turn the DEAD `profound_referral_rows`
 * table into a real signal. PURE / deterministic / no I/O.
 *
 * AI-referral visits are the realest money signal Beacon has from Profound: ACTUAL
 * visitors an AI assistant sent to a page (vs. mere visibility/citation share). This
 * module aggregates per-page AI-referred traffic and measures before/after lift
 * around a treatment date so it can feed the proof loop ("did AI start sending more
 * traffic after the change?"). No fabrication — empty rows → empty signal.
 *
 * Pinned by referral-signals.test.ts.
 */

export type ProfoundReferralRow = {
  date: string; // YYYY-MM-DD
  path: string;
  referralSource: string; // e.g. "chatgpt.com", "perplexity.ai"
  referralType: string; // e.g. "ai_assistant"
  visits: number;
};

export type AiReferralByPage = {
  path: string;
  visits: number;
  /** Distinct AI sources that sent traffic, largest first. */
  sources: { source: string; visits: number }[];
  firstDate: string | null;
  lastDate: string | null;
};

function canonPath(p: string): string {
  if (!p) return "/";
  let path = p;
  try {
    path = p.startsWith("http") ? new URL(p).pathname : p;
  } catch {
    /* raw */
  }
  path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path.toLowerCase();
}

/** Aggregate AI-referral visits per page, sources ranked. PURE. */
export function aggregateReferralsByPage(rows: ProfoundReferralRow[]): AiReferralByPage[] {
  const byPage = new Map<string, { visits: number; sources: Map<string, number>; first: string | null; last: string | null }>();
  for (const r of rows) {
    if (!r.path || (r.visits ?? 0) <= 0) continue;
    const key = canonPath(r.path);
    const e = byPage.get(key) ?? { visits: 0, sources: new Map(), first: null, last: null };
    e.visits += r.visits;
    e.sources.set(r.referralSource || "unknown", (e.sources.get(r.referralSource || "unknown") ?? 0) + r.visits);
    if (r.date) {
      if (!e.first || r.date < e.first) e.first = r.date;
      if (!e.last || r.date > e.last) e.last = r.date;
    }
    byPage.set(key, e);
  }
  return [...byPage.entries()]
    .map(([path, e]) => ({
      path,
      visits: e.visits,
      sources: [...e.sources.entries()].map(([source, visits]) => ({ source, visits })).sort((a, b) => b.visits - a.visits),
      firstDate: e.first,
      lastDate: e.last,
    }))
    .sort((a, b) => b.visits - a.visits);
}

export type ReferralOutcome = {
  path: string;
  beforeVisits: number;
  afterVisits: number;
  deltaPct: number | null;
  windowDays: number;
  verdict: "rose" | "fell" | "flat" | "no_data";
};

/** Before/after AI-referral lift around a treatment date (for proof). PURE.
 *  Sums visits in [t-windowDays, t) vs [t, t+windowDays). */
export function referralOutcomeForPage(
  rows: ProfoundReferralRow[],
  path: string,
  treatmentDateISO: string,
  windowDays = 14,
): ReferralOutcome {
  const key = canonPath(path);
  const t = Date.parse(treatmentDateISO);
  const dayMs = 86_400_000;
  let before = 0;
  let after = 0;
  let any = false;
  for (const r of rows) {
    if (canonPath(r.path) !== key || !r.date) continue;
    const d = Date.parse(r.date);
    if (Number.isNaN(d)) continue;
    if (d >= t - windowDays * dayMs && d < t) {
      before += r.visits;
      any = true;
    } else if (d >= t && d < t + windowDays * dayMs) {
      after += r.visits;
      any = true;
    }
  }
  if (!any) return { path: key, beforeVisits: 0, afterVisits: 0, deltaPct: null, windowDays, verdict: "no_data" };
  const deltaPct = before > 0 ? (after - before) / before : after > 0 ? 1 : 0;
  const verdict = deltaPct >= 0.15 ? "rose" : deltaPct <= -0.15 ? "fell" : "flat";
  return { path: key, beforeVisits: before, afterVisits: after, deltaPct, windowDays, verdict };
}

export function summarizeReferrals(rows: ProfoundReferralRow[]): {
  totalVisits: number;
  pages: number;
  topSources: { source: string; visits: number }[];
} {
  const bySource = new Map<string, number>();
  let total = 0;
  const pages = new Set<string>();
  for (const r of rows) {
    if ((r.visits ?? 0) <= 0) continue;
    total += r.visits;
    pages.add(canonPath(r.path));
    bySource.set(r.referralSource || "unknown", (bySource.get(r.referralSource || "unknown") ?? 0) + r.visits);
  }
  return {
    totalVisits: total,
    pages: pages.size,
    topSources: [...bySource.entries()].map(([source, visits]) => ({ source, visits })).sort((a, b) => b.visits - a.visits).slice(0, 8),
  };
}

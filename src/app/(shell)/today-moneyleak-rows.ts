/**
 * today-moneyleak-rows (2026-06-25, L8/CRO axis) — PURE, dependency-free join of
 * GA4 page value × Clarity friction into the site-wide "money leak" list: pages
 * with real traffic that are ALSO frustrating users (dead clicks / rage clicks /
 * quickbacks above threshold). These are conversion leaks — fix the page UX and
 * the existing traffic converts better. Type-only inputs so this is unit-testable
 * without server-only loaders (mirrors today-declines-rows).
 */

// Structural subsets of the real Ga4PageValue / ClarityPageSignal — only what we read.
export type Ga4Like = { page: string; sessions28d: number; conversions28d: number };
export type ClarityLike = {
  url: string;
  deadRate: number;
  rageRate: number;
  quickbackRate: number;
};

export type FrictionKind = "dead" | "rage" | "quickback";
export type MoneyLeakRow = {
  page: string; // canonical URL
  sessions: number;
  conversions: number;
  friction: { kind: FrictionKind; rate: number; pct: number; label: string; directive: string };
};

// What each friction signal actually means + the concrete fix (signal → directive),
// so the row prescribes, not just diagnoses. Generic across tenants/verticals.
const DIRECTIVE: Record<FrictionKind, string> = {
  dead:
    "Visitors keep clicking things that don't respond — make non-links stop looking clickable, or wire up the elements they're tapping (images, headings, buttons).",
  rage:
    "Visitors rapidly re-click the same spot — something feels broken or too slow. Find the element and fix what it's supposed to do.",
  quickback:
    "Visitors bounce straight back to search — the page doesn't deliver what they came for. Lead with a direct answer above the fold that matches the query.",
};

// Thresholds: a page must clear ONE of these to count as a leak. Tuned to be
// conservative (real frustration, not noise) and generic (no tenant specifics).
const DEAD_MIN = 0.2; // ≥20% of sessions have a dead click
const RAGE_MIN = 0.08; // ≥8% have a rage click
const QUICKBACK_MIN = 0.3; // ≥30% bounce straight back

const LABEL: Record<FrictionKind, string> = {
  dead: "dead clicks",
  rage: "rage clicks",
  quickback: "quickbacks",
};

/**
 * Join GA4 value (traffic + conversions) with Clarity friction, keyed by canon
 * URL, and emit the pages leaking money. Ranked by sessions at risk (desc).
 */
export function buildMoneyLeakRows(
  ga4: Ga4Like[],
  clarity: ClarityLike[],
  canon: (u: string) => string,
  opts: { minSessions?: number; cap?: number } = {},
): MoneyLeakRow[] {
  const minSessions = opts.minSessions ?? 50;
  const cap = opts.cap ?? 8;

  const frictionByCanon = new Map<string, ClarityLike>();
  for (const c of clarity) {
    const key = canon(c.url);
    if (key) frictionByCanon.set(key, c);
  }

  const rows: MoneyLeakRow[] = [];
  for (const g of ga4) {
    if (g.sessions28d < minSessions) continue;
    const f = frictionByCanon.get(canon(g.page));
    if (!f) continue;

    // Pick the most severe friction relative to its own threshold so the named
    // problem is the one most worth fixing.
    const candidates: Array<{ kind: FrictionKind; rate: number; ratio: number }> = [
      { kind: "dead", rate: f.deadRate, ratio: f.deadRate / DEAD_MIN },
      { kind: "rage", rate: f.rageRate, ratio: f.rageRate / RAGE_MIN },
      { kind: "quickback", rate: f.quickbackRate, ratio: f.quickbackRate / QUICKBACK_MIN },
    ];
    const worst = candidates.filter((c) => c.ratio >= 1).sort((a, b) => b.ratio - a.ratio)[0];
    if (!worst) continue;

    rows.push({
      page: canon(g.page),
      sessions: g.sessions28d,
      conversions: g.conversions28d,
      friction: {
        kind: worst.kind,
        rate: worst.rate,
        pct: Math.round(worst.rate * 100),
        label: LABEL[worst.kind],
        directive: DIRECTIVE[worst.kind],
      },
    });
  }

  // Most traffic at risk first.
  rows.sort((a, b) => b.sessions - a.sessions);
  return rows.slice(0, cap);
}

/** Total monthly sessions across the leaking pages (the traffic at risk). */
export function moneyLeakSessionsAtRisk(rows: MoneyLeakRow[]): number {
  return rows.reduce((s, r) => s + Math.max(0, r.sessions), 0);
}

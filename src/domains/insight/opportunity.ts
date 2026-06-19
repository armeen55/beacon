/**
 * Insight layer — Opportunity Map (operator-OS rebuild, slice 1).
 *
 * PURE composition over already-computed per-page signals (GSC / SEMrush /
 * Clarity / GA4 / Page Surgeon). No data access here — `compute-opportunity-map.ts`
 * does the I/O and feeds plain inputs into these pure functions so the
 * classification + ranking logic is unit-testable without a database.
 *
 * Every number an OpportunityItem shows traces to a real source signal; the
 * `evidenceBySource` lines carry that provenance. `estClicksAtStake` is an
 * honest, DIRECTIONAL estimate (copy must label it so) — never a promise.
 */

export type OpportunityKind =
  | "ctr_leak"
  | "striking_distance"
  | "decay"
  | "rising"
  | "friction";

export type OpportunitySource = "gsc" | "semrush" | "clarity" | "ga4";

export type OpportunityEvidence = { source: OpportunitySource; line: string };

export type OpportunityItem = {
  canonUrl: string;
  path: string;
  /** Every detected kind for this page (filterable). */
  kinds: OpportunityKind[];
  /** Dominant kind — drives the headline + icon. */
  kind: OpportunityKind;
  /** Short page label (path tail, spaced). */
  title: string;
  /** One-line plain-English "why this matters". */
  why: string;
  evidenceBySource: OpportunityEvidence[];
  /** The action that moves it. */
  expectedLever: string;
  /** Directional estimate of clicks recoverable / at stake — NOT a promise. */
  estClicksAtStake: number;
  /** GA4 value weight (1.0–1.5); neutral when no GA4 data. */
  importance: number;
  hasChangePack: boolean;
  /** Ranking weight = estClicksAtStake × importance. */
  score: number;
};

/** Plain per-page inputs (decoupled from the loader's signal types so this
 *  module stays pure + testable). The loader maps real signals → this shape. */
export type OpportunityPageInput = {
  canonUrl: string;
  path: string;
  gsc?: {
    clicks90d: number;
    impressions90d: number;
    ctr90d: number; // 0–1
    position90d: number;
    topQuery?: string;
  };
  decay?: { clicksNow: number; clicksPrior: number };
  striking?: { keyword: string; position: number; volume: number }[];
  clarity?: { sessions: number; deadClicks: number; rageClicks: number };
  /** GA4 value weight (default 1.0). */
  importance?: number;
  hasChangePack?: boolean;
};

/**
 * Expected organic CTR by average position — a rough, well-sourced curve
 * (GSC-aggregate / advanced-web-ranking style). DIRECTIONAL only; used to
 * size a CTR leak, never as a guarantee.
 */
export function expectedCtrForPosition(position: number): number {
  const table: [number, number][] = [
    [1, 0.27], [2, 0.15], [3, 0.1], [4, 0.07], [5, 0.05],
    [6, 0.04], [7, 0.03], [8, 0.025], [9, 0.02], [10, 0.018],
  ];
  if (position <= 1) return 0.27;
  for (let i = table.length - 1; i >= 0; i--) {
    if (position >= table[i][0]) return table[i][1];
  }
  return 0.015;
}

function pathTail(path: string): string {
  const seg = path.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  return seg ? seg.replace(/-/g, " ") : "home";
}

const CTR_LEAK_MIN_IMPRESSIONS = 500;
const DECAY_DROP_RATIO = 0.8; // clicksNow < 80% of prior
const DECAY_MIN_PRIOR = 15;
const RISING_GROW_RATIO = 1.3;
const RISING_MIN_NOW = 15;
const FRICTION_MIN_DEAD = 10;
const FRICTION_MIN_RAGE = 5;

/** Priority order for choosing the dominant kind (click/revenue impact first). */
const KIND_PRIORITY: OpportunityKind[] = [
  "ctr_leak",
  "striking_distance",
  "decay",
  "friction",
  "rising",
];

/**
 * Classify + score one page from its joined signals. Returns null when the page
 * presents no actionable opportunity. Pure + deterministic.
 */
export function buildOpportunity(
  input: OpportunityPageInput,
): OpportunityItem | null {
  const kinds: OpportunityKind[] = [];
  const evidence: OpportunityEvidence[] = [];
  const importance = input.importance ?? 1.0;
  let estClicksAtStake = 0;
  let why = "";
  let expectedLever = "";

  // ── CTR leak: ranks page-1ish, real impressions, CTR well below expected ──
  if (
    input.gsc &&
    input.gsc.impressions90d >= CTR_LEAK_MIN_IMPRESSIONS &&
    input.gsc.position90d <= 10
  ) {
    const expected = expectedCtrForPosition(input.gsc.position90d);
    if (input.gsc.ctr90d < expected * 0.5) {
      kinds.push("ctr_leak");
      const gain = Math.round(input.gsc.impressions90d * (expected - input.gsc.ctr90d));
      estClicksAtStake = Math.max(estClicksAtStake, gain);
      const ctrPct = (input.gsc.ctr90d * 100).toFixed(2);
      const expPct = (expected * 100).toFixed(1);
      evidence.push({
        source: "gsc",
        line: `Ranks #${input.gsc.position90d.toFixed(1)} for "${input.gsc.topQuery ?? "key terms"}" with ${input.gsc.impressions90d.toLocaleString()} impressions but only ${ctrPct}% CTR (≈${expPct}% expected at this rank).`,
      });
      why = "Ranking well but barely clicked — a title/snippet problem, not a ranking one.";
      expectedLever = "Rewrite the title + meta to match intent → recover clicks at the rank you already hold.";
    }
  }

  // ── Striking distance: page-2 keywords with real volume (SEMrush) ──
  if (input.striking && input.striking.length > 0) {
    kinds.push("striking_distance");
    const vol = input.striking.reduce((s, k) => s + (k.volume || 0), 0);
    estClicksAtStake = Math.max(estClicksAtStake, Math.round(vol * 0.05));
    const top = input.striking[0];
    evidence.push({
      source: "semrush",
      line: `"${top.keyword}" (${(top.volume || 0).toLocaleString()}/mo) sits at position ${top.position} — page 2. ${input.striking.length} striking-distance keyword(s) total.`,
    });
    if (!why) {
      why = "Real search demand one page away — already ranking, just below the fold.";
      expectedLever = "Strengthen the page for these terms (depth + internal links) → push page 2 → page 1.";
    }
  }

  // ── Decay: losing clicks vs the prior window ──
  if (
    input.decay &&
    input.decay.clicksPrior >= DECAY_MIN_PRIOR &&
    input.decay.clicksNow < input.decay.clicksPrior * DECAY_DROP_RATIO
  ) {
    kinds.push("decay");
    const lost = input.decay.clicksPrior - input.decay.clicksNow;
    estClicksAtStake = Math.max(estClicksAtStake, lost);
    evidence.push({
      source: "gsc",
      line: `Clicks fell ${input.decay.clicksPrior} → ${input.decay.clicksNow} vs the prior 28 days (−${lost}).`,
    });
    if (!why) {
      why = "A page that used to perform is sliding — refresh it before it falls further.";
      expectedLever = "Refresh the content + intro answer → arrest the decline.";
    }
  }

  // ── Rising: momentum to protect / amplify ──
  if (
    input.decay &&
    input.decay.clicksNow >= RISING_MIN_NOW &&
    input.decay.clicksNow > input.decay.clicksPrior * RISING_GROW_RATIO
  ) {
    kinds.push("rising");
    const gained = input.decay.clicksNow - input.decay.clicksPrior;
    estClicksAtStake = Math.max(estClicksAtStake, gained);
    evidence.push({
      source: "gsc",
      line: `Clicks rose ${input.decay.clicksPrior} → ${input.decay.clicksNow} (+${gained}) — momentum.`,
    });
    if (!why) {
      why = "This page is taking off — pour fuel on it while it's hot.";
      expectedLever = "Expand + add schema + internal links to ride the momentum.";
    }
  }

  // ── Friction: Clarity dead / rage clicks ──
  if (
    input.clarity &&
    (input.clarity.deadClicks >= FRICTION_MIN_DEAD ||
      input.clarity.rageClicks >= FRICTION_MIN_RAGE)
  ) {
    kinds.push("friction");
    estClicksAtStake = Math.max(
      estClicksAtStake,
      input.clarity.deadClicks + input.clarity.rageClicks,
    );
    evidence.push({
      source: "clarity",
      line: `${input.clarity.deadClicks} dead clicks + ${input.clarity.rageClicks} rage clicks over ${input.clarity.sessions} sessions — visitors clicking things that don't respond.`,
    });
    if (!why) {
      why = "Visitors are hitting dead ends on this page.";
      expectedLever = "Make the clicked elements real links / fix the broken interaction.";
    }
  }

  if (kinds.length === 0) return null;

  const kind = KIND_PRIORITY.find((k) => kinds.includes(k)) ?? kinds[0];

  return {
    canonUrl: input.canonUrl,
    path: input.path,
    kinds,
    kind,
    title: pathTail(input.path),
    why,
    evidenceBySource: evidence,
    expectedLever,
    estClicksAtStake,
    importance,
    hasChangePack: input.hasChangePack ?? false,
    score: Math.round(estClicksAtStake * importance),
  };
}

/** Rank opportunities by score (clicks-at-stake × value weight), highest first. */
export function rankOpportunities(items: OpportunityItem[]): OpportunityItem[] {
  return [...items].sort((a, b) => b.score - a.score);
}

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

import { deriveSerpGuard, type SerpStatus } from "./serp-guard";

export type OpportunityKind =
  | "cannibalization"
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
  /** Pack primary action label when a Change Pack exists — the canonical
   *  per-page action all surfaces agree on (supersedes the diagnosis lever). */
  packAction: string | null;
  /** Window the estimate covers (GSC signals are 90d). */
  estWindow: "90d";
  /** Confidence in the clicks-at-stake ESTIMATE (data-volume driven). */
  estConfidence: "high" | "medium" | "low";
  /** SERP-feature knowledge for this page (Phase 1 broad scan ⇒ "unknown"). */
  serpStatus: SerpStatus;
  /** Non-null when the SERP guard fired (e.g. top-5 + unknown SERP). */
  serpGuardLabel: string | null;
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
  /** Same-query page competition where THIS page is the lead (best-ranking)
   *  URL. Query-level signal attached to the lead page by the compute layer. */
  cannibalization?: {
    query: string;
    urlCount: number;
    combinedImpressions: number;
    combinedClicks: number;
    bestPosition: number;
    /** Other cannibalized queries this lead page also tops (for "+N more"). */
    additionalCases: number;
  };
  decay?: { clicksNow: number; clicksPrior: number };
  striking?: { keyword: string; position: number; volume: number }[];
  clarity?: { sessions: number; deadClicks: number; rageClicks: number };
  /** GA4 value weight (default 1.0). */
  importance?: number;
  hasChangePack?: boolean;
  /** Labeled pack primary action (from compute layer) when a pack exists. */
  packHeadlineAction?: string | null;
  /** SERP-feature knowledge (default "unknown" in the broad scan). */
  serpStatus?: SerpStatus;
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
  return seg ? seg.replace(/-/g, " ") : "Home page";
}

const CTR_LEAK_MIN_IMPRESSIONS = 500;
const DECAY_DROP_RATIO = 0.8; // clicksNow < 80% of prior
const DECAY_MIN_PRIOR = 15;
const RISING_GROW_RATIO = 1.3;
const RISING_MIN_NOW = 15;
const FRICTION_MIN_DEAD = 10;
const FRICTION_MIN_RAGE = 5;

/** Priority order for choosing the dominant kind (most actionable, highest-
 *  movement lever first). Cannibalization sits BELOW the direct-movement kinds:
 *  when a page both leaks CTR and cannibalizes a query, the recoverable money is
 *  the title/snippet rewrite at the rank already held — a structural cluster
 *  move is the hardest, slowest, operator-choice fix, so it only HEADLINES when
 *  it is the page's dominant blocker (no CTR-leak / striking / decay above it).
 *  It always stays a visible secondary signal via `kinds` + its evidence line. */
const KIND_PRIORITY: OpportunityKind[] = [
  "ctr_leak",
  "striking_distance",
  "decay",
  "cannibalization",
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
  const serpStatus: SerpStatus = input.serpStatus ?? "unknown";
  let serpGuardLabel: string | null = null;

  // Per-kind estimate + narrative, resolved to the DOMINANT kind at the end so
  // the displayed number always matches the displayed "why". A cannibalization
  // headline can no longer borrow a CTR-leak's (much larger) clicks-at-stake,
  // and vice-versa — the incoherent "~1,535 clicks · earning 1 click from 618
  // impressions" pairing is structurally impossible now.
  const gainByKind: Partial<Record<OpportunityKind, number>> = {};
  const whyByKind: Partial<Record<OpportunityKind, string>> = {};
  const leverByKind: Partial<Record<OpportunityKind, string>> = {};

  // ── CTR leak: ranks page-1ish, real impressions, CTR well below expected ──
  if (
    input.gsc &&
    input.gsc.impressions90d >= CTR_LEAK_MIN_IMPRESSIONS &&
    input.gsc.position90d <= 10
  ) {
    const expected = expectedCtrForPosition(input.gsc.position90d);
    if (input.gsc.ctr90d < expected * 0.5) {
      kinds.push("ctr_leak");
      gainByKind.ctr_leak = Math.round(
        input.gsc.impressions90d * (expected - input.gsc.ctr90d),
      );
      const ctrPct = (input.gsc.ctr90d * 100).toFixed(2);
      const expPct = (expected * 100).toFixed(1);
      evidence.push({
        source: "gsc",
        line: `Ranks #${input.gsc.position90d.toFixed(1)} for "${input.gsc.topQuery ?? "key terms"}" with ${input.gsc.impressions90d.toLocaleString()} impressions but only ${ctrPct}% CTR (≈${expPct}% expected at this rank).`,
      });
      // SERP guard: on a top-ranked low-CTR page with NO SERP-feature data, a
      // feature (AI Overview / featured snippet / image pack) may own the
      // clicks — DON'T over-claim a title problem. Verify the SERP first.
      const guard = deriveSerpGuard({ position: input.gsc.position90d, serpStatus });
      if (guard.downgrade) {
        serpGuardLabel = guard.label;
        whyByKind.ctr_leak =
          "Likely a title/snippet OR SERP-presentation issue, SERP check needed before rewriting.";
        leverByKind.ctr_leak =
          "Check the live SERP (AI Overview / featured snippet / image pack). If it's clear, rewrite the title + meta to match intent, otherwise the clicks are SERP-owned, not a title problem.";
      } else {
        whyByKind.ctr_leak = "Ranking on page 1 but under-clicked, likely a title/snippet issue.";
        leverByKind.ctr_leak =
          "Rewrite the title + meta to match intent → recover clicks at the rank you already hold.";
      }
    }
  }

  // ── Striking distance: page-2 keywords with real volume (SEMrush) ──
  if (input.striking && input.striking.length > 0) {
    kinds.push("striking_distance");
    const vol = input.striking.reduce((s, k) => s + (k.volume || 0), 0);
    gainByKind.striking_distance = Math.round(vol * 0.05);
    const top = input.striking[0];
    const n = input.striking.length;
    evidence.push({
      source: "semrush",
      line: `"${top.keyword}" (${(top.volume || 0).toLocaleString()}/mo) sits at position ${top.position}, page 2. ${n} striking-distance keyword${n === 1 ? "" : "s"} total.`,
    });
    whyByKind.striking_distance =
      "Real search demand one page away, already ranking, just below the fold.";
    leverByKind.striking_distance =
      "Strengthen the page for these terms (depth + internal links) → push page 2 → page 1.";
  }

  // ── Decay: losing clicks vs the prior window ──
  if (
    input.decay &&
    input.decay.clicksPrior >= DECAY_MIN_PRIOR &&
    input.decay.clicksNow < input.decay.clicksPrior * DECAY_DROP_RATIO
  ) {
    kinds.push("decay");
    const lost = input.decay.clicksPrior - input.decay.clicksNow;
    gainByKind.decay = lost;
    evidence.push({
      source: "gsc",
      line: `Clicks fell ${input.decay.clicksPrior} → ${input.decay.clicksNow} vs the prior 28 days (−${lost}).`,
    });
    whyByKind.decay = "A page that used to perform is sliding, refresh it before it falls further.";
    leverByKind.decay = "Refresh the content + intro answer → arrest the decline.";
  }

  // ── Rising: momentum to protect / amplify ──
  if (
    input.decay &&
    input.decay.clicksNow >= RISING_MIN_NOW &&
    input.decay.clicksNow > input.decay.clicksPrior * RISING_GROW_RATIO
  ) {
    kinds.push("rising");
    const gained = input.decay.clicksNow - input.decay.clicksPrior;
    gainByKind.rising = gained;
    evidence.push({
      source: "gsc",
      line: `Clicks rose ${input.decay.clicksPrior} → ${input.decay.clicksNow} (+${gained}), momentum.`,
    });
    whyByKind.rising = "This page is taking off, pour fuel on it while it's hot.";
    leverByKind.rising = "Expand + add schema + internal links to ride the momentum.";
  }

  // ── Friction: Clarity dead / rage clicks ──
  if (
    input.clarity &&
    (input.clarity.deadClicks >= FRICTION_MIN_DEAD ||
      input.clarity.rageClicks >= FRICTION_MIN_RAGE)
  ) {
    kinds.push("friction");
    gainByKind.friction = input.clarity.deadClicks + input.clarity.rageClicks;
    evidence.push({
      source: "clarity",
      line: `${input.clarity.deadClicks} dead clicks + ${input.clarity.rageClicks} rage clicks over ${input.clarity.sessions} sessions, visitors clicking things that don't respond.`,
    });
    whyByKind.friction = "Visitors are hitting dead ends on this page.";
    leverByKind.friction = "Make the clicked elements real links / fix the broken interaction.";
  }

  // ── Cannibalization: 2+ of the tenant's own URLs split a query (THIS page is
  //    the lead / best-ranking URL). A structural cluster issue. It carries its
  //    OWN cautious estimate + narrative and is ALWAYS pushed as a visible
  //    secondary signal (kinds + evidence line), but only HEADLINES when it is
  //    the dominant kind (KIND_PRIORITY) — i.e. there is no CTR-leak / striking
  //    / decay to fix first. A title rewrite cannot fix duplicate pages, but
  //    neither should a cluster move bury recoverable title money. ──
  if (input.cannibalization) {
    const c = input.cannibalization;
    kinds.push("cannibalization");
    // Cautious, cluster-level estimate: clicks the cluster could recover if it
    // ranked alone at its best position, minus what it earns split today.
    const gain = Math.max(
      0,
      Math.round(
        c.combinedImpressions * expectedCtrForPosition(c.bestPosition) - c.combinedClicks,
      ),
    );
    gainByKind.cannibalization = gain;
    const clk = `${c.combinedClicks.toLocaleString()} click${c.combinedClicks === 1 ? "" : "s"}`;
    const more =
      c.additionalCases > 0
        ? ` (+${c.additionalCases} more quer${c.additionalCases === 1 ? "y" : "ies"})`
        : "";
    evidence.push({
      source: "gsc",
      line: `${c.urlCount} of your pages compete for "${c.query}": ${c.combinedImpressions.toLocaleString()} impressions, ${clk}, best rank #${c.bestPosition.toFixed(1)}.${more}`,
    });
    whyByKind.cannibalization = `${c.urlCount} of your pages compete for "${c.query}", earning ${clk} from ${c.combinedImpressions.toLocaleString()} impressions.`;
    leverByKind.cannibalization =
      "Pick one lead page for this query and point the other pages' internal links at it. A structural cluster fix, not a title rewrite.";
  }

  if (kinds.length === 0) return null;

  const kind = KIND_PRIORITY.find((k) => kinds.includes(k)) ?? kinds[0];

  // Displayed estimate + narrative = the DOMINANT kind's, so the number always
  // matches the "why" the operator reads. Ranking still uses the page's BEST
  // opportunity across all kinds, so a page is never under-ranked just because
  // its headline kind happens to carry the smaller estimate.
  const estClicksAtStake = gainByKind[kind] ?? 0;
  const why = whyByKind[kind] ?? "";
  const expectedLever = leverByKind[kind] ?? "";
  const maxGain = Math.max(0, ...Object.values(gainByKind));

  // Confidence in the estimate is data-volume driven (NOT a SERP claim).
  // Mirrors `estimateConfidence` in page-primary.ts; inlined to avoid a
  // runtime import cycle (page-primary imports OpportunityItem's type).
  // Cannibalization recovery is inherently uncertain (depends on the operator's
  // consolidation choice), so its estimate stays cautious regardless of volume.
  const estConfidence: "high" | "medium" | "low" =
    kind === "cannibalization"
      ? "low"
      : input.gsc
        ? input.gsc.impressions90d >= 3000
          ? "high"
          : input.gsc.impressions90d >= 800
            ? "medium"
            : "low"
        : "low";

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
    packAction: input.packHeadlineAction ?? null,
    estWindow: "90d",
    estConfidence,
    serpStatus,
    serpGuardLabel,
    score: Math.round(maxGain * importance),
  };
}

/** Rank opportunities by score (clicks-at-stake × value weight), highest first. */
export function rankOpportunities(items: OpportunityItem[]): OpportunityItem[] {
  return [...items].sort((a, b) => b.score - a.score);
}

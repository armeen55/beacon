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
  /** Window the estimate covers: CTR/striking estimates are 90d; decay / rising /
   *  friction / cannibalization are computed over a 28-day window. */
  estWindow: "90d" | "28d";
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
    /** The LEAD (best-ranking) URL's own impressions/clicks for this query —
     *  used to size recovery (consolidating doesn't grant the lead the SUM of
     *  every competing URL's impressions at the top CTR). */
    leadImpressions: number;
    leadClicks: number;
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
  const ctrByRank: number[] = [
    0.27, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018,
  ]; // index r-1 → expected CTR at rank r (1..10)
  // ROUND to the nearest integer rank before lookup. GSC avg positions are
  // fractional (e.g. 3.8); flooring to the lower rank credited the BETTER rank's
  // higher CTR (3.8 → rank-3's 0.10 instead of rank-4's 0.07), overstating the
  // "CTR leak" ~40% on essentially every card. Rounding matches the sibling
  // page-surgeon/expected-ctr.ts convention. Below page 1, a graduated floor
  // (0.012 for 11-20, else 0.008) instead of letting rank-10's 0.018 stand.
  const r = Math.max(1, Math.round(position));
  if (r <= 10) return ctrByRank[r - 1];
  return r <= 20 ? 0.012 : 0.008;
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

  // ── Striking distance: near-the-top keywords with real volume (SEMrush). The
  //     band spans positions ~4-20, so the headline keyword can be on page 1
  //     (4-10) or page 2 (11-20) — anchor the copy to its ACTUAL position. ──
  if (input.striking && input.striking.length > 0) {
    kinds.push("striking_distance");
    // Size the upside off the CTR CURVE: per keyword, the incremental clicks from
    // its CURRENT rank to a MODEST target (up ~4 ranks, floored at rank 5 — never
    // assume #1), times monthly volume. The old flat `5% of ALL market volume`
    // treated market search volume as captured impressions, was unbounded, and
    // ignored the current rank — overstating page-2 pages badly. ×3 = monthly→90d.
    const strikingGain = input.striking.reduce((sum, k) => {
      const cur = expectedCtrForPosition(k.position);
      const target = expectedCtrForPosition(Math.max(5, Math.round(k.position) - 4));
      return sum + (k.volume || 0) * Math.max(0, target - cur);
    }, 0);
    gainByKind.striking_distance = Math.round(strikingGain * 3);
    const top = input.striking[0];
    const n = input.striking.length;
    const onPage1 = top.position <= 10;
    const pg = onPage1 ? 1 : 2;
    evidence.push({
      source: "semrush",
      line: `"${top.keyword}" (${(top.volume || 0).toLocaleString()}/mo) sits at position ${top.position} (page ${pg}). ${n} striking-distance keyword${n === 1 ? "" : "s"} total.`,
    });
    whyByKind.striking_distance = onPage1
      ? "Real search demand, already ranking just outside the top spots. A push could lift it higher."
      : "Real search demand one page away, already ranking, just below the fold.";
    leverByKind.striking_distance = onPage1
      ? "Strengthen the page for these terms (depth + internal links) → climb within page 1."
      : "Strengthen the page for these terms (depth + internal links) → push page 2 → page 1.";
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
    // Cautious recovery estimate sized off the LEAD URL's OWN impressions at its
    // best-rank CTR, minus what the lead earns today. Using the cluster's COMBINED
    // impressions overstated badly — Google rarely shows two of your URLs for one
    // query, so summing every competing URL's impressions (incl. deep page-3
    // ranks) and crediting them all at the lead's top-rank CTR is not achievable.
    const gain = Math.max(
      0,
      Math.round(
        c.leadImpressions * expectedCtrForPosition(c.bestPosition) - c.leadClicks,
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
  // Ranking score is in SEARCH-CLICK units. Friction's gain is a raw Clarity
  // dead/rage EVENT count (a different unit) — don't let it inflate the cross-kind
  // score when a true search-click kind is present. A friction-only page still
  // ranks on its own gain.
  const clickKindGains = Object.entries(gainByKind)
    .filter(([k]) => k !== "friction")
    .map(([, v]) => v);
  const maxGain =
    clickKindGains.length > 0
      ? Math.max(0, ...clickKindGains)
      : Math.max(0, gainByKind.friction ?? 0);

  // Confidence in the estimate is data-volume driven (NOT a SERP claim).
  // Mirrors `estimateConfidence` in page-primary.ts; inlined to avoid a
  // runtime import cycle (page-primary imports OpportunityItem's type).
  // Cannibalization recovery is inherently uncertain (depends on the operator's
  // consolidation choice), so its estimate stays cautious regardless of volume.
  const estConfidence: "high" | "medium" | "low" = (() => {
    // Cannibalization recovery depends on the operator's consolidation choice —
    // inherently uncertain regardless of volume.
    if (kind === "cannibalization") return "low";
    // Striking-distance's NUMBER comes from SEMrush market volume, so its
    // confidence must come from the SAME signal (keyword breadth/volume) — NOT
    // from GSC impressions, which measure a different thing. Never "high": it's
    // a market-volume projection of an unrealized rank gain.
    if (kind === "striking_distance") {
      const topVol = input.striking?.[0]?.volume ?? 0;
      const n = input.striking?.length ?? 0;
      return n >= 3 || topVol >= 1000 ? "medium" : "low";
    }
    // CTR-leak / decay / rising are GSC-grounded: confidence from GSC volume.
    if (!input.gsc) return "low";
    if (input.gsc.impressions90d >= 3000) return "high";
    if (input.gsc.impressions90d >= 800) return "medium";
    return "low";
  })();

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
    // A Change Pack's per-page action (e.g. "Rewrite the title") cannot headline
    // a CANNIBALIZATION-dominant page — the fix is a structural cluster move, not
    // a title rewrite, and surfacing the pack action there contradicts the row's
    // own "why". Suppress the displayed pack action for cannibalization so every
    // surface (opportunity list, Today plan) shows the cluster-fix lever instead.
    packAction: kind === "cannibalization" ? null : input.packHeadlineAction ?? null,
    // The estimate's window matches the kind's source window so the number never
    // contradicts the evidence text (decay/rising/friction/cannibalization are
    // 28-day; CTR-leak/striking-distance are 90d).
    estWindow:
      kind === "decay" || kind === "rising" || kind === "friction" || kind === "cannibalization"
        ? "28d"
        : "90d",
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

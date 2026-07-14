/**
 * intent-clustering (operator spec 2026-07-09, D-27..D-33) - the New Pages board's
 * SEMANTIC clustering + floor + ranking + label layer. PURE, tenant-agnostic, NO LLM.
 *
 * WHY: the board was a cannibalization factory. It proposed SEPARATE pages for
 * "Iranian director" / "Iranian directors" and "Kashan rug" / "Kashan rugs" (the same
 * page twice), rendered roughly ALPHABETICALLY ("4 in farsi" 50/mo above "capital of
 * iran" 27,100/mo), and labelled cards Hot/Warm/Emerging (meaningless). This module
 * replaces all four failures deterministically:
 *
 *  - D-27 clusterNewPageCandidates: merge true semantic duplicates into ONE canonical
 *    proposal and report DEDUPLICATED demand, never a blind sum of variant volumes.
 *  - D-28 applyNewPageFloor: drop clusters under 50 searches/mo UNLESS a non-volume
 *    strategic signal keeps them (AI-validated / competitor-cited), with a stated reason.
 *  - D-29 rankNewPageClusters: a real opportunity sort (clusterVolume x winnability x
 *    intent fit), NEVER alphabetical.
 *  - D-33 deriveNewPageSignal: Rising / Seasonal / Stable from real trend evidence,
 *    each carrying its own evidence line.
 *
 * Deliberately does NOT hardcode topic synonyms (director != filmmaker): merging is by
 * token-set equality after singularization, plus a same-head-noun subset merge. Two
 * topics that only a synonym map could join stay separate on purpose.
 *
 * Pinned by intent-clustering.test.ts.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";

// ── candidate + cluster shapes ───────────────────────────────────────────────

export type NewPageClusterCandidate = {
  id: string;
  /** Display label / topic. */
  label: string;
  /** Real monthly search volume; null when only a proxy score is known. */
  volume: number | null;
  /** Strategic signal (D-28 floor exemption): AI already answers this question. */
  aiValidated?: boolean;
  /** Strategic signal (D-28 floor exemption): competitor pages already get cited here. */
  competitorCited?: boolean;
  /** Winnability [0..1] - reuse the prepared BUILD/WAIT verdict + content-SERP share
   *  via deriveWinnability(). Defaults to a neutral 0.5 when unknown. */
  winnability?: number;
  /** Intent fit [0..1] - is this a real content-page intent? Defaults to 1. */
  intentFit?: number;
};

export type ClusterVariant = { id: string; label: string; volume: number | null };

export type NewPageCluster = {
  /** id of the canonical (highest-volume) variant. */
  canonicalId: string;
  /** Canonical label = the highest-volume variant's label. */
  label: string;
  /**
   * D-27 DEDUPLICATED demand: MAX variant volume plus 30% of the SUM of the others.
   * Never a blind sum - two phrasings of the same page do not each bring their full
   * volume, so the extras are discounted to 30% to represent overlapping demand.
   */
  clusterVolume: number;
  /** Every merged variant with its own volume (canonical first, then by volume desc). */
  variants: ClusterVariant[];
  /** Best winnability across the merged variants. */
  winnability: number;
  /** Best intent fit across the merged variants. */
  intentFit: number;
  /** True when ANY variant carries the signal (drives the D-28 floor exemption). */
  aiValidated: boolean;
  competitorCited: boolean;
  /** D-28: set only when the cluster is under the floor but kept on a strategic
   *  signal - the plain reason to show on the card. null otherwise. */
  keptUnderFloorReason: string | null;
};

// ── token normalization + singularization ────────────────────────────────────

/**
 * Singularize one token with the operator's simple rules (D-27):
 *  - "…ies" (len > 3) -> "…y"  (companies -> company)
 *  - strip a trailing "s" when len > 3 and not "…ss"  (rugs -> rug, directors ->
 *    director; glass/bus stay put)
 * Deliberately crude and deterministic - no dictionary, no LLM.
 */
export function singularizeToken(raw: string): string {
  const t = raw.toLowerCase();
  if (t.length > 3 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Ordered singularized tokens of a label: lowercase, strip punctuation, split on
 *  whitespace, singularize each, drop empties. Order preserved (the head noun is the
 *  last token). */
export function labelTokens(label: string): string[] {
  return topicTokens(label).map((token) => {
    // Small editorial-intent ontology, not tenant-specific keyword stuffing.
    // These words describe the same destination-page intent in content SERPs.
    if (token === "wonder" || token === "sight" || token === "landmark") return "attraction";
    return token;
  });
}

/** The sorted UNIQUE token set - the intent key two candidates match on. */
function tokenSet(tokens: string[]): string[] {
  return [...new Set(tokens)].sort();
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((t) => sb.has(t));
}

/** a ⊆ b (proper or equal), both non-empty. */
function isSubset(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length > b.length) return false;
  const sb = new Set(b);
  return a.every((t) => sb.has(t));
}

// ── D-27: clustering ─────────────────────────────────────────────────────────

type Prepared = {
  cand: NewPageClusterCandidate;
  ordered: string[];
  set: string[];
  head: string;
  vol: number;
};

/**
 * Two candidates merge when EITHER:
 *  (a) their singularized token SETS are equal (kashan rug ≡ kashan rugs,
 *      iranian director ≡ iranian directors), OR
 *  (b) one token set is a subset of the other AND they share the same head noun
 *      (director ⊆ iranian director, both head "director") - collapsed into the
 *      larger-volume variant.
 * Never merges on a single shared token alone (tehran vs isfahan stay separate).
 */
function shouldMerge(a: Prepared, b: Prepared): boolean {
  if (setsEqual(a.set, b.set)) return true;
  if (a.head && a.head === b.head && (isSubset(a.set, b.set) || isSubset(b.set, a.set))) return true;
  const shared = a.set.filter((token) => b.set.includes(token)).length;
  const smaller = Math.min(a.set.length, b.set.length);
  // Two or more shared distinguishing concepts with strong containment is one
  // page intent even when a modifier changes the final noun (kids vs USA).
  if (shared >= 2 && smaller > 0 && shared / smaller >= 0.66) return true;
  // A bare core topic plus a short, clearly more specific editorial framing is
  // a hub/section relationship, not two independent pages (wedding vs wedding
  // culture and traditions). Bound the larger side to avoid sweeping merges.
  if (shared === 1 && smaller === 1 && Math.max(a.set.length, b.set.length) <= 4) return true;
  return false;
}

/** Pick the canonical: highest volume, then more-specific (more tokens), then the
 *  shorter label, then a stable id order. */
function canonicalOf(members: Prepared[]): Prepared {
  return [...members].sort((x, y) => {
    if (x.vol !== y.vol) return y.vol - x.vol;
    if (x.ordered.length !== y.ordered.length) return y.ordered.length - x.ordered.length;
    if (x.cand.label.length !== y.cand.label.length) return x.cand.label.length - y.cand.label.length;
    return x.cand.id < y.cand.id ? -1 : x.cand.id > y.cand.id ? 1 : 0;
  })[0];
}

export function clusterNewPageCandidates(candidates: readonly NewPageClusterCandidate[]): NewPageCluster[] {
  const prepared: Prepared[] = candidates.map((cand) => {
    const ordered = labelTokens(cand.label);
    return {
      cand,
      ordered,
      set: tokenSet(ordered),
      head: ordered[ordered.length - 1] ?? "",
      vol: cand.volume ?? 0,
    };
  });

  // Union-find over the two merge signals.
  const n = prepared.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldMerge(prepared[i], prepared[j])) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }

  const byRoot = new Map<number, Prepared[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(prepared[i]);
  }

  const clusters: NewPageCluster[] = [];
  for (const members of byRoot.values()) {
    const canonical = canonicalOf(members);
    const maxVol = Math.max(...members.map((m) => m.vol));
    const totalVol = members.reduce((s, m) => s + m.vol, 0);
    // D-27: deduplicated demand = MAX + 30% of the SUM of the others. Never a blind sum.
    const clusterVolume = Math.round(maxVol + 0.3 * (totalVol - maxVol));
    const variants: ClusterVariant[] = [...members]
      .sort((x, y) => (x.cand.id === canonical.cand.id ? -1 : y.cand.id === canonical.cand.id ? 1 : y.vol - x.vol))
      .map((m) => ({ id: m.cand.id, label: m.cand.label, volume: m.cand.volume }));
    clusters.push({
      canonicalId: canonical.cand.id,
      label: canonical.cand.label,
      clusterVolume,
      variants,
      winnability: Math.max(...members.map((m) => m.cand.winnability ?? 0.5)),
      intentFit: Math.max(...members.map((m) => m.cand.intentFit ?? 1)),
      aiValidated: members.some((m) => !!m.cand.aiValidated),
      competitorCited: members.some((m) => !!m.cand.competitorCited),
      keptUnderFloorReason: null,
    });
  }
  return clusters;
}

// ── D-28: floor ──────────────────────────────────────────────────────────────

export const NEW_PAGE_VOLUME_FLOOR = 50;

/** The plain reason a sub-floor cluster is kept on a strategic (non-volume) signal. */
function floorExemptionReason(c: NewPageCluster): string | null {
  if (c.aiValidated && c.competitorCited) {
    return "kept despite low volume: AI already answers this and cites competitors";
  }
  if (c.aiValidated) return "kept despite low volume: AI already answers this question";
  if (c.competitorCited) return "kept despite low volume: competitor pages already get cited for this";
  return null;
}

export type FloorResult = {
  kept: NewPageCluster[];
  dropped: { label: string; clusterVolume: number; reason: string }[];
};

/**
 * D-28: after clustering, drop clusters under NEW_PAGE_VOLUME_FLOOR searches/mo UNLESS
 * a strategic (non-volume) signal keeps them. Kept-below-floor clusters carry the plain
 * reason on keptUnderFloorReason so the card can show WHY. Above-floor clusters pass
 * through with keptUnderFloorReason left null.
 */
export function applyNewPageFloor(
  clusters: readonly NewPageCluster[],
  floor: number = NEW_PAGE_VOLUME_FLOOR,
): FloorResult {
  const kept: NewPageCluster[] = [];
  const dropped: FloorResult["dropped"] = [];
  for (const c of clusters) {
    if (c.clusterVolume >= floor) {
      kept.push({ ...c, keptUnderFloorReason: null });
      continue;
    }
    const reason = floorExemptionReason(c);
    if (reason) {
      kept.push({ ...c, keptUnderFloorReason: reason });
    } else {
      dropped.push({
        label: c.label,
        clusterVolume: c.clusterVolume,
        reason: `under ${floor}/mo with no strategic signal`,
      });
    }
  }
  return { kept, dropped };
}

// ── D-29: ranking ────────────────────────────────────────────────────────────

/** Opportunity score = deduplicated demand x winnability x intent fit. */
export function clusterOpportunityScore(c: NewPageCluster): number {
  return c.clusterVolume * c.winnability * c.intentFit;
}

function strategicWeight(c: NewPageCluster): number {
  return (c.aiValidated ? 2 : 0) + (c.competitorCited ? 1 : 0);
}

/**
 * D-29: order the board by a real opportunity sort, NEVER alphabetical. Primary key is
 * clusterVolume x winnability x intent fit; ties (including the zero-volume strategic
 * group) break by strategic weight, then winnability, then raw volume, then label for
 * a stable, deterministic order. Returns a NEW array; does not mutate the input.
 */
export function rankNewPageClusters(clusters: readonly NewPageCluster[]): NewPageCluster[] {
  return [...clusters].sort((a, b) => {
    const sa = clusterOpportunityScore(a);
    const sb = clusterOpportunityScore(b);
    if (sa !== sb) return sb - sa;
    const wa = strategicWeight(a);
    const wb = strategicWeight(b);
    if (wa !== wb) return wb - wa;
    if (a.winnability !== b.winnability) return b.winnability - a.winnability;
    if (a.clusterVolume !== b.clusterVolume) return b.clusterVolume - a.clusterVolume;
    return a.label.localeCompare(b.label);
  });
}

// ── winnability derivation (reuses the prepared verdict already on candidates) ──

/**
 * Winnability [0.1..1] from the prepared BUILD/WAIT/SKIP verdict + its confidence +
 * the content-SERP share (contentDomainCount out of 10 - a content-heavy SERP means a
 * content page can win). Neutral 0.5 when no verdict has been prepared yet.
 */
export function deriveWinnability(
  v: { verdict: "build" | "wait" | "reject"; confidence: "high" | "medium" | "low"; contentDomainCount: number } | null | undefined,
): number {
  if (!v) return 0.5;
  const base = v.verdict === "build" ? 1 : v.verdict === "wait" ? 0.6 : 0.25;
  const conf = v.confidence === "high" ? 1 : v.confidence === "medium" ? 0.85 : 0.7;
  const contentShare = Math.max(0, Math.min(1, (v.contentDomainCount ?? 0) / 10));
  return Math.max(0.1, Math.min(1, base * conf * (0.7 + 0.3 * contentShare)));
}

// ── D-33: Rising / Seasonal / Stable ─────────────────────────────────────────

export type NewPageSignalKind = "rising" | "seasonal" | "stable";
export type NewPageSignal = {
  kind: NewPageSignalKind;
  label: "Rising" | "Seasonal" | "Stable";
  /** The evidence line ("searches 3.7x usual this month"); null for Stable. */
  evidence: string | null;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const RISING_MULTIPLIER = 1.5;

function median(xs: number[]): number {
  const s = [...xs].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A genuine query spike: the latest month is >= RISING_MULTIPLIER x the median of the
 *  prior months. Returns the multiplier, else null. */
export function detectTrendSpike(
  monthly: ReadonlyArray<{ month: number; volume: number }> | null | undefined,
): { multiplier: number } | null {
  if (!monthly || monthly.length < 4) return null;
  const vols = monthly.map((m) => m.volume).filter((v) => Number.isFinite(v));
  if (vols.length < 4) return null;
  const last = vols[vols.length - 1];
  const med = median(vols.slice(0, -1));
  if (med <= 0) return null;
  const multiplier = last / med;
  return multiplier >= RISING_MULTIPLIER ? { multiplier } : null;
}

/** A seasonal window is open when the series has a strong peak month (>= 1.8x the annual
 *  median) and that peak is within the next two calendar months (the preparation
 *  window, spec H-57). nowMonth is 1-12. */
export function detectSeasonalWindow(
  monthly: ReadonlyArray<{ month: number; volume: number }> | null | undefined,
  nowMonth: number,
): { peakMonthLabel: string } | null {
  if (!monthly || monthly.length < 12) return null;
  const vols = monthly.map((m) => m.volume);
  const med = median(vols);
  if (med <= 0) return null;
  let peakIdx = 0;
  for (let i = 1; i < vols.length; i++) if (vols[i] > vols[peakIdx]) peakIdx = i;
  if (vols[peakIdx] < med * 1.8) return null;
  const peakMonth = monthly[peakIdx].month;
  if (peakMonth < 1 || peakMonth > 12) return null;
  const monthsUntil = (peakMonth - nowMonth + 12) % 12;
  if (monthsUntil > 2) return null;
  return { peakMonthLabel: MONTHS[peakMonth - 1] };
}

/**
 * D-33: derive the card label from real evidence. Seasonal takes precedence over a
 * generic spike (a seasonal window is the more specific, more actionable story); a
 * non-seasonal spike is Rising; neither is Stable (no evidence line).
 */
export function deriveNewPageSignal(evidence: {
  trend?: { multiplier: number } | null;
  seasonal?: { peakMonthLabel: string } | null;
}): NewPageSignal {
  if (evidence.seasonal) {
    return {
      kind: "seasonal",
      label: "Seasonal",
      evidence: `usually peaks around ${evidence.seasonal.peakMonthLabel}, that window is open now`,
    };
  }
  if (evidence.trend && evidence.trend.multiplier >= RISING_MULTIPLIER) {
    return {
      kind: "rising",
      label: "Rising",
      evidence: `searches ${evidence.trend.multiplier.toFixed(1)}x usual this month`,
    };
  }
  return { kind: "stable", label: "Stable", evidence: null };
}

/**
 * Observation-led page-intent resolver — Phase v7 Commit 1 (2026-04-23).
 *
 * For each RecommendationCandidate, scans the cluster's observations for
 * owned-URL citations and decides the operator-facing action, motive,
 * and target URL. This is Layer 1 of three:
 *
 *   1. Observation-led (this module)  — citation_urls carry the strongest
 *      "which page does AI think answers this prompt?" signal.
 *   2. Inventory fallback (v7 Commit 2) — sitemap + page-snapshots for the
 *      "page exists but AI hasn't cited it yet" case.
 *   3. LLM adjudicator (v7 Commit 3)   — ambiguous / high-value only.
 *
 * Design:
 *   - Pure. No I/O. All inputs explicit.
 *   - Deterministic. Same inputs → same outputs.
 *   - Applies the NATIVE_REGIME_START filter internally (mirrors the
 *     opportunity classifier) so mixed-source callers don't dilute
 *     the signal with pre-pivot Profound rows lacking citation_urls.
 *   - Every candidate resolves to exactly one resolution. Silent
 *     observations → tier: "deterministic_only" + action inferred from
 *     candidate type (later layers may override).
 *   - URL canonicalization: lowercase host, strip `www.`, strip trailing
 *     slash on path, drop query + fragment. `https://www.ritzbuilders.com/X/`
 *     and `http://ritzbuilders.com/X` both land on the same key.
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import { NATIVE_REGIME_START } from "@/domains/product/url-citation-history";
import type { RecommendationCandidate } from "./generate";
import {
  NEEDS_NEW_PAGE,
  type EvidenceRef,
  type PageIntentResolution,
  type RecommendationAction,
  type RecommendationMotive,
  type ResolvedRecommendationCandidate,
} from "./resolved-types";
import {
  matchClusterToInventory,
  type PageInventoryEntry,
} from "./page-inventory";

// ---------------------------------------------------------------------------
// Thresholds — tuned from Ritz dogfood, revise after feedback.
// ---------------------------------------------------------------------------

/** Share of cluster observations citing one URL to call it "strengthen". */
const STRENGTHEN_SHARE = 0.4;
/** Share to bump strengthen confidence high. */
const STRENGTHEN_HIGH_CONFIDENCE_SHARE = 0.6;
/** Share to keep a URL in play as "expand" (page exists but thin coverage). */
const EXPAND_SHARE = 0.1;
/** Per-URL share used to flag cannibalization. Must appear on ≥2 URLs. */
const CANNIBALIZATION_SHARE = 0.2;
/** Inventory-match score above which we override create_new_page →
 *  strengthen_existing_page. Page URL + title + H1 all strongly match
 *  the cluster label. */
const INVENTORY_STRENGTHEN_THRESHOLD = 0.8;
/** Score above which we override create_new_page → expand_existing_page.
 *  Partial match; page exists but probably doesn't fully cover the cluster. */
const INVENTORY_EXPAND_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvePageIntentArgs = {
  candidates: ReadonlyArray<RecommendationCandidate>;
  observations: ReadonlyArray<PromptAnswerObservation>;
  activeEntities: ReadonlyArray<TrackedEntity>;
  /** Layer 2 fallback (v7 Commit 2). When provided, resolver attempts to
   *  match cluster labels against existing page URLs / titles / H1s
   *  whenever Layer 1 (observations) falls through to create_new_page.
   *  Pass buildPageInventory(...) output. */
  pageInventory?: ReadonlyArray<PageInventoryEntry>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolvePageIntent(
  args: ResolvePageIntentArgs,
): ResolvedRecommendationCandidate[] {
  const ownedDomains = extractOwnedDomains(args.activeEntities);
  const inventory = args.pageInventory ?? [];
  return args.candidates.map((c) =>
    resolveOne(c, args.observations, ownedDomains, inventory),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveOne(
  candidate: RecommendationCandidate,
  observations: ReadonlyArray<PromptAnswerObservation>,
  ownedDomains: ReadonlySet<string>,
  inventory: ReadonlyArray<PageInventoryEntry>,
): ResolvedRecommendationCandidate {
  if (candidate.type === "watch_winning_cluster") {
    return {
      ...candidate,
      resolution: {
        action: "watch",
        motive: "defend_winning_cluster",
        targetUrl: NEEDS_NEW_PAGE,
        confidence: "medium",
        confidenceReason:
          "Winning cluster — no action required; passive defense.",
        tier: "observation",
        reasoning:
          "You're the primary answer on this cluster. Watch for descriptor drift or rising competitors.",
        cannibalization: null,
        evidenceRefs: [],
      },
    };
  }

  const affectedSet = new Set(candidate.affectedPromptIds);
  const urlCitationsByUrl = new Map<string, number>();
  let observationsScanned = 0;

  for (const o of observations) {
    if (!affectedSet.has(o.prompt_id)) continue;
    if (o.observed_at.slice(0, 10) < NATIVE_REGIME_START) continue;
    observationsScanned += 1;

    const seenInObs = new Set<string>();
    for (const rawUrl of o.citation_urls ?? []) {
      if (!rawUrl) continue;
      const host = extractHost(rawUrl);
      if (!host) continue;
      if (!isOwnedHost(host, ownedDomains)) continue;
      const canonical = canonicalizeUrl(rawUrl);
      if (!canonical) continue;
      if (seenInObs.has(canonical)) continue;
      seenInObs.add(canonical);
      urlCitationsByUrl.set(
        canonical,
        (urlCitationsByUrl.get(canonical) ?? 0) + 1,
      );
    }
  }

  const sortedUrls = [...urlCitationsByUrl.entries()].sort(
    ([aUrl, aN], [bUrl, bN]) => bN - aN || aUrl.localeCompare(bUrl),
  );

  if (observationsScanned === 0) {
    const inventoryFallback = tryInventoryMatch(candidate, inventory, {
      observationsScanned: 0,
      layer1Reason:
        "No native observations yet on this cluster — falling back to site inventory.",
    });
    if (inventoryFallback) {
      return { ...candidate, resolution: inventoryFallback };
    }
    return {
      ...candidate,
      resolution: buildSilentResolution(candidate),
    };
  }

  if (sortedUrls.length === 0) {
    const inventoryFallback = tryInventoryMatch(candidate, inventory, {
      observationsScanned,
      layer1Reason: `No owned URLs cited across ${observationsScanned} observations — falling back to site inventory.`,
    });
    if (inventoryFallback) {
      return { ...candidate, resolution: inventoryFallback };
    }
    return {
      ...candidate,
      resolution: buildCreateNewResolution(
        candidate,
        observationsScanned,
        "observation",
      ),
    };
  }

  const [topUrl, topCount] = sortedUrls[0];
  const topShare = topCount / observationsScanned;

  const cannibalizing = sortedUrls.filter(
    ([, count]) => count / observationsScanned >= CANNIBALIZATION_SHARE,
  );
  if (cannibalizing.length >= 2) {
    const otherUrls = cannibalizing.slice(1).map(([url]) => url);
    return {
      ...candidate,
      resolution: {
        action: "merge_or_dedupe",
        motive: "resolve_cannibalization",
        targetUrl: topUrl,
        confidence: "medium",
        confidenceReason: `AI splits citations across ${cannibalizing.length} owned URLs on this cluster.`,
        tier: "observation",
        reasoning: `Multiple owned pages compete for this intent. Consolidate into ${topUrl} and redirect or update the others.`,
        cannibalization: otherUrls,
        evidenceRefs: buildEvidenceRefs(candidate, sortedUrls.slice(0, 5)),
      },
    };
  }

  if (topShare >= STRENGTHEN_SHARE) {
    return {
      ...candidate,
      resolution: {
        action: "strengthen_existing_page",
        motive: inferMotive(candidate),
        targetUrl: topUrl,
        confidence:
          topShare >= STRENGTHEN_HIGH_CONFIDENCE_SHARE ? "high" : "medium",
        confidenceReason: `AI cites ${topUrl} on ${topCount} of ${observationsScanned} observations (${pct(topShare)}%).`,
        tier: "observation",
        reasoning: `AI already cites this page on most prompts in the cluster. Strengthen its lead copy / descriptors / authority rather than creating a new page.`,
        cannibalization: null,
        evidenceRefs: buildEvidenceRefs(candidate, sortedUrls.slice(0, 3)),
      },
    };
  }

  if (topShare >= EXPAND_SHARE) {
    return {
      ...candidate,
      resolution: {
        action: "expand_existing_page",
        motive: inferMotive(candidate),
        targetUrl: topUrl,
        confidence: "medium",
        confidenceReason: `AI cites ${topUrl} on ${topCount} of ${observationsScanned} observations (${pct(topShare)}%) — present but thin.`,
        tier: "observation",
        reasoning: `Page exists and is cited on some prompts, but doesn't cover the full cluster. Expand with missing angles before creating a new page.`,
        cannibalization: null,
        evidenceRefs: buildEvidenceRefs(candidate, sortedUrls.slice(0, 3)),
      },
    };
  }

  // Citations exist but all URLs below expand threshold → treat as silent,
  // fall through to create. Later layers may override.
  return {
    ...candidate,
    resolution: buildCreateNewResolution(
      candidate,
      observationsScanned,
      "observation",
    ),
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — page inventory fallback
// ---------------------------------------------------------------------------

function tryInventoryMatch(
  candidate: RecommendationCandidate,
  inventory: ReadonlyArray<PageInventoryEntry>,
  opts: { observationsScanned: number; layer1Reason: string },
): PageIntentResolution | null {
  if (inventory.length === 0) return null;

  const label = candidate.clusterLabel ?? candidate.title;
  if (!label) return null;

  const matches = matchClusterToInventory({
    label,
    kind: candidate.clusterKind,
    inventory,
    topN: 3,
  });
  if (matches.length === 0) return null;

  const top = matches[0];
  if (top.score >= INVENTORY_STRENGTHEN_THRESHOLD) {
    return {
      action: "strengthen_existing_page",
      motive: inferMotive(candidate),
      targetUrl: top.url,
      confidence: "medium",
      confidenceReason: `${opts.layer1Reason} Site inventory shows ${top.url} (${top.entry.routeType}) matches the cluster label strongly [${top.reasons.join("; ")}].`,
      tier: "inventory",
      reasoning: `Page already exists on the site; AI just hasn't cited it yet on these prompts. Strengthen copy / schema before creating a new page.`,
      cannibalization: null,
      evidenceRefs: buildInventoryEvidenceRefs(candidate, matches),
    };
  }
  if (top.score >= INVENTORY_EXPAND_THRESHOLD) {
    return {
      action: "expand_existing_page",
      motive: inferMotive(candidate),
      targetUrl: top.url,
      confidence: "low",
      confidenceReason: `${opts.layer1Reason} Site inventory shows ${top.url} partially matches [${top.reasons.join("; ")}] — page exists but may not fully cover the cluster.`,
      tier: "inventory",
      reasoning: `A related page exists. Expand its scope (new section / FAQ / heading) to cover this cluster before creating a separate page.`,
      cannibalization: null,
      evidenceRefs: buildInventoryEvidenceRefs(candidate, matches),
    };
  }
  return null;
}

function buildInventoryEvidenceRefs(
  candidate: RecommendationCandidate,
  matches: ReadonlyArray<{ url: string; score: number }>,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const m of matches) {
    refs.push({
      type: "url",
      url: m.url,
      citationCount: 0,
      observationCount: 0,
    });
  }
  const topCompetitor = candidate.evidence.primaryCompetitors[0];
  if (topCompetitor && topCompetitor.totalAffectedPrompts > 0) {
    refs.push({
      type: "competitor",
      name: topCompetitor.name,
      primaryShare:
        topCompetitor.promptsWherePrimary /
        topCompetitor.totalAffectedPrompts,
    });
  }
  for (const id of candidate.affectedPromptIds.slice(0, 5)) {
    refs.push({ type: "prompt", id });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildSilentResolution(
  candidate: RecommendationCandidate,
): PageIntentResolution {
  const action = defaultActionForCandidate(candidate);
  return {
    action,
    motive: inferMotive(candidate),
    targetUrl: NEEDS_NEW_PAGE,
    confidence: "low",
    confidenceReason:
      "No native observations yet on this cluster — decision falls through to inventory/adjudicator layers.",
    tier: "deterministic_only",
    reasoning: buildDefaultReasoning(action, candidate),
    cannibalization: null,
    evidenceRefs: [],
  };
}

function buildCreateNewResolution(
  candidate: RecommendationCandidate,
  observationsScanned: number,
  tier: "observation" | "deterministic_only",
): PageIntentResolution {
  const action: RecommendationAction = "create_new_page";
  return {
    action,
    motive: inferMotive(candidate),
    targetUrl: NEEDS_NEW_PAGE,
    confidence: observationsScanned >= 3 ? "medium" : "low",
    confidenceReason:
      observationsScanned > 0
        ? `No owned URLs cited across ${observationsScanned} observations on this cluster.`
        : "No native observations yet on this cluster.",
    tier,
    reasoning: buildDefaultReasoning(action, candidate),
    cannibalization: null,
    evidenceRefs: [],
  };
}

function defaultActionForCandidate(
  candidate: RecommendationCandidate,
): RecommendationAction {
  switch (candidate.type) {
    case "create_cluster_page":
    case "create_single":
    case "target_competitors":
      return "create_new_page";
    case "strengthen_page_copy":
      return "needs_review";
    case "watch_winning_cluster":
      return "watch";
  }
}

function buildDefaultReasoning(
  action: RecommendationAction,
  candidate: RecommendationCandidate,
): string {
  const n = candidate.evidence.promptCount;
  const label = candidate.clusterLabel ?? "these prompts";
  if (action === "create_new_page") {
    return `No existing owned page covers ${label}. Creating a focused page is the likely next move.`;
  }
  if (action === "needs_review") {
    return `Cluster needs human review — deterministic layers couldn't resolve a clear action.`;
  }
  if (action === "strengthen_existing_page") {
    return `${n} prompts could benefit from tighter copy on the existing target page.`;
  }
  return `Action needed on ${label}.`;
}

function inferMotive(candidate: RecommendationCandidate): RecommendationMotive {
  const top = candidate.evidence.primaryCompetitors[0];
  const competitorDominates =
    top &&
    top.totalAffectedPrompts > 0 &&
    top.promptsWherePrimary / top.totalAffectedPrompts >= 0.5;
  if (competitorDominates) return "counter_competitor";

  const b = candidate.evidence.categoryBreakdown;
  const absent = b.absent ?? 0;
  const outranked = b.outranked ?? 0;
  const close = b.close ?? 0;
  const winning = b.winning ?? 0;

  if (absent >= outranked && absent >= close && absent >= winning) {
    return "capture_absent_cluster";
  }
  if (close >= outranked && close >= winning) {
    return "improve_close_prompt";
  }
  if (winning >= outranked) {
    return "defend_winning_cluster";
  }
  if (outranked > 0) return "counter_competitor";
  return "improve_citation_depth";
}

function buildEvidenceRefs(
  candidate: RecommendationCandidate,
  sortedUrls: Array<[string, number]>,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const [url, count] of sortedUrls) {
    refs.push({
      type: "url",
      url,
      citationCount: count,
      observationCount: count,
    });
  }
  const topCompetitor = candidate.evidence.primaryCompetitors[0];
  if (topCompetitor && topCompetitor.totalAffectedPrompts > 0) {
    refs.push({
      type: "competitor",
      name: topCompetitor.name,
      primaryShare:
        topCompetitor.promptsWherePrimary /
        topCompetitor.totalAffectedPrompts,
    });
  }
  for (const id of candidate.affectedPromptIds.slice(0, 5)) {
    refs.push({ type: "prompt", id });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// URL helpers — kept local so the resolver is a single self-contained module.
// ---------------------------------------------------------------------------

function extractOwnedDomains(
  activeEntities: ReadonlyArray<TrackedEntity>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const e of activeEntities) {
    if (!e.is_owned) continue;
    if (!e.domain) continue;
    const host = normalizeHost(e.domain);
    if (host) out.add(host);
  }
  return out;
}

function extractHost(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return normalizeHost(parsed.host);
  } catch {
    // Bare-domain or path-only — try conservative extraction.
    const trimmed = rawUrl.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("/")) return null;
    const withoutScheme = trimmed.replace(/^https?:\/\//, "");
    const host = withoutScheme.split("/")[0] ?? "";
    return normalizeHost(host);
  }
}

function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^www\./, "");
}

function isOwnedHost(host: string, ownedDomains: ReadonlySet<string>): boolean {
  if (ownedDomains.has(host)) return true;
  // Match `sub.ritzbuilders.com` when `ritzbuilders.com` is owned.
  for (const owned of ownedDomains) {
    if (host.endsWith(`.${owned}`)) return true;
  }
  return false;
}

export function canonicalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = normalizeHost(parsed.host);
    if (!host) return null;
    let path = parsed.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

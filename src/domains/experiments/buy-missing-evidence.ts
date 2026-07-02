/**
 * buy-missing-evidence (2026-07-02, item 39) - the team should never ship a top pick with the
 * live-Google teammate silent when one $0.003 lookup would let it speak. emitDataforseoOpinion
 * in specialist-opinions.ts abstains whenever extras.serpVerdict is null/undefined - that is
 * honest (never fabricate), but on tonight's TOP picks it is a gap worth closing before the
 * plan record freezes, not after.
 *
 * Two halves, kept separate on purpose:
 *   - findEvidenceGaps: PURE decision logic. No I/O. Given tonight's already-selected picks
 *     (each with its EvidencePacket, when one exists) it answers which ones have a genuinely
 *     silent live-Google voice - no cached SERP pattern for the pick's query, no fresh SERP
 *     history row. Bounded to the top N picks (default 5) so a busy night never fans out
 *     unbounded spend.
 *   - buyEvidenceForPick: the I/O side. Runs ONE targeted DataForSEO SERP check through the
 *     existing capped, fail-closed, cached runSerpQuery gauntlet (dataforseo-serp.ts) and turns
 *     a real snapshot into a SerpValidation (serp-validation.ts) the dataforseo specialist can
 *     read. Fail-soft: any non-"ok" status (disabled, dry_run, capped, error) or an unusable
 *     snapshot returns null - the caller keeps the pick's original abstain, and the batch never
 *     blocks on this.
 *
 * The caller (build-today-preview.ts) is responsible for the idempotency + re-review wiring:
 * runSerpQuery's own 14-day cache means a query bought once for a pick is never bought again
 * that day (or for two weeks), so "one attempt per pick per night" falls out of the existing
 * cache for free - no new store needed.
 */

import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import type { SerpValidation } from "@/domains/serp/serp-validation";
import { validateCreatePage } from "@/domains/serp/serp-validation";
import { runSerpQuery, type SerpRunResult } from "@/domains/serp/dataforseo-serp";

/** The minimal shape findEvidenceGaps needs from a nightly pick - a BuiltCandidate satisfies
 *  this structurally (targetQuery + an optional packet the caller looked up by page path). */
export type EvidenceGapCandidate = {
  /** Stable identity for logging/tests - normally the pick's url. */
  url: string;
  /** The search this pick targets - what we'd buy a live SERP check for. */
  targetQuery: string;
  /** The fused evidence packet for this pick's page, when one exists. Null/undefined when the
   *  page has no packet (the team never reviewed it) - such picks are never a "gap": there is
   *  no debate to complete. */
  packet?: EvidencePacket | null;
  /** Raw opportunity ranking - the caller's top-N ordering (e.g. ctrOpportunityClicks). Higher
   *  ranks first when bounding to the top N picks. */
  rankScore: number;
  /** A cached SERP pattern already exists for this pick's query (research-enrichment-producer's
   *  14d cache) - when true, the live-Google voice has SOMETHING to say even if the dataforseo
   *  specialist opinion itself is fed from a different verdict source; still counted as covered
   *  so we never spend twice on the same query the night already fetched. */
  hasCachedSerpPattern?: boolean;
  /** A fresh (within the caller's own freshness window) SERP history row already exists for
   *  this exact query - same reasoning as hasCachedSerpPattern. */
  hasFreshSerpHistory?: boolean;
};

export type EvidenceGap = {
  candidate: EvidenceGapCandidate;
  query: string;
};

const MAX_GAPS_PER_NIGHT = 5;

/** Does this candidate's packet already carry a live-Google (dataforseo) opinion? Mirrors the
 *  exact abstain condition in emitDataforseoOpinion (extras.serpVerdict null -> null opinion) -
 *  we don't re-run the emitter here (this module has no extras to feed it), we ask the plainer
 *  question the emitter itself would ask: is there ANY evidence a live SERP was already read
 *  for this pick (a cached pattern or a fresh history row)? Both are populated only when a real
 *  DataForSEO read happened, so "yes" here means the dataforseo specialist had something to work
 *  with even before this module runs.
 */
function hasLiveSerpEvidence(c: EvidenceGapCandidate): boolean {
  return Boolean(c.hasCachedSerpPattern || c.hasFreshSerpHistory);
}

/**
 * PURE. Given tonight's picks (already selected, already team-reviewed once), return the ones
 * whose live-Google voice is genuinely silent - no packet means nothing to debate (skip), a
 * packet with existing SERP evidence means the teammate already has something to say (skip),
 * and everything else is a real gap worth one targeted buy. Bounded to the top
 * `maxGaps` picks by `rankScore` (default 5, per item 39's bound) so a busy night can never
 * balloon into an unbounded spend fan-out.
 */
export function findEvidenceGaps(
  picks: readonly EvidenceGapCandidate[],
  opts: { maxGaps?: number } = {},
): EvidenceGap[] {
  const maxGaps = opts.maxGaps ?? MAX_GAPS_PER_NIGHT;
  if (maxGaps <= 0) return [];

  const ranked = [...picks].sort((a, b) => b.rankScore - a.rankScore).slice(0, maxGaps);
  const gaps: EvidenceGap[] = [];
  for (const c of ranked) {
    if (!c.packet) continue; // no packet -> no debate to complete, nothing to buy for
    const query = c.targetQuery.trim();
    if (!query) continue; // nothing to search for -> not a real gap
    if (hasLiveSerpEvidence(c)) continue; // the teammate already has evidence -> not silent
    gaps.push({ candidate: c, query });
  }
  return gaps;
}

export type EvidencePurchaseResult = {
  query: string;
  status: "bought" | "declined";
  /** Why a purchase didn't land ("dry_run", "disabled", "capped", "error", "no_results") -
   *  present only when status is "declined". Never thrown - the caller fails soft to the
   *  original abstain. */
  declineReason?: string;
  /** The fresh live-Google verdict, ready to feed specialist-opinions.ts's extras.serpVerdict.
   *  Present only when status is "bought". */
  serpVerdict?: SerpValidation;
  /** Real spend recorded by the gauntlet (0 unless status is "bought"). */
  costUsd: number;
  /** One first-person, plain-language sentence for the pick's "how we know" evidence -
   *  present only when status is "bought". No em or en dashes, ever. */
  receiptSentence?: string;
};

function receiptSentenceFor(query: string, v: SerpValidation): string {
  const verdictPlain: Record<SerpValidation["verdict"], string> = {
    build: "worth building",
    wait: "not ready to build yet",
    reject: "not winnable as a new page",
  };
  const lead = `I checked Google live before finalizing this pick: for "${query}" the top results say this is ${verdictPlain[v.verdict]}.`;
  const reason = v.reasons[0] ? ` ${v.reasons[0]}` : "";
  return `${lead}${reason}`;
}

/**
 * Run ONE targeted DataForSEO SERP check for a single evidence gap, through the existing
 * capped, fail-closed, 14-day-cached runSerpQuery gauntlet - the SAME gauntlet every other
 * DataForSEO caller in this codebase rides (dry-run default, hard monthly cap, durable ledger).
 * This function never bypasses it and never retries past one attempt.
 *
 * Fail-soft by construction: disabled/dry-run/capped/error/empty-results all resolve to
 * status "declined" with a reason, never a thrown error - the caller keeps the pick's original
 * abstain and the nightly batch is never blocked on this call.
 */
export async function buyEvidenceForPick(
  gap: EvidenceGap,
  opts: {
    ownDomain?: string | null;
    profoundDomains?: readonly string[];
    /** Injectable for tests - defaults to the real gauntleted runSerpQuery. Never bypass the
     *  gauntlet in production code; this exists solely so tests never hit the network/env. */
    runQuery?: (query: string) => Promise<SerpRunResult>;
  } = {},
): Promise<EvidencePurchaseResult> {
  const query = gap.query;
  const doRun = opts.runQuery ?? ((q: string) => runSerpQuery(q));
  let run: SerpRunResult;
  try {
    run = await doRun(query);
  } catch {
    return { query, status: "declined", declineReason: "error", costUsd: 0 };
  }

  if (run.status === "error") return { query, status: "declined", declineReason: "error", costUsd: 0 };
  if (run.status === "disabled") return { query, status: "declined", declineReason: "disabled", costUsd: 0 };
  if (run.status === "dry_run") return { query, status: "declined", declineReason: "dry_run", costUsd: 0 };
  if (run.status === "capped") return { query, status: "declined", declineReason: "capped", costUsd: 0 };
  // status is "ok" or "cache_hit" from here - both are a genuine, usable read.
  if (!run.snapshot || run.snapshot.results.length === 0) {
    return { query, status: "declined", declineReason: "no_results", costUsd: run.costUsd };
  }

  // ownDomain is a bare domain (e.g. "iranopedia.com"), never the page URL - callers should pass
  // the tenant's real domain; absent that we have no honest fallback, so "" (validateCreatePage
  // treats an empty own-domain as "never matches", the safe default - it never fabricates a
  // false "you already rank").
  const ownDomain = opts.ownDomain ?? "";
  const packet = gap.candidate.packet;
  const profoundDomains =
    opts.profoundDomains ??
    (packet?.competitor.domain
      ? [packet.competitor.domain, ...(packet.competitor.otherUrls ?? [])]
      : []);

  const serpVerdict = validateCreatePage({
    snapshot: run.snapshot,
    ownDomain: ownDomain || "",
    profoundDomains,
  });

  return {
    query,
    status: "bought",
    serpVerdict,
    costUsd: run.costUsd,
    receiptSentence: receiptSentenceFor(query, serpVerdict),
  };
}

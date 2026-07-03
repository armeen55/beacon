/**
 * stale-fact-trigger (BEACON_500 R13b / N25 + N27, 2026-07-03) - predicate
 * `stale_fact`, the claim-conflict trigger's sibling in the SAME family and
 * the SAME cap-3 slot.
 *
 * PURE / no I/O / no LLM. The nightly claim-graph rebuild (N27,
 * provenance/claim-graph.ts) has already flipped every claim whose newest
 * source observation is past its volatility class's freshness deadline to
 * status "stale_check_due" (fast 180 days, slow 540, static never). This
 * module sweeps those claims sitewide, groups them by their home page, ranks
 * the pages by GSC traffic, and shapes the top pages into candidates with
 * the honest sentence:
 *
 *   "Your /iran-population page cites a 2023 population figure I last
 *    confirmed 8 months ago. Numbers like this age; worth a fresh check."
 *
 * Law 2 (calibrated abstention): the sentence says the fact is OLD, never
 * that it is wrong. There is no mechanical edit to draft until a fresh value
 * exists, so the action is `watch` (track without editing), the registry's
 * existing passive action. `stale_fact::watch` has NO promotion-eligibility
 * entry, so it can never auto-push regardless of confidence - the exact
 * posture of claim_conflict::watch.
 *
 * The shared slot: claimTriggerSlot() emits conflicts first, then stale
 * checks fill whatever remains of the cap-3 slot (conflicts outrank stale
 * checks when both exist - a live disagreement beats an aging fact).
 *
 * @no-classifier-required: the anchor is a known owned page URL taken
 * directly from the claim record's affectedPages (a page_snapshots-derived
 * fact), not a crawled snapshot - neither `classifyPageType` nor
 * `isNonHtmlAsset` applies. (Sanctioned opt-out per the page-classifier
 * architecture invariant, same shape as claim-conflict-trigger.ts.)
 */

import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import { dedupeKey } from "@/domains/recommendation-intelligence/emitter/dedupe-key";
import { cooldownKey } from "@/domains/recommendation-intelligence/emitter/cooldown-key";
import { staleFactCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import {
  findClaimConflicts,
  freshnessDeadlineDays,
  pathOfUrl,
  relativeAge,
  type ClaimRecord,
} from "./claim-graph";
import {
  claimConflictCandidates,
  MAX_CLAIM_CONFLICT_CANDIDATES,
} from "./claim-conflict-trigger";

/** The stale sweep never emits more than this many candidates on its own,
 *  and the claim family SHARES one cap-3 slot (see claimTriggerSlot). */
export const MAX_STALE_FACT_CANDIDATES = 3;

export type StaleFactFinding = {
  /** The page the stale claim lives on (its first affected page). */
  pageUrl: string;
  pagePath: string;
  /** GSC 90d impressions (or any traffic proxy) - ranks the sweep. */
  traffic: number;
  /** The page's top stale claim (graph order = traffic order). */
  claim: ClaimRecord;
  /** How many stale_check_due claims this page carries in total. */
  staleClaimsOnPage: number;
};

/**
 * The pure sitewide sweep: stale_check_due claims grouped by their home
 * page, one finding per page (the page's first stale claim in graph order),
 * ranked by the page's traffic, highest first. Empty in = empty out.
 */
export function findStaleFactFindings(
  records: readonly ClaimRecord[],
  opts?: { trafficFor?: (url: string) => number },
): StaleFactFinding[] {
  const trafficFor = opts?.trafficFor ?? (() => 0);
  const byPage = new Map<string, { pageUrl: string; claims: ClaimRecord[] }>();
  for (const r of records) {
    if (r.status !== "stale_check_due") continue;
    const pageUrl = r.affectedPages[0];
    if (!pageUrl) continue; // no owned-page home: nothing to point at
    const path = pathOfUrl(pageUrl);
    const entry = byPage.get(path);
    if (entry) entry.claims.push(r);
    else byPage.set(path, { pageUrl, claims: [r] });
  }
  return [...byPage.entries()]
    .map(([pagePath, { pageUrl, claims }]) => ({
      pageUrl,
      pagePath,
      traffic: trafficFor(pageUrl),
      claim: claims[0]!,
      staleClaimsOnPage: claims.length,
    }))
    .sort((a, b) => b.traffic - a.traffic || a.pagePath.localeCompare(b.pagePath));
}

/** Deterministic plain label for the aging fact, plus its plural word.
 *  "a 2023 population figure" / "Numbers"; "a persepolis date" / "Dates". */
export function staleFactLabel(claim: ClaimRecord): { label: string; plural: string } {
  const year = claim.value.raw.match(/\b[12]\d{3}\b/)?.[0] ?? null;
  const head = claim.subject[0] ?? null;
  if (year) {
    return { label: head ? `a ${year} ${head} figure` : `a ${year} figure`, plural: "Numbers" };
  }
  if (claim.value.kind === "date") {
    return { label: head ? `a ${head} date` : "a dated fact", plural: "Dates" };
  }
  if (claim.value.kind === "number") {
    return { label: head ? `a ${head} figure` : "a figure", plural: "Numbers" };
  }
  return { label: head ? `a ${head} detail` : "a detail", plural: "Details" };
}

/** The full stale sentence for one finding - shared by the trigger candidate
 *  and the /diagnostics/provenance stale list so both always read the same. */
export function staleFactSentence(finding: Pick<StaleFactFinding, "pagePath" | "claim">, nowIso: string): string {
  const { label, plural } = staleFactLabel(finding.claim);
  const age = relativeAge(finding.claim.lastConfirmedAt, nowIso) ?? "a while ago";
  return stripBannedDashes(staleFactCopy(finding.pagePath, label, age, plural));
}

export function staleFactCandidates(args: {
  tenantId: string;
  findings: readonly StaleFactFinding[];
  nowIso: string;
  signalAt: string;
  maxCandidates?: number;
}): RecommendationCandidateRow[] {
  const max = args.maxCandidates ?? MAX_STALE_FACT_CANDIDATES;
  if (args.findings.length === 0 || max <= 0) return [];

  const actionType = "watch" as const;

  return args.findings.slice(0, max).map((finding) => {
    const claim = finding.claim;
    const topicClusterLabel = `stale_fact:${claim.subjectKey}`;
    return {
      tenant_id: args.tenantId,
      trigger_signal: "stale_fact",
      action_type: actionType,
      generator_kind: "deterministic" as const,
      target_url: finding.pageUrl,
      topic_cluster_label: topicClusterLabel,
      evidence: [
        {
          kind: "page_snapshot" as const,
          ref: claim.id,
          detail:
            "stale_fact value=" +
            claim.value.raw +
            " on " +
            finding.pagePath +
            "; last_confirmed=" +
            claim.lastConfirmedAt +
            "; volatility=" +
            claim.volatilityClass +
            "; deadline_days=" +
            String(freshnessDeadlineDays(claim.volatilityClass) ?? 0),
        },
      ],
      confidence: "medium" as const,
      impact_estimate: "low" as const,
      customer_copy: staleFactSentence(finding, args.nowIso),
      operator_evidence: stripBannedDashes(
        "signal=stale_fact; claim_id=" +
          claim.id +
          "; value=" +
          claim.value.raw +
          "; volatility=" +
          claim.volatilityClass +
          "; deadline_days=" +
          String(freshnessDeadlineDays(claim.volatilityClass) ?? 0) +
          "; last_confirmed=" +
          claim.lastConfirmedAt +
          "; page=" +
          finding.pagePath +
          "; stale_claims_on_page=" +
          String(finding.staleClaimsOnPage),
      ),
      dedupe_key: dedupeKey({
        tenantId: args.tenantId,
        actionType,
        targetUrl: finding.pageUrl,
        topicClusterLabel,
      }),
      cooldown_key: cooldownKey({ tenantId: args.tenantId, actionType, targetUrl: finding.pageUrl }),
      created_from_signal_at: args.signalAt,
      safety_flags: [],
    };
  });
}

/**
 * The claim family's ONE shared cap-3 slot (the same How-we-know slot):
 * conflicts first (a live disagreement outranks an aging fact), stale
 * checks fill whatever room remains. Empty graph in = byte-identical [].
 */
export function claimTriggerSlot(args: {
  tenantId: string;
  records: readonly ClaimRecord[];
  nowIso: string;
  signalAt: string;
  trafficFor?: (url: string) => number;
}): RecommendationCandidateRow[] {
  if (args.records.length === 0) return [];
  const conflictRows = claimConflictCandidates({
    tenantId: args.tenantId,
    conflicts: findClaimConflicts(args.records),
    signalAt: args.signalAt,
  });
  const room = MAX_CLAIM_CONFLICT_CANDIDATES - conflictRows.length;
  if (room <= 0) return conflictRows;
  const staleRows = staleFactCandidates({
    tenantId: args.tenantId,
    findings: findStaleFactFindings(args.records, { trafficFor: args.trafficFor }),
    nowIso: args.nowIso,
    signalAt: args.signalAt,
    maxCandidates: room,
  });
  return [...conflictRows, ...staleRows];
}

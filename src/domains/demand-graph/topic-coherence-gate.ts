/**
 * topic-coherence-gate (2026-07-02, UX0 — New Pages data-correctness) — a PURE,
 * deterministic gate that keeps a create_page candidate from gluing unrelated demand
 * together under one head topic. Operator ground-truth on the live New Pages board
 * found a card titled "Travel Iran Beautiful Natural Wonders" whose absorbed members
 * covered superstitions, sports, and common Iranian names — a topic-clustering bug,
 * not a display bug.
 *
 * Reuses the SAME distinguishing-token discipline as `evidence/relevance-gate.ts`
 * (no generic brand/stopword can carry a match on its own) so this stays consistent
 * with the rest of the demand graph's relevance rules. PURE — no I/O, no LLM.
 */
import { topicTokens } from "@/domains/evidence/relevance-gate";

export type CoherenceMember = {
  /** Stable id for logging (a URL, a demandKey, a sub-query — whatever the caller has). */
  id: string;
  /** The text to test against the head topic (a label, a query, a URL slug). */
  text: string;
};

export type CoherenceVerdict = {
  /** Members that share a distinguishing token with the head topic (or with each
   *  other, when the head topic itself is too thin to test against). */
  kept: CoherenceMember[];
  /** Members dropped for sharing no distinguishing token with the head topic. */
  dropped: CoherenceMember[];
  /** True when MOST members disagree with the head topic — the whole candidate is
   *  incoherent (mixed demand glued under one label) and should be suppressed, not
   *  just trimmed member-by-member. */
  suppressCandidate: boolean;
  reason: string;
};

const MIN_COHERENT_FRACTION = 0.5; // >=50% of members must agree, or the candidate is junk.

/**
 * Test a candidate's member sub-queries/fanouts/URLs against its own head topic label.
 * A member is KEPT only when it shares a distinguishing token with the head topic
 * (the same rule `relevance-gate.ts` uses for competitor/internal-link evidence).
 * When most members disagree, the whole candidate is flagged for suppression — a
 * head label built by averaging incoherent members is worse than no card at all.
 */
export function checkTopicCoherence(headTopic: string, members: readonly CoherenceMember[]): CoherenceVerdict {
  const headTokens = new Set(topicTokens(headTopic));
  if (members.length === 0) {
    return { kept: [], dropped: [], suppressCandidate: false, reason: "no members to check" };
  }
  if (headTokens.size === 0) {
    // The head topic itself has no distinguishing subject (all generic/stopwords) —
    // can't judge coherence against it; let members through but flag as unverifiable
    // rather than silently accepting or destructively dropping everything.
    return { kept: [...members], dropped: [], suppressCandidate: false, reason: "head topic has no distinguishing tokens (unverifiable, kept as-is)" };
  }

  const kept: CoherenceMember[] = [];
  const dropped: CoherenceMember[] = [];
  for (const m of members) {
    const mTokens = topicTokens(m.text);
    const shares = mTokens.some((t) => headTokens.has(t));
    if (shares) kept.push(m);
    else dropped.push(m);
  }

  const coherentFraction = kept.length / members.length;
  const suppressCandidate = coherentFraction < MIN_COHERENT_FRACTION;
  const reason = suppressCandidate
    ? `only ${kept.length}/${members.length} members share a distinguishing token with "${headTopic}" — incoherent cluster, suppress`
    : dropped.length > 0
      ? `dropped ${dropped.length}/${members.length} off-topic member(s); kept ${kept.length} on-topic`
      : "all members on-topic";

  return { kept, dropped, suppressCandidate, reason };
}

/**
 * Convenience wrapper for the common create_page shape: a head label + the list of
 * competitor URLs / sub-queries / fanouts attributed to it. Returns the filtered lists
 * plus whether the whole candidate should be dropped.
 */
export function gateCreatePageCandidate(
  headLabel: string,
  opts: { urls?: readonly string[]; subQueries?: readonly string[] },
): { keptUrls: string[]; droppedUrls: string[]; keptSubQueries: string[]; droppedSubQueries: string[]; suppressCandidate: boolean; reason: string } {
  const urlMembers = (opts.urls ?? []).map((u) => ({ id: u, text: u }));
  const queryMembers = (opts.subQueries ?? []).map((q) => ({ id: q, text: q }));
  const all = [...urlMembers, ...queryMembers];
  const verdict = checkTopicCoherence(headLabel, all);
  // "no members were dropped" covers BOTH the empty-input case and the unverifiable-
  // head-topic case (checkTopicCoherence returns everything in `kept` for both), so
  // the caller's original lists pass through untouched instead of collapsing to [].
  if (verdict.dropped.length === 0) {
    return {
      keptUrls: [...(opts.urls ?? [])],
      droppedUrls: [],
      keptSubQueries: [...(opts.subQueries ?? [])],
      droppedSubQueries: [],
      suppressCandidate: verdict.suppressCandidate,
      reason: verdict.reason,
    };
  }
  const keptIds = new Set(verdict.kept.map((m) => m.id));
  return {
    keptUrls: (opts.urls ?? []).filter((u) => keptIds.has(u)),
    droppedUrls: (opts.urls ?? []).filter((u) => !keptIds.has(u)),
    keptSubQueries: (opts.subQueries ?? []).filter((q) => keptIds.has(q)),
    droppedSubQueries: (opts.subQueries ?? []).filter((q) => !keptIds.has(q)),
    suppressCandidate: verdict.suppressCandidate,
    reason: verdict.reason,
  };
}

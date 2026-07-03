/**
 * abstention (BEACON_500 N49, 2026-07-03) - the Quality Constitution's law 2
 * (calibrated abstention) made enforceable as a deterministic pipeline gate.
 *
 * Law 2, plainly: Beacon does not present a confident move when it has no real
 * evidence for it. A pure proxy guess (a page merely EXISTS, or a template says
 * "pages like this usually want an FAQ") with nothing corroborating it is not a
 * recommendation - it is a hunch. Before N49 the candidate pipeline would still
 * queue such a hunch and dress it as a confident move; N49 holds it in an
 * honest "watching" state instead.
 *
 * SUFFICIENCY RULE (the whole gate, one sentence): a candidate is sufficient to
 * recommend when it has AT LEAST ONE real signal -
 *   - a demand signal (someone is actually searching for this: a GSC query with
 *     real impressions, a demand-graph node, a keyword-library volume), OR
 *   - a competitor teardown (a competitor page/answer we can point at and say
 *     "they cover this and you do not"), OR
 *   - a real first-party behavior/GSC signal (a striking-distance rank, a CTR
 *     gap, a decay trend, a Clarity-friction reading - the page's own numbers
 *     moving).
 * With NONE of the three, the item is HELD (not dropped, not deleted): it stays
 * in a watching state so the operator sees it is on Beacon's radar, and it
 * ships automatically the moment any one signal appears.
 *
 * PURE. No I/O, no clock. The caller reads whatever evidence it already has for
 * each candidate (the demand graph, the competitor teardown, the GSC/Clarity
 * triggers) and reduces it to the three booleans in AbstentionEvidence; this
 * module decides sufficiency and composes the honest sentence. Wired as a FINAL
 * filter after the existing pipeline (promote-to-queue.ts / the daily planner):
 * additive, and BYTE-IDENTICAL when every candidate already carries at least
 * one signal (the common case - a fresh, well-instrumented tenant), because a
 * sufficient candidate passes through untouched.
 *
 * DISTINCT from specific-edit-validator-abstention: that gate is the LLM-side,
 * per-edit contract (does THIS generated edit's evidence packet ground it?).
 * N49 is the higher, pipeline-level gate (does this CANDIDATE deserve to be a
 * confident move at all, before any drafting?). They stack: N49 first, then the
 * per-edit contract on whatever N49 lets through.
 *
 * Pinned by abstention.test.ts.
 */

// ---------------------------------------------------------------------------
// Evidence contract (the three real-signal classes law 2 recognizes)
// ---------------------------------------------------------------------------

export type AbstentionEvidence = {
  /** Real search demand for this move's topic: a GSC query with impressions, a
   *  demand-graph node, or a cached keyword-library volume. NOT the mere fact a
   *  URL exists. */
  hasDemandSignal: boolean;
  /** A competitor teardown we can name: a competitor page/answer covering this
   *  topic that the tenant does not. */
  hasCompetitorTeardown: boolean;
  /** A real first-party behavior/GSC signal: striking distance, a CTR gap, a
   *  decay trend, a Clarity-friction reading - the page's OWN numbers moving. */
  hasBehaviorOrGscSignal: boolean;
};

export type AbstentionState = "ready" | "watching";

export type AbstentionVerdict = {
  state: AbstentionState;
  /** Which signal classes were present (for the "how we know" surface). */
  presentSignals: Array<"demand" | "competitor" | "behavior_or_gsc">;
  /** First-person plain sentence. For "watching" it is the honest hold
   *  sentence law 2 requires; for "ready" it names what backs the move. No
   *  dashes, no lab jargon. */
  sentence: string;
};

// ---------------------------------------------------------------------------
// Core gate
// ---------------------------------------------------------------------------

/** The exact honest hold sentence for an item with no corroborating evidence.
 *  Exported so the surface count line and any card render the SAME words. */
export const WATCHING_SENTENCE =
  "I do not have enough evidence to recommend this yet, so I am watching it and will bring it to you the moment a real signal shows up.";

function presentSignalsOf(e: AbstentionEvidence): AbstentionVerdict["presentSignals"] {
  const out: AbstentionVerdict["presentSignals"] = [];
  if (e.hasDemandSignal) out.push("demand");
  if (e.hasCompetitorTeardown) out.push("competitor");
  if (e.hasBehaviorOrGscSignal) out.push("behavior_or_gsc");
  return out;
}

const SIGNAL_PHRASE: Record<AbstentionVerdict["presentSignals"][number], string> = {
  demand: "real search demand",
  competitor: "a competitor already covering this",
  behavior_or_gsc: "this page's own search numbers moving",
};

/** Join phrases with commas and a trailing "and". */
function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * The gate. Returns "ready" when at least one of the three real-signal classes
 * is present, "watching" (with the honest sentence) when NONE is. PURE.
 */
export function assessAbstention(evidence: AbstentionEvidence): AbstentionVerdict {
  const present = presentSignalsOf(evidence);
  if (present.length === 0) {
    return { state: "watching", presentSignals: [], sentence: WATCHING_SENTENCE };
  }
  const phrases = present.map((s) => SIGNAL_PHRASE[s]);
  return {
    state: "ready",
    presentSignals: present,
    sentence: `I am recommending this because I can point to ${joinPhrases(phrases)}.`,
  };
}

/** Is there enough evidence to ship this as a confident move? Convenience for a
 *  caller that only needs the boolean (a filter predicate). PURE. */
export function hasSufficientEvidence(evidence: AbstentionEvidence): boolean {
  return assessAbstention(evidence).state === "ready";
}

// ---------------------------------------------------------------------------
// Pipeline filter (the final-filter seam)
// ---------------------------------------------------------------------------

export type AbstentionFilterResult<T> = {
  /** Candidates with at least one real signal - shipped to the queue as before. */
  ready: T[];
  /** Candidates held for evidence - each paired with its honest verdict so the
   *  surface can show WHY it is waiting. Never dropped, never deleted. */
  held: Array<{ item: T; verdict: AbstentionVerdict }>;
};

/**
 * Partition a candidate batch into ready vs held, using a caller-supplied
 * extractor that reduces each candidate to its AbstentionEvidence. PURE.
 *
 * BYTE-IDENTICAL GUARANTEE: when every candidate's extractor returns at least
 * one true signal, `held` is empty and `ready` is the input in order - the
 * exact pre-N49 batch. A caller that wants the wire-in to be provably a no-op
 * on a fully-evidenced batch can assert `held.length === 0`.
 */
export function partitionByEvidence<T>(
  items: ReadonlyArray<T>,
  extract: (item: T) => AbstentionEvidence,
): AbstentionFilterResult<T> {
  const ready: T[] = [];
  const held: Array<{ item: T; verdict: AbstentionVerdict }> = [];
  for (const item of items) {
    const verdict = assessAbstention(extract(item));
    if (verdict.state === "ready") ready.push(item);
    else held.push({ item, verdict });
  }
  return { ready, held };
}

// ---------------------------------------------------------------------------
// Honest count line (law 2's operator-facing surface)
// ---------------------------------------------------------------------------

/** The one-line honest surface for the held count. Returns null when nothing is
 *  held (the caller renders nothing - absence already says "everything I am
 *  showing you is backed by evidence"). PURE. No dashes. */
export function heldForEvidenceLine(heldCount: number): string | null {
  if (heldCount <= 0) return null;
  if (heldCount === 1) {
    return "1 possible move is waiting for more evidence before I recommend it.";
  }
  return `${heldCount} possible moves are waiting for more evidence before I recommend them.`;
}

/**
 * teardown-commonality-verdict (2026-07-02, master plan item D2; "take the
 * best ideologies to either make our new page for new gap, or edit our current
 * page in the gap").
 *
 * PURE / no I/O / no LLM. Given a prompt's CommonalityBrief (what the winning
 * pages share; teardown-commonality.ts) plus whether the tenant already OWNS
 * a matching page for that prompt's topic, routes to exactly one of two
 * outcomes:
 *
 *   - OWNED  -> an ATOMIC EDIT BRIEF: the specific missing shared elements as
 *     additions to the existing page, fanout questions woven in as extra
 *     coverage. Reuses the same ownership signal
 *     `create-page-ownership-gate.ts` already established (an AeoEvidence /
 *     native citation confirming the tenant's own URL); never re-litigates
 *     "do we own this," only reuses it.
 *   - UNOWNED -> the CommonalityBrief becomes additive fields on a create-page
 *     candidate brief (never a replacement of the existing candidate shape;
 *     this module does not construct MoveCandidate/PreparedMovePack itself,
 *     it hands back a small additive object a caller merges in, so it stays
 *     compatible with whatever coherence/ownership gates run downstream).
 *
 * Contract (repeated from teardown-commonality.ts, load-bearing here too):
 * briefs describe STRUCTURE + FACTS TO COVER, never prose to copy. Neither
 * outcome here ever contains a sentence lifted from a competitor page; the
 * drafter (a separate, later step) writes 100% original content from the
 * brief fields.
 */

import type { CommonalityBrief, ConsensusSpec } from "./teardown-commonality";
import { commonalitySentence } from "./teardown-commonality";
import type { AeoEvidence } from "./profound-evidence-fusion";

export type GapVerdictOutcome = "atomic_edit" | "new_page" | "no_verdict";

export type AtomicEditBrief = {
  kind: "atomic_edit";
  /** The owned URL this edit targets. */
  ownedUrl: string;
  /** Specific additions, one per missing shared element (never prose; a
   *  to-do list of what to add, e.g. "Add a section covering X"). */
  additions: string[];
  /** Fanout/follow-up questions to weave into the edit (from the native poll
   *  or Profound query fanouts; caller supplies, this module just carries
   *  them through so the edit brief is self-contained). */
  fanoutQuestionsToWeave: string[];
  /** One-line summary of the consensus that justifies the edit. */
  rationale: string;
  /** N20 (2026-07-03): the 3-of-5 structural consensus + named outliers.
   *  Optional so verdicts persisted before N20 still parse; null when fewer
   *  than 3 usable teardowns fed the brief. */
  consensusSpec?: ConsensusSpec | null;
};

export type NewPageCommonalityFields = {
  kind: "new_page_commonality";
  /** Additive fields a create-page candidate brief should merge in; never a
   *  replacement of the candidate's own shape. */
  sharedHeadingsToInclude: string[];
  answerShape: CommonalityBrief["answerShape"];
  wordBand: CommonalityBrief["wordBand"];
  schemaTypesToInclude: string[];
  openingPattern: CommonalityBrief["openingPattern"];
  hasFaqConsensus: boolean;
  hasToolConsensus: boolean;
  fanoutQuestionsToWeave: string[];
  /** One-line summary of the consensus that justifies the new page. */
  rationale: string;
  /** N20 (2026-07-03): the 3-of-5 structural consensus + named outliers a
   *  drafter may build to. An element in `consensusSpec.outliers` (present on
   *  only ONE winner) is NEVER copied into this brief - pinned in tests.
   *  Optional so verdicts persisted before N20 still parse. */
  consensusSpec?: ConsensusSpec | null;
};

export type GapVerdict = {
  promptId: string;
  outcome: GapVerdictOutcome;
  atomicEdit: AtomicEditBrief | null;
  newPage: NewPageCommonalityFields | null;
  /** The plain-language sentence for the card/detail render (operator-journey
   *  quotable line; same one on both outcomes' underlying brief). */
  renderedSentence: string | null;
  /** Why no_verdict, when applicable (e.g. brief was null; fewer than 2
   *  usable teardown facts for this prompt). */
  reason: string | null;
};

// ── Persistence helpers (D4, 2026-07-02) — PURE key/serialize/parse only, no
// I/O. The verdict was computed nightly by native-teardown-runner.ts and
// discarded; D4 (the unified allocator) needs to read it back without
// re-running the teardown, so callers persist it via move-draft-store.ts's
// "gap_verdict" kind, same read/write contract serp-steal-lane.ts's StealBrief
// already uses (latest row per key wins). Kept here (not in the runner) so the
// key/shape stays colocated with the type it serializes. ──────────────────

/** The stored row: the pure GapVerdict plus the two I/O-layer facts D4 needs
 *  to build a CanonicalChange without re-reading raw observation rows
 *  (promptText for the card label, ownedUrl to resolve the target page). */
export type PersistedGapVerdict = GapVerdict & {
  promptText: string;
  ownedUrl: string | null;
  /** Full native-AI research receipt behind this verdict. Optional for rows
   * persisted before the connected preparation seam. */
  aeoEvidence?: AeoEvidence | null;
};

/** Stable move_drafts key for one tenant+prompt pair - a re-run lands on the
 *  same row (latest wins, same read contract as serp-steal-lane's steal briefs). */
export function gapVerdictDraftKey(promptId: string): string {
  return `gap_verdict:${promptId.trim().toLowerCase()}`;
}

export const GAP_VERDICT_KIND = "gap_verdict" as const;

export function serializeGapVerdict(verdict: PersistedGapVerdict): string {
  return JSON.stringify({ __kind: "gap_verdict", ...verdict });
}

export function parseGapVerdict(content: string | null | undefined): PersistedGapVerdict | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content) as { __kind?: string } & PersistedGapVerdict;
    return v && v.__kind === "gap_verdict" && typeof v.promptId === "string" ? v : null;
  } catch {
    return null;
  }
}

export type OwnershipSignal = {
  /** The tenant's own URL AI/the poll already cites for this prompt's topic,
   *  if any. Reuses the exact signal create-page-ownership-gate.ts uses
   *  (aeoEvidence.topCitedPages[].isOwned / ownCitationCount > 0); this
   *  module takes the resolved URL, it does not recompute ownership. */
  ownedUrl: string | null;
};

/**
 * Route one prompt's CommonalityBrief to an atomic-edit or new-page verdict.
 * `brief === null` (fewer than 2 usable teardown facts) returns "no_verdict";
 * never fabricates a consensus from a single page.
 */
export function routeGapVerdict(input: {
  promptId: string;
  brief: CommonalityBrief | null;
  ownership: OwnershipSignal;
  fanoutQuestions?: readonly string[];
}): GapVerdict {
  const { promptId, brief, ownership } = input;
  const fanoutQuestionsToWeave = [...new Set(input.fanoutQuestions ?? [])].slice(0, 8);

  if (!brief) {
    return {
      promptId,
      outcome: "no_verdict",
      atomicEdit: null,
      newPage: null,
      renderedSentence: null,
      reason: "Fewer than 2 usable competitor teardowns for this prompt; not enough winners to find a consensus yet.",
    };
  }

  const renderedSentence = commonalitySentence(brief);

  if (ownership.ownedUrl) {
    const additions: string[] = [...brief.whatTheyAllHaveThatWeDont];
    if (additions.length === 0) {
      // Owned + already matches the consensus; still atomic_edit (we own the
      // page), but the additions list is honestly empty rather than padded.
      return {
        promptId,
        outcome: "atomic_edit",
        atomicEdit: {
          kind: "atomic_edit",
          ownedUrl: ownership.ownedUrl,
          additions: [],
          fanoutQuestionsToWeave,
          rationale: `${renderedSentence} Your page already covers what the winners share.`,
          consensusSpec: brief.consensusSpec ?? null,
        },
        newPage: null,
        renderedSentence,
        reason: null,
      };
    }
    return {
      promptId,
      outcome: "atomic_edit",
      atomicEdit: {
        kind: "atomic_edit",
        ownedUrl: ownership.ownedUrl,
        additions,
        fanoutQuestionsToWeave,
        rationale: `${renderedSentence} Your page is missing: ${additions.join("; ")}.`,
        consensusSpec: brief.consensusSpec ?? null,
      },
      newPage: null,
      renderedSentence,
      reason: null,
    };
  }

  return {
    promptId,
    outcome: "new_page",
    atomicEdit: null,
    newPage: {
      kind: "new_page_commonality",
      sharedHeadingsToInclude: brief.sharedHeadings.map((h) => h.label),
      answerShape: brief.answerShape,
      wordBand: brief.wordBand,
      schemaTypesToInclude: brief.schemaTypes,
      openingPattern: brief.openingPattern,
      hasFaqConsensus: brief.hasFaqConsensus,
      hasToolConsensus: brief.hasToolConsensus,
      fanoutQuestionsToWeave,
      rationale: `${renderedSentence} No owned page yet; build one to this shape.`,
      consensusSpec: brief.consensusSpec ?? null,
    },
    renderedSentence,
    reason: null,
  };
}

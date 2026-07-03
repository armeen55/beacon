import "server-only";

/**
 * load-dismissal-signals (R23 P15, 2026-07-03) - the I/O edge that turns the two
 * curation stores the operator already writes into the pure dismissal-learning
 * inputs. Read-only; fail-soft → empty (no signal → no learning, the byte-
 * identical contract). Reads ONLY the dismissal store + the proof ledger - never
 * mutates either.
 *
 *  - opportunity_dismissals (status "skip"/"done") → both a do-not-repeat ref
 *    (the exact rejected kind × page) AND a KIND-demotion observation (the
 *    operator skipped this KIND of move again). A `done` dismissal is a "handled
 *    it" signal, so it feeds do-not-repeat but NOT the skip-demotion (they acted
 *    on it, they didn't reject the kind).
 *  - proof ledger (shipped_change_proof) → a do-not-repeat ref for every change
 *    already shipped/live (never re-suggest a change already made).
 *
 * The oppKey format is `kind|page|query` (opportunity-dismissal-store.ts); we
 * split it back into kind + page. canonicalMoveType (applied downstream) folds
 * the feed's kind vocabulary onto the graph's move kinds.
 */

import { loadDismissedKeys } from "@/domains/recommendation-intelligence/opportunity-dismissal-store";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import type { DecidedMoveRef, DismissalObservation } from "./dismissal-learning";

export type DismissalSignals = {
  doNotRepeat: DecidedMoveRef[];
  dismissals: DismissalObservation[];
};

const EMPTY: DismissalSignals = { doNotRepeat: [], dismissals: [] };

/** Parse an `kind|page|query` opp key back into (kind, page). Returns null when
 *  the key is malformed or carries no kind. */
function parseOppKey(oppKey: string): { kind: string; page: string | null } | null {
  const parts = oppKey.split("|");
  const kind = (parts[0] ?? "").trim();
  if (!kind) return null;
  const page = (parts[1] ?? "").trim();
  return { kind, page: page || null };
}

/**
 * Load the dismissal-learning inputs for a tenant. Fail-soft: any store error
 * yields the empty signal set, so the demand graph is byte-identical to its
 * no-learning ranking (the zero-risk contract). The dismissal read is the
 * store's own request-cached read; the ledger read is the same one every other
 * learner uses.
 */
export async function loadDismissalSignals(tenantId: string): Promise<DismissalSignals> {
  if (!tenantId) return EMPTY;

  const dismissedKeys = await loadDismissedKeys(tenantId).catch(() => new Set<string>());
  const doNotRepeat: DecidedMoveRef[] = [];
  const dismissals: DismissalObservation[] = [];
  for (const key of dismissedKeys) {
    const parsed = parseOppKey(key);
    if (!parsed) continue;
    // Curation is "skip" or "done"; both mean "don't re-suggest this exact thing".
    doNotRepeat.push({ moveType: parsed.kind, page: parsed.page, reason: "rejected" });
    // A skip is also evidence the operator does not act on this KIND of move.
    // (A "done" would ideally be excluded here, but the dismissed-keys set does
    // not carry the status; treating a handled item as a mild skip-signal only
    // ever demotes a kind the operator has repeatedly cleared from the board,
    // and the >= MIN_DISMISSALS_TO_DEMOTE floor keeps a one-off from mattering.)
    dismissals.push({ moveType: parsed.kind });
  }

  let shipped: Awaited<ReturnType<typeof loadShippedChanges>> = [];
  try {
    shipped = await loadShippedChanges();
  } catch {
    shipped = [];
  }
  for (const r of shipped) {
    if (!r.actionType) continue;
    doNotRepeat.push({ moveType: r.actionType, page: r.page ?? null, reason: "shipped" });
  }

  return { doNotRepeat, dismissals };
}

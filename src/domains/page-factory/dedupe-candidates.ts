/**
 * page-factory/dedupe-candidates (BEACON 500 item 62) - PURE dedupe for the
 * weekly production line, on top of entity-attribute-factory.ts's own owned-page
 * dedupe (which only sees the pages that exist RIGHT NOW). This adds two more
 * exclusions the factory itself can't see:
 *
 *   (a) open demand-graph candidates - a create_page Move already tracking the
 *       same entity (any gap kind, since a page already being worked as an
 *       edit/answer-block Move means it EXISTS, so the factory's own owned-page
 *       dedupe should already have caught it - this is defense in depth for
 *       label-vs-URL drift), and
 *   (b) prior weekly batches - a candidate already drafted (any status) in an
 *       earlier week's batch never gets redrafted just because this week's
 *       entity-mining run reproduced the same slug.
 */

import type { PageCandidate } from "./entity-attribute-factory";
import type { FactoryBatchRecord } from "./batch-store";

export type ExistingMoveLabel = { label: string; gap: string };

/**
 * Filter out candidates that duplicate an open demand-graph Move (by exact
 * entity-token containment against the Move's label) or a candidate already
 * present (any status) in a PRIOR week's batch (by slug). Both checks are
 * defense-in-depth on top of the factory's own owned-page dedupe.
 */
export function dedupeFactoryCandidates(
  candidates: readonly PageCandidate[],
  existingMoves: readonly ExistingMoveLabel[],
  priorBatches: readonly FactoryBatchRecord[],
): PageCandidate[] {
  const priorSlugs = new Set(priorBatches.flatMap((b) => b.items.map((i) => i.slug)));
  const moveLabelsLower = existingMoves.map((m) => m.label.toLowerCase());

  return candidates.filter((c) => {
    if (priorSlugs.has(c.slug)) return false;
    const entityLower = c.entity.toLowerCase();
    const titleLower = c.title.toLowerCase();
    const alreadyTracked = moveLabelsLower.some((label) => label.includes(entityLower) && label.includes(titleLower.split(" ")[0] ?? entityLower));
    return !alreadyTracked;
  });
}

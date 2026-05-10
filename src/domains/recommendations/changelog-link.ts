/**
 * Recommendation → /changes/[id] link resolver.
 *
 * The match-runner stamps `changelog_entries.source_rec_id = rec.stableKey`
 * when an accepted recommendation's edit goes live on a page. This pure
 * helper turns that linkage into a customer-safe href the
 * /recommendations row can render alongside the existing primary action
 * button.
 *
 * Customer-safety contract:
 *   - Returns `null` when no matching changelog id is known. Callers
 *     MUST gate the link render on a non-null return value — never
 *     render a "broken" link.
 *   - The href shape is the same /changes/[id] route /today's
 *     LiveChangesBlock and /changes scorecard expansion already use.
 *     No new route, no new id format, no new data model.
 *   - The id flowing into the URL is the changelog entry's id slug
 *     (e.g. `cl-mogzw78nv8pu54`) — same id /today already exposes.
 *     No additional UUID/internal leak vs the existing demo path.
 *
 * Pure. Same inputs → same outputs.
 */

/**
 * Build a `recId → changelogId` lookup from a list of changelog
 * entries. First entry wins when multiple changelog rows reference
 * the same recommendation (e.g. an FAQ Q+A pair lands as two
 * changelog entries with the same source_rec_id; the demo link
 * goes to whichever landed first).
 */
export function buildChangelogIdByRecId(
  entries: ReadonlyArray<{ id: string; source_rec_id?: string | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    const recId = entry.source_rec_id;
    if (!recId || typeof recId !== "string" || recId === "") continue;
    if (!entry.id || typeof entry.id !== "string") continue;
    if (map[recId] !== undefined) continue; // first-wins
    map[recId] = entry.id;
  }
  return map;
}

/**
 * Resolve the /changes/[id] href for a recommendation row, or `null`
 * when no link should render.
 *
 * The link should render only for rows where the operator has acted
 * on the recommendation (accepted / measuring / shipped) AND a
 * matching changelog entry exists. Returns null otherwise so the
 * caller can elide the surface entirely.
 */
export function changeLinkHrefForRow(
  row: {
    sourceRecommendationId: string;
    responseStatus: "accepted" | "dismissed" | "deferred" | null;
    status: string;
  },
  changelogIdByRecId: Record<string, string>,
): string | null {
  // Pending / dismissed / deferred rows: no link, even if a stray
  // changelog entry exists somewhere with this source_rec_id.
  if (row.responseStatus !== "accepted") return null;

  // Some statuses (e.g. "needs_fresh_edit") flow through responseStatus
  // = "accepted" but the operator hasn't actually shipped anything
  // yet — those rows have no changelog. The map lookup below handles
  // this correctly: missing entry → null link.
  const id = changelogIdByRecId[row.sourceRecommendationId];
  if (!id || typeof id !== "string" || id === "") return null;

  return `/changes/${id}`;
}

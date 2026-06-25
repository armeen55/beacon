/**
 * group-moves (2026-06-25) — collapse multiple Moves that target the SAME owned
 * page into ONE primary Move + secondary reasons. The engine produces one Move
 * per demand node, so a single page (e.g. /iran-flag) can surface as both
 * answer_block AND fix_experience — two cards/queue-rows for one page, which is
 * confusing. This groups by owned URL, keeps the highest-scoring as primary, and
 * exposes the rest as "also" reasons. Pages with no owned URL (create_page) are
 * never merged. PURE.
 */

import type { GapKind, MoveCandidate } from "./build-graph";

export type MoveGroup = { primary: MoveCandidate; secondary: MoveCandidate[] };

/** Short, plain-English "also do this" phrase per gap (for secondary reasons). */
export function secondaryGapPhrase(gap: GapKind): string {
  switch (gap) {
    case "answer_block": return "add a direct answer block";
    case "edit_page": return "tighten the title/meta";
    case "fix_experience": return "fix dead/rage clicks (page friction)";
    case "create_page": return "consider a dedicated page";
    default: return "review";
  }
}

export function groupMovesByOwnedPage(moves: ReadonlyArray<MoveCandidate>): MoveGroup[] {
  const byUrl = new Map<string, MoveCandidate[]>();
  const standalone: MoveCandidate[] = []; // no owned URL (create_page) — never merged
  for (const m of moves) {
    if (!m.ownedUrl) {
      standalone.push(m);
      continue;
    }
    const list = byUrl.get(m.ownedUrl);
    if (list) list.push(m);
    else byUrl.set(m.ownedUrl, [m]);
  }
  const groups: MoveGroup[] = [];
  for (const list of byUrl.values()) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    groups.push({ primary: sorted[0]!, secondary: sorted.slice(1) });
  }
  for (const m of standalone) groups.push({ primary: m, secondary: [] });
  // Order by the primary's score so the worklist stays ranked.
  groups.sort((a, b) => b.primary.score - a.primary.score);
  return groups;
}

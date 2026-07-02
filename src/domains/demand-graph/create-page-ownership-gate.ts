/**
 * create-page-ownership-gate (2026-07-02, UX0 — New Pages data-correctness) — a PURE
 * post-pass that stops a create_page Move from claiming "you have no page yet" when the
 * tenant is ALREADY cited by AI for that exact topic. Operator ground-truth found a
 * "Persian Literature" card pitched as a MISSING page while its own attached AEO
 * evidence showed the tenant's own URL among the cited pages (ownCitationCount > 0) —
 * a create_page candidate that outran the citation data confirming a page already
 * exists and already wins there.
 *
 * Runs AFTER `attachProfoundEvidenceToMoves` (this needs `aeoEvidence` to be present)
 * and BEFORE `collapseCreatePageSiblings` (a reclassified move should never absorb or
 * be absorbed as a create_page sibling). Reclassifies to `gap: "edit_page"` (pointing at
 * the actual cited owned URL) when one is known, else drops the move entirely and logs
 * why — never leaves a citation-confirmed page as "missing". PURE / no I/O.
 */
import type { MoveCandidate } from "./build-graph";

export type OwnershipReclassification = {
  demandKey: string;
  label: string;
  action: "reclassified" | "dropped";
  ownedUrl: string | null;
  ownCitationCount: number;
  reason: string;
};

export type OwnershipGateResult = {
  moves: MoveCandidate[];
  changes: OwnershipReclassification[];
};

/**
 * Reclassify/drop create_page Moves that AI already cites the tenant's own page for.
 * A Move with no aeoEvidence, or aeoEvidence.ownCitationCount === 0, is untouched.
 */
export function gateCreatePageOwnership(moves: readonly MoveCandidate[]): OwnershipGateResult {
  const changes: OwnershipReclassification[] = [];
  const out: MoveCandidate[] = [];

  for (const m of moves) {
    if (m.gap !== "create_page" || !m.aeoEvidence || m.aeoEvidence.ownCitationCount <= 0) {
      out.push(m);
      continue;
    }
    const ownedPage = m.aeoEvidence.topCitedPages.find((p) => p.isOwned) ?? null;
    if (ownedPage) {
      out.push({
        ...m,
        gap: "edit_page",
        ownedUrl: ownedPage.url,
        rationale: `AI already cites your own page (${ownedPage.url}) for this topic ${m.aeoEvidence.ownCitationCount} time(s) — this is not a missing page. Strengthen the existing page instead of creating a new one.`,
      });
      changes.push({
        demandKey: m.demandKey,
        label: m.label,
        action: "reclassified",
        ownedUrl: ownedPage.url,
        ownCitationCount: m.aeoEvidence.ownCitationCount,
        reason: `AI cites the tenant's own page for this topic — reclassified create_page -> edit_page (${ownedPage.url}).`,
      });
    } else {
      // Confirmed cited somewhere on the owned domain, but no specific URL surfaced —
      // still never honest to say "no page yet"; drop rather than mislabel.
      changes.push({
        demandKey: m.demandKey,
        label: m.label,
        action: "dropped",
        ownedUrl: null,
        ownCitationCount: m.aeoEvidence.ownCitationCount,
        reason: "AI cites the tenant's own domain for this topic but no specific owned URL was identified — dropped rather than claim a missing page.",
      });
    }
  }

  return { moves: out, changes };
}

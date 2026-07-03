/**
 * create-page-ownership-gate (2026-07-02, UX0, New Pages data-correctness;
 * extended 2026-07-02 for N2, the query-to-page ownership registry), a PURE
 * post-pass that stops a create_page Move from claiming "you have no page yet" when the
 * tenant is ALREADY cited by AI for that exact topic. Operator ground-truth found a
 * "Persian Literature" card pitched as a MISSING page while its own attached AEO
 * evidence showed the tenant's own URL among the cited pages (ownCitationCount > 0),
 * a create_page candidate that outran the citation data confirming a page already
 * exists and already wins there.
 *
 * Runs AFTER `attachProfoundEvidenceToMoves` (this needs `aeoEvidence` to be present)
 * and BEFORE `collapseCreatePageSiblings` (a reclassified move should never absorb or
 * be absorbed as a create_page sibling). Reclassifies to `gap: "edit_page"` (pointing at
 * the actual cited owned URL) when one is known, else drops the move entirely and logs
 * why, never leaves a citation-confirmed page as "missing". PURE / no I/O.
 *
 * N2 EXTENSION: `gateCreatePageOwnership` above only ever knew about AI-citation
 * evidence (Profound). The N2 ownership registry (src/domains/ownership/registry.ts)
 * is a SUPERSET signal, it also knows when Google's own GSC impressions (gsc_ranks)
 * or a SERP-overlap intent cluster (serp_cluster) already send a query to one of the
 * tenant's own pages, even when Profound never cited it. `gateCreatePageOwnershipWithRegistry`
 * runs the original citation-only gate FIRST (byte-identical behavior preserved), then
 * checks every SURVIVING create_page candidate's label against the registry and
 * reclassifies/drops the same way, so one create_page Move can now be caught by either
 * signal, never neither. Additive: a caller with no registry (or an empty one) gets
 * the exact original gate's output.
 */
import type { MoveCandidate } from "./build-graph";
import { resolveOwner, type OwnershipRegistry } from "@/domains/ownership/registry";

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
        rationale: `AI already cites your own page (${ownedPage.url}) for this topic ${m.aeoEvidence.ownCitationCount} time(s), this is not a missing page. Strengthen the existing page instead of creating a new one.`,
      });
      changes.push({
        demandKey: m.demandKey,
        label: m.label,
        action: "reclassified",
        ownedUrl: ownedPage.url,
        ownCitationCount: m.aeoEvidence.ownCitationCount,
        reason: `AI cites the tenant's own page for this topic, reclassified create_page -> edit_page (${ownedPage.url}).`,
      });
    } else {
      // Confirmed cited somewhere on the owned domain, but no specific URL surfaced,
      // still never honest to say "no page yet"; drop rather than mislabel.
      changes.push({
        demandKey: m.demandKey,
        label: m.label,
        action: "dropped",
        ownedUrl: null,
        ownCitationCount: m.aeoEvidence.ownCitationCount,
        reason: "AI cites the tenant's own domain for this topic but no specific owned URL was identified, dropped rather than claim a missing page.",
      });
    }
  }

  return { moves: out, changes };
}

/**
 * N2 (2026-07-02): the registry-aware superset of `gateCreatePageOwnership`.
 * Runs the original citation-only gate first (unchanged behavior for every
 * Move it already catches), then checks each SURVIVING create_page candidate's
 * label against the ownership registry (Google-impressions or SERP-cluster
 * evidence, not just AI-citation evidence). When the registry already names an
 * owner for this topic, reclassify to `edit_page` at that owner exactly like
 * the citation gate does, a create_page Move must never say "you have no page
 * yet" when ANY trusted signal (AI citation, GSC ranks, or SERP-cluster
 * overlap) says otherwise.
 *
 * A Move whose label resolves to a registry entry with `owner: null` (a real,
 * confirmed gap; a conflict entry naming contenders but no clear owner
 * would still carry a non-null `owner`, so `owner: null` only happens when the
 * registry legitimately has no page for this query) is left untouched.
 *
 * Additive: an empty/no registry produces byte-identical output to
 * `gateCreatePageOwnership` alone (pinned by the paired unit test).
 */
export function gateCreatePageOwnershipWithRegistry(
  moves: readonly MoveCandidate[],
  registry: OwnershipRegistry | null | undefined,
): OwnershipGateResult {
  const citationGated = gateCreatePageOwnership(moves);
  if (!registry || registry.byQuery.size === 0) return citationGated;

  const changes: OwnershipReclassification[] = [...citationGated.changes];
  const out: MoveCandidate[] = [];

  for (const m of citationGated.moves) {
    if (m.gap !== "create_page") {
      out.push(m);
      continue;
    }
    const entry = resolveOwner(registry, m.label);
    if (!entry || !entry.owner) {
      out.push(m);
      continue;
    }
    out.push({
      ...m,
      gap: "edit_page",
      ownedUrl: entry.owner,
      rationale: `The ownership registry already names ${entry.owner} as the owner of this query/topic (${entry.basis === "gsc_ranks" ? "Google sends it the most impressions" : "a SERP-overlap intent cluster ranks it best"}), this is not a missing page. Strengthen the existing page instead of creating a new one.`,
    });
    changes.push({
      demandKey: m.demandKey,
      label: m.label,
      action: "reclassified",
      ownedUrl: entry.owner,
      ownCitationCount: 0,
      reason: `Ownership registry (${entry.basis}) already names an owner for this topic, reclassified create_page -> edit_page (${entry.owner}).`,
    });
  }

  return { moves: out, changes };
}

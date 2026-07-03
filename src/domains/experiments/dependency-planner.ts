/**
 * dependency-planner (BEACON_500 N45, 2026-07-03) - the PURE prerequisite gate.
 *
 * Some changes have PREREQUISITES: doing the dependent one first wastes the
 * work. You cannot optimize a page Google is told to ignore; you cannot claim
 * rich results before the schema that produces them exists; you cannot
 * interlink into a hub page you have not built yet. N45 derives these
 * prerequisite EDGES between the candidates already queued together, then holds
 * a dependent candidate (ExcludedReason "prerequisite_pending", with the plain
 * sentence) until its prerequisite ships.
 *
 * THIS MODULE COMPOSES, IT DOES NOT REIMPLEMENT. It reuses:
 *   - the R19 technical signals (technical-demand.ts's noindex / bad_status /
 *     canonical_elsewhere) as the "this page is technically blocked" input,
 *     reduced by the caller to a per-path TechnicalBlock flag. A content edit on
 *     a technically-blocked page depends on the fix landing first.
 *   - the create_page -> add_internal_link relationship (N14's linked-page
 *     model): an internal-link candidate pointing at a page that is ITSELF a
 *     create_page candidate in the same batch depends on that page being built.
 *   - the add_schema -> rich-results relationship: a schema-dependent edit
 *     (add_table / add_faq / add_comparison_section - the ones that only earn a
 *     rich result WITH schema) on a page that also has an add_schema candidate
 *     depends on the schema landing first.
 *
 * PURE. No I/O, no clock. The caller (build-today-preview.ts / the trigger
 * pipeline) reduces its candidates to the DependencyCandidate shape (path,
 * actionType, the two flags it already knows) and hands them in; this module
 * derives the edges and returns which candidates are held and why.
 *
 * ADDITIVE + BYTE-IDENTICAL WHEN NO DEPENDENCIES EXIST (pinned): a batch with
 * no prerequisite relationship yields an EMPTY hold list and every candidate
 * eligible - the exact pre-N45 behavior. A prerequisite that is ALREADY DONE
 * (its `technicalBlocked` cleared, or the prerequisite candidate marked
 * `alreadyShipped`) holds nothing. Only a dependent whose prerequisite is still
 * pending IN THE SAME BATCH (or still blocking on the page) is held.
 *
 * Pinned by dependency-planner.test.ts.
 */

import type { ActionType } from "@/domains/recommendations/action-types";

// ---------------------------------------------------------------------------
// Small pure helpers (leaf-level, matching the sibling-module convention)
// ---------------------------------------------------------------------------

/** Host-stripped, trailing-slash-normalized, lowercased path - the SAME
 *  normalization daily-experiment-planner.ts uses so a caller mixing URLs and
 *  paths keys consistently. */
export function normPath(u: string | null | undefined): string {
  if (!u) return "";
  return (
    (u.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type DependencyCandidate = {
  /** Stable id within the batch (the candidate's own id / dedupe key). */
  id: string;
  /** The page this candidate targets. */
  url: string;
  actionType: ActionType;
  /** For an add_internal_link candidate: the page it links TO (the hub it needs
   *  to already exist). Absent for every other action type. Host-stripped or
   *  raw - normalized internally. */
  linkDestinationUrl?: string | null;
  /** R19 technical signal, reduced by the caller from technical-demand.ts: this
   *  page currently carries a noindex / broken-status / canonical-elsewhere
   *  defect. A content edit on such a page depends on the fix. Absent/false =
   *  the page is technically clean (the common case). */
  technicalBlocked?: boolean;
  /** True when this candidate's OWN change has already shipped (so it can serve
   *  as a satisfied prerequisite for others, but is never itself held). The
   *  caller sets this from the proof ledger. Absent/false = still pending. */
  alreadyShipped?: boolean;
};

/** The kinds of prerequisite N45 recognizes. Named so a surface can group holds
 *  and a test can assert which rule fired. */
export type PrerequisiteKind =
  | "fix_technical_block"
  | "build_hub_page"
  | "add_schema_first";

export type DependencyEdge = {
  /** The candidate that must WAIT. */
  dependentId: string;
  /** The candidate (or on-page condition) it waits FOR. For a technical block
   *  with no fix candidate in the batch, this is null (the page condition
   *  itself is the blocker, not another queued candidate). */
  prerequisiteId: string | null;
  kind: PrerequisiteKind;
  /** The plain first-person sentence naming WHY, no dashes, no lab jargon. */
  plainReason: string;
};

export type DependencyPlan = {
  /** Every derived prerequisite edge (including satisfied ones? No - only
   *  UNSATISFIED edges reach here; a satisfied prerequisite produces no edge). */
  edges: DependencyEdge[];
  /** Candidate ids to HOLD this batch, each with its reason - the dependent
   *  end of an unsatisfied edge. A candidate held by more than one edge appears
   *  once, with the most severe reason (technical block first). */
  held: Array<{ id: string; kind: PrerequisiteKind; plainReason: string }>;
};

// ---------------------------------------------------------------------------
// Which action types depend on which prerequisites
// ---------------------------------------------------------------------------

/** Content/optimization edits that are pointless on a technically-blocked page.
 *  A technical FIX itself (fix_noindex / fix_status_code / fix_canonical) is
 *  NOT here - the fix is the prerequisite, never the dependent. */
const CONTENT_OPTIMIZATION_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "edit_title",
  "edit_meta",
  "improve_meta",
  "change_h1",
  "add_h2_section",
  "rewrite_h2",
  "add_faq",
  "rewrite_faq",
  "full_rewrite",
  "add_table",
  "edit_table_row",
  "add_answer_block",
  "add_proof_section",
  "add_comparison_section",
  "add_cost_section",
  "add_timeline_section",
  "reorder_sections",
  "update_intro",
  "add_h3_section",
  "add_image_alt_text",
]);

/** The technical fixes that CLEAR a block. When one of these is a pending
 *  candidate on the blocked page, it is the named prerequisite; when none is
 *  queued, the block itself is the (unnamed) prerequisite. */
const TECHNICAL_FIX_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "fix_noindex",
  "fix_status_code",
  "fix_canonical",
  "fix_sitemap",
  "fix_robots",
]);

/** Edits that only earn a rich result WITH schema on the page - so they depend
 *  on an add_schema/fix_schema candidate on the same page shipping first. */
const SCHEMA_DEPENDENT_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "add_table",
  "add_faq",
  "rewrite_faq",
  "add_comparison_section",
]);

const SCHEMA_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(["add_schema", "fix_schema"]);

const SEVERITY: Record<PrerequisiteKind, number> = {
  fix_technical_block: 0,
  build_hub_page: 1,
  add_schema_first: 2,
};

// ---------------------------------------------------------------------------
// Edge derivation (one builder per prerequisite kind)
// ---------------------------------------------------------------------------

/** fix_technical_block: a content edit on a page carrying a noindex / broken-
 *  status / canonical-elsewhere defect. Names the queued fix candidate as the
 *  prerequisite when one exists; else the block itself. Never fires for the
 *  fix candidate itself, nor when the page is already clean. PURE. */
export function buildTechnicalBlockEdges(
  candidates: ReadonlyArray<DependencyCandidate>,
): DependencyEdge[] {
  // Index the pending technical-fix candidate per blocked path (first wins).
  const fixByPath = new Map<string, DependencyCandidate>();
  for (const c of candidates) {
    if (TECHNICAL_FIX_ACTIONS.has(c.actionType) && !c.alreadyShipped) {
      const p = normPath(c.url);
      if (!fixByPath.has(p)) fixByPath.set(p, c);
    }
  }
  const edges: DependencyEdge[] = [];
  for (const c of candidates) {
    if (c.alreadyShipped) continue;
    if (!c.technicalBlocked) continue;
    if (!CONTENT_OPTIMIZATION_ACTIONS.has(c.actionType)) continue;
    const p = normPath(c.url);
    const fix = fixByPath.get(p);
    edges.push({
      dependentId: c.id,
      prerequisiteId: fix ? fix.id : null,
      kind: "fix_technical_block",
      plainReason: `Fix the indexing problem on ${p} first. Optimizing a page Google is told to ignore wastes the work.`,
    });
  }
  return edges;
}

/** build_hub_page: an add_internal_link candidate pointing at a page that is
 *  ITSELF a not-yet-shipped create_page candidate in this batch. You cannot
 *  link into a page you have not built. PURE. */
export function buildHubPageEdges(
  candidates: ReadonlyArray<DependencyCandidate>,
): DependencyEdge[] {
  const createByPath = new Map<string, DependencyCandidate>();
  for (const c of candidates) {
    if (c.actionType === "create_page" && !c.alreadyShipped) {
      createByPath.set(normPath(c.url), c);
    }
  }
  if (createByPath.size === 0) return [];
  const edges: DependencyEdge[] = [];
  for (const c of candidates) {
    if (c.alreadyShipped) continue;
    if (c.actionType !== "add_internal_link") continue;
    const dest = normPath(c.linkDestinationUrl);
    if (!dest) continue;
    const hub = createByPath.get(dest);
    if (!hub) continue;
    edges.push({
      dependentId: c.id,
      prerequisiteId: hub.id,
      kind: "build_hub_page",
      plainReason: `Build ${dest} first. There is no point linking to a page that does not exist yet.`,
    });
  }
  return edges;
}

/** add_schema_first: a schema-dependent edit (a table / FAQ / comparison whose
 *  rich result needs schema) on a page that also has a not-yet-shipped
 *  add_schema/fix_schema candidate. The schema has to land first for the rich
 *  result to appear. PURE. */
export function buildSchemaFirstEdges(
  candidates: ReadonlyArray<DependencyCandidate>,
): DependencyEdge[] {
  const schemaByPath = new Map<string, DependencyCandidate>();
  for (const c of candidates) {
    if (SCHEMA_ACTIONS.has(c.actionType) && !c.alreadyShipped) {
      const p = normPath(c.url);
      if (!schemaByPath.has(p)) schemaByPath.set(p, c);
    }
  }
  if (schemaByPath.size === 0) return [];
  const edges: DependencyEdge[] = [];
  for (const c of candidates) {
    if (c.alreadyShipped) continue;
    if (!SCHEMA_DEPENDENT_ACTIONS.has(c.actionType)) continue;
    const p = normPath(c.url);
    const schema = schemaByPath.get(p);
    if (!schema) continue;
    if (schema.id === c.id) continue; // never depend on itself
    edges.push({
      dependentId: c.id,
      prerequisiteId: schema.id,
      kind: "add_schema_first",
      plainReason: `Add the schema on ${p} first. Without it this content will not earn the richer result in search.`,
    });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Derive every prerequisite edge for a batch and collapse them into the hold
 * list. PURE. A candidate held by multiple edges is held ONCE, keeping the most
 * severe reason (technical block > hub > schema). BYTE-IDENTICAL when no
 * dependency exists: empty edges, empty held.
 */
export function planDependencies(
  candidates: ReadonlyArray<DependencyCandidate>,
): DependencyPlan {
  const edges = [
    ...buildTechnicalBlockEdges(candidates),
    ...buildHubPageEdges(candidates),
    ...buildSchemaFirstEdges(candidates),
  ];

  // Collapse to one hold per dependent, keeping the most severe reason.
  const bestByDependent = new Map<string, DependencyEdge>();
  for (const e of edges) {
    const prev = bestByDependent.get(e.dependentId);
    if (!prev || SEVERITY[e.kind] < SEVERITY[prev.kind]) {
      bestByDependent.set(e.dependentId, e);
    }
  }
  const held = [...bestByDependent.values()].map((e) => ({
    id: e.dependentId,
    kind: e.kind,
    plainReason: e.plainReason,
  }));

  return { edges, held };
}

/** The set of candidate ids to hold this batch, for a caller that only needs
 *  the ids to exclude. PURE. */
export function heldCandidateIds(plan: DependencyPlan): Set<string> {
  return new Set(plan.held.map((h) => h.id));
}

/** Lookup of held id -> plain reason, for a caller wiring the exclusion with
 *  its plainReason (mirrors the planner's InterferenceHoldLookup shape). PURE. */
export function dependencyHoldLookup(plan: DependencyPlan): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of plan.held) out.set(h.id, h.plainReason);
  return out;
}

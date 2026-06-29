/**
 * Unified ActionPack model (2026-06-26, Beacon v1 Core Consolidation — Phase B).
 *
 * ONE flat, presentation-grade view that EVERY recommendation source adapts INTO
 * — so the cockpit, the operator worklist, dedup, and trust all read a single
 * shape. It is a NORMALIZATION LAYER, not a 4th competing primitive: the rich
 * internal envelopes stay (demand-graph `PreparedMovePack` / `EvidencePacket`,
 * profound-coverage `AeoActionPack`); adapters in `adapters.ts` flatten each into
 * this. PURE / no I/O.
 *
 * Every ActionPack must justify itself: `whyNotNoise` + `evidenceSources` make
 * "this is a real, evidence-backed move" legible, never a bare keyword.
 */

/** The unified action taxonomy — the union of what every source can recommend. */
export type ActionType =
  | "edit_existing_page"
  | "add_answer_block"
  | "create_new_page"
  | "create_hub"
  | "add_internal_links"
  | "consolidate_pages"
  | "fix_title_meta_ctr"
  | "fix_conversion_friction";

/** Which connectors/engines contributed evidence to this pack. */
export type EvidenceSource =
  | "rank_revenue"        // the demand-graph score/components
  | "profound"            // per-prompt AEO evidence (prompts/fanouts/cited pages)
  | "dataforseo"          // live SERP validation verdict
  | "gsc"                 // Search Console demand (clicks/impr/ctr/position)
  | "ga4"                 // engagement / conversions / revenue
  | "clarity"             // UX friction (rage/dead/quickback)
  | "competitor_teardown"; // deterministic competitor page audit

export type ActionPackConfidence = "high" | "medium" | "low";

/** Where the pack was produced (provenance for dedup + legacy accounting). */
export type ActionPackOrigin = "rank_revenue" | "profound_coverage";

export type ActionPackGscDemand = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

export type ActionPackGa4Value = {
  sessions: number;
  conversions: number;
  /** Real revenue when GA4 ecommerce is wired; null = not measured (never faked). */
  revenue: number | null;
};

/** Profound prompt receipt — the AEO "AI is asked X, cites these, you're absent". */
export type ActionPackProfoundReceipt = {
  topPrompt: string;
  promptCount: number;
  fanoutCount: number;
  citedDomains: string[];
  ownAbsent: boolean;
};

export type ActionPackSerpValidation = {
  verdict: "build" | "wait" | "skip";
  confidence: string;
  /** Top organic domains on the live SERP (the field of play). */
  topDomains: string[];
  /** SERP composition: how many of the top-10 are content vs marketplace/UGC. */
  contentDomainCount: number;
  marketplaceUgcCount: number;
  /** How many SERP winners overlap the Profound-cited competitors (Google∩AI). */
  profoundOverlapCount: number;
  ownAlreadyRanks: boolean;
  /** Cache/spend metadata — cached verdict, $ already spent (never a fresh call). */
  costUsd: number;
};

/**
 * The unified pack. Optional evidence fields are present only when that source
 * actually contributed (null = that connector had nothing / isn't wired), so the
 * absence is honest, never a zero masquerading as data.
 */
export type ActionPack = {
  /** Stable id: hash of (tenant, actionType, target||slug||label). */
  id: string;
  tenantId: string;
  actionType: ActionType;
  /** Existing-page target (canonical URL) or null for create/hub. */
  targetUrl: string | null;
  /** Suggested slug for a create/hub action, else null. */
  newPageSlug: string | null;
  /** Human topic/title for the card. */
  label: string;
  /** Unified priority (higher = do first). Carried from the source scorer. */
  priorityScore: number;
  confidence: ActionPackConfidence;
  /** Which connectors backed this pack. */
  evidenceSources: EvidenceSource[];
  // ── typed evidence (null when the source contributed nothing) ──
  gscDemand: ActionPackGscDemand | null;
  ga4Value: ActionPackGa4Value | null;
  clarityFriction: { score: number } | null;
  profoundReceipt: ActionPackProfoundReceipt | null;
  dataforseoValidation: ActionPackSerpValidation | null;
  competitorPagesToBeat: string[];
  /** Draft/brief readiness for this move. */
  draftStatus: "none" | "ready" | "stale";
  /** Reuse the source proof plan (metrics + windows + controls). */
  proofPlan: { metrics: string[]; windowsDays: number[]; controls: string } | null;
  /** The one-line justification — why this is a real move, not noise. */
  whyNotNoise: string;
  origin: ActionPackOrigin;
  /** Cache/staleness key carried from the source. */
  evidenceHash: string;
  /** Canonicalization (2026-06-29) — when this create_new_page pack is the canonical
   *  representative of a near-duplicate cluster (collapsed across the demand-graph AND
   *  Profound-coverage sources), the absorbed sibling labels + merge reason/confidence.
   *  Set by collapseCreatePagePacks(); absent for singletons. */
  canonicalGroup?: { alsoCovers: string[]; reason: string; confidence: "high" | "medium" };
};

export const ACTION_LABEL: Record<ActionType, string> = {
  edit_existing_page: "Edit existing page",
  add_answer_block: "Add answer block",
  create_new_page: "Create new page",
  create_hub: "Create hub",
  add_internal_links: "Add internal links",
  consolidate_pages: "Consolidate pages",
  fix_title_meta_ctr: "Fix title / meta (CTR)",
  fix_conversion_friction: "Fix conversion friction",
};

/** Coarse bucket for the worklist views. */
export function actionFamily(a: ActionType): "existing_page" | "new_page" | "hub" | "links" | "cro" {
  switch (a) {
    case "create_new_page":
      return "new_page";
    case "create_hub":
      return "hub";
    case "add_internal_links":
    case "consolidate_pages":
      return "links";
    case "fix_conversion_friction":
      return "cro";
    default:
      return "existing_page";
  }
}

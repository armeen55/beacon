/**
 * move-draft-store (2026-06-25) — durable persistence for the AI drafts an
 * operator generates on a Today's Moves card (answer block + FAQ JSON-LD). Each
 * draft costs a real (small) LLM spend; without this they vanish on reload and
 * the operator pays to regenerate. Keyed by (tenant, rec, kind), latest wins.
 *
 * DEGRADE-SAFE: every path is fail-soft. If the `move_drafts` table is absent
 * (fresh install before the additive migration — PostgREST PGRST205 / Postgres
 * 42P01), reads return empty and writes return false; the cockpit just behaves
 * as it did before (generate-on-demand, no persistence). Never throws.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

// "serp_verdict" persists the precomputed DataForSEO create-page verdict JSON so
// the New Pages board arrives "Google checked" with no operator click. The DB
// `kind` column is free text — no migration needed to add a kind.
// "prepared_pack" (P3) persists a projected PreparedMovePack (specialist opinions
// + router decision + readiness status) so a Move arrives "prepared, not chore".
// "structured_draft" (P4) persists a Zod-validated structured draft (answer block,
// create-page brief, atomic edit, …) — never loose blob text.
export type MoveDraftKind =
  | "answer_block"
  | "faq"
  | "serp_verdict"
  | "prepared_pack"
  | "structured_draft"
  // Sprint 6: persisted image-alt scan findings (column is free-text → no migration).
  | "image_alt_findings"
  // Sprint 6: persisted product/collection on-page SEO gaps from the same scan.
  | "product_seo_findings";

export type MoveDraftRow = {
  recId: string;
  kind: MoveDraftKind;
  content: string;
  createdAt: string;
};

/** A missing table (not yet migrated) — treat as "no drafts", not an error. */
function isMissingTable(code?: string | null): boolean {
  return code === "PGRST205" || code === "42P01";
}

/** Persist one generated draft. Fail-soft → false (never throws). */
export async function saveMoveDraft(
  tenantId: string,
  recId: string,
  kind: MoveDraftKind,
  content: string,
): Promise<boolean> {
  const trimmed = (content ?? "").trim();
  if (!tenantId || !recId || !trimmed) return false;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("move_drafts").insert({
      tenant_id: tenantId,
      rec_id: recId,
      kind,
      content: trimmed.slice(0, 12_000),
    });
    if (error) {
      if (!isMissingTable(error.code)) {
        log.warn("[move-draft] save failed", { tenantId, recId, kind, error: error.message });
      }
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[move-draft] save threw", {
      tenantId,
      recId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/**
 * Latest draft per (recId, kind) for a tenant, as a map keyed `${recId}::${kind}`.
 * Fail-soft → empty map. Used by the cockpit loader to hydrate cards on render.
 */
export async function getLatestMoveDrafts(
  tenantId: string,
  limit = 500,
): Promise<Map<string, MoveDraftRow>> {
  const out = new Map<string, MoveDraftRow>();
  if (!tenantId) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("move_drafts")
      .select("rec_id, kind, content, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error && !isMissingTable(error.code)) {
        log.warn("[move-draft] read failed", { tenantId, error: error.message });
      }
      return out;
    }
    for (const r of data) {
      const key = `${r.rec_id as string}::${r.kind as string}`;
      if (out.has(key)) continue; // first seen = newest (desc order)
      out.set(key, {
        recId: r.rec_id as string,
        kind: r.kind as MoveDraftKind,
        content: r.content as string,
        createdAt: r.created_at as string,
      });
    }
    return out;
  } catch (e) {
    log.warn("[move-draft] read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return out;
  }
}

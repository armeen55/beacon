import "server-only";

/**
 * state-repo (integrity closure) - the basis-scoped Supabase-only research-state
 * repository. ONE row per (tenant, basis) in public.research_state; optimistic
 * row_version writes; NO file or JSON dual-write anywhere. Service-role only
 * (RLS denies anon/authenticated). The admin client + configured check are an
 * injectable seam so the repo is unit-testable without a live DB.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";

type ResearchStateRow<T> = {
  tenantId: string;
  basisTag: string;
  schemaVersion: number;
  state: T;
  rowVersion: number;
};

/** Minimal Supabase surface the repo touches, so a fake table stands in for tests. */
type AdminLike = { from: (table: string) => unknown };
export type StateRepoDeps = { admin?: () => AdminLike; configured?: () => boolean };

const TABLE = "research_state";

/** Load the (tenant, basis) row, or null when absent / unconfigured / on error. */
export async function loadResearchState<T>(
  tenantId: string,
  basisTag: string,
  deps: StateRepoDeps = {},
): Promise<ResearchStateRow<T> | null> {
  const configured = deps.configured ?? isSupabaseConfigured;
  if (!configured() || !tenantId || !basisTag) return null;
  try {
    const admin = deps.admin ?? getSupabaseAdmin;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (admin() as any)
      .from(TABLE)
      .select("schema_version, state, row_version")
      .eq("tenant_id", tenantId)
      .eq("basis_tag", basisTag)
      .maybeSingle();
    const { data, error } = await q;
    if (error || !data) return null;
    const row = data as { schema_version: number; state: T; row_version: number };
    return { tenantId, basisTag, schemaVersion: row.schema_version, state: row.state, rowVersion: row.row_version };
  } catch {
    return null;
  }
}

/** Optimistic save: writes only when the stored row_version still equals
 *  expectedRowVersion (or the row is absent for expectedRowVersion <= 0).
 *  Returns the new row version, or null when the row moved underneath us. */
export async function saveResearchState<T>(
  tenantId: string,
  basisTag: string,
  state: T,
  expectedRowVersion: number,
  deps: StateRepoDeps = {},
): Promise<number | null> {
  const configured = deps.configured ?? isSupabaseConfigured;
  if (!configured() || !tenantId || !basisTag) return null;
  const admin = deps.admin ?? getSupabaseAdmin;
  const nowIso = new Date().toISOString();
  try {
    if (expectedRowVersion <= 0) {
      // Absent row: INSERT. A concurrent existing row makes the PK insert fail,
      // which surfaces as an error/no-row and is reported as a conflict (null).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin() as any)
        .from(TABLE)
        .insert({ tenant_id: tenantId, basis_tag: basisTag, state, row_version: 1, updated_at: nowIso })
        .select("row_version")
        .maybeSingle();
      if (error || !data) return null;
      return (data as { row_version: number }).row_version;
    }
    const next = expectedRowVersion + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin() as any)
      .from(TABLE)
      .update({ state, row_version: next, updated_at: nowIso })
      .eq("tenant_id", tenantId)
      .eq("basis_tag", basisTag)
      .eq("row_version", expectedRowVersion)
      .select("row_version")
      .maybeSingle();
    if (error || !data) return null;
    return (data as { row_version: number }).row_version;
  } catch {
    return null;
  }
}

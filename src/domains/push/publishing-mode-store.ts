import "server-only";

/**
 * 2026-06-16 — durable per-site publishing-mode store (armed vs staged).
 *
 * Mirrors `src/lib/connectors/wix/mappings-store.ts` EXACTLY in posture:
 *   • Reads/writes go through the Supabase service-role admin client,
 *     tenant-scoped on EVERY query (`.eq("tenant_id", tid)`).
 *   • Tenant is ALWAYS the ambient request tenant (`currentTenantId()`) — the
 *     same one the file fallback routes by. No explicit-tenant override (that
 *     would desync the Supabase + file paths → a cross-tenant foot-gun).
 *   • FILE FALLBACK so no-env local dev + the pre-migration hosted window keep
 *     working: getSupabaseAdmin() throws (no env) → file store; PostgREST
 *     `42P01` undefined_table → file store.
 *
 * SAFETY: the absence of any record → `staged` (the safe default, two-click).
 * Every failure path also resolves to `staged`. Losing the armed state can only
 * ever revert to requiring the second approval click — NEVER to an unexpected
 * live write. (The structural write authority stays in executePush.)
 *
 * Pinned by tests/domains/push/publishing-mode-store.test.ts.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { PublishingMode } from "./publishing-mode";

const TABLE = "wix_publishing_mode";
const STORE = "wix-publishing-mode";

export type PublishingModeState = {
  mode: PublishingMode;
  /** ISO timestamp the site was armed, or null when staged/never armed. */
  armedAt: string | null;
  /** Who armed it (user id / "operator"), or null. */
  armedBy: string | null;
};

const STAGED: PublishingModeState = { mode: "staged", armedAt: null, armedBy: null };

type ModeRow = {
  tenant_id: string;
  mode: string;
  armed_at: string | null;
  armed_by: string | null;
  updated_at?: string;
};

/** File-store row shape — the file is already tenant-scoped (per-tenant file),
 *  so it carries NO tenant_id (the json-store routes by the ambient tenant). */
type FileModeRow = Pick<ModeRow, "mode" | "armed_at" | "armed_by">;

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

function rowToState(row: FileModeRow | null | undefined): PublishingModeState {
  if (row == null) return STAGED;
  return {
    mode: row.mode === "armed" ? "armed" : "staged",
    armedAt: row.armed_at ?? null,
    armedBy: row.armed_by ?? null,
  };
}

async function readFileState(): Promise<PublishingModeState> {
  try {
    const rows = (await readStore<FileModeRow>(STORE)) ?? [];
    return rowToState(rows[0]);
  } catch {
    return STAGED; // fail-safe: any read error → staged (two-click)
  }
}

/**
 * The tenant's publishing mode. Defaults to `staged` on ANY uncertainty (no
 * record, no env, table absent, read error) — the safe, review-gated default.
 */
export async function getPublishingMode(): Promise<PublishingModeState> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return await readFileState(); // no Supabase env (local dev) → file store
  }
  let tid: string;
  try {
    tid = await currentTenantId();
  } catch {
    return STAGED; // no tenant context → staged (never an accidental armed read)
  }
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("tenant_id", tid)
    .maybeSingle();
  if (error != null) {
    if (isUndefinedTableError(error)) return await readFileState();
    // LOUD but fail-safe: an unexpected read error must not present as armed.
    console.error(
      `[publishing-mode-store] read failed for ${tid}: ${error.message ?? String(error)} — defaulting to staged (safe).`,
    );
    return STAGED;
  }
  return rowToState(data as ModeRow | null);
}

/**
 * Set the tenant's publishing mode. Stamps armed_at/armed_by when arming,
 * clears them when staging. Best-effort file mirror for local parity.
 */
export async function setPublishingMode(args: {
  mode: PublishingMode;
  armedBy?: string | null;
  now?: Date;
}): Promise<PublishingModeState> {
  const now = args.now ?? new Date();
  const nextState: PublishingModeState = {
    mode: args.mode,
    armedAt: args.mode === "armed" ? now.toISOString() : null,
    armedBy: args.mode === "armed" ? args.armedBy ?? "operator" : null,
  };

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await writeFileState(nextState); // no env → file store only
    return nextState;
  }
  const tid = await currentTenantId();
  const row: ModeRow = {
    tenant_id: tid,
    mode: nextState.mode,
    armed_at: nextState.armedAt,
    armed_by: nextState.armedBy,
    updated_at: now.toISOString(),
  };
  const up = await admin.from(TABLE).upsert(row, { onConflict: "tenant_id" });
  if (up.error != null) {
    if (isUndefinedTableError(up.error)) {
      await writeFileState(nextState);
      return nextState;
    }
    throw new Error(
      `publishing-mode-store: upsert failed for ${tid}: ${up.error.message ?? String(up.error)}`,
    );
  }
  await mirrorToFile(nextState);
  return nextState;
}

async function writeFileState(state: PublishingModeState): Promise<void> {
  // The json-store file is already per-tenant (ambient-routed), so the row
  // carries NO tenant_id — only the mode + arming metadata.
  await writeStore<FileModeRow>(STORE, [
    { mode: state.mode, armed_at: state.armedAt, armed_by: state.armedBy },
  ]);
}

async function mirrorToFile(state: PublishingModeState): Promise<void> {
  try {
    await writeFileState(state);
  } catch {
    // best-effort local parity; never block the durable write on a file error.
  }
}

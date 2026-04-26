/**
 * Sprint 6A.1 Phase 11 (2026-04-24) — recommended_edits persistence layer.
 *
 * Maps validated `SpecificEdit[]` from a provider bundle to the
 * `recommended_edits` row shape (Phase 1 migration), persists to
 * `.data/recommended-edits.json` (file-first, idempotent by
 * deterministic `id`), and dual-writes to Supabase.
 *
 * The orchestration helper `runProviderAndPersist` chains:
 *   provider.generate(packet)
 *   → validateSpecificEditBundle(bundle, packet)
 *   → mapSpecificEditToRow per accepted edit
 *   → file replace-by-id + dual-write
 *
 * Pure mapping. No LLM. No UI. No route render.
 *
 * Hard rules (locked by tests):
 *   - Only validated edits land in `recommended_edits`.
 *   - Rejected edits do NOT silently succeed — the orchestration
 *     helper returns the rejected list with field + reason so the
 *     caller can log / persist them to `llm_rejections` (a future
 *     phase wires that table; v1 keeps it in-memory only since
 *     deterministic output is always valid).
 *   - Bundle-level errors (tenantId / recId / evidenceHash mismatch)
 *     skip persistence entirely — we never write a half-broken
 *     bundle.
 *   - `id` is deterministic
 *     `${recId}__${actionType}__${target_element_key ?? "null"}` so
 *     re-runs are idempotent both at the file layer and at the DB
 *     layer's (rec_id, action_type, target_element_key) unique index.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  readDotDataJson,
  writeDotDataJson,
} from "@/lib/persistence/dotdata-json";
import { syncRecommendedEdits } from "@/lib/persistence/dual-write";
import { currentTenantId } from "@/lib/tenant-context";
import type {
  ActionType,
} from "./action-types";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";
import type {
  SpecificEdit,
  SpecificEditBundle,
  SpecificEditEvidenceRef,
  SpecificEditProvider,
  SpecificEditSource,
} from "./specific-edit-provider";
import {
  validateSpecificEditBundle,
  type BundlePerEditResult,
  type ValidationFail,
} from "./specific-edit-validator";

// ---------------------------------------------------------------------------
// DB row shape — snake_case mirror of the recommended_edits migration.
// ---------------------------------------------------------------------------

export type RecommendedEditRow = {
  id: string;
  tenant_id: string;
  rec_id: string;
  action_type: ActionType;
  target_url: string;
  target_element_key: string | null;
  display_label: string | null;
  current_text: string | null;
  proposed_text: string | null;
  why: string;
  /** Stored as jsonb. Array of typed evidence refs. */
  evidence: SpecificEditEvidenceRef[];
  expected_impact: string | null;
  difficulty: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  measurement_plan: string | null;
  /** Stored as text[]. */
  risks: string[];
  source: SpecificEditSource;
  provider_name: string | null;
  evidence_hash: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export type MapSpecificEditToRowArgs = {
  edit: SpecificEdit;
  recId: string;
  tenantId: string;
  evidenceHash: string;
  now: Date;
};

/**
 * Pure: SpecificEdit → recommended_edits row. Camel→snake; flattens
 * `targetElement` into the four element columns; deterministic `id`
 * keeps the row idempotent under re-runs.
 */
export function mapSpecificEditToRow(
  args: MapSpecificEditToRowArgs,
): RecommendedEditRow {
  const { edit, recId, tenantId, evidenceHash, now } = args;
  const elementKey = edit.targetElement?.elementKey ?? null;
  const id = `${recId}__${edit.actionType}__${elementKey ?? "null"}`;
  const nowIso = now.toISOString();
  return {
    id,
    tenant_id: tenantId,
    rec_id: recId,
    action_type: edit.actionType,
    target_url: edit.targetUrl,
    target_element_key: elementKey,
    display_label: edit.targetElement?.displayLabel ?? null,
    current_text: edit.targetElement?.currentText ?? null,
    proposed_text: edit.targetElement?.proposedText ?? null,
    why: edit.why,
    evidence: edit.evidence,
    expected_impact: edit.expectedImpact,
    difficulty: edit.difficulty,
    confidence: edit.confidence,
    measurement_plan: edit.measurementPlan,
    risks: edit.risks,
    source: edit.source,
    provider_name: edit.providerName,
    evidence_hash: evidenceHash,
    model: edit.model,
    cost_usd: edit.costUsd,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Local file persistence (file-first invariant)
// ---------------------------------------------------------------------------

const STORE = "recommended-edits";

/** Read all current rows from `.data/recommended-edits.json`. */
export async function readRecommendedEditsLocal(): Promise<RecommendedEditRow[]> {
  return (await readDotDataJson<RecommendedEditRow[]>(STORE)) ?? [];
}

/**
 * Replace-by-`id` write to `.data/recommended-edits.json`. Existing
 * rows whose `id` matches a row in `incoming` are overwritten;
 * everything else is preserved. Vercel's lambda FS is read-only —
 * `writeDotDataJson` no-ops there; the dual-write keeps the canonical
 * source up to date in Supabase.
 */
export async function persistRecommendedEditsLocal(
  incoming: RecommendedEditRow[],
): Promise<void> {
  if (incoming.length === 0) return;
  const existing = await readRecommendedEditsLocal();
  const byId = new Map<string, RecommendedEditRow>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  await writeDotDataJson(STORE, [...byId.values()]);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type RunProviderAndPersistOptions = {
  provider: SpecificEditProvider;
  packet: SpecificEditEvidencePacket;
  /** When true (default), skip both the local file write AND the
   *  Supabase dual-write. The bundle is still generated + validated,
   *  so callers can inspect the planned output without side effects. */
  dryRun?: boolean;
  now?: Date;
};

export type RunProviderAndPersistResult = {
  /** True only when bundle validation passed AND every accepted row
   *  was persisted (or would have been, in dry-run). */
  ok: boolean;
  /** The full bundle from the provider. */
  bundle: SpecificEditBundle;
  /** Bundle-level validation errors (empty when bundle is well-formed). */
  bundleErrors: ValidationFail[];
  /** Total edits the provider returned. */
  totalGenerated: number;
  /** Edits that passed `validateSpecificEdit`. */
  acceptedCount: number;
  /** Edits that failed `validateSpecificEdit`. */
  rejectedCount: number;
  /** The rows mapped from accepted edits. Identical to what was
   *  written (or would be written, in dry-run). */
  acceptedRows: RecommendedEditRow[];
  /** Per-edit results for rejected edits — caller can log them or
   *  persist them to `llm_rejections` in a later phase. */
  rejected: BundlePerEditResult[];
  /** True when the run actually wrote (file + dual-write). False for
   *  dry-runs OR when bundle validation failed. */
  persisted: boolean;
};

/**
 * Generate a bundle, validate it, map accepted edits to rows, and
 * persist (file-first + Supabase dual-write). Bundle-level validation
 * failures abort persistence — callers should NOT silently retry.
 *
 * Dry-run is opt-in via `dryRun: true`. The default writes when the
 * bundle is well-formed.
 */
export async function runProviderAndPersist(
  opts: RunProviderAndPersistOptions,
): Promise<RunProviderAndPersistResult> {
  // Phase 7.7d (2026-04-25): assert the packet's tenantId matches the
  // resolved request/CLI context. Without this, a packet built under
  // tenant A could be passed into a server action that resolves to
  // tenant B and write under the wrong tenant. Fails loud at the
  // boundary so misconfigurations surface immediately rather than
  // landing rows under the wrong tenant.
  //
  // CLI context: currentTenantId() falls through to BEACON_TENANT_ID
  // env (Phase 7.5d fail-loud) — same fail-loud guarantee.
  const ctxTenantId = await currentTenantId();
  if (opts.packet.tenantId !== ctxTenantId) {
    throw new Error(
      `[runProviderAndPersist] tenant mismatch: packet.tenantId=${JSON.stringify(opts.packet.tenantId)} context=${ctxTenantId}`,
    );
  }

  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;

  const bundle = await opts.provider.generate(opts.packet);
  const validation = validateSpecificEditBundle(bundle, opts.packet);

  const acceptedEdits: SpecificEdit[] = validation.perEdit
    .filter((p) => p.result.ok)
    .map((p) => p.edit);
  const rejected: BundlePerEditResult[] = validation.perEdit.filter(
    (p) => !p.result.ok,
  );

  const allRows = acceptedEdits.map((edit) =>
    mapSpecificEditToRow({
      edit,
      recId: opts.packet.recId,
      tenantId: opts.packet.tenantId,
      evidenceHash: opts.packet.evidenceHash,
      now,
    }),
  );

  // Defensive dedup at the persistence boundary by row `id` (which is
  // deterministic on `(rec_id, action_type, target_element_key)` —
  // exactly the DB unique-index target with `NULLS NOT DISTINCT`).
  // Phase 9 generators iterate `ownedPageCandidates × prompts`, which
  // can produce multiple edits with the same element_key but different
  // `target_url`. The unique index doesn't include `target_url`, so
  // those rows collide on upsert. Keep the FIRST occurrence (highest
  // match score) until the schema or generator design is broadened.
  const seenIds = new Set<string>();
  const acceptedRows: RecommendedEditRow[] = [];
  let droppedDuplicateRowCount = 0;
  for (const row of allRows) {
    if (seenIds.has(row.id)) {
      droppedDuplicateRowCount += 1;
      continue;
    }
    seenIds.add(row.id);
    acceptedRows.push(row);
  }
  if (droppedDuplicateRowCount > 0) {
    log.warn(
      "runProviderAndPersist: dropped duplicate (rec_id, action_type, target_element_key) rows",
      {
        recId: opts.packet.recId,
        droppedDuplicateRowCount,
        keptCount: acceptedRows.length,
      },
    );
  }

  let persisted = false;
  if (
    !dryRun &&
    validation.bundleErrors.length === 0 &&
    acceptedRows.length > 0
  ) {
    try {
      await persistRecommendedEditsLocal(acceptedRows);
      await syncRecommendedEdits(acceptedRows, ctxTenantId);
      persisted = true;
    } catch (err) {
      log.error("recommended_edits persistence failed", {
        recId: opts.packet.recId,
        tenantId: opts.packet.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Re-throw so callers can surface this — quietly degrading would
      // hide a real persistence break.
      throw err;
    }
  }

  return {
    ok:
      validation.bundleErrors.length === 0 && validation.rejectedCount === 0,
    bundle,
    bundleErrors: [...validation.bundleErrors],
    totalGenerated: bundle.recommendations.length,
    acceptedCount: validation.acceptedCount,
    rejectedCount: validation.rejectedCount,
    acceptedRows,
    rejected,
    persisted,
  };
}

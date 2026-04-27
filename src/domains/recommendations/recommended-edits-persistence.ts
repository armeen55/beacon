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
import { resolveLLMProvider } from "@/lib/llm/config";
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
import { emptyBundleFor } from "./specific-edit-provider";
import { deterministicProvider } from "./providers/deterministic";
import { openaiProvider } from "./providers/openai";
import { checkBudget, recordSpend } from "./adjudicator-budget";
import { appendSpecificEditLLMHistory } from "./specific-edit-llm-history";
import {
  validateSpecificEditBundle,
  type BundlePerEditResult,
  type ValidationFail,
} from "./specific-edit-validator";

// ---------------------------------------------------------------------------
// DB row shape — snake_case mirror of the recommended_edits migration.
// ---------------------------------------------------------------------------

/**
 * Recommendation Lifecycle OS — Phase 1 (2026-04-27).
 *
 * Per-edit lifecycle state. Locked in
 * `docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md` §2.
 *
 * Phase 1 ships only the SHAPE (this union + the 7 new persistence
 * columns) and the `recommended` → `accepted` transition. The remaining
 * states (`verified_live` etc.) are populated by the match engine in
 * Phase 3. UI surfacing is Phase 6. Until then, callers MUST treat
 * undefined as `recommended` at the read boundary — legacy file rows
 * predate this column.
 */
export type ImplementationStatus =
  | "recommended"
  | "accepted"
  | "verified_live"
  | "verified_live_modified"
  | "needs_review"
  | "wrong_page"
  | "partially_implemented"
  | "not_found_after_7d"
  | "dismissed";

/** Phase 1: confidence tier emitted by the (future Phase 2) match engine. */
export type LiveMatchConfidence = "high" | "medium" | "low";

/**
 * Phase 1 (extended Phase 3, 2026-04-27): kind of match emitted by
 * the match engine. `"structural_partial"` was added in Phase 3 to
 * support FAQ Q+A pair reconciliation where one leg matched and the
 * other did not. The DB column is `text NULL` so any string is
 * accepted; widening the TS union keeps the persistence-layer type
 * a faithful mirror of the engine's `MatchKind`.
 *
 * Engine-only kinds (`"none"`, `"unsupported"`) are intentionally
 * NOT in this union — those are only emitted alongside
 * `outcome: "not_found"`, where the runner does not stamp `live_*`
 * fields at all.
 */
export type LiveMatchKind =
  | "exact"
  | "modified"
  | "key_only"
  | "text_only"
  | "wrong_page"
  | "structural_partial";

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

  // ---------------------------------------------------------------------
  // Recommendation Lifecycle OS — Phase 1 (2026-04-27).
  //
  // Optional. The DB has a column DEFAULT 'recommended' for
  // implementation_status, so SELECTs always return a value; the field
  // is optional in TS only because legacy `.data/recommended-edits.json`
  // rows on disk predate the column. Read sites MUST treat undefined as
  // `'recommended'` (use `editLifecycleStatus(row)` helper).
  //
  // The remaining live_* columns are populated by Phase 3's match
  // engine; until then they stay null/undefined for every row.
  // ---------------------------------------------------------------------

  /** Per-edit lifecycle state. See `ImplementationStatus`. */
  implementation_status?: ImplementationStatus;
  /**
   * ISO timestamp at which the match engine first observed this edit
   * live on the page. Source: `page_snapshots.fetched_at` of the
   * matching snapshot. Stays null until Phase 3.
   */
  live_at?: string | null;
  /** `page_snapshots.id` of the snapshot that proved the edit live. */
  live_snapshot_id?: string | null;
  /** Confidence tier of the match (Phase 3 fills). */
  live_match_confidence?: LiveMatchConfidence | null;
  /** Match kind (exact / modified / key_only / text_only / wrong_page). */
  live_match_kind?: LiveMatchKind | null;
  /**
   * `page_element_inventory.element_key` of the matching element. May
   * differ from `target_element_key` when match was text-only.
   */
  live_element_key?: string | null;
  /** Free-text reason if status is `not_found_after_7d`. */
  not_found_reason?: string | null;
};

/**
 * Read-side normalization: legacy file rows lack `implementation_status`.
 * Treat undefined as `recommended` — matches the DB column DEFAULT.
 *
 * Pure helper. No I/O. Idempotent. Use anywhere a caller needs to
 * branch on lifecycle state without writing the same fallback inline.
 */
export function editLifecycleStatus(
  row: Pick<RecommendedEditRow, "implementation_status">,
): ImplementationStatus {
  return row.implementation_status ?? "recommended";
}

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
    // Lifecycle OS Phase 1: every newly-mapped edit starts in
    // `recommended`. The DB column DEFAULT covers existing-row
    // upserts; we set it explicitly here so the file-first store and
    // any Supabase upsert from new code agree.
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle OS Phase 1 — `recommended` → `accepted` transition.
// ---------------------------------------------------------------------------

/**
 * Mark a set of `recommended_edits` rows as `accepted`. Called by the
 * `acceptRecommendation` server action immediately after the per-edit
 * changelog fan-out. Pure-ish: reads the local file, mutates matching
 * rows in place (status + updated_at), writes the file back, then
 * dual-writes the changed rows to Supabase.
 *
 * Hard rules (locked by tests):
 *   - Idempotent: re-calling with the same ids on already-accepted rows
 *     is a no-op (no file write, no dual-write).
 *   - Forward-only: rows already in `verified_live` / `verified_live_modified`
 *     / `dismissed` etc. are NOT downgraded to `accepted` — Phase 2's
 *     state-machine guard bakes this into the transition table.
 *     Phase 1's surface-level guard: only flips when current status is
 *     `recommended` or undefined (legacy rows).
 *   - Unknown ids are skipped silently. Returning a count of rows
 *     actually flipped lets the caller log; throwing on unknown ids
 *     would couple the server action to file-state assumptions.
 *
 * Returns the count of rows whose status actually changed.
 */
export async function markRecommendedEditsAccepted(args: {
  editIds: ReadonlyArray<string>;
  tenantId: string;
  now?: Date;
}): Promise<{ flipped: number; skipped: number }> {
  if (args.editIds.length === 0) return { flipped: 0, skipped: 0 };
  const nowIso = (args.now ?? new Date()).toISOString();
  const idSet = new Set(args.editIds);

  const all = await readRecommendedEditsLocal();
  const flipped: RecommendedEditRow[] = [];
  let skipped = 0;
  const next: RecommendedEditRow[] = [];
  for (const row of all) {
    if (!idSet.has(row.id)) {
      next.push(row);
      continue;
    }
    const status = editLifecycleStatus(row);
    if (status === "recommended") {
      const updated: RecommendedEditRow = {
        ...row,
        implementation_status: "accepted",
        updated_at: nowIso,
      };
      flipped.push(updated);
      next.push(updated);
    } else {
      // Already accepted (or further along) — no-op for idempotency.
      skipped += 1;
      next.push(row);
    }
  }

  if (flipped.length === 0) {
    return { flipped: 0, skipped };
  }

  await writeDotDataJson(STORE, next);
  try {
    await syncRecommendedEdits(flipped, args.tenantId);
  } catch (err) {
    log.warn("markRecommendedEditsAccepted: dual-write failed", {
      tenantId: args.tenantId,
      flippedCount: flipped.length,
      error: err instanceof Error ? err.message : String(err),
    });
    // File-first contract: the local mutation already landed; the
    // Supabase mirror catches up on the next successful sync. Match
    // engine in Phase 3 reads from the file-first source via the
    // repository, so attribution stays correct even on a transient
    // dual-write failure.
  }
  return { flipped: flipped.length, skipped };
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
  /**
   * Sprint 6A.2c (2026-04-26): now optional. When omitted the function
   * resolves the active provider via `resolveLLMProvider()` reading
   * `BEACON_LLM_PROVIDER` env (default = "deterministic"). Existing CLI
   * callers continue to pass `deterministicProvider` explicitly; the
   * new env-driven path is reachable through tests + the future server
   * action surface in 6A.2e.
   */
  provider?: SpecificEditProvider;
  packet: SpecificEditEvidencePacket;
  /** When true, skip both the local file write AND the Supabase
   *  dual-write. The bundle is still generated + validated, so callers
   *  can inspect the planned output without side effects. */
  dryRun?: boolean;
  now?: Date;
};

/**
 * Resolve the active provider for one `runProviderAndPersist` call.
 * Explicit `opts.provider` always wins; otherwise read env via
 * `resolveLLMProvider()` and dispatch through the registry. Throws on
 * invalid env (config gate inherits the 6A.2a fail-loud contract).
 */
function resolveProvider(
  opts: RunProviderAndPersistOptions,
): SpecificEditProvider {
  if (opts.provider) return opts.provider;
  const name = resolveLLMProvider();
  if (name === "openai") return openaiProvider;
  return deterministicProvider;
}

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
  // Phase 7.7d (2026-04-25): tenant mismatch is the FIRST gate. Earliest
  // fail-loud — must run before provider resolution / budget gate /
  // network call so a misconfigured packet never reaches the LLM.
  // CLI context: currentTenantId() falls through to BEACON_TENANT_ID env
  // (Phase 7.5d fail-loud).
  const ctxTenantId = await currentTenantId();
  if (opts.packet.tenantId !== ctxTenantId) {
    throw new Error(
      `[runProviderAndPersist] tenant mismatch: packet.tenantId=${JSON.stringify(opts.packet.tenantId)} context=${ctxTenantId}`,
    );
  }

  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;

  // Sprint 6A.2c (2026-04-26): resolve the active provider via the
  // 6A.2a config helper unless caller passed one explicitly. Throws on
  // invalid BEACON_LLM_PROVIDER / missing OPENAI_API_KEY (fail-loud).
  const provider = resolveProvider(opts);

  // Sprint 6A.2c: pre-call budget gate for paid providers. Deterministic
  // is free — skip the gate. OpenAI shares the existing `llm-budget.json`
  // monthly cap with the page-intent adjudicator (Option A from the
  // 6A.2 plan): one pot, one place to monitor. If the cap is reached,
  // do NOT call the provider; record the budget-blocked event in
  // history; return an empty no-persist result.
  if (provider.name === "openai") {
    const budget = await checkBudget({ now });
    if (!budget.allowed) {
      log.warn("[runProviderAndPersist] budget blocked", {
        recId: opts.packet.recId,
        tenantId: opts.packet.tenantId,
        reason: budget.reason,
      });
      await appendSpecificEditLLMHistory({
        timestamp: now.toISOString(),
        tenantId: opts.packet.tenantId,
        recId: opts.packet.recId,
        evidenceHash: opts.packet.evidenceHash,
        providerName: "openai",
        model: null,
        costUsd: 0,
        acceptedCount: 0,
        status: "budget_blocked",
        errorMessage: budget.reason,
      });
      const emptyBundle = emptyBundleFor(opts.packet, "openai", now);
      return {
        ok: false,
        bundle: emptyBundle,
        bundleErrors: [],
        totalGenerated: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        acceptedRows: [],
        rejected: [],
        persisted: false,
      };
    }
  }

  // Sprint 6A.2c: provider call wrapped in try/catch. Provider failures
  // already return empty bundles in 6A.2b's openai implementation, but
  // the wrapper here also handles unexpected throws (e.g., the anthropic
  // stub if it's somehow reached) without crashing the pipeline. The
  // caller still sees the empty bundle; the deterministic provider's
  // output (run in a separate invocation) is the safety net.
  let bundle: SpecificEditBundle;
  try {
    bundle = await provider.generate(opts.packet);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[runProviderAndPersist] provider threw; treating as empty", {
      recId: opts.packet.recId,
      tenantId: opts.packet.tenantId,
      providerName: provider.name,
      error: msg,
    });
    if (provider.name === "openai") {
      await appendSpecificEditLLMHistory({
        timestamp: now.toISOString(),
        tenantId: opts.packet.tenantId,
        recId: opts.packet.recId,
        evidenceHash: opts.packet.evidenceHash,
        providerName: "openai",
        model: null,
        costUsd: 0,
        acceptedCount: 0,
        status: "empty_or_error",
        errorMessage: msg.slice(0, 500),
      });
    }
    bundle = emptyBundleFor(opts.packet, provider.name, now);
  }

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

  // Sprint 6A.2c (2026-04-26): post-call accounting for the OpenAI
  // path. Three flavors:
  //   - bundle has cost > 0 + recommendations: live_call. Record spend,
  //     append history with the actual cost + accepted count.
  //   - bundle has cost = 0 (provider returned empty after the call):
  //     empty_or_error. Skip recordSpend (nothing to record); append a
  //     history breadcrumb so the operator sees the failed attempt.
  //   - dryRun=true with a paid bundle: still record the spend (the
  //     network call DID happen — dryRun only governs row persistence,
  //     not whether the provider was invoked).
  // Deterministic provider produces totalCostUsd === 0 by design and
  // doesn't need an entry here.
  if (provider.name === "openai") {
    if (bundle.totalCostUsd > 0) {
      await recordSpend(bundle.totalCostUsd, { now });
      await appendSpecificEditLLMHistory({
        timestamp: now.toISOString(),
        tenantId: opts.packet.tenantId,
        recId: opts.packet.recId,
        evidenceHash: opts.packet.evidenceHash,
        providerName: "openai",
        model:
          bundle.recommendations.length > 0
            ? (bundle.recommendations[0].model ?? null)
            : null,
        costUsd: bundle.totalCostUsd,
        acceptedCount: validation.acceptedCount,
        status: "live_call",
      });
    } else if (bundle.recommendations.length === 0) {
      // Empty bundle with zero cost — provider returned []
      // legitimately or short-circuited (network error, refusal, etc.)
      // The 6A.2b provider's failure modes all land here. Add a
      // breadcrumb unless we already wrote one in the catch block.
      // Idempotent dedup isn't critical because runs are infrequent and
      // entries roll off at the cap; an extra row is fine.
      await appendSpecificEditLLMHistory({
        timestamp: now.toISOString(),
        tenantId: opts.packet.tenantId,
        recId: opts.packet.recId,
        evidenceHash: opts.packet.evidenceHash,
        providerName: "openai",
        model: null,
        costUsd: 0,
        acceptedCount: 0,
        status: "empty_or_error",
      });
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

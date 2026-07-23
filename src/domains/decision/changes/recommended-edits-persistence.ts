/**
 * recommended_edits persistence layer — the durable queue for exact-edit
 * recommendations.
 *
 * Owns the `recommended_edits` row shape, its lifecycle state machine
 * (recommended → accepted → pushed/verified_live/…), file-first
 * persistence to `.data/recommended-edits.json` (idempotent by
 * deterministic `id`), and the Supabase dual-write.
 *
 * Core 100K wave 2 (DECISION kernel collapse): the drafting/generation
 * orchestration (provider bundle → validate → map → persist) was deleted
 * along with the specific-edit provider/validator/evidence cluster it
 * drove — that generation had no live caller. This module now serves the
 * live surfaces (Changes, push/stage-change, load-action-row-by-edit) that
 * read persisted rows and drive the lifecycle transitions.
 *
 * Hard rules (locked by tests):
 *   - `id` is deterministic
 *     `${recId}__${actionType}__${target_element_key ?? "null"}` so
 *     re-runs stay idempotent at the file layer and at the DB's
 *     (rec_id, action_type, target_element_key) unique index.
 *   - Forward-only: a re-generation never downgrades a lifecycle-locked
 *     row (accepted / verified_live / dismissed / …) back to recommended.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  readDotDataJson,
  writeDotDataJson,
} from "@/lib/persistence/dotdata-json";
import { syncRecommendedEdits } from "@/lib/persistence/dual-write";
import type { ActionType } from "./action-types";

// ---------------------------------------------------------------------------
// Row provenance + evidence-ref types. Inlined here (Core 100K wave 2 —
// DECISION kernel collapse) after the specific-edit provider/generation
// cluster was deleted. `recommended_edits` rows persisted by prior
// generation passes still carry these shapes, so the persistence layer
// remains their single source of truth.
// ---------------------------------------------------------------------------

/**
 * Source attribution. Mirrors `recommended_edits.source` column.
 *   - "deterministic" / "deterministic_promotion" — trigger-engine rows
 *   - "openai" / "anthropic" — LLM-provider rows (historical provenance)
 *   - "operator_edited" — the operator hand-edited an existing row
 */
export type SpecificEditSource =
  | "deterministic"
  | "deterministic_promotion"
  | "openai"
  | "anthropic"
  | "operator_edited";

/**
 * Typed evidence references stored on `recommended_edits.evidence` (jsonb).
 *   - prompt: an affected tracked-prompt id
 *   - element: an edited page element (key + url)
 *   - owned_page: an owned page url
 *   - competitor: a competitor name
 *   - prior_outcome: a prior action type
 */
export type SpecificEditEvidenceRef =
  | { type: "prompt"; promptId: string }
  | { type: "element"; elementKey: string; url: string }
  | { type: "owned_page"; url: string }
  | { type: "competitor"; competitorName: string }
  | { type: "prior_outcome"; actionType: ActionType };

// ---------------------------------------------------------------------------
// DB row shape — snake_case mirror of the recommended_edits migration.
// ---------------------------------------------------------------------------

/**
 * Recommendation Lifecycle OS — Phase 1 (2026-04-27).
 *
 * Per-edit lifecycle state. Invariant: forward-only state machine
 * (recommended -> accepted -> pushed/verified_live/dismissed); a
 * re-generation never downgrades a lifecycle-locked row. See docs/architecture.md.
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
  /** §push (2026-06-10): Beacon itself published the approved edit.
   *  Reachable ONLY via the human "Approve & Push" action. */
  | "pushed"
  /** §push: the adapter call failed; card stays actionable. */
  | "push_failed"
  | "verified_live"
  | "verified_live_modified"
  | "needs_review"
  | "wrong_page"
  | "partially_implemented"
  | "not_found_after_7d"
  /** Night-shift #114 (2026-06-11): auto-expired by the nightly queue
   *  sweeper — TTL or per-tenant queue-cap overflow. ONLY auto-promoted
   *  rows (source deterministic_promotion) ever get this status; it is
   *  machine hygiene, not operator rejection (cooldown 30d, vs 90d for
   *  dismissed). */
  | "expired"
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
 *
 * W2 Step 2.4 (2026-05-01): added `"operator_override"` to support
 * the explicit "Mark shipped" affordance on /recommendations and
 * /changes. The match engine never emits this value — it's stamped
 * exclusively by `markRecommendedEditsAsShipped`. When a later scan
 * finds the edit live with a real match kind, the row is allowed to
 * stay `verified_live` and the kind may be upgraded; downgrades are
 * blocked by the lifecycle's forward-only contract.
 */
export type LiveMatchKind =
  | "exact"
  | "modified"
  | "key_only"
  | "text_only"
  | "wrong_page"
  | "structural_partial"
  | "operator_override";

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
  /** Night-shift #100 substrate (2026-06-11): the matched element's
   *  LIVE text at verify time. On verified_live_modified this is the
   *  operator's final wording — the proposed→final delta that feeds
   *  the inner learning loop. */
  live_text?: string | null;
  /** Night-shift #127 substrate (2026-06-11): stamped the moment the
   *  operator accepts. The match runner's accept-time derivation
   *  prefers this over its legacy changelog/response/created_at
   *  ladder; also enables the time-to-approve metric. */
  accepted_at?: string | null;
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
        // #127 substrate (2026-06-11): explicit accept timestamp — the
        // 7-day not_found promotion no longer depends on derivation.
        accepted_at: nowIso,
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
// §push (2026-06-10) — push-result transition.
//
// The push service executed an adapter write for ONE approved card; this
// records the outcome. `pushed` also stamps `live_at` (the change IS live
// the moment the CMS write returns 200) so the Mode A outcome clock starts
// immediately; the match engine's scan pass remains the authoritative
// `verified_live` flip (or the immediate probe can flip it same-minute).
// ---------------------------------------------------------------------------

export async function markRecommendedEditPushResult(args: {
  editId: string;
  tenantId: string;
  result: "pushed" | "push_failed";
  verifiedByProbe?: boolean;
  now?: Date;
}): Promise<{ updated: boolean }> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const all = await readRecommendedEditsLocal();
  let updatedRow: RecommendedEditRow | null = null;
  const next: RecommendedEditRow[] = all.map((row) => {
    if (row.id !== args.editId) return row;
    const status =
      args.result === "pushed"
        ? args.verifiedByProbe
          ? ("verified_live" as const)
          : ("pushed" as const)
        : ("push_failed" as const);
    updatedRow = {
      ...row,
      implementation_status: status,
      ...(args.result === "pushed" ? { live_at: row.live_at ?? nowIso } : {}),
      updated_at: nowIso,
    };
    return updatedRow;
  });
  if (updatedRow == null) return { updated: false };

  await writeDotDataJson(STORE, next);
  try {
    await syncRecommendedEdits([updatedRow], args.tenantId);
  } catch (err) {
    log.warn("markRecommendedEditPushResult: dual-write failed", {
      tenantId: args.tenantId,
      editId: args.editId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { updated: true };
}

// ---------------------------------------------------------------------------
// W2 Step 2.4 (2026-05-01) — operator-driven `verified_live` transition.
//
// The match engine flips edits to `verified_live` after a scan confirms
// the edit on-page (Phase 3). But operators frequently ship an edit at
// 11pm and want the verdict clock started before tomorrow's 07:00 UTC
// scan. The "Mark shipped" affordance on /recommendations + /changes
// gives them a one-click manual override.
//
// State machine: `recommended` OR `accepted` → `verified_live`.
// Stamps:
//   - `live_at = nowIso` so bake-window math anchors immediately.
//   - `live_match_kind = "operator_override"` to distinguish from
//     scan-confirmed kinds (`exact` / `modified` / etc.). The match
//     engine treats `operator_override` as "trust the operator;
//     don't downgrade or unset on a future scan that finds the edit
//     under a different kind". A scan that finds NOTHING on the page
//     still cannot move us to `not_found_after_7d` because the
//     forward-only contract keeps `verified_live` terminal — the
//     operator owns the truth here.
//   - `live_match_confidence = "high"` — operator assertion is the
//     highest-confidence signal we have (modulo the operator being
//     wrong, which is recoverable via dismiss).
//
// Forward-only: rows already past `verified_live` (verified_live_modified,
// partially_implemented, not_found_after_7d, dismissed, needs_review,
// wrong_page) are no-op. Idempotent. Unknown ids are skipped silently.
// ---------------------------------------------------------------------------

export async function markRecommendedEditsAsShipped(args: {
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
    if (status === "recommended" || status === "accepted") {
      const updated: RecommendedEditRow = {
        ...row,
        implementation_status: "verified_live",
        live_at: nowIso,
        live_match_kind: "operator_override",
        live_match_confidence: "high",
        // The match engine populates live_snapshot_id + live_element_key
        // when it finds the edit live on the page. Operator override has
        // no scan to point at, so we leave those null. The next
        // successful scan will fill them in (forward-only on the rest of
        // the lifecycle keeps `verified_live` stable while the engine
        // lands the snapshot reference).
        live_snapshot_id: row.live_snapshot_id ?? null,
        live_element_key: row.live_element_key ?? null,
        not_found_reason: null,
        updated_at: nowIso,
      };
      flipped.push(updated);
      next.push(updated);
    } else {
      // Already verified_live (or further along) — no-op for idempotency.
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
    log.warn("markRecommendedEditsAsShipped: dual-write failed", {
      tenantId: args.tenantId,
      flippedCount: flipped.length,
      error: err instanceof Error ? err.message : String(err),
    });
    // File-first contract: same semantics as markRecommendedEditsAccepted.
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
/**
 * Statuses that represent an operator decision or a live-verified state.
 * A re-generation must NEVER reset these back to "recommended" — doing so
 * silently un-accepts shipped work and corrupts the proof engine's
 * treatment dates (audit #3, 2026-06-14). Forward-only contract shared by
 * the local file writer and the promotion writer's Supabase sync.
 */
export const LIFECYCLE_LOCKED_STATUSES: ReadonlySet<ImplementationStatus> =
  new Set<ImplementationStatus>([
    "accepted",
    // §push: Beacon published / tried to publish — resetting to "recommended"
    // loses the push record + live_at (the proof engine's treatment date).
    "pushed",
    "push_failed",
    "verified_live",
    "verified_live_modified",
    // Operator/scan decisions that must survive a nightly re-promotion.
    "needs_review",
    "wrong_page",
    "partially_implemented",
    // A measured "never found live after the bake window" — keep it, don't silently
    // reset to recommended (matches the match-runner's forward-only contract).
    "not_found_after_7d",
    "dismissed",
  ]);
// NOTE: "expired" is deliberately NOT locked — it's machine hygiene with a 30d
// cooldown whose whole purpose is to let a candidate re-surface later; locking it
// would strand it as "expired" forever. "recommended" is the only other unlocked
// state (it SHOULD be refreshed by re-promotion).

/**
 * Drop any incoming row whose persisted twin (same `id`) is in a
 * lifecycle-locked state, so a nightly re-run never downgrades an
 * operator-acted / live row back to "recommended". Pure; matches by the
 * deterministic promotion id. Rows still in "recommended" (or absent) are
 * left for the caller to overwrite/refresh as normal.
 */
export function dropLifecycleLockedRewrites<T extends { id: string }>(
  incoming: ReadonlyArray<T>,
  existing: ReadonlyArray<{
    id: string;
    implementation_status?: ImplementationStatus | null;
  }>,
): T[] {
  const locked = new Set(
    existing
      .filter((e) =>
        LIFECYCLE_LOCKED_STATUSES.has(
          (e.implementation_status ?? "recommended") as ImplementationStatus,
        ),
      )
      .map((e) => e.id),
  );
  return incoming.filter((r) => !locked.has(r.id));
}

export async function persistRecommendedEditsLocal(
  incoming: RecommendedEditRow[],
): Promise<void> {
  if (incoming.length === 0) return;
  const existing = await readRecommendedEditsLocal();
  const byId = new Map<string, RecommendedEditRow>();
  for (const row of existing) byId.set(row.id, row);
  // Forward-only (audit #3): a re-generation re-stamps every row
  // "recommended". Never let that overwrite a lifecycle-locked existing
  // row (accepted / verified_live / dismissed / …) — preserve it verbatim.
  for (const row of dropLifecycleLockedRewrites(incoming, existing)) {
    byId.set(row.id, row);
  }
  await writeDotDataJson(STORE, [...byId.values()]);
}

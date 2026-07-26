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

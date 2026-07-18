/**
 * Sprint 6A.1 Phase 8 (2026-04-24) — SpecificEditProvider interface +
 * output types.
 *
 * The contract every Specific Edit Generator (deterministic v1,
 * deterministic+LLM in Sprint 6A.2) implements. The interface consumes
 * a `SpecificEditEvidencePacket` from Phase 7 and produces a
 * `SpecificEditBundle` whose row shape mirrors the
 * `recommended_edits` table (Phase 1 migration).
 *
 * NO IMPLEMENTATIONS in this file. NO LLM CALLS. NO DB WRITES.
 * Implementations live alongside this file under `./providers/*.ts` —
 * one per provider — so provider-specific dependencies stay isolated
 * and auditable.
 *
 * Runtime providers behind one interface:
 *   - `deterministic` — the shell that activates in Phase 6A.1.9 with
 *     hand-written generators for the v1 active action types
 *     (edit_title, add_h2_section, add_faq).
 *   - `openai` — implemented behind the budgeted structured-output
 *     boundary.
 *   - `anthropic` remains a historical source/provider-name value so
 *     stored provenance still round-trips, but it is not configurable
 *     or implemented at runtime.
 *
 * The same `SpecificEditEvidencePacket` flows through every provider.
 * Callers swap providers with one line; no upstream code changes.
 */

import type { ActionType } from "./action-types";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";

// ---------------------------------------------------------------------------
// Output types — every field designed to round-trip JSON.stringify and
// map cleanly to the `recommended_edits` row shape.
// ---------------------------------------------------------------------------

export type SpecificEditDifficulty = "low" | "medium" | "high";
export type SpecificEditConfidence = "low" | "medium" | "high";

/**
 * Source attribution. Mirrors `recommended_edits.source` column.
 *
 *   - "deterministic" — emitted by a hand-written generator
 *   - "openai" / "anthropic" — emitted by the named LLM provider
 *   - "operator_edited" — the operator hand-edited an existing row
 *     (Sprint 6A.2 UX); reserved here so provider output and
 *     operator output share the same row shape.
 */
export type SpecificEditSource =
  | "deterministic"
  // Slice 4.5.D.α₁a (2026-05-20) — α₀a-trigger-engine-promoted
  // rows. Distinct from "deterministic" (which labels rows from the
  // legacy deterministic specific-edit provider — different
  // pipeline). Pinned by
  // `recommendation-intelligence-promotion-writer-source-pin`.
  | "deterministic_promotion"
  | "openai"
  | "anthropic"
  | "operator_edited";

/**
 * The set of provider names. Drawn from the same union as
 * `SpecificEditSource` minus `operator_edited`. The interface's `name`
 * MUST be one of these; generators / LLM calls dispatch on it.
 */
export type SpecificEditProviderName =
  | "deterministic"
  | "openai"
  | "anthropic";

/**
 * Typed evidence references back to the `SpecificEditEvidencePacket`'s
 * blocks. Generators (and LLM output validation in Sprint 6A.1.10)
 * MUST cite at least one ref per `SpecificEdit` so attribution can
 * trace why a specific edit was proposed. Keys map to packet content:
 *
 *   - prompt: `affectedPrompts[*].promptId`
 *   - element: `targetPageElements[*].elementKey` (+ url)
 *   - owned_page: `ownedPageCandidates[*].url`
 *   - competitor: `competitorAngles[*].competitorName`
 *   - prior_outcome: `priorOutcomes[*].actionType`
 */
export type SpecificEditEvidenceRef =
  | { type: "prompt"; promptId: string }
  | { type: "element"; elementKey: string; url: string }
  | { type: "owned_page"; url: string }
  | { type: "competitor"; competitorName: string }
  | { type: "prior_outcome"; actionType: ActionType };

/**
 * Identifies the page element being edited. Required when the action
 * type targets an existing element (per `ACTION_TYPE_REGISTRY`) and
 * MUST be `null` for page-level lifecycle actions (`create_page`,
 * `split_page`, `merge_pages`, `watch`).
 *
 * Both `currentText` and `proposedText` are nullable on this type so
 * the same shape covers both rewrite (current + proposed) and
 * additive (proposed only) edits. The validation layer (6A.1.10)
 * cross-checks against `ACTION_TYPE_REGISTRY[actionType].requires*Text`
 * to reject rows that omit a required text.
 */
export type SpecificEditTargetElement = {
  /** Stable element_key from `page_element_inventory`. Validation
   *  layer requires this to appear in the packet's
   *  `targetPageElements`, OR be a `<element_type>[new]:<hash>` key
   *  for additive edits per `element-key.ts:newElementKey`. */
  elementKey: string;
  /** Operator-facing label snapshot. Generally mirrors the
   *  packet's row but generators may rewrite for clarity. */
  displayLabel: string;
  /** Current value, when the edit modifies existing content. */
  currentText: string | null;
  /** New value, when the edit produces explicit text. */
  proposedText: string | null;
};

/**
 * One typed edit. Maps 1:1 to a `recommended_edits` row in the
 * database (the persistence layer in a future phase will translate
 * camelCase ↔ snake_case + flatten `targetElement` into the four
 * `target_element_key` / `display_label` / `current_text` /
 * `proposed_text` columns).
 *
 * NOT yet a database type — this stays the in-memory provider output.
 */
export type SpecificEdit = {
  actionType: ActionType;
  /** Owned page URL or the `needs_new_page` sentinel. Validation
   *  layer requires this to appear in the packet's
   *  `allowedTargetUrls`. */
  targetUrl: string;
  /** Null for page-level lifecycle actions; required object for
   *  element-targeted actions. */
  targetElement: SpecificEditTargetElement | null;
  why: string;
  /** Typed refs into the evidence packet that justify this edit. */
  evidence: SpecificEditEvidenceRef[];
  /** Operator-facing impact estimate. May stay null when the
   *  generator has no honest signal to report. */
  expectedImpact: string | null;
  difficulty: SpecificEditDifficulty;
  confidence: SpecificEditConfidence;
  /** How the operator (or a future job) will measure whether this
   *  edit moved the needle. Optional. */
  measurementPlan: string | null;
  risks: string[];
  source: SpecificEditSource;
  /** Provider name (matches the implementing provider's `name`).
   *  Redundant with `source` for `deterministic` / `openai` /
   *  `anthropic`; carries provider provenance for `operator_edited`
   *  rows so attribution can still trace the original generator. */
  providerName: string;
  /** Specific model id when LLM-sourced (e.g. `gpt-4o-mini-2024-07-18`,
   *  `claude-opus-4-7`). Null for deterministic + operator rows. */
  model: string | null;
  /** USD spent producing THIS edit. Null for deterministic +
   *  operator rows. */
  costUsd: number | null;
};

/**
 * The full output of one provider invocation. `recommendations` may be
 * `[]` (legitimate — a generator that has no honest output for this
 * packet), but `evidenceHash` MUST mirror the input packet's hash so
 * the cache key (Sprint 6A.2) survives provider swaps.
 */
export type SpecificEditBundle = {
  schemaVersion: "specific-edit-bundle/v1";
  generatedAt: string;
  tenantId: string;
  recId: string;
  /** Mirrors the input packet's evidenceHash. Cache key + audit. */
  evidenceHash: string;
  providerName: SpecificEditProviderName;
  /** May be []. Order is generator-determined and considered stable
   *  per provider — used for hash determinism in Sprint 6A.2's cache. */
  recommendations: SpecificEdit[];
  /** Total USD spent producing this bundle. 0 for deterministic +
   *  operator rows; sum of per-edit `costUsd` for LLM. */
  totalCostUsd: number;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Every provider implements this. Provider-agnostic by design — the
 * caller (Sprint 6A.2's evidence-hash cache + budget gate) doesn't
 * care which provider runs as long as the bundle conforms.
 *
 * `generate` is async because the LLM providers will hit the network.
 * The deterministic provider implements it as `async () => {...}`
 * regardless so the caller writes one code path.
 *
 * Implementations MUST NOT throw for "no recommendations" — return
 * an empty `recommendations` array instead. They MAY throw when:
 *   - the provider is not yet implemented (`openai` / `anthropic`
 *     in v1)
 *   - the packet is structurally invalid (missing tenantId / recId /
 *     evidenceHash)
 *   - the provider's network call fails AND the caller's budget /
 *     retry policy says "abort, don't degrade silently"
 *
 * Implementations MUST NOT mutate the input packet.
 */
export interface SpecificEditProvider {
  readonly name: SpecificEditProviderName;
  generate(packet: SpecificEditEvidencePacket): Promise<SpecificEditBundle>;
}

// ---------------------------------------------------------------------------
// Helpers — factored here so all provider implementations stay short and
// share the same packet → bundle scaffolding.
// ---------------------------------------------------------------------------

/**
 * Build a bundle skeleton from a packet + provider identity. Generators
 * call this and append to `recommendations` rather than re-deriving
 * tenantId / recId / evidenceHash themselves. Returns a fresh object —
 * safe to mutate.
 */
export function emptyBundleFor(
  packet: SpecificEditEvidencePacket,
  providerName: SpecificEditProviderName,
  now: Date = new Date(),
): SpecificEditBundle {
  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: now.toISOString(),
    tenantId: packet.tenantId,
    recId: packet.recId,
    evidenceHash: packet.evidenceHash,
    providerName,
    recommendations: [],
    totalCostUsd: 0,
  };
}

/**
 * Sprint 6A.1 Phase 10 (2026-04-24) — Output validation layer.
 *
 * Pure functions. No DB writes. No UI. No LLM. No mutation of the
 * input edit / packet. Validators return a discriminated result; bad
 * edits are REJECTED, never silently rewritten.
 *
 * Two entry points:
 *
 *   - `validateSpecificEdit(edit, packet)` — per-row validator. Used
 *     by deterministic generators (Phase 6A.1.9 output is implicitly
 *     valid but the validator is run on top for symmetry) and the
 *     LLM providers (Sprint 6A.2 — LLM output is the real customer of
 *     this layer).
 *
 *   - `validateSpecificEditBundle(bundle, packet)` — bundle-level
 *     validator. Checks bundle-level coherence (`tenantId` /
 *     `recId` / `evidenceHash` mirror the input packet) AND runs
 *     `validateSpecificEdit` per recommendation. Returns aggregate
 *     accepted/rejected counts; the persistence layer in a later
 *     phase will use the rejected list to populate
 *     `llm_rejections.raw_output` + `validation_error`.
 *
 * The validator does NOT call the providers. Callers do:
 *
 *   ```
 *   const bundle = await provider.generate(packet);
 *   const result = validateSpecificEditBundle(bundle, packet);
 *   const accepted = result.perEdit.filter(p => p.result.ok).map(p => p.edit);
 *   ```
 *
 * Hard rules locked by tests:
 *   - actionType must be valid + in `packet.allowedActionTypes`.
 *   - targetUrl must be in `packet.allowedTargetUrls`.
 *   - For non-page-level actions: targetElement.elementKey must
 *     EITHER exist in `packet.targetPageElements` (matched by url +
 *     key) OR be a valid `<elementType>[new]:<hash>` additive key.
 *   - For page-level lifecycle actions (elementTypeDomain == []):
 *     targetElement MUST be null.
 *   - requiresCurrentText / requiresProposedText match registry.
 *   - All evidence refs point to packet content.
 *   - difficulty / confidence are valid enum members.
 *   - source / providerName / model / costUsd cohere (deterministic
 *     can't carry a model + cost; LLM sources can).
 *   - Output is JSON-serializable (no functions, Date, Map, Set,
 *     class instances, undefined values).
 */

import {
  ELEMENT_TYPES,
  type ElementType,
} from "@/domains/pages/extractors/registry";
import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "./action-types";
import type { SpecificEditEvidencePacket } from "./specific-edit-evidence";
import type {
  SpecificEdit,
  SpecificEditBundle,
  SpecificEditEvidenceRef,
  SpecificEditProviderName,
  SpecificEditSource,
} from "./specific-edit-provider";
import { NEEDS_NEW_PAGE } from "./resolved-types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ValidationOk = { readonly ok: true };
export type ValidationFail = {
  readonly ok: false;
  /** Dot-path of the offending field on the edit (e.g.
   *  "targetElement.elementKey", "evidence[2].promptId"). */
  readonly field: string;
  readonly reason: string;
};
export type ValidationResult = ValidationOk | ValidationFail;

const OK: ValidationOk = { ok: true };
const fail = (field: string, reason: string): ValidationFail => ({
  ok: false,
  field,
  reason,
});

export type BundlePerEditResult = {
  readonly edit: SpecificEdit;
  readonly result: ValidationResult;
};

export type BundleValidationResult = {
  /** True only when bundle-level checks AND every per-edit result pass. */
  readonly ok: boolean;
  readonly bundleErrors: readonly ValidationFail[];
  readonly perEdit: readonly BundlePerEditResult[];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
};

// ---------------------------------------------------------------------------
// Element-key parsing helpers (pure — exported for tests + reuse)
// ---------------------------------------------------------------------------

/**
 * Parse the `ElementType` out of a stable element key. Returns `null`
 * when the key shape is unrecognized. Recognized shapes:
 *
 *   - `<type>[<index>]:<hash>` → positional / singleton
 *   - `<type>[new]:<hash>`     → additive
 *   - `schema[<TypeName>]`      → schema_type
 *   - `schema[<TypeName>]...:<hash>` → schema_property
 */
export function parseElementTypeFromKey(
  elementKey: string,
): ElementType | null {
  if (typeof elementKey !== "string" || elementKey.length === 0) return null;

  if (elementKey.startsWith("schema[")) {
    const closeIdx = elementKey.indexOf("]");
    if (closeIdx === -1) return null;
    // `schema[X]` exactly = schema_type; anything after the closing
    // bracket = schema_property.
    if (elementKey.length === closeIdx + 1) return "schema_type";
    return "schema_property";
  }

  const bracketIdx = elementKey.indexOf("[");
  if (bracketIdx <= 0) return null;
  const candidate = elementKey.slice(0, bracketIdx);
  return (ELEMENT_TYPES as readonly string[]).includes(candidate)
    ? (candidate as ElementType)
    : null;
}

/** True for `<type>[new]:<hash>` additive keys. */
export function isAdditiveElementKey(elementKey: string): boolean {
  return /\[new\]:/.test(elementKey);
}

// ---------------------------------------------------------------------------
// SpecificEdit validator
// ---------------------------------------------------------------------------

const DIFFICULTY_VALUES = ["low", "medium", "high"] as const;
const CONFIDENCE_VALUES = ["low", "medium", "high"] as const;
const SOURCE_VALUES: readonly SpecificEditSource[] = [
  "deterministic",
  "openai",
  "anthropic",
  "operator_edited",
];
const PROVIDER_NAMES: readonly SpecificEditProviderName[] = [
  "deterministic",
  "openai",
  "anthropic",
];

// ---------------------------------------------------------------------------
// Sprint 6A.2d (2026-04-26) — defense-in-depth length caps + LLM safety gates.
//
// The 6A.2b OpenAI provider schema already enforces these at the decoder
// level via JSON-schema `maxLength`, but the validator runs on EVERY
// edit (deterministic + LLM + operator_edited) and is the single
// authoritative semantic check. Duplicating the caps here ensures:
//   - operator_edited rows can't grow unbounded
//   - a future provider that doesn't enforce JSON-schema lengths
//     (e.g., a function-calling tool path) still gets rejected
//   - test fixtures + CLI smokes can't sneak oversized rows past
//     persistence
// ---------------------------------------------------------------------------

/** Operator scope from 6A.2 plan §4. */
const MAX_PROPOSED_TEXT_LENGTH = 2_000;
/** Captured page text — may be a long HTML excerpt; cap is generous
 *  but bounded to prevent JSON ledger bloat. */
const MAX_CURRENT_TEXT_LENGTH = 4_000;
const MAX_WHY_LENGTH = 500;
const MAX_EXPECTED_IMPACT_LENGTH = 200;
const MAX_MEASUREMENT_PLAN_LENGTH = 300;
const MAX_RISK_LENGTH = 200;
/** displayLabel is short snapshot text; the schema already caps; this
 *  enforces consistently across sources. */
const MAX_DISPLAY_LABEL_LENGTH = 200;

/**
 * Sprint 6A.2d (2026-04-26) — gate that allows `confidence="low"` to
 * pass validation for LLM-sourced edits. OFF by default. When unset,
 * `low` from openai/anthropic rejects with a "low confidence requires
 * env gate" reason; deterministic + operator_edited rows are NOT
 * affected (operator_edited rows already passed once before the
 * operator decided to act on them).
 */
function isLowConfidenceLLMGateOpen(): boolean {
  return process.env.BEACON_LLM_LOW_CONF === "1";
}

export function validateSpecificEdit(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  // ── 1. actionType valid + allowed ────────────────────────────────────
  if (!(ACTION_TYPES as readonly string[]).includes(edit.actionType)) {
    return fail("actionType", `unknown actionType: ${edit.actionType}`);
  }
  if (!packet.allowedActionTypes.includes(edit.actionType as ActionType)) {
    return fail(
      "actionType",
      `actionType "${edit.actionType}" not in packet.allowedActionTypes`,
    );
  }
  const spec = ACTION_TYPE_REGISTRY[edit.actionType as ActionType];

  // ── 2. targetUrl ────────────────────────────────────────────────────
  if (typeof edit.targetUrl !== "string" || edit.targetUrl.length === 0) {
    return fail("targetUrl", "targetUrl required (non-empty string)");
  }
  if (!packet.allowedTargetUrls.includes(edit.targetUrl)) {
    return fail(
      "targetUrl",
      `targetUrl "${edit.targetUrl}" not in packet.allowedTargetUrls`,
    );
  }

  // ── 3. targetElement presence (page-level vs element) ───────────────
  const isPageLevel = spec.elementTypeDomain.length === 0;
  if (isPageLevel) {
    if (edit.targetElement !== null) {
      return fail(
        "targetElement",
        `page-level actionType "${edit.actionType}" must have targetElement === null`,
      );
    }
    // Page-level: skip element-key + text checks; jump to evidence.
  } else {
    if (edit.targetElement === null) {
      return fail(
        "targetElement",
        `actionType "${edit.actionType}" requires a targetElement object`,
      );
    }
    const tel = edit.targetElement;

    // 3a. elementKey shape
    if (typeof tel.elementKey !== "string" || tel.elementKey.length === 0) {
      return fail(
        "targetElement.elementKey",
        "elementKey required (non-empty string)",
      );
    }
    const parsedType = parseElementTypeFromKey(tel.elementKey);
    if (!parsedType) {
      return fail(
        "targetElement.elementKey",
        `cannot parse element_type from key "${tel.elementKey}"`,
      );
    }

    // 3b. element_type must be in the action's domain
    if (!spec.elementTypeDomain.includes(parsedType)) {
      return fail(
        "targetElement.elementKey",
        `element_type "${parsedType}" not in elementTypeDomain for actionType "${edit.actionType}" (allowed: ${spec.elementTypeDomain.join(", ")})`,
      );
    }

    // 3c. additive vs inventory key consistency
    const isAdditive = isAdditiveElementKey(tel.elementKey);
    if (isAdditive && spec.requiresCurrentText) {
      return fail(
        "targetElement.elementKey",
        `actionType "${edit.actionType}" requires currentText — additive [new] key not allowed`,
      );
    }
    if (!isAdditive) {
      const inventoryHit = packet.targetPageElements.find(
        (el) =>
          el.url === edit.targetUrl && el.elementKey === tel.elementKey,
      );
      if (!inventoryHit) {
        return fail(
          "targetElement.elementKey",
          `elementKey "${tel.elementKey}" not in packet.targetPageElements for url "${edit.targetUrl}"`,
        );
      }
    }

    // 3d. displayLabel required + capped (Sprint 6A.2d)
    if (typeof tel.displayLabel !== "string" || tel.displayLabel.length === 0) {
      return fail("targetElement.displayLabel", "displayLabel required");
    }
    if (tel.displayLabel.length > MAX_DISPLAY_LABEL_LENGTH) {
      return fail(
        "targetElement.displayLabel",
        `displayLabel exceeds ${MAX_DISPLAY_LABEL_LENGTH} chars (got ${tel.displayLabel.length})`,
      );
    }

    // 3e. requiresCurrentText / requiresProposedText + length caps
    // (Sprint 6A.2d defense-in-depth).
    if (spec.requiresCurrentText) {
      if (typeof tel.currentText !== "string" || tel.currentText.length === 0) {
        return fail(
          "targetElement.currentText",
          `actionType "${edit.actionType}" requires currentText`,
        );
      }
    } else {
      // Additive actions: currentText must be null OR string. Don't
      // reject when null; reject when wrong type.
      if (
        tel.currentText !== null &&
        typeof tel.currentText !== "string"
      ) {
        return fail(
          "targetElement.currentText",
          "currentText must be string or null",
        );
      }
    }
    if (
      typeof tel.currentText === "string" &&
      tel.currentText.length > MAX_CURRENT_TEXT_LENGTH
    ) {
      return fail(
        "targetElement.currentText",
        `currentText exceeds ${MAX_CURRENT_TEXT_LENGTH} chars (got ${tel.currentText.length})`,
      );
    }
    if (spec.requiresProposedText) {
      if (
        typeof tel.proposedText !== "string" ||
        tel.proposedText.length === 0
      ) {
        return fail(
          "targetElement.proposedText",
          `actionType "${edit.actionType}" requires proposedText`,
        );
      }
    } else {
      if (
        tel.proposedText !== null &&
        typeof tel.proposedText !== "string"
      ) {
        return fail(
          "targetElement.proposedText",
          "proposedText must be string or null",
        );
      }
    }
    if (
      typeof tel.proposedText === "string" &&
      tel.proposedText.length > MAX_PROPOSED_TEXT_LENGTH
    ) {
      return fail(
        "targetElement.proposedText",
        `proposedText exceeds ${MAX_PROPOSED_TEXT_LENGTH} chars (got ${tel.proposedText.length})`,
      );
    }
  }

  // ── 4. why ──────────────────────────────────────────────────────────
  if (typeof edit.why !== "string" || edit.why.length === 0) {
    return fail("why", "why required (non-empty string)");
  }
  if (edit.why.length > MAX_WHY_LENGTH) {
    return fail(
      "why",
      `why exceeds ${MAX_WHY_LENGTH} chars (got ${edit.why.length})`,
    );
  }

  // ── 5. evidence refs ────────────────────────────────────────────────
  if (!Array.isArray(edit.evidence)) {
    return fail("evidence", "evidence must be an array");
  }
  for (let i = 0; i < edit.evidence.length; i++) {
    const refResult = validateEvidenceRef(edit.evidence[i], packet);
    if (!refResult.ok) {
      return fail(`evidence[${i}]`, refResult.reason);
    }
  }

  // ── 6. enums ────────────────────────────────────────────────────────
  if (!(DIFFICULTY_VALUES as readonly string[]).includes(edit.difficulty)) {
    return fail("difficulty", `invalid difficulty "${edit.difficulty}"`);
  }
  if (!(CONFIDENCE_VALUES as readonly string[]).includes(edit.confidence)) {
    return fail("confidence", `invalid confidence "${edit.confidence}"`);
  }

  // ── 6.5 LLM low-confidence gate (Sprint 6A.2d) ──────────────────────
  // Reject `confidence="low"` from openai/anthropic unless the operator
  // explicitly opens the env gate (`BEACON_LLM_LOW_CONF=1`). Deterministic
  // and operator_edited rows are NOT affected — deterministic generators
  // don't emit low-confidence by current design, and operator_edited
  // rows already passed once before the operator chose to act.
  if (
    edit.confidence === "low" &&
    (edit.source === "openai" || edit.source === "anthropic") &&
    !isLowConfidenceLLMGateOpen()
  ) {
    return fail(
      "confidence",
      `LLM-sourced edit with confidence="low" rejected by default. Set BEACON_LLM_LOW_CONF=1 to allow.`,
    );
  }

  // ── 7. risks ────────────────────────────────────────────────────────
  if (!Array.isArray(edit.risks)) {
    return fail("risks", "risks must be an array");
  }
  for (let i = 0; i < edit.risks.length; i++) {
    if (typeof edit.risks[i] !== "string") {
      return fail(`risks[${i}]`, "risks entries must be strings");
    }
    if (edit.risks[i].length > MAX_RISK_LENGTH) {
      return fail(
        `risks[${i}]`,
        `risk entry exceeds ${MAX_RISK_LENGTH} chars (got ${edit.risks[i].length})`,
      );
    }
  }

  // ── 8. expectedImpact / measurementPlan optionals + length caps ────
  if (
    edit.expectedImpact !== null &&
    typeof edit.expectedImpact !== "string"
  ) {
    return fail("expectedImpact", "expectedImpact must be string or null");
  }
  if (
    typeof edit.expectedImpact === "string" &&
    edit.expectedImpact.length > MAX_EXPECTED_IMPACT_LENGTH
  ) {
    return fail(
      "expectedImpact",
      `expectedImpact exceeds ${MAX_EXPECTED_IMPACT_LENGTH} chars (got ${edit.expectedImpact.length})`,
    );
  }
  if (
    edit.measurementPlan !== null &&
    typeof edit.measurementPlan !== "string"
  ) {
    return fail("measurementPlan", "measurementPlan must be string or null");
  }
  if (
    typeof edit.measurementPlan === "string" &&
    edit.measurementPlan.length > MAX_MEASUREMENT_PLAN_LENGTH
  ) {
    return fail(
      "measurementPlan",
      `measurementPlan exceeds ${MAX_MEASUREMENT_PLAN_LENGTH} chars (got ${edit.measurementPlan.length})`,
    );
  }

  // ── 9. source / providerName / model / costUsd coherence ──────────
  if (!(SOURCE_VALUES as readonly string[]).includes(edit.source)) {
    return fail("source", `invalid source "${edit.source}"`);
  }
  if (typeof edit.providerName !== "string" || edit.providerName.length === 0) {
    return fail("providerName", "providerName required");
  }

  if (edit.source === "deterministic") {
    if (edit.providerName !== "deterministic") {
      return fail(
        "providerName",
        `source=deterministic requires providerName="deterministic" (got "${edit.providerName}")`,
      );
    }
    if (edit.model !== null) {
      return fail("model", "model must be null for source=deterministic");
    }
    if (edit.costUsd !== null) {
      return fail("costUsd", "costUsd must be null for source=deterministic");
    }
  } else if (edit.source === "openai" || edit.source === "anthropic") {
    if (edit.providerName !== edit.source) {
      return fail(
        "providerName",
        `source=${edit.source} requires providerName="${edit.source}"`,
      );
    }
    if (edit.model !== null && typeof edit.model !== "string") {
      return fail("model", "model must be string or null");
    }
    if (
      edit.costUsd !== null &&
      (typeof edit.costUsd !== "number" || edit.costUsd < 0)
    ) {
      return fail("costUsd", "costUsd must be non-negative number or null");
    }
  } else if (edit.source === "operator_edited") {
    if (
      !(PROVIDER_NAMES as readonly string[]).includes(edit.providerName)
    ) {
      return fail(
        "providerName",
        `operator_edited rows must carry the originating provider name (got "${edit.providerName}")`,
      );
    }
    if (edit.model !== null && typeof edit.model !== "string") {
      return fail("model", "model must be string or null");
    }
    if (
      edit.costUsd !== null &&
      (typeof edit.costUsd !== "number" || edit.costUsd < 0)
    ) {
      return fail("costUsd", "costUsd must be non-negative number or null");
    }
  }

  // ── 10. JSON-serializability ───────────────────────────────────────
  const ser = validateSerializable(edit, "$");
  if (!ser.ok) return ser;

  return OK;
}

// ---------------------------------------------------------------------------
// Evidence ref validator
// ---------------------------------------------------------------------------

function validateEvidenceRef(
  ref: SpecificEditEvidenceRef,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  if (ref === null || typeof ref !== "object") {
    return fail("$", "evidence ref must be a non-null object");
  }
  switch (ref.type) {
    case "prompt": {
      if (typeof ref.promptId !== "string" || !ref.promptId) {
        return fail("$", "prompt ref missing promptId");
      }
      const found = packet.affectedPrompts.some(
        (p) => p.promptId === ref.promptId,
      );
      if (!found) {
        return fail("$", `prompt ref unknown promptId "${ref.promptId}"`);
      }
      return OK;
    }
    case "element": {
      if (typeof ref.elementKey !== "string" || !ref.elementKey) {
        return fail("$", "element ref missing elementKey");
      }
      if (typeof ref.url !== "string" || !ref.url) {
        return fail("$", "element ref missing url");
      }
      const found = packet.targetPageElements.some(
        (e) => e.elementKey === ref.elementKey && e.url === ref.url,
      );
      if (!found) {
        return fail(
          "$",
          `element ref (${ref.elementKey}@${ref.url}) not in packet.targetPageElements`,
        );
      }
      return OK;
    }
    case "owned_page": {
      if (typeof ref.url !== "string" || !ref.url) {
        return fail("$", "owned_page ref missing url");
      }
      // owned_page must be one of the candidate URLs (the
      // `needs_new_page` sentinel is a target option but not a real
      // page — it's not allowed as an evidence ref).
      const candidateUrls = new Set(
        packet.ownedPageCandidates.map((c) => c.url),
      );
      if (!candidateUrls.has(ref.url)) {
        return fail(
          "$",
          `owned_page ref url "${ref.url}" not in packet.ownedPageCandidates`,
        );
      }
      if (ref.url === NEEDS_NEW_PAGE) {
        return fail(
          "$",
          "owned_page ref cannot be the needs_new_page sentinel",
        );
      }
      return OK;
    }
    case "competitor": {
      if (typeof ref.competitorName !== "string" || !ref.competitorName) {
        return fail("$", "competitor ref missing competitorName");
      }
      const found = packet.competitorAngles.some(
        (c) => c.competitorName === ref.competitorName,
      );
      if (!found) {
        return fail(
          "$",
          `competitor ref unknown name "${ref.competitorName}"`,
        );
      }
      return OK;
    }
    case "prior_outcome": {
      if (typeof ref.actionType !== "string" || !ref.actionType) {
        return fail("$", "prior_outcome ref missing actionType");
      }
      const found = packet.priorOutcomes.some(
        (p) => p.actionType === ref.actionType,
      );
      if (!found) {
        return fail(
          "$",
          `prior_outcome ref unknown actionType "${ref.actionType}"`,
        );
      }
      return OK;
    }
    default: {
      const unknown: { type?: string } = ref as { type?: string };
      return fail("$", `unknown evidence ref type "${unknown.type}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Serializability walker
// ---------------------------------------------------------------------------

/** Recursive walk asserting JSON-only output: no functions, undefined,
 *  symbols, bigints, Date / Map / Set / class instances. */
export function validateSerializable(
  value: unknown,
  path = "$",
): ValidationResult {
  if (value === null) return OK;
  if (value === undefined) {
    return fail(path, "undefined value not JSON-serializable");
  }
  const t = typeof value;
  if (t === "function") return fail(path, "function not JSON-serializable");
  if (t === "string" || t === "number" || t === "boolean") return OK;
  if (t === "symbol" || t === "bigint") {
    return fail(path, `${t} not JSON-serializable`);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = validateSerializable(value[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return OK;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const ctor =
        (value as { constructor?: { name?: string } }).constructor?.name ??
        "unknown";
      return fail(path, `non-plain-object (${ctor}) not JSON-serializable`);
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = validateSerializable(v, `${path}.${k}`);
      if (!r.ok) return r;
    }
    return OK;
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Bundle validator
// ---------------------------------------------------------------------------

export function validateSpecificEditBundle(
  bundle: SpecificEditBundle,
  packet: SpecificEditEvidencePacket,
): BundleValidationResult {
  const bundleErrors: ValidationFail[] = [];

  if (bundle.tenantId !== packet.tenantId) {
    bundleErrors.push(
      fail(
        "tenantId",
        `bundle.tenantId "${bundle.tenantId}" !== packet.tenantId "${packet.tenantId}"`,
      ),
    );
  }
  if (bundle.recId !== packet.recId) {
    bundleErrors.push(
      fail(
        "recId",
        `bundle.recId "${bundle.recId}" !== packet.recId "${packet.recId}"`,
      ),
    );
  }
  if (bundle.evidenceHash !== packet.evidenceHash) {
    bundleErrors.push(
      fail(
        "evidenceHash",
        `bundle.evidenceHash "${bundle.evidenceHash}" !== packet.evidenceHash "${packet.evidenceHash}"`,
      ),
    );
  }
  if (typeof bundle.totalCostUsd !== "number" || bundle.totalCostUsd < 0) {
    bundleErrors.push(
      fail("totalCostUsd", "totalCostUsd must be non-negative number"),
    );
  }

  const perEdit: BundlePerEditResult[] = bundle.recommendations.map(
    (edit) => ({
      edit,
      result: validateSpecificEdit(edit, packet),
    }),
  );

  const acceptedCount = perEdit.filter((p) => p.result.ok).length;
  const rejectedCount = perEdit.length - acceptedCount;

  return {
    ok: bundleErrors.length === 0 && rejectedCount === 0,
    bundleErrors,
    perEdit,
    acceptedCount,
    rejectedCount,
  };
}

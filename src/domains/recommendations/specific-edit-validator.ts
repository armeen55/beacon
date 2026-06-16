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
import {
  findEmDashes,
  findIncompleteBrandMentions,
  findUnsupportedBrandClaims,
  getBrandAssertions,
  getBrandNameStyle,
} from "./brand-assertions";
import type {
  SpecificEdit,
  SpecificEditBundle,
  SpecificEditEvidenceRef,
  SpecificEditProviderName,
  SpecificEditSource,
} from "./specific-edit-provider";
import { NEEDS_NEW_PAGE } from "./resolved-types";
import {
  detectPlaceholder,
  evaluateFaqAnswer,
  parseFaqProposedText,
} from "./placeholder-detection";
import { containsUuid } from "./copy-sanitize";

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

// ---------------------------------------------------------------------------
// T4.1 (2026-05-06) — Abstention contract validator.
//
// Trust Sprint Phase 2.A audit found that Rule 16.A (the LLM's "abstain
// when evidence is structurally too thin" instruction) was enforced ONLY
// in the SYSTEM_PROMPT. If a model ignored the rule, the bundle persisted.
// This validator function adds defense-in-depth: regardless of what the
// provider returned, an edit MUST fail validation when the underlying
// packet matches one of the four abstention triggers below.
//
// Triggers (operator-locked at T4.1 launch):
//
//   A. resolution.confidence === "low" AND brandAssertions empty
//      → reason: abstention_contract_low_confidence_no_brand_assertions
//      The packet's resolver judged the targeting low-confidence and
//      there's no operator-curated assertion to anchor public copy.
//
//   B. competitorPageBlueprints empty AND aiSearchSignal.topSearchQueries
//      empty AND brandAssertions empty
//      → reason: abstention_contract_no_grounding_signals
//      The model has nothing to ground new copy against — no AI search
//      queries, no competitor pages to differentiate against, no operator
//      assertions to riff on. Edits would be pure invention.
//
//   C. Single-prompt evidence with no owned page candidates AND no
//      competitor angles AND no brand assertions AND no AI search queries
//      → reason: abstention_contract_single_prompt_thin_evidence
//      The Trust Sprint sample-20 audit found row #5 (Atherton FAQ
//      answer) hit exactly this shape: one prompt, no owned page, no
//      competitor, no brand assertions. Treated as ABSTAIN_THIN_EVIDENCE
//      by the auditor; this rule formalizes the contract.
//
//   D. Thin FAQ ANSWER (faq_answer element) on a single-prompt packet
//      with no owned page AND no brand assertion AND no AI search query
//      AND no multi-prompt evidence
//      → reason: abstention_contract_thin_faq_answer
//      Customer-facing answers carry brand voice and structural risk
//      (rec #1 in the sample-20: "Ritz Builders recommends hiring an
//      architect-led design-build firm" — self-promotional from a
//      thin packet). FAQ QUESTIONS (faq_question element) survive this
//      gate so the operator can still ship a paired Q+A when other
//      grounding (owned page) is present on the question side.
//
// Helpers below isolate each rule so the audit script can re-run them
// independently and report which trigger fired without re-implementing
// the validator path.
// ---------------------------------------------------------------------------

export type AbstentionRejectReason =
  | "abstention_contract_low_confidence_no_brand_assertions"
  | "abstention_contract_no_grounding_signals"
  | "abstention_contract_single_prompt_thin_evidence"
  | "abstention_contract_thin_faq_answer";

/**
 * Returns `null` when the packet+edit combination passes the abstention
 * contract; otherwise returns the SPECIFIC reason the bundle would have
 * abstained per Rule 16.A.
 *
 * Pure: zero I/O. Same input → same output. Safe for the audit script
 * to call against historical packets without persisting anything.
 *
 * Caller convention: passing `edit=null` runs only the packet-level
 * triggers (A, B, C). Trigger D needs the edit's actionType +
 * targetElement.elementKey to know whether the edit is a faq_answer
 * row. The audit script may call with null when packet-only checks
 * are sufficient.
 */
export function checkAbstentionContract(
  packet: SpecificEditEvidencePacket,
  edit: SpecificEdit | null,
): AbstentionRejectReason | null {
  // ── Rule A — resolution.confidence === "low" + no brand assertions ──
  // resolution may be undefined/null on packets that didn't go through
  // the page-intent resolver; only fire when the field is explicitly
  // present + low.
  if (
    packet.resolution != null &&
    packet.resolution.confidence === "low" &&
    packet.brandAssertions.length === 0
  ) {
    return "abstention_contract_low_confidence_no_brand_assertions";
  }

  // ── Rule B — no grounding signals at all ──
  if (
    packet.competitorPageBlueprints.length === 0 &&
    packet.aiSearchSignal.topSearchQueries.length === 0 &&
    packet.brandAssertions.length === 0
  ) {
    return "abstention_contract_no_grounding_signals";
  }

  // ── Rule C — single-prompt thin evidence (no other grounding) ──
  if (
    packet.affectedPrompts.length === 1 &&
    packet.ownedPageCandidates.length === 0 &&
    packet.competitorAngles.length === 0 &&
    packet.brandAssertions.length === 0 &&
    packet.aiSearchSignal.topSearchQueries.length === 0
  ) {
    return "abstention_contract_single_prompt_thin_evidence";
  }

  // ── Rule D — thin FAQ ANSWER (only when edit is provided) ──
  if (edit != null && isFaqAnswerEdit(edit)) {
    const hasOwnedPage = packet.ownedPageCandidates.length > 0;
    const hasBrandAssertion = packet.brandAssertions.length > 0;
    const hasSearchQuery = packet.aiSearchSignal.topSearchQueries.length > 0;
    const hasMultiPrompt = packet.affectedPrompts.length >= 2;
    const hasAnyStrongerGrounding =
      hasOwnedPage || hasBrandAssertion || hasSearchQuery || hasMultiPrompt;
    if (!hasAnyStrongerGrounding) {
      return "abstention_contract_thin_faq_answer";
    }
  }

  return null;
}

/**
 * True when an edit targets the `faq_answer` element type. The element
 * key has shape `faq_answer[<idx>]:<hash>` (positional) or
 * `faq_answer[new]:<hash>` (additive). actionType is `add_faq` for
 * either question or answer rows; the discriminator is the element key.
 */
function isFaqAnswerEdit(edit: SpecificEdit): boolean {
  const tel = edit.targetElement;
  if (tel == null) return false;
  const parsed = parseElementTypeFromKey(tel.elementKey);
  return parsed === "faq_answer";
}

/**
 * Validator gate: returns ValidationResult so it can compose into the
 * existing per-edit pipeline. Wraps `checkAbstentionContract` and emits
 * a typed ValidationFail with the precise rejection reason.
 */
export function validateAbstentionContract(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  const reason = checkAbstentionContract(packet, edit);
  if (reason == null) return OK;
  return fail("packet", reason);
}

export function validateSpecificEdit(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  // ── 0. T4.1 — Abstention contract (Trust Sprint, 2026-05-06).
  // Runs FIRST so a structurally thin packet rejects before we waste
  // CPU on actionType / element-key / copy gates. Reasons are:
  //   abstention_contract_low_confidence_no_brand_assertions
  //   abstention_contract_no_grounding_signals
  //   abstention_contract_single_prompt_thin_evidence
  //   abstention_contract_thin_faq_answer
  // Locked by `tests/architecture/abstention-contract-trust.test.ts`.
  const abstentionGate = validateAbstentionContract(edit, packet);
  if (!abstentionGate.ok) return abstentionGate;

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

  // ── 9.5 FAQ intent rewriting (Sprint 6A.2g.C) ──────────────────────
  // For add_faq / rewrite_faq with a faq_question targetElement, reject
  // proposedText that (a) doesn't end in "?" or (b) lifts the synthetic
  // affected-prompt text verbatim. The model is instructed via Rule 13
  // to rewrite into customer-voice phrasing; this layer catches it
  // when the model ignores the rule.
  //
  // Other action types are unaffected. faq_answer elements are
  // unaffected (answers don't end in "?"). The env opt-out
  // BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 disables ONLY the verbatim-stem
  // check — the "?" requirement always runs.
  //
  // W3 §3.8 — run the row-shape gate FIRST so a bundled Q+A row
  // gets the operator-actionable "contains an answer body" error
  // instead of the generic "must end with ?" reason.
  const faqShapePreCheck = validateFaqRowShape(edit);
  if (!faqShapePreCheck.ok) return faqShapePreCheck;
  const faqGate = validateFaqIntentRewriting(edit, packet);
  if (!faqGate.ok) return faqGate;

  // ── 9.55 Placeholder + FAQ structural quality (W3 Step 3.1) ────────
  // Reject:
  //   - any proposedText / displayLabel matching a placeholder phrase
  //     (Draft answer / TBD / operator: rewrite / [insert / placeholder
  //     / TODO: / rewrite below). The deterministic generators no
  //     longer emit these, but the LLM provider in 3.4 might; this
  //     layer is the catch-all.
  //   - add_faq edits whose Q+A body is structurally useless
  //     (under MIN_FAQ_ANSWER_WORDS, mostly repeats the question, or
  //     has no specific content beyond generic filler).
  //
  // Locked by tests in
  // src/domains/recommendations/placeholder-detection.test.ts and
  // specific-edit-validator-llm-hardening.test.ts (extended at this
  // step). NEVER bypass with an env flag — placeholder copy in the
  // queue erodes operator trust faster than any false positive.
  const placeholderGate = validateNoPlaceholder(edit);
  if (!placeholderGate.ok) return placeholderGate;

  // ── 9.5b LLM-DryRun-2 (operator audit, 2026-05-05): no raw prompt
  // UUIDs in operator-visible `why`. The render-time sanitizer
  // (`sanitizeOperatorEvidenceText`) scrubs UUIDs at draw-time, but
  // the persisted `recommended_edits.why` column would still carry
  // raw `b741f295-...` strings if the LLM emitted them. After
  // LLM-DryRun-1 found 7 such leaks across 2 of 5 samples, the
  // SYSTEM_PROMPT was tightened (good/bad examples + structural rule
  // "evidence[].promptId must use the full UUID; why must reference
  // prompt text snippets, not IDs"). This validator gate enforces the
  // same contract at validation time: a future SYSTEM_PROMPT regression
  // (or a different LLM provider) will fail the bundle rather than
  // persist UUID-bearing rows.
  //
  // `expectedImpact` and `measurementPlan` are also operator-visible
  // copy fields and get the same treatment.
  //
  // `evidence: [{type:"prompt", promptId: <UUID>}]` is the canonical
  // place for raw IDs and is intentionally NOT scanned here.
  const uuidGate = validateNoUuidInOperatorCopy(edit);
  if (!uuidGate.ok) return uuidGate;

  // ── 9.6 Competitor public-copy safety (Sprint 6A.2g.B) ─────────────
  // Reject competitor names from packet.competitorAngles[*] that leak
  // into visitor-readable copy: proposedText + targetElement.displayLabel.
  // Aliases include the full name + safe suffix-stripped variants drawn
  // from a CLOSED set (Construction, Builders, Builder, Inc, LLC, Co,
  // Company, Group). No token-level scans, no fuzzy matching. The
  // env opt-out BEACON_ALLOW_COMPETITOR_COPY=1 skips the rule entirely
  // — operator escape hatch when a coincidental alias collision bites.
  // Competitor names in why / evidence / measurementPlan are operator-
  // facing context and remain explicitly allowed.
  const competitorGate = validateCompetitorPublicCopy(edit, packet);
  if (!competitorGate.ok) return competitorGate;

  // ── 9.7 Brand-claim grounding (W3 Step 3.7) ────────────────────────
  // Reject public copy that asserts third-party recognition (frequently
  // recommended, most trusted, top-rated, leading, award-winning, etc.)
  // when the tenant's `brandAssertions` doesn't authorize the category.
  // Operator-locked at W3 §3.7 launch — the LLM has no source for these
  // claims, and the W3 §3.6 sample-quality report flagged unsupported
  // social-proof claims as the dominant minor-edit defect.
  //
  // Scans `proposedText` + `displayLabel` ONLY. `why` /
  // `expectedImpact` / `measurementPlan` / `risks` are operator-facing
  // and may freely reference any context. `currentText` reflects the
  // live site (Beacon isn't validating what's already there).
  //
  // Locked by `specific-edit-validator-brand-claims.test.ts`. Env
  // opt-out: `BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1` skips the rule
  // so the operator can ship a copy revision they manually approved.
  if (process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS !== "1") {
    const brandGate = validateBrandClaimGrounding(edit, packet);
    if (!brandGate.ok) return brandGate;
  }

  // ── 9.8 Public-copy style (W3 Step 3.7s) ───────────────────────────
  // Operator-locked style rules layered on top of brand-claim
  // grounding:
  //   - No em dashes (— or free-standing –) in body / heading copy.
  //     Periods, commas, colons, parentheses replace them.
  //   - First mention of the brand uses the FULL entity name
  //     ("Ritz Builders"), not the short form alone ("Ritz"). After
  //     first mention, the model may transition to first-person
  //     plural ("our team" / "we") for natural website tone, but
  //     bare "Ritz" is never allowed.
  // Operator opt-out:
  //   - BEACON_ALLOW_EM_DASH=1 — em dash gate stays armed by default.
  //   - BEACON_ALLOW_SHORT_BRAND_NAME=1 — brand-name-first gate stays
  //     armed by default.
  //
  // Locked by `specific-edit-validator-brand-claims.test.ts`.
  if (process.env.BEACON_ALLOW_EM_DASH !== "1") {
    const dashGate = validateNoEmDashes(edit);
    if (!dashGate.ok) return dashGate;
  }

  // ── 9.85 Public-copy leading-superlative ban (W3 Step 3.12) ────────
  // Operator-locked guardrail (2026-05-03): generated public copy
  // (proposedText + displayLabel) MUST NOT start with a self-claim
  // superlative like "Best …", "Top …", "Leading …", "Premier …",
  // "#1 …" — even when the AI fanout query the rec was grounded in
  // contains "best …".  Raw fanout keywords carry comparison intent;
  // public Ritz copy must transform that into a buyer-decision angle
  // ("How to choose …" / "What to look for …") rather than parrot a
  // self-award framing.
  //
  // Why a NEW rule on top of `validateBrandClaimGrounding`: the
  // brand-claim grounder catches subject-of-sentence superlatives
  // ("the best luxury home builders") via the `best_in_market`
  // pattern, but the W3 §3.10 paid run produced an H2 starting with
  // bare "Best luxury custom home builders in the Bay Area" — no
  // definite article, no "is/are" verb — that slipped through. The
  // §3.11 fanout audit caught it; this gate locks the catch.
  //
  // Operator opt-out: BEACON_ALLOW_LEADING_SUPERLATIVE=1.
  if (process.env.BEACON_ALLOW_LEADING_SUPERLATIVE !== "1") {
    const leadGate = validateNoLeadingSuperlativePublicCopy(edit);
    if (!leadGate.ok) return leadGate;
  }

  if (process.env.BEACON_ALLOW_SHORT_BRAND_NAME !== "1") {
    const nameGate = validateBrandNameFirstMention(edit, packet);
    if (!nameGate.ok) return nameGate;
  }

  // ── 10. JSON-serializability ───────────────────────────────────────
  const ser = validateSerializable(edit, "$");
  if (!ser.ok) return ser;

  return OK;
}

/**
 * W3 Step 3.7 (2026-05-03) — public-copy brand-claim grounding.
 *
 * Scans `targetElement.proposedText` + `targetElement.displayLabel`
 * for forbidden-claim patterns. Each pattern declares an
 * `unlockedBy` category; if the packet's `brandAssertions` carries
 * an assertion of that category, the pattern is unlocked. Patterns
 * with `unlockedBy: null` (guarantee_outcome) stay permanently
 * locked regardless of operator assertions.
 *
 * Operator-facing fields (`why`, `expectedImpact`, `measurementPlan`,
 * `risks`) are NOT scanned — they live on the operator side of the
 * page and may freely reference brand context, evidence, and rec
 * reasoning. `currentText` reflects what's already on the live site
 * and is similarly skipped.
 *
 * Pure / deterministic. Returns the FIRST match (validator
 * convention) so the failure reason names a single, actionable
 * pattern.
 */
function validateBrandClaimGrounding(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  const tel = edit.targetElement;
  if (!tel) return OK;
  const fields: Array<{ value: string | null | undefined; path: string }> = [
    {
      value: tel.proposedText,
      path: "targetElement.proposedText",
    },
    {
      value: tel.displayLabel,
      path: "targetElement.displayLabel",
    },
  ];
  for (const f of fields) {
    if (typeof f.value !== "string" || f.value.length === 0) continue;
    const matches = findUnsupportedBrandClaims(f.value, packet.brandAssertions);
    if (matches.length === 0) continue;
    const first = matches[0];
    return fail(
      f.path,
      `unsupported brand claim '${first.matchedText}' (pattern: ${first.patternId}) — ${first.description}`,
    );
  }
  return OK;
}

/**
 * W3 Step 3.7s (2026-05-03) — public-copy em dash ban.
 *
 * Operator-locked style: generated public copy MUST NOT contain em
 * dashes (`—`) or free-standing en dashes (`–` not bracketed by
 * digits). Rationale: em-dash-heavy prose reads cheap on a builder's
 * website and is the visible LLM tell. Periods, commas, colons,
 * parentheses replace it.
 *
 * Scans `targetElement.proposedText` + `targetElement.displayLabel`
 * only. Operator-facing fields (`why` / `risks` etc.) may use
 * em dashes freely.
 *
 * Pure / deterministic. Returns the first match (validator
 * convention).
 */
function validateNoEmDashes(edit: SpecificEdit): ValidationResult {
  const tel = edit.targetElement;
  if (!tel) return OK;
  const fields: Array<{ value: string | null | undefined; path: string }> = [
    { value: tel.proposedText, path: "targetElement.proposedText" },
    { value: tel.displayLabel, path: "targetElement.displayLabel" },
  ];
  for (const f of fields) {
    if (typeof f.value !== "string" || f.value.length === 0) continue;
    const matches = findEmDashes(f.value);
    if (matches.length === 0) continue;
    const first = matches[0];
    return fail(
      f.path,
      `em dash banned in public copy ('${first.char}' near "${first.contextText}") — replace with period / comma / colon / parentheses`,
    );
  }
  return OK;
}

/**
 * W3 Step 3.12 (2026-05-03) — public-copy leading-superlative ban.
 *
 * Reject any generated public copy whose `proposedText` or
 * `displayLabel` STARTS with a self-claim superlative — "Best ...",
 * "Top ...", "Leading ...", "Premier ...", "#1 ...", "Top-rated ...",
 * "Highest-rated ...", "Most-trusted ..." — regardless of whether the
 * trailing words match a brand-claim pattern.
 *
 * Locked by §3.11 query-fanout audit: raw fanout queries MAY contain
 * "best" (real comparison-stage buyer demand), but public Ritz copy
 * must transform that into a buyer-decision angle. The §3.10 paid run
 * emitted `H2: "Best luxury custom home builders in the Bay Area"` —
 * the brand-claim grounder's `best_in_market` regex (subject of
 * sentence pattern) didn't catch it because there was no article or
 * verb. This gate fires on the leading-token shape.
 *
 * Pure / deterministic. Returns the first match (validator
 * convention) so the failure reason names a single, actionable
 * pattern.
 */
function validateNoLeadingSuperlativePublicCopy(
  edit: SpecificEdit,
): ValidationResult {
  const tel = edit.targetElement;
  if (!tel) return OK;
  const fields: Array<{ value: string | null | undefined; path: string }> = [
    { value: tel.proposedText, path: "targetElement.proposedText" },
    { value: tel.displayLabel, path: "targetElement.displayLabel" },
  ];
  for (const f of fields) {
    if (typeof f.value !== "string" || f.value.length === 0) continue;
    const hit = findLeadingSuperlative(f.value);
    if (!hit) continue;
    return fail(
      f.path,
      `public copy may not start with self-claim superlative '${hit.matched}' — even when the AI fanout query contains '${hit.matched.toLowerCase()}', generated H2 / heading / FAQ copy must transform comparison-stage demand into a buyer-decision angle (e.g., "How to choose …", "What to look for in …", "Questions to ask …")`,
    );
  }
  return OK;
}

/**
 * Inspect the FIRST non-whitespace word of a public-copy string. If
 * it matches a banned self-claim superlative, return `{ matched }`;
 * otherwise return null. Case-insensitive on the leading match (so
 * "Best", "BEST", "best" all fire); the matched text preserves the
 * original case for the error message.
 *
 * "Top-rated" / "Highest-rated" / "Most-trusted" treated as single
 * tokens (hyphenated). "#1" matches the literal start-of-string
 * pattern.
 */
function findLeadingSuperlative(
  text: string,
): { matched: string } | null {
  // Strip leading whitespace + leading newlines so we look at the
  // actual first word (multi-line bodies often start with the heading
  // line followed by blank lines + the body paragraph; we want the
  // very first visible token).
  const trimmed = text.replace(/^\s+/, "");
  if (trimmed.length === 0) return null;
  // Pattern: one banned superlative as a leading token, followed by a
  // word boundary (whitespace, end-of-string, or punctuation).  The
  // alternation is sorted longest-first so "Top-rated" wins over
  // "Top".
  const re =
    /^(Highest-rated|Most-trusted|Top-rated|Top\b|Best\b|Leading\b|Premier\b|#1\b)/i;
  const m = trimmed.match(re);
  if (!m) return null;
  return { matched: m[0] };
}

/**
 * W3 Step 3.7s (2026-05-03) — brand-name first-mention rule.
 *
 * Operator-locked style: every standalone generated section must use
 * the FULL entity name ("Ritz Builders") for any brand mention. The
 * short form ("Ritz") alone is never allowed unless explicitly
 * authorized by the tenant config. After the first mention the model
 * may transition to first-person plural ("our team", "we") — that's
 * natural website tone — but bare "Ritz" remains banned.
 *
 * Scans `targetElement.proposedText` + `targetElement.displayLabel`.
 * Operator-facing fields skipped. Tracked-prompt text in the packet
 * (e.g., "best builders in Ritz" coming from a user prompt) NEVER
 * trips this rule because the validator only sees the LLM's edit
 * fields.
 */
function validateBrandNameFirstMention(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  const style = getBrandNameStyle(packet.tenantId);
  if (style === null) return OK;
  const tel = edit.targetElement;
  if (!tel) return OK;
  const fields: Array<{ value: string | null | undefined; path: string }> = [
    { value: tel.proposedText, path: "targetElement.proposedText" },
    { value: tel.displayLabel, path: "targetElement.displayLabel" },
  ];
  for (const f of fields) {
    if (typeof f.value !== "string" || f.value.length === 0) continue;
    const matches = findIncompleteBrandMentions(f.value, style);
    if (matches.length === 0) continue;
    const first = matches[0];
    return fail(
      f.path,
      `brand short form '${first.shortForm}' alone is not allowed in public copy (use the full entity name '${first.fullName}', or first-person plural like 'our team' / 'we' after the first full mention) — context: "${first.contextText}"`,
    );
  }
  return OK;
}

/**
 * W3 Step 3.8 (2026-05-03) — per-edit FAQ shape integrity.
 *
 * Operator-locked: FAQ edits must ship as PAIRED rows (one
 * `faq_question[new]:<hash>` + one `faq_answer[new]:<hash>` with the
 * same hash suffix). The Step 3.7 paid run revealed the model
 * bundling Q+A into a single faq_question row's proposedText — that
 * row reads `Who … in Palo Alto?\nRitz Builders offers …`. Step 3.8
 * rejects bundled rows here; `validateSpecificEditBundle` enforces
 * the cross-row pairing.
 *
 * Question rows (`faq_question[new]:<hash>`):
 *   - proposedText ≤ 200 chars (already enforced upstream).
 *   - proposedText must end with "?" (already enforced by
 *     validateFaqIntentRewriting).
 *   - proposedText must NOT contain an embedded answer body —
 *     reject any line break followed by ≥ 6 alphanumeric chars
 *     of body text (the operator-caught failure mode).
 *
 * Answer rows (`faq_answer[new]:<hash>`):
 *   - Word count ≥ 30 (operator preferred 40-120; 30 is the hard
 *     floor — answers below 30 words rarely satisfy the question).
 *   - proposedText must NOT be a bare question (ending with "?"
 *     and ≤ 200 chars with no body content).
 *
 * Returns OK for non-FAQ action types. The "Q:"-prefixed
 * deterministic shape (Q: …\n\nA: …) is intentionally NOT scanned
 * here — `validateNoPlaceholder` already handles it via
 * `parseFaqProposedText`.
 *
 * Pure / deterministic. No env opt-out — operator scope is "FAQ
 * pairing is non-negotiable."
 */
function validateFaqRowShape(edit: SpecificEdit): ValidationResult {
  if (edit.actionType !== "add_faq" && edit.actionType !== "rewrite_faq") {
    return OK;
  }
  const tel = edit.targetElement;
  if (!tel) return OK;
  const proposed =
    typeof tel.proposedText === "string" ? tel.proposedText.trim() : "";
  if (proposed.length === 0) return OK;
  const elementType = parseElementTypeFromKey(tel.elementKey);

  if (elementType === "faq_question") {
    // Reject explicit `Q: …\n\nA: …` bundling on faq_question rows
    // (operator-locked: question rows must be question-only text).
    if (/^Q\s*:\s*[\s\S]*?\n\s*A\s*:/.test(proposed)) {
      return fail(
        "targetElement.proposedText",
        "FAQ question row uses Q: / A: bundled format — emit the question and answer as TWO separate edits with shared hash suffix (faq_question[new]:<hash> + faq_answer[new]:<hash>).",
      );
    }
    // Reject any newline in a question row. Legitimate questions are
    // a single grammatical sentence ending in "?". A newline almost
    // always signals an answer body bundled into the question's
    // proposedText (the operator-caught Step 3.7 failure mode).
    if (/\n/.test(proposed)) {
      return fail(
        "targetElement.proposedText",
        "FAQ question row contains an answer body (newline detected) — emit the question and answer as TWO separate edits with shared hash suffix (faq_question[new]:<hash> + faq_answer[new]:<hash>).",
      );
    }
    return OK;
  }

  if (elementType === "faq_answer") {
    // Reject bare-question answers (operator-locked: the answer row
    // must contain answer copy, not the question copy).
    const looksLikeQuestion =
      proposed.endsWith("?") && proposed.length <= 200;
    if (looksLikeQuestion) {
      return fail(
        "targetElement.proposedText",
        "FAQ answer row contains question text instead of an answer — the answer row must hold the answer body (40-120 words preferred).",
      );
    }
    // Reject bare-stub answers (< 30 words). Operator preference is
    // 40-120; 30 is the hard floor.
    const wordCount = proposed.split(/\s+/).filter(Boolean).length;
    if (wordCount < 30) {
      return fail(
        "targetElement.proposedText",
        `FAQ answer row is too short (${wordCount} words) — operator preference is 40-120 words. Generator should abstain or expand the answer with packet evidence.`,
      );
    }
    return OK;
  }

  // Other element types (e.g., faq[new] without question/answer
  // suffix) skip this gate.
  return OK;
}

// ---------------------------------------------------------------------------
// Sprint 6A.2g.C — FAQ intent rewriting helper
// ---------------------------------------------------------------------------

/**
 * Sprint 6A.2g.C (2026-04-26) — gate that allows FAQ-question
 * proposedText to start with the synthetic affected-prompt stem. OFF
 * by default. When the operator hits a false positive (e.g., the
 * affected prompt is already a real customer question and the model
 * legitimately mirrors it), set BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 to
 * accept those rows. The "?" ending check always runs regardless.
 */
function isSyntheticFaqCopyAllowed(): boolean {
  return process.env.BEACON_ALLOW_SYNTHETIC_FAQ_COPY === "1";
}

/**
 * Sprint 6A.2g.C — first-50-char prefix used to detect "verbatim copy"
 * of a synthetic prompt into FAQ proposedText. The choice of 50 chars
 * + lowercase + punctuation-stripped + collapsed-whitespace is a
 * deliberate compromise: long enough to catch real-world prompt-stem
 * lifts, short enough to tolerate paraphrases that prepend a question
 * word ("Who are the …", "How much does …"). Operator opts out via
 * BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 when a coincidental prefix
 * collision bites (rare in practice — the synthetic prompts in this
 * tenant don't read like customer questions).
 */
const FAQ_STEM_PREFIX_LENGTH = 50;

function normalizeFaqStem(s: string): string {
  return s
    .trim()
    .toLowerCase()
    // Strip non-alphanumeric except whitespace; punctuation noise.
    .replace(/[^a-z0-9\s]/g, "")
    // Collapse whitespace.
    .replace(/\s+/g, " ")
    .slice(0, FAQ_STEM_PREFIX_LENGTH);
}

// ---------------------------------------------------------------------------
// W3 Step 3.1 — placeholder + FAQ structural-quality gate
// ---------------------------------------------------------------------------

/**
 * Reject edits whose copy reads like a generator placeholder, OR whose
 * FAQ Q+A body is structurally useless.
 *
 * Phrase rejection runs against:
 *   - targetElement.proposedText
 *   - targetElement.displayLabel
 *   - targetElement.currentText is intentionally NOT scanned —
 *     currentText comes from the page crawler reflecting whatever the
 *     site already says. We're not validating the live site; we're
 *     validating what we'd RECOMMEND.
 *
 * Structural rejection (FAQ Q+A) runs only on add_faq + rewrite_faq
 * edits whose proposedText parses as `Q: ... \n\nA: ...`. Edits whose
 * proposedText doesn't match the deterministic-generator format skip
 * the structural test (the LLM provider in W3 Step 3.4 may emit
 * different shapes; for those, the existing rule 9.5 + the phrase
 * rejection already catch the worst failures).
 *
 * No env opt-out — placeholder copy must never reach the queue.
 */
function validateNoPlaceholder(edit: SpecificEdit): ValidationResult {
  if (edit.targetElement === null) return OK;
  const tel = edit.targetElement;

  // 1. Phrase scan — proposedText.
  if (typeof tel.proposedText === "string" && tel.proposedText.length > 0) {
    const hit = detectPlaceholder(tel.proposedText);
    if (hit.matched) {
      return fail(
        "targetElement.proposedText",
        `proposedText matches placeholder pattern (${hit.patternId}): ${hit.description}. Generators must emit grounded copy or abstain ([]).`,
      );
    }
  }

  // 2. Phrase scan — displayLabel.
  if (typeof tel.displayLabel === "string" && tel.displayLabel.length > 0) {
    const hit = detectPlaceholder(tel.displayLabel);
    if (hit.matched) {
      return fail(
        "targetElement.displayLabel",
        `displayLabel matches placeholder pattern (${hit.patternId}): ${hit.description}.`,
      );
    }
  }

  // 3. Structural scan — only FAQ action types with parseable Q+A
  // proposedText.
  if (edit.actionType === "add_faq" || edit.actionType === "rewrite_faq") {
    const parsed = parseFaqProposedText(tel.proposedText);
    if (parsed) {
      const verdict = evaluateFaqAnswer(parsed);
      if (!verdict.ok) {
        return fail(
          "targetElement.proposedText",
          `FAQ answer structurally insufficient (${verdict.reason}): ${verdict.detail}. Generator should abstain when evidence is too thin.`,
        );
      }
    }
  }

  return OK;
}

/**
 * LLM-DryRun-2 rule (operator audit, 2026-05-05) — reject raw prompt
 * UUIDs in the operator-visible attribution / methodology copy fields.
 *
 * Scans `why`, `expectedImpact`, `measurementPlan`. The internal
 * `evidence: [{ type:"prompt", promptId: <UUID> }]` arrays are the
 * canonical place for raw IDs — they're not scanned here.
 *
 * Why it matters: the M2 render-time sanitizer scrubs UUIDs out of
 * `why` when /recommendations renders the drawer, but the persisted
 * row in Supabase + `.data/recommended-edits.json` still carries the
 * raw UUID. Any future read path that doesn't go through the sanitizer
 * (an export, a CSV download, a debug API call, an admin tool) would
 * leak the ID. Reject at validation time so new rows never carry the
 * leak, and pin via architecture invariant on the persisted store.
 *
 * Pure / deterministic. Uses the existing `containsUuid` predicate
 * (Schema-v4 RFC 4122 8-4-4-4-12 hex pattern, case-insensitive,
 * accepts trailing `...` truncation).
 */
function validateNoUuidInOperatorCopy(edit: SpecificEdit): ValidationResult {
  if (typeof edit.why === "string" && containsUuid(edit.why)) {
    return fail(
      "why",
      `raw prompt UUID detected in why text — cite prompts by short text snippet (e.g. "the 'best whole home remodel builders bay area' prompt"), not by ID. The internal evidence[] array is the canonical place for raw IDs.`,
    );
  }
  if (
    typeof edit.expectedImpact === "string" &&
    containsUuid(edit.expectedImpact)
  ) {
    return fail(
      "expectedImpact",
      "raw prompt UUID detected in expectedImpact — operator-visible copy must reference prompts by snippet, not ID.",
    );
  }
  if (
    typeof edit.measurementPlan === "string" &&
    containsUuid(edit.measurementPlan)
  ) {
    return fail(
      "measurementPlan",
      "raw prompt UUID detected in measurementPlan — operator-visible copy must reference prompts by snippet, not ID.",
    );
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Sprint 6A.2g.B — Competitor public-copy safety helpers
// ---------------------------------------------------------------------------

/**
 * Sprint 6A.2g.B (2026-04-26) — gate that disables the competitor-
 * public-copy check. OFF by default. Set BEACON_ALLOW_COMPETITOR_COPY=1
 * when a coincidental alias collision rejects a legitimate edit (e.g.,
 * a competitor named "Reno" colliding with the city "Reno" in copy).
 */
function isCompetitorCopyAllowed(): boolean {
  return process.env.BEACON_ALLOW_COMPETITOR_COPY === "1";
}

/**
 * Sprint 6A.2g.B — closed suffix set. Operator-locked. NOT extensible
 * by config; the suffix list is intentionally narrow to avoid false
 * positives from generic-noun company suffixes ("Solutions", "Partners",
 * etc.). If a competitor name's trailing word is one of these, we
 * strip it to produce a safe alias variant — e.g., "De Mattei
 * Construction" → "De Mattei". If the trailing word is anything else,
 * we do NOT generate a stripped alias (no token-level scans, no
 * heuristic decomposition).
 */
const COMPETITOR_SUFFIX_SET = [
  "Construction",
  "Builders",
  "Builder",
  "Inc",
  "LLC",
  "Co",
  "Company",
  "Group",
] as const;

/** Cap aliases per competitor at 5 to bound false-positive surface. */
const MAX_COMPETITOR_ALIASES = 5;

/**
 * Skip aliases shorter than 4 characters.
 *
 * Common-English-word collisions ("Co", "On", "In", "Bay", "ICB",
 * etc.) would dominate false positives. The W3 §3.8.6 Luxury Home
 * Builder Bay Area dry-run caught the bare-"Bay" alias of competitor
 * "Bay Builders" matching every "Bay Area" mention in legitimate
 * geo copy — three of three generated edits rejected as false
 * positives. Raising the floor from 3 → 4 chars keeps every real
 * competitor's full + meaningful suffix-stripped names ("Bay
 * Builders", "Kasten Builders" → "Kasten", "Greenberg Construction"
 * → "Greenberg") while suppressing 3-char fragments that collide
 * with everyday geo / English words.
 *
 * The full competitor name is ALWAYS included regardless of length —
 * a competitor literally named "Bay" would still match its full
 * name. Only the suffix-stripped derivative is suppressed.
 */
const MIN_COMPETITOR_ALIAS_LENGTH = 4;

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sprint 6A.2g.B — build the safe alias set for one competitor name.
 *
 * The full trimmed name is ALWAYS the first alias regardless of length.
 * Then iteratively strip a trailing closed-set suffix to produce
 * progressively shorter variants. Stop when no closed-set suffix
 * matches OR the cap is reached. Each generated variant must be ≥
 * MIN_COMPETITOR_ALIAS_LENGTH chars; shorter variants are skipped (but
 * we keep iterating in case further suffixes apply — though in
 * practice short names have no further suffixes).
 *
 * Examples:
 *   "De Mattei Construction" → ["De Mattei Construction", "De Mattei"]
 *   "Acme Builders Inc"      → ["Acme Builders Inc", "Acme Builders", "Acme"]
 *   "Acme Solutions"         → ["Acme Solutions"] — "Solutions" not in set
 *   "Co Pacific"             → ["Co Pacific"] — "Pacific" not in set
 *   "X Co"                   → ["X Co"] — "X" alone too short
 *   "ABC LLC"                → ["ABC LLC", "ABC"]
 */
export function buildCompetitorAliases(competitorName: string): string[] {
  if (typeof competitorName !== "string") return [];
  const trimmed = competitorName.trim();
  if (trimmed.length === 0) return [];

  const out: string[] = [trimmed];
  const seen = new Set<string>([trimmed.toLowerCase()]);

  let current = trimmed;
  while (out.length < MAX_COMPETITOR_ALIASES) {
    let stripped: string | null = null;
    for (const suffix of COMPETITOR_SUFFIX_SET) {
      // Match trailing whitespace + suffix + optional period, end of string,
      // case-insensitive. Word-boundary semantics come for free from
      // requiring `\s+` before the suffix.
      const re = new RegExp(`\\s+${escapeRegexLiteral(suffix)}\\.?$`, "i");
      if (re.test(current)) {
        stripped = current.replace(re, "").trim();
        break;
      }
    }
    if (stripped === null) break;
    if (stripped.length < MIN_COMPETITOR_ALIAS_LENGTH) break;
    const key = stripped.toLowerCase();
    if (!seen.has(key)) {
      out.push(stripped);
      seen.add(key);
    }
    current = stripped;
  }

  return out;
}

function validateCompetitorPublicCopy(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  if (isCompetitorCopyAllowed()) return OK;
  if (edit.targetElement === null) return OK;
  const tel = edit.targetElement;

  // Build the full alias-set once per call. N is small (typically <10
  // competitors per packet × ≤5 aliases each), so a flat scan is fine.
  type AliasGroup = { competitorName: string; aliases: string[] };
  const groups: AliasGroup[] = [];
  for (const angle of packet.competitorAngles) {
    if (typeof angle.competitorName !== "string") continue;
    const aliases = buildCompetitorAliases(angle.competitorName);
    if (aliases.length === 0) continue;
    groups.push({ competitorName: angle.competitorName, aliases });
  }
  if (groups.length === 0) return OK;

  function checkField(
    fieldName: "targetElement.proposedText" | "targetElement.displayLabel",
    value: unknown,
  ): ValidationResult {
    if (typeof value !== "string" || value.length === 0) return OK;
    for (const group of groups) {
      for (const alias of group.aliases) {
        // Word-boundary anchored, case-insensitive, escaped literal.
        // No token-level scan; no fuzzy match. The `\b` anchors mean
        // "Reno" won't match "Renovation" (next char "v" is word-class
        // → no boundary).
        const re = new RegExp(`\\b${escapeRegexLiteral(alias)}\\b`, "i");
        if (re.test(value)) {
          return fail(
            fieldName,
            `${fieldName.split(".").pop()} contains competitor name "${group.competitorName}" (matched alias ${JSON.stringify(alias)}). Competitor names are evidence-only; keep them in why / evidence refs and out of visitor-readable copy. Set BEACON_ALLOW_COMPETITOR_COPY=1 to override.`,
          );
        }
      }
    }
    return OK;
  }

  const proposedResult = checkField(
    "targetElement.proposedText",
    tel.proposedText,
  );
  if (!proposedResult.ok) return proposedResult;
  const labelResult = checkField(
    "targetElement.displayLabel",
    tel.displayLabel,
  );
  if (!labelResult.ok) return labelResult;

  return OK;
}

function validateFaqIntentRewriting(
  edit: SpecificEdit,
  packet: SpecificEditEvidencePacket,
): ValidationResult {
  // Only fires for the two FAQ action types.
  if (edit.actionType !== "add_faq" && edit.actionType !== "rewrite_faq") {
    return OK;
  }
  // Page-level branch can't reach here (rule 3 already requires non-null
  // targetElement for these content actions), but guard defensively.
  if (edit.targetElement === null) return OK;
  const tel = edit.targetElement;

  // Only the question half of a FAQ pair is gated. faq_answer rows
  // legitimately don't end in "?" and aren't lifting prompt stems.
  const elementType = parseElementTypeFromKey(tel.elementKey);
  if (elementType !== "faq_question") return OK;

  // Rule 3 already required proposedText to be a non-empty string for
  // requiresProposedText=true actions (both FAQ types qualify).
  // Defensive: skip if absent.
  if (typeof tel.proposedText !== "string" || tel.proposedText.length === 0) {
    return OK;
  }
  const fullProposed = tel.proposedText.trim();

  // W3 Step 3.1 (2026-05-01) — recognize the deterministic generator's
  // Q+A shape. When proposedText parses as `Q: <question>\n\nA:
  // <answer>`, the "?" + verbatim-stem checks run against the QUESTION
  // half, not the full text. Otherwise (LLM may emit just the question
  // string, no "A:" prefix), the checks run against the full text as
  // before. Pre-W3 callers continue to work unchanged.
  const parsed = parseFaqProposedText(fullProposed);
  const questionForGate = parsed ? parsed.question.trim() : fullProposed;

  // (a) Must end with "?". Always enforced — the env opt-out does NOT
  // skip this check. A FAQ "question" that doesn't end in a question
  // mark isn't a question.
  if (!questionForGate.endsWith("?")) {
    return fail(
      "targetElement.proposedText",
      `add_faq / rewrite_faq question must end with "?" (got: ${JSON.stringify(questionForGate.slice(-20))})`,
    );
  }

  // (b) Must NOT begin with the synthetic affected-prompt stem.
  // Skip-if-opted-out so operator can ship rows the model legitimately
  // mirrored from already-customer-voiced affected prompts.
  if (isSyntheticFaqCopyAllowed()) return OK;

  const proposedNorm = normalizeFaqStem(questionForGate);
  if (proposedNorm.length === 0) return OK;

  for (const affected of packet.affectedPrompts) {
    const stemNorm = normalizeFaqStem(affected.promptText);
    if (stemNorm.length === 0) continue;
    if (proposedNorm.startsWith(stemNorm)) {
      return fail(
        "targetElement.proposedText",
        `FAQ question lifts synthetic prompt text verbatim from prompt "${affected.promptId}" (matched normalized stem ${JSON.stringify(stemNorm)}). Rewrite into customer-voice phrasing or set BEACON_ALLOW_SYNTHETIC_FAQ_COPY=1 to override.`,
      );
    }
  }

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

  const perEditMutable: BundlePerEditResult[] = bundle.recommendations.map(
    (edit) => ({
      edit,
      result: validateSpecificEdit(edit, packet),
    }),
  );

  // ── W3 Step 3.8 — bundle-level FAQ Q+A pairing ──────────────────────
  // Group every FAQ edit by its element-key hash suffix; reject any
  // unpaired question or answer row. Operator-locked: FAQ edits must
  // ship as paired rows, never alone.
  //
  // Pairing runs on the EFFECTIVE accepted set: a per-edit-failed
  // question leaves its matching answer effectively orphaned at
  // persist time, so the answer must fail too. This guard prevents
  // a half-pair from reaching disk on `--write` runs (operator-
  // caught Cupertino case: model proposed a "the best builders"
  // FAQ question that hit the brand-claim gate; the answer was
  // otherwise clean and would have persisted as an orphan without
  // this fix).
  const pairingFailures = checkFaqPairing(
    bundle.recommendations,
    perEditMutable.map((p) => p.result.ok),
  );
  for (const pf of pairingFailures) {
    bundleErrors.push(
      fail(
        `recommendations[${pf.editIndex}].targetElement.elementKey`,
        pf.reason,
      ),
    );
    // Also overwrite the per-edit result so the operator sees which
    // specific row was orphaned (instead of just a bundle-level
    // banner).
    const existing = perEditMutable[pf.editIndex];
    if (existing && existing.result.ok) {
      perEditMutable[pf.editIndex] = {
        edit: existing.edit,
        result: fail(
          `targetElement.elementKey`,
          pf.reason,
        ),
      };
    }
  }

  const perEdit: readonly BundlePerEditResult[] = perEditMutable;
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

// ---------------------------------------------------------------------------
// SAFETY #273 (2026-06-14) — deterministic-draft public-copy safety gate.
//
// `validateSpecificEdit` is the authoritative gate for the LLM provider +
// the legacy specific-edit provider path. But the DETERMINISTIC promotion
// pipeline (`recommendation-intelligence/promotion-writer` →
// `enrichPromotionRow` → `persistRecommendedEditsLocal` /
// `syncRecommendedEdits`) produces customer-approvable `proposed_text` and
// `display_label` WITHOUT ever building a `SpecificEditEvidencePacket`, so
// `validateSpecificEdit` (which is heavily packet-dependent: allowedTargetUrls,
// allowedActionTypes, targetPageElements inventory, evidence refs, abstention
// contract) cannot run on it without spuriously rejecting every row.
//
// This function isolates the PUBLIC-COPY safety subset — the gates that scan
// the visitor-readable strings a bad draft could leak onto a live site — and
// runs them against the promotion row's two customer-facing fields. It needs
// only `tenantId` (for brand assertions + brand-name style); everything else
// is packet-independent. Identical env opt-outs to the per-edit path so a
// row that would be allowed there is allowed here.
//
// Gates applied (each scans `proposed_text` + `display_label` ONLY):
//   - placeholder phrases (always on — never opt-outable)
//   - leading self-claim superlative (BEACON_ALLOW_LEADING_SUPERLATIVE=1)
//   - unsupported brand claims (BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1)
//   - em dashes (BEACON_ALLOW_EM_DASH=1)
//   - bare brand short form (BEACON_ALLOW_SHORT_BRAND_NAME=1)
//
// Returns the FIRST failure (validator convention) or OK. Pure: no I/O.
// The caller ABSTAINS (drops the draft fields / suppresses the row) on a
// failure — it must never crash the promotion queue.
// ---------------------------------------------------------------------------

export type DeterministicDraftSafetyInput = {
  readonly tenantId: string;
  readonly proposedText: string | null;
  readonly displayLabel: string | null;
  /**
   * SAFETY #273 follow-up (2026-06-15) — the deterministic action type
   * (from the promotion row). Lets the gate distinguish PUBLISHABLE-COPY
   * drafts (the new title / meta / h1 STRING gets pasted onto the live
   * page) from DIRECTIVE drafts (an operator INSTRUCTION — "Add this
   * JSON-LD…", "Remove the noindex tag…", "Add a 2-3 sentence answer…" —
   * that is never published verbatim). Optional / null → treated as
   * publishable copy so the safe default (gate armed) never weakens.
   */
  readonly actionType?: string | null;
};

/**
 * SAFETY #273 follow-up (2026-06-15) — deterministic action types whose
 * `proposed_text` is an OPERATOR INSTRUCTION, not text published to the
 * live site. These mirror the directive branches of
 * `recommendation-intelligence/draft-enrichment.ts` `enrichPromotionRow`
 * (composeFixDirective / composeInternalLinks / composeSchema /
 * composeFixSchema / composeSourcesDirective / composeAnswerBlockDirective
 * / composeClarityDirective). For these, the PUBLISHED-PROSE style rules
 * (em dash, leading self-claim superlative, bare brand short form) do not
 * apply — they exist to keep an AI-tell out of visitor-readable copy, and
 * a directive is read by the operator in the Beacon queue, never pasted to
 * the page as-is. The correctness/legality gates (placeholder, unsupported
 * brand claim) STILL run for every action type.
 *
 * Anything NOT in this set (the three publishable-copy types edit_title /
 * edit_meta / change_h1, plus any unknown/future type) keeps the full
 * style gate — the safe default.
 */
const DETERMINISTIC_DIRECTIVE_ACTION_TYPES: ReadonlySet<string> = new Set([
  "fix_canonical",
  "fix_robots",
  "fix_noindex",
  "fix_status_code",
  "fix_sitemap",
  "fix_page_experience",
  "add_internal_link",
  "add_schema",
  "fix_schema",
  "add_proof_section",
  "add_answer_block",
]);

export function validateDeterministicDraftSafety(
  input: DeterministicDraftSafetyInput,
): ValidationResult {
  const fields: Array<{ value: string | null; path: string }> = [
    { value: input.proposedText, path: "proposed_text" },
    { value: input.displayLabel, path: "display_label" },
  ];

  // A directive draft is an operator instruction, never published prose, so
  // the PUBLISHED-PROSE style gates below (leading superlative, em dash, bare
  // brand short form) are skipped for it. Correctness gates still run.
  const isDirective =
    input.actionType != null &&
    DETERMINISTIC_DIRECTIVE_ACTION_TYPES.has(input.actionType);

  // 1. Placeholder phrases — never opt-outable (mirrors validateNoPlaceholder).
  // Runs for EVERY action type (a directive must never say "[insert X]" / TODO).
  for (const f of fields) {
    if (typeof f.value !== "string" || f.value.length === 0) continue;
    const hit = detectPlaceholder(f.value);
    if (hit.matched) {
      return fail(
        f.path,
        `${f.path} matches placeholder pattern (${hit.patternId}): ${hit.description}.`,
      );
    }
  }

  // 2. Leading self-claim superlative (BEACON_ALLOW_LEADING_SUPERLATIVE=1).
  //    Published-prose style rule — skipped for directive drafts.
  if (!isDirective && process.env.BEACON_ALLOW_LEADING_SUPERLATIVE !== "1") {
    for (const f of fields) {
      if (typeof f.value !== "string" || f.value.length === 0) continue;
      const hit = findLeadingSuperlative(f.value);
      if (hit) {
        return fail(
          f.path,
          `${f.path} may not start with self-claim superlative '${hit.matched}'.`,
        );
      }
    }
  }

  // 3. Unsupported brand claims (BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS=1).
  // Uses the tenant's operator-curated assertion list; empty list = every
  // forbidden pattern stays locked (the safe default). Runs for EVERY action
  // type — a directive must not assert unsupported social proof either.
  if (process.env.BEACON_ALLOW_UNSUPPORTED_BRAND_CLAIMS !== "1") {
    const assertions = getBrandAssertions(input.tenantId);
    for (const f of fields) {
      if (typeof f.value !== "string" || f.value.length === 0) continue;
      const matches = findUnsupportedBrandClaims(f.value, assertions);
      if (matches.length > 0) {
        const first = matches[0];
        return fail(
          f.path,
          `unsupported brand claim '${first.matchedText}' (pattern: ${first.patternId}) — ${first.description}`,
        );
      }
    }
  }

  // 4. Em dashes (BEACON_ALLOW_EM_DASH=1).
  //    Published-prose style rule — skipped for directive drafts (their
  //    operator-facing instruction text legitimately uses em dashes).
  if (!isDirective && process.env.BEACON_ALLOW_EM_DASH !== "1") {
    for (const f of fields) {
      if (typeof f.value !== "string" || f.value.length === 0) continue;
      const matches = findEmDashes(f.value);
      if (matches.length > 0) {
        return fail(
          f.path,
          `em dash banned in public copy ('${matches[0].char}' near "${matches[0].contextText}").`,
        );
      }
    }
  }

  // 5. Bare brand short form (BEACON_ALLOW_SHORT_BRAND_NAME=1). No-op for
  //    tenants without a curated brand-name style. Published-prose style
  //    rule — skipped for directive drafts.
  if (!isDirective && process.env.BEACON_ALLOW_SHORT_BRAND_NAME !== "1") {
    const style = getBrandNameStyle(input.tenantId);
    if (style !== null) {
      for (const f of fields) {
        if (typeof f.value !== "string" || f.value.length === 0) continue;
        const matches = findIncompleteBrandMentions(f.value, style);
        if (matches.length > 0) {
          const first = matches[0];
          return fail(
            f.path,
            `brand short form '${first.shortForm}' alone is not allowed in public copy (use the full entity name '${first.fullName}').`,
          );
        }
      }
    }
  }

  return OK;
}

/**
 * W3 Step 3.8 (2026-05-03) — bundle-level FAQ pairing check.
 *
 * For every `faq_question[new]:<hash>` row there must be exactly one
 * `faq_answer[new]:<hash>` row with the same hash suffix in the
 * bundle (and vice versa). Returns a list of `{ editIndex, reason }`
 * for every orphan + every duplicate.
 *
 * The "shared hash suffix" is the trailing `:<hash>` of an additive
 * element key (e.g., `faq_question[new]:abcd1234` and
 * `faq_answer[new]:abcd1234` share hash `abcd1234`). Non-additive
 * element keys (e.g., `faq_question:existing-id`) match by their
 * full elementKey suffix.
 *
 * Pure / deterministic. Returns empty array when the bundle has no
 * FAQ rows.
 */
type FaqPairingFailure = {
  readonly editIndex: number;
  readonly reason: string;
};

function checkFaqPairing(
  edits: ReadonlyArray<SpecificEdit>,
  /**
   * Optional per-edit pass/fail flags (length = edits.length). When
   * supplied, edits whose flag is `false` are SKIPPED during
   * bucketing — i.e., a per-edit-failed question leaves its bucket
   * empty so the matching answer (if otherwise OK) is correctly
   * flagged as orphan. Without this guard, a `--write` run could
   * persist a half-pair when one row of the pair failed the
   * brand-claim / em-dash / synthetic-stem / placeholder /
   * competitor gates.
   */
  perEditOk?: ReadonlyArray<boolean>,
): FaqPairingFailure[] {
  const failures: FaqPairingFailure[] = [];
  // Build per-hash buckets of question + answer indices.
  const questionsByHash = new Map<string, number[]>();
  const answersByHash = new Map<string, number[]>();
  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    if (edit.actionType !== "add_faq" && edit.actionType !== "rewrite_faq") {
      continue;
    }
    const tel = edit.targetElement;
    if (!tel) continue;
    const elementType = parseElementTypeFromKey(tel.elementKey);
    if (elementType !== "faq_question" && elementType !== "faq_answer") {
      continue;
    }
    // Skip per-edit-failed rows so the EFFECTIVE bundle drives
    // pairing. Without this skip, a failed question would still
    // fill its bucket and the matching (otherwise-OK) answer would
    // pass the pairing check — only to be persisted as an orphan
    // because the question never makes it into `acceptedRows`.
    if (perEditOk && perEditOk[i] === false) continue;
    const hash = extractElementKeyHashSuffix(tel.elementKey);
    if (hash === null) continue; // can't pair without a hash; skip.
    const bucket =
      elementType === "faq_question" ? questionsByHash : answersByHash;
    const list = bucket.get(hash);
    if (list) list.push(i);
    else bucket.set(hash, [i]);
  }
  // Detect orphan + duplicate questions.
  for (const [hash, qIndices] of questionsByHash) {
    const aIndices = answersByHash.get(hash) ?? [];
    if (qIndices.length > 1) {
      for (const idx of qIndices.slice(1)) {
        failures.push({
          editIndex: idx,
          reason: `duplicate FAQ question with hash suffix '${hash}' — only one faq_question[new]:${hash} row may appear per bundle (paired with one faq_answer[new]:${hash}).`,
        });
      }
    }
    if (aIndices.length === 0) {
      for (const idx of qIndices) {
        failures.push({
          editIndex: idx,
          reason: `unpaired FAQ question (faq_question[new]:${hash}) — every FAQ question must ship with a matching faq_answer[new]:${hash} answer row in the same bundle.`,
        });
      }
    }
  }
  // Detect orphan + duplicate answers.
  for (const [hash, aIndices] of answersByHash) {
    const qIndices = questionsByHash.get(hash) ?? [];
    if (aIndices.length > 1) {
      for (const idx of aIndices.slice(1)) {
        failures.push({
          editIndex: idx,
          reason: `duplicate FAQ answer with hash suffix '${hash}' — only one faq_answer[new]:${hash} row may appear per bundle.`,
        });
      }
    }
    if (qIndices.length === 0) {
      for (const idx of aIndices) {
        failures.push({
          editIndex: idx,
          reason: `unpaired FAQ answer (faq_answer[new]:${hash}) — every FAQ answer must ship with a matching faq_question[new]:${hash} question row in the same bundle.`,
        });
      }
    }
  }
  // Sort by editIndex so the FIRST orphan in document order surfaces
  // first (operator scans top-to-bottom).
  failures.sort((a, b) => a.editIndex - b.editIndex);
  return failures;
}

/**
 * Extract the hash suffix from a `<type>[new]:<hash>` element key.
 * Returns null when the key isn't additive or has no `:hash` suffix.
 */
function extractElementKeyHashSuffix(elementKey: string): string | null {
  if (typeof elementKey !== "string") return null;
  // additive shape: `faq_question[new]:abc123`
  const additiveMatch = elementKey.match(/\[new\]:(.+)$/);
  if (additiveMatch && additiveMatch[1].length > 0) return additiveMatch[1];
  // existing-element shape: `faq_question:existing-id` — match
  // anything after the first colon.
  const colonIdx = elementKey.indexOf(":");
  if (colonIdx > 0 && colonIdx < elementKey.length - 1) {
    return elementKey.slice(colonIdx + 1);
  }
  return null;
}

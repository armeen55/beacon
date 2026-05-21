/**
 * Slice 4.5.E.α₁b₁ (2026-05-21) — LLM-draft-gateway env flag.
 *
 * Single source of truth for whether the LLM-draft gateway is
 * permitted to invoke the OpenAI provider. The flag is CALLER-side:
 * the gateway itself does NOT read the env var. Future α₁b₂ wires
 * an operator-only server action that consults this helper BEFORE
 * any call to `draftProposedTextForCandidate(...)`.
 *
 * Default-off semantics mirror `BEACON_PROMOTION_LIVE_WRITE_ENABLED`
 * + `BEACON_OPERATOR_MODE`:
 *
 *   • Returns `true` ONLY when the env var is the literal string
 *     `"true"`. Strict casing — any other value (including `"True"`,
 *     `"TRUE"`, `"1"`, `undefined`, `""`) returns `false`.
 *   • Customer-mode default: env var unset ⇒ `false` ⇒ no LLM-draft
 *     gateway invocations allowed.
 *
 * Read-only helper. No side effects.
 *
 * Pinned by:
 *   • tests/architecture/recommendation-intelligence-llm-draft-
 *     gateway-render-isolation.test.ts (proves no customer-facing
 *     page imports the gateway today)
 *   • Future α₁b₂ contract test will pin that the operator-only
 *     server action consults this helper.
 */

export function isLlmDraftGatewayEnabled(): boolean {
  return process.env.BEACON_LLM_DRAFT_GATEWAY_ENABLED === "true";
}

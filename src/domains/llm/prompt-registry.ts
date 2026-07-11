/**
 * llm/prompt-registry (2026-07-03, BEACON 500 R16 / P6) - every production
 * prompt has a NAME and a VERSION, and every gateway call carries them.
 *
 * Why: prompts are load-bearing product logic, but until now editing one was
 * invisible to CI - a reworded system prompt could silently break the parsing/
 * validation path that consumes the model's output. This registry + the
 * regression harness (tests/llm-regression/) close that hole:
 *
 *   - Each entry maps a stable promptId to its CURRENT version.
 *   - tests/llm-regression/prompt-regression.test.ts requires a recorded
 *     fixture at fixtures/prompts/<promptId>.v<version>.json for EVERY entry
 *     and runs it through the REAL parsing/validation path (no live calls).
 *   - Bumping a version here without adding the new fixture fails a named
 *     test. Editing prompt WORDING that changes the output contract must bump
 *     the version (reviewers can hold that line because the version sits in
 *     the same diff as the prompt text's call site).
 *
 * PURE - constants only, no I/O, importable from anywhere (including tests).
 */

export const PROMPT_REGISTRY = {
  // ── structured-drafter kinds (all parse through callStructuredLLM) ────────
  // draft.answer_block bumped to v2 (2026-07-09, W5/J-71): 80-150 word target
  // + "sources" field + cite-sources instruction replace the old 40-60 word
  // prompt - the content-hash call cache must never serve a stale v1 response
  // under the new contract.
  // Bumped to v3 (2026-07-10, drafter last-mile G4): the system prompt now
  // instructs grounding superlative-intent topics in specific facts (no
  // unprovable superlative), paired with a verification-aware superlative
  // post-check + rephrase retry - a contract change, so the cache must not
  // serve a stale v2 response.
  // Bumped to v4 (2026-07-10, pilot loop 4): the system prompt now instructs
  // citing each named entity's OWN reference page for an entity-rich roundup
  // (never a bare list/index page) and prefers a tenant's allowlisted domains
  // / the "sources you may cite" hint when they genuinely cover the claim; the
  // superlative rephrase-retry instruction now also forbids swapping in a NEW
  // ungrounded superlative. A prompt-wording change, so the cache must not
  // serve a stale v3 response under the new guidance.
  // Bumped to v5 (2026-07-11, pilot loop 5): the entity-rich system prompt now
  // also instructs one-fact-per-sentence (never bundling two different facts
  // about the same entity into one clause, so per-sentence coverage can verify
  // each claim on its own); and the retry path can now emit a MERGED
  // too-thin + superlative-rephrase instruction when attempt 1 fails both
  // checks at once. A prompt-wording change, so the cache must not serve a
  // stale v4 response under the new guidance.
  // Bumped to v6 (2026-07-11, pilot loop 6): every rephrase-class retry
  // instruction (superlative-only, too-thin-only, and the combined
  // instruction) now closes with a reminder not to introduce any number,
  // percentage, or statistic absent from the evidence. A prompt-wording
  // change, so the cache must not serve a stale v5 response under the new
  // guidance.
  "draft.answer_block": 6,
  "draft.atomic_edit": 1,
  "draft.create_page_brief": 1,
  "draft.cro_fix": 1,
  "draft.internal_link": 1,
  "draft.aeo_prompt_brief": 1,
  "draft.team_verdict": 1,
  "draft.batch_adjudication": 1,
  "draft.strategy_review": 1,
  "draft.section_draft": 1,
  "draft.outreach_pitch": 1,
  "draft.ask_answer": 1,
  // Registered schema kinds with no bespoke production prompt yet (P8 targets);
  // callStructuredLLM derives draft.<kind>, so they must resolve to a version.
  "draft.tool_asset": 1,
  "draft.commerce_asset": 1,
  "draft.experiment_plan": 1,
  // ── legacy demand-graph drafters (llm-answer-block.ts) ────────────────────
  // answer_block.text bumped to v2 (2026-07-09, W5/J-71): 80-150 word target
  // + cite-sources instruction replace the old 40-60 word prompt.
  "answer_block.text": 2,
  "answer_block.faq_schema": 1,
  // ── recommendation reasoning passes ───────────────────────────────────────
  "rec.why_narrative": 1,
  "rec.strategist": 1,
  "rec.critic": 1,
  "rec.specific_edit_bundle": 1,
  "rec.page_intent_adjudicator": 1,
  // ── page surgeon ──────────────────────────────────────────────────────────
  "page_surgeon.judge": 1,
  "page_surgeon.serp_hypothesis": 1,
  // ── other production egress ───────────────────────────────────────────────
  "push.cluster_factory": 1,
  "ai_visibility.engine_poll_openai": 1,
} as const;

export type PromptId = keyof typeof PROMPT_REGISTRY;

/** The current version for a registered prompt. */
export function promptVersion(id: PromptId): number {
  return PROMPT_REGISTRY[id];
}

/** Fixture basename the regression harness expects for a registry entry. */
export function promptFixtureName(id: PromptId): string {
  return `${id}.v${PROMPT_REGISTRY[id]}.json`;
}

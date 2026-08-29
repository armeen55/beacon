/**
 * llm/prompt-registry (2026-07-03, BEACON 500 R16 / P6) - every production prompt has a NAME and a VERSION, and every gateway call carries them.
 *
 * Why: prompts are load-bearing product logic, and a reworded system prompt can silently break the parsing/validation path that consumes the model's output.
 * Each entry maps a stable promptId to its CURRENT version, and the version is folded into the call cache key, so wording that changes the output contract
 * MUST bump the version here: a stale answer taken under the old wording can then never be served under the new one. The version sits in the same diff as
 * the prompt text's call site, so a reviewer can hold that line.
 *
 * PURE - constants only, no I/O, importable from anywhere (including tests).
 */

export const PROMPT_REGISTRY = {
  // ── structured-drafter kinds (all parse through callStructuredLLM) ──────── draft.answer_block bumped to v2 (2026-07-09, W5/J-71): 80-150 word target
  // + "sources" field + cite-sources instruction replace the old 40-60 word prompt - the content-hash call cache must never serve a stale v1 response under the new contract.
  // Bumped to v3 (2026-07-10, drafter last-mile G4): the system prompt now instructs grounding superlative-intent topics in specific facts (no
  // unprovable superlative), paired with a verification-aware superlative post-check + rephrase retry - a contract change, so the cache must not serve a stale v2 response.
  // Bumped to v4 (2026-07-10, pilot loop 4): the system prompt now instructs citing each named entity's OWN reference page for an entity-rich roundup
  // (never a bare list/index page) and prefers a tenant's allowlisted domains / the "sources you may cite" hint when they genuinely cover the claim; the
  // superlative rephrase-retry instruction now also forbids swapping in a NEW ungrounded superlative. A prompt-wording change, so the cache must not serve a stale v3 response under the new guidance.
  // Bumped to v5 (2026-07-11, pilot loop 5): the entity-rich system prompt now also instructs one-fact-per-sentence (never bundling two different facts
  // about the same entity into one clause, so per-sentence coverage can verify each claim on its own); and the retry path can now emit a MERGED
  // too-thin + superlative-rephrase instruction when attempt 1 fails both checks at once. A prompt-wording change, so the cache must not serve a stale v4 response under the new guidance.
  // Bumped to v6 (2026-07-11, pilot loop 6): every rephrase-class retry instruction (superlative-only, too-thin-only, and the combined instruction) now closes with a reminder not to introduce any number,
  // percentage, or statistic absent from the evidence. A prompt-wording change, so the cache must not serve a stale v5 response under the new guidance.
  "draft.answer_block": 6,
  // draft.atomic_edit bumped to v2 (2026-08-23, grounded utility): the head clause now names the actual field (an answer block is no longer told it is a title edit) and the intent directive carries the AEO shape vocabulary, so the cache must never serve a v1 answer written under the two-assignments prompt. Previously: stayed at v1 (2026-08-01, V1 Closure); the opening-answer clause is APPENDED only when the field is
  // answer_block, a value nothing ever passed before, and the cache key folds in the system text itself, so no stored title or meta draft can be served under wording it was not taken under.
  "draft.atomic_edit": 4, // v4 (2026-08-24): a meta carries META_SUBJECT_CLAUSE, which forbids the page's FAQ rail as its subject and requires it to open by naming the thing. No v2/v3 description can be served under wording that forbids what it did.
  "draft.editor_judgement": 3, // v3 (2026-08-28): the response contract changed. `claimsEntailed` is gone; the editor returns one entailment ruling per material claim ({i, by, entailed}) naming that claim's own evidence ids, and the overall claims result is derived from those rulings. No v2 verdict answers this contract.
  "draft.factual_review": 4, // v4 (2026-08-28): the reviewer now rules on ROLE as well as entailment. A cached v3 answer carries no role verdict, and reusing one would authorize exactly the mismatch v4 exists to refuse
  // draft.internal_link and draft.section_draft get their FIRST production wording at v1 (2026-08-01, V1 Closure): both kinds were registered schemas with no caller, so nothing is cached under either id and
  // there is no stale answer a version could protect. Any change to the wording from here must bump them.
  // The AEO gap reader (2026-08-28): compares a search, the complete stored owned page and the credited
  // passages, and returns what the page LACKS from a closed vocabulary. Judgment only; it drafts nothing.
  "draft.aeo_gap": 2, // v2 (2026-08-28): the reader's packet and instructions changed (it is told explicitly when no credited passage is on file, and the owned side is supplied as exact id/text tuples), so a v1 answer was given to a different question and must not be served from cache.
  "draft.internal_link": 1,
  "draft.batch_adjudication": 1,
  "draft.strategy_review": 1,
  "draft.section_draft": 1,
  "draft.outreach_pitch": 1,
  // The coverage verdict (N3b, 2026-07-28): does this account already have the right page for a researched topic. Judgment only; it drafts nothing.
  "draft.coverage_adjudication": 1,
  // The new page brief (N4, 2026-07-28): the one call an EARNED create_new verdict may make. It writes the page, never the decision that the page should exist.
  "draft.new_page_brief": 1,
  // Reading one AI engine's answer back (2026-07-31, V1 Truth Convergence Phase 1): what it said, who it named, what it left out. It restates the answer and
  // decides nothing, so the wording that forbids inventing is the whole contract and any change to it must bump this version.
  "draft.answer_analysis": 1,
  // The SAME reading over many answers in one call (2026-08-01, V1 Closure): the rules are the answer_analysis rules plus "one entry per observation id, echoed exactly, never merged". A
  // change to either half changes what a stored batch reading means, so it must bump this version.
  "draft.answer_analysis_batch": 1,
  // Reading my OWN grouping back (2026-07-31, V1 Truth Convergence Phase 2): which cases are one subject, which is two, and which page answers which. It
  // refines an answer the deterministic pass already reached and decides nothing on its own, so the wording that forbids inventing an id, an address or a
  // fact is the whole contract; any change to it must bump this version.
  "draft.case_synthesis": 1,
  // What the pages that WIN a search have in common (2026-07-31, V1 Truth Convergence Phase 3): the shape, the sections, the named things and the questions three or more
  // publishers agree on, plus what my own page lacks against them. It abstracts a pattern and never copies a page, so the wording that forbids quoting a heading, naming a page
  // it was not shown, or writing a figure of its own is the whole contract; any change to it must bump this version. Bumped to v2 (2026-07-31, Phase 3 repair): the rules now cap a verbatim heading at
  // five words rather than sixty characters, forbid an eight-word run from ANY supplied line in ANY field, require every named section and thing to exist on every page cited
  // for it, order ownedGaps empty when no page of mine is supplied, and hand the model the already-settled page shape to repeat rather than re-vote. A contract change, so a
  // stale v1 answer must never be served under it.
  "draft.winning_pattern": 2,
  // What ONE owned page is FOR (2026-08-11, page job): its purpose in a sentence, its shape, who it is written for, its subject
  // words, and whether it sells. Read off the page's own stored extract and nothing else, so the wording that forbids naming a
  // subject the extract does not carry is the whole contract; any change to it must bump this version. The cache key already
  // folds the extract text, so a re-crawled page pays again on its own and an unchanged page never pays twice.
  "draft.page_job": 1,
  // Registered schema kinds with no bespoke production prompt yet (P8 targets); callStructuredLLM derives draft.<kind>, so they must resolve to a version.
  "draft.tool_asset": 1,
  "draft.commerce_asset": 1,
  "draft.experiment_plan": 1,
  // ── onboarding kinds (Slice 5, 2026-07-24) ────────────────────────────────
  "draft.business_profile_inference": 1,
  "draft.business_profile_patch": 1,
  "draft.prompt_candidates": 1,
  // ── legacy demand-graph drafters (llm-answer-block.ts) ──────────────────── answer_block.text bumped to v2 (2026-07-09, W5/J-71): 80-150 word target
  // + cite-sources instruction replace the old 40-60 word prompt.
  "answer_block.text": 2,
  "answer_block.faq_schema": 1,
  // ── recommendation reasoning passes ───────────────────────────────────────
  "rec.why_narrative": 1,
  "rec.strategist": 1,
  "rec.critic": 1,
  "rec.specific_edit_bundle": 1,
  "rec.page_intent_adjudicator": 1,
  "competitor.overlap_adjudication": 1,
  // ── page surgeon ──────────────────────────────────────────────────────────
  "page_surgeon.judge": 1,
  "page_surgeon.serp_hypothesis": 1,
  // ── other production egress ───────────────────────────────────────────────
  "push.cluster_factory": 1,
  "ai_visibility.engine_poll_openai": 1,
} as const;

export type PromptId = keyof typeof PROMPT_REGISTRY;

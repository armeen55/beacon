/**
 * Every gateway prompt has a stable identity and a version in its cache key.
 * Change the version alongside an output-contract change; preserve unrelated prompt identities.
 * Pure constants, with no I/O.
 */

export const PROMPT_REGISTRY = {
  // Structured drafter kinds all parse through the same validated gateway.
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
  "draft.body_edit": 3, // Publisher role shared with the final editor; no lexical voice classifier.
  "draft.page_acceptance": 3,
  // draft.atomic_edit bumped to v2 (2026-08-23, grounded utility): the head clause now names the actual field (an answer block is no longer told it is a title edit) and the intent directive carries the AEO shape vocabulary, so the cache must never serve a v1 answer written under the two-assignments prompt. Previously: stayed at v1 (2026-08-01, V1 Closure); the opening-answer clause is APPENDED only when the field is
  // answer_block, a value nothing ever passed before, and the cache key folds in the system text itself, so no stored title or meta draft can be served under wording it was not taken under.
  "draft.atomic_edit": 9, // Shared publisher role across publication fields.
  "draft.editor_judgement": 6, // Shared publisher-role and material-form acceptance.
  "draft.factual_review": 5, // v5 (2026-08-30): the ruling gains materialChange for suspected wording-only changes, so a cached v3 ruling never silently skips the question. v3 (2026-08-28): the prompt, the response schema, the reviewer packet, the mapping validation and what is persisted all changed, so a receipt banked under v2 is not the same promise and must fail closed as old
  // The AEO gap reader (2026-08-28): compares a search, the complete stored owned page and the credited
  // passages, and returns what the page LACKS from a closed vocabulary. Judgment only; it drafts nothing.
  "draft.aeo_gap": 3, // v3: visible main-content scope/freshness and separate owned/credited authority replace FAQ excerpt pooling.
  // The fact-check pair (2026-08-29): both are called through `draft.${kind}` and neither was ever registered,
  // so promptVersion resolved to undefined and only the folded system text separated one contract from the next.
  // v1 is the honest first identity for the wording each carries today. This is prompt-cache versioning and has
  // nothing to do with VERIFICATION_RULES_VERSION, which stays at 4.
  // v4: up to five query-backed winners supply scoped research; selected owned passages never prove whole-page absence.
  "draft.competitor_comparison": 4,
  "draft.fact_claim_extraction": 1,
  "draft.fact_claim_judgement": 3, // v2 (2026-08-29): every supporting source returns its own support ruling with verbatim spans (claim-support artifact v2), so a cached v1 answer cannot satisfy the new contract
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
  "draft.winning_pattern": 3, // Held main content + capture scope + search identity replace metadata-only comparison.
  // What ONE owned page is FOR (2026-08-11, page job): its purpose in a sentence, its shape, who it is written for, its subject
  // words, and whether it sells. Read off the page's own stored extract and nothing else, so the wording that forbids naming a
  // subject the extract does not carry is the whole contract; any change to it must bump this version. The cache key already
  // folds the extract text, so a re-crawled page pays again on its own and an unchanged page never pays twice.
  "draft.page_job": 2,
  // ── onboarding kinds (Slice 5, 2026-07-24) ────────────────────────────────
  "draft.business_profile_inference": 1,
  "draft.business_profile_patch": 1,
  "draft.prompt_candidates": 1,
  "competitor.overlap_adjudication": 1,
} as const;

export type PromptId = keyof typeof PROMPT_REGISTRY;

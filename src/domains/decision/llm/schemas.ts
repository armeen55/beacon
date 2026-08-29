/** llm/schemas (2026-06-25, P4, structured drafts), Zod schemas for every product-critical LLM artifact. No loose blob text is ever the final product artifact: a draft is only trusted once it parses against one of
 *  these schemas. Every draft carries `evidenceRefs` (≥1, what grounds it), `confidence`, `risks`, and `operatorSteps`; content drafts also carry a `proofPlan` so the Move ships with its measurement attached. These
 *  schemas are the validation contract for `structured-drafter.ts` (validate → retry-once → fail-closed) and the typed shape the PreparedMovePack (P3) carries forward. PURE, types + validators only, no I/O.
 *  Tenant-agnostic. */

import { z } from "zod";
import { BusinessProfileInferenceSchema, BusinessProfilePatchSchema, PromptCandidatesSchema } from "./onboarding-schemas";

// ── shared building blocks ──────────────────────────────────────────────────

/** Where a claim is grounded, points at a real signal/source the team read. `source` mirrors the EvidenceRef sources used by the specialist layer. */
const EvidenceRefSchema = z.object({
  source: z.enum(["gsc", "ga4", "clarity", "dataforseo", "competitor_teardown", "owned_snapshot", "fanout"]),
  detail: z.string().min(1).max(300),
});

/** ANALYTICS ALONE IS NOT EVIDENCE OF A SEARCH. ga4 and clarity report what people did once they were already on the page; neither says what anyone searched for, what a results page holds, or what a rival's page
 *  covers. A draft resting on those two alone has nothing behind the change it proposes, so a validated draft must carry at least ONE ref from another source; carrying none at all is a different failure and stays with
 *  the schema's own min(1). The refusal sentence below is what the retry is then told, so the model is asked for exactly what is owed. */
const BEHAVIOUR_ONLY_SOURCES = new Set<string>(["ga4", "clarity"]);
export const evidenceIsGrounded = (refs: readonly { source?: string }[]): boolean => refs.some((r) => !!r?.source && !BEHAVIOUR_ONLY_SOURCES.has(r.source));
export const UNGROUNDED_EVIDENCE_ERROR = "evidenceRefs: analytics alone is not evidence of a search; cite at least one ref whose source is gsc, dataforseo, competitor_teardown, owned_snapshot or fanout";

const ConfidenceSchema = z.enum(["high", "medium", "low"]);

/** W5 (2026-07-09, J-69/J-71), one citation attached to a factual draft. The LLM may PROPOSE a source (url/title/domain/claim) but never decides `authority`: source-authority.ts's deterministic classifier stamps it
 *  (.gov/.edu, the named encyclopedic and major-press set, or the tenant's allowlist earn "authoritative"; a real URL with a claim is "weak"; a bare URL is "unverified" and counts as no source). `claim` is the fact the
 *  source is checked to cover. */
export const SourceRefSchema = z.object({
  url: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  domain: z.string().min(1).max(120),
  /** ISO date (or plain-English date string) the source was read/retrieved. */
  retrievedAt: z.string().min(1).max(40),
  /** The specific fact/claim this source backs, never a bare citation. */
  claim: z.string().min(1).max(400),
  authority: z.enum(["authoritative", "weak", "unverified"]),
  /** W5 P0-1 (2026-07-09), set at GENERATION time ONLY (structured-drafter.ts fetches the URL and checks the fetched text actually carries this claim's tokens, never on a render/eval path). `true` means the cited page
   *  was reachable AND its text matches the claim; the source-authority gate (`hasQualifyingAuthoritativeSource`) requires this true so a hallucinated .gov/.edu URL can never earn "authoritative" on domain class alone.
   *  Defaults to false so every persisted pre-P0-1 draft deserializes clean and honestly surfaces "Needs a source" until regenerated. */
  verified: z.boolean().default(false),
  /** W5 P0-1, ISO timestamp the generation-time verification confirmed the source. Present only alongside verified === true. */
  verifiedAt: z.string().min(1).max(40).optional(),
  /** W5 stop-ship F2 (2026-07-09): the exact excerpt (a sentence or adjacent pair) on the fetched page that entails this claim - persisted so the operator can see WHAT backed it, not just that something did. Set only
   *  alongside verified === true. */
  supportingExcerpt: z.string().max(600).optional(),
  /** W5 stop-ship F2: the FINAL URL the source-verify fetch actually landed on after redirects (authority is recomputed from this host, not the proposed one). Set only alongside verified === true. */
  finalUrl: z.string().max(500).optional(),
  /** W5 stop-ship F2: sha256(supportingExcerpt) first 16 hex chars - a stable fingerprint of the backing passage. Set only alongside verified === true. */
  contentHash: z.string().max(64).optional(),
  /** Drafter last-mile G5 (2026-07-10): set at GENERATION time when the cited URL is from an authority-strong domain BUT the fetch was refused with a robots/anti-bot status (403 class), so the claim could not be
   *  confirmed by reading the page. `authority` stays "authoritative" (the domain is trusted) while `verified` stays false (we never read it). The draft gate turns this into a `needs_source_check` hold ("I could not
   *  read <domain> myself, check this citation"), NEVER silently ready. Absent or false on every reachable and unreachable source, and reset before any fetch. */
  fetchBlocked: z.boolean().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** One concrete, operator-facing step to execute the Move. */
const OperatorStepSchema = z.string().min(3).max(280);

/** Proof plan attached to a content Move, metrics + windows + control basis. */
const ProofPlanSchema = z.object({
  metrics: z.array(z.string().min(1)).min(1).max(8),
  windowsDays: z.array(z.number().int().positive()).min(1).default([7, 14, 28]),
  controls: z.string().min(1).max(300),
});

/** Fields EVERY structured draft must carry, the trust floor. evidenceRefs is REQUIRED and non-empty: a draft with no grounding is rejected by validation. */
const base = {
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  confidence: ConfidenceSchema,
  risks: z.array(z.string().min(1)).max(8).default([]),
  operatorSteps: z.array(OperatorStepSchema).min(1).max(12),
};

// ── the draft schemas (the Sprint 2 minimum set) ────────────────────────────

/** 1. AnswerBlockDraft, the 80-150 word extractable AEO answer block (J-71: "80-150 words WITH source citations - 40-60 is too thin"). `answer`'s max is widened to 1200 chars (150 words needs ~1050), the 80-150 word
 *  BAND itself is enforced by draft-quality.ts's evaluateDraftQuality, not here; this schema only bounds the shape. `sources` is additive with a `[]` default so every persisted pre-W5 draft still deserializes clean. W5
 *  P2 (2026-07-09): the min is raised to 450 chars (a coarse floor for the 80-word contract) so the drafter cannot cache an obviously-too-thin answer the quality gate would reject; the precise 80-word check is the gate
 *  plus the drafter's own word-count retry (structured-drafter.ts). */
const AnswerBlockDraftSchema = z.object({
  answer: z.string().min(450).max(1200),
  citationHook: z.string().max(200).nullable().default(null),
  /** W5 (J-69): the 1-2 authoritative sources backing this answer's claims. Defaults to [], an empty list is exactly what "no source yet" means; the quality gate (never this schema) decides whether that blocks copy. */
  sources: z.array(SourceRefSchema).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});

/** 2. AtomicEditDraft, one precise field change on an existing page. */
const AtomicEditDraftSchema = z.object({
  field: z.enum(["title", "meta", "h1", "answer_block", "section"]),
  before: z.string().max(2000).nullable().default(null),
  after: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(400),
  /** W5 (J-69): same additive sources list, only meaningful when the edit introduces a NEW factual claim the "before" value didn't already carry (see draft-quality.ts's isFactualClaim); a pure rephrase is never gated. */
  sources: z.array(SourceRefSchema).default([]),
  proofPlan: ProofPlanSchema,
  /** THE EDITOR CONTRACT (decision/drafted-copy): the homework a finished edit shows, additive with defaults so every draft stored before it still deserializes. `claims` is what the copy asserts and the grounding ids that carry it; the deliverable check, never this schema, decides whether an empty one is finished. */
  placementAnchor: z.string().max(400).default(""),
  naturalHeading: z.string().max(160).nullable().default(null),
  claims: z.array(z.object({ text: z.string().min(1).max(400), supportedBy: z.array(z.string().min(1).max(80)).max(8).default([]) })).max(10).default([]),
  implementationMinutes: z.number().int().min(0).max(600).default(0),
  ...base,
});
export type AtomicEditDraft = z.infer<typeof AtomicEditDraftSchema>;

/** 4. ToolAssetSpec, spec for an interactive tool/calculator. */
const ToolAssetSpecSchema = z.object({
  toolName: z.string().min(2).max(80),
  summary: z.string().min(1).max(400),
  inputs: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        type: z.enum(["number", "text", "select", "date", "boolean"]),
      }),
    )
    .min(1)
    .max(12),
  outputs: z.array(z.string().min(1).max(120)).min(1).max(12),
  buildPath: z.enum(["embed", "static_widget", "calculator", "form"]),
  ...base,
});

/** 5. CommerceAssetSpec, what a commerce opportunity should BECOME + the brief. Schema-only here (Sprint 2 doesn't generate these en masse; P8 does). */
const CommerceAssetSpecSchema = z.object({
  assetType: z.enum([
    "product",
    "collection_page",
    "campaign_landing_page",
    "content_product_bundle",
    "lead_magnet",
    "sales_artifact",
    "trust_artifact",
  ]),
  concept: z.string().min(1).max(300),
  whyNow: z.string().min(1).max(300),
  designBrief: z.string().min(1).max(1200),
  seoTitle: z.string().min(10).max(70),
  metaDescription: z.string().min(50).max(170),
  imageAltRules: z.array(z.string().min(1).max(200)).max(8).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});

/** 7. ExperimentPlan, a falsifiable experiment for a Move. */
const ExperimentPlanSchema = z.object({
  hypothesis: z.string().min(1).max(300),
  primaryMetric: z.string().min(1).max(80),
  expectedDirection: z.enum(["up", "down", "neutral_hold"]),
  windowsDays: z.array(z.number().int().positive()).min(1).default([7, 14, 28]),
  controlDescription: z.string().min(1).max(300),
  ...base,
});

/** 9. InternalLinkDraft, a contextual internal link from a source page to a target page. NOT a bare URL pair: the exact anchor + the sentence to drop the link into + why it helps. Self-links and misleading anchors are
 *  rejected by the quality gate. */
const InternalLinkDraftSchema = z.object({
  sourcePage: z.string().min(1).max(400),
  targetPage: z.string().min(1).max(400),
  anchorText: z.string().min(2).max(120),
  linkSentence: z.string().min(10).max(400),
  reason: z.string().min(4).max(400),
  riskNotes: z.array(z.string().min(1).max(200)).max(6).default([]),
  proofPlan: ProofPlanSchema,
  ...base,
});
export type InternalLinkDraft = z.infer<typeof InternalLinkDraftSchema>;

// ── team verdict (FINAL PREMIUM PLAN item 25) ───────────────────────────────── The strategist's one-paragraph synthesis of the specialist debate for a nightly pick. Grounded in the REAL voices (claims carry the
// numbers); the numeric firewall blocks any figure that is not in the grounding. Short, opinionated, operator language.

// ── batch adjudication (BEACON 500 item 12 - the final review) ──────────────── The nightly FINAL REVIEW over the whole plan preview: one bounded call sanity-checks EVERY pick against its own evidence ("does the
// proposed text match what the top search actually asks for?"). Output is per-pick verdicts ONLY - the review can flag a pick with a one-line caution, it can never drop or reorder picks. The concern line is operator
// copy: plain language, <= 140 chars, and it passes the same numeric-fidelity firewall as every draft.

const BatchAdjudicationSchema = z.object({
  picks: z
    .array(
      z.object({
        /** Echoed EXACTLY from the input - a mangled id is dropped by the caller. */
        pickId: z.string().min(1).max(240),
        verdict: z.enum(["looks_right", "concern"]),
        /** Present only when verdict is "concern": one plain sentence, <= 140 chars. */
        concern: z.string().max(140).optional(),
      }),
    )
    .min(1)
    .max(24),
});

// ── strategy review (BEACON 500 item 51 - the weekly reallocation memo) ─────── One Sunday-night LLM pass over the week's settled dossier proposes a lever mix (relative weight per actionFamily) and up to 3
// page-family focus targets for the COMING week, plus a short signed memo explaining the change. The LLM PROPOSES; the caller (apply-mix.ts / run-strategy-review.ts) deterministically CLAMPS every weight to [0.5,
// 2.0], drops any family it does not recognize, and strips dashes. A failure here means no change this week (fail-open to the previous mix) - this schema only bounds the SHAPE, never the trust decision.

const StrategyLeverWeightSchema = z.object({
  family: z.string().min(1).max(40),
  weight: z.number().min(0).max(10),
  reason: z.string().min(1).max(140),
});

const StrategyFocusFamilySchema = z.object({
  family: z.string().min(1).max(60),
  reason: z.string().min(1).max(160),
});

const StrategyReviewSchema = z.object({
  leverMix: z.array(StrategyLeverWeightSchema).min(1).max(12),
  focusFamilies: z.array(StrategyFocusFamilySchema).max(3).default([]),
  /** The signed memo, plain business English, <= 900 chars. */
  memo: z.string().min(20).max(900),
  confidence: ConfidenceSchema,
});

// ── section draft (BEACON 500 item 55 - outline-to-draft pipeline) ─────────── One drafted section of a full-page walk. NOT part of the shared `base` set: a section carries its OWN lightweight sources list (not the
// heavier evidenceRefs/confidence/risks/operatorSteps shape) because it is one small unit in a sequential walk, not a standalone Move draft. `containsNumber` lets the assembler know at a glance which sections carry a
// verified figure.

const SectionSourceSchema = z.object({
  kind: z.enum(["own_data", "competitor_observation", "fanout_question", "keyword"]),
  detail: z.string().min(1).max(300),
});

const SectionDraftSchema = z.object({
  heading: z.string().min(2).max(160),
  body: z.string().min(40).max(1200),
  /** At least one source, a section with zero grounding is rejected by validation. */
  sources: z.array(SectionSourceSchema).min(1).max(6),
  containsNumber: z.boolean(),
});
export type SectionDraft = z.infer<typeof SectionDraftSchema>;

// ── outreach pitch (BEACON_500 item 57 - get-cited/link-reclaim pitches) ───── A cold-outreach email pitch for ONE lead. NOT part of the shared `base` set: an outreach pitch is a short email, not a Move draft, so it
// skips proofPlan and operatorSteps but keeps evidenceRefs (the personalization must be real) and confidence. subject/body length caps keep it a real, sendable email.

const OutreachPitchSchema = z.object({
  subject: z.string().min(4).max(80),
  body: z.string().min(40).max(900),
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  confidence: ConfidenceSchema,
  risks: z.array(z.string().min(1)).max(8).default([]),
});

// ── coverage adjudication (N3b, 2026-07-28) ───────────────────────────────── ONE verdict on whether this account ALREADY has the right page for a topic it researched. The model COMPARES the owned pages the caller
// supplied and picks a verdict; it may not invent a page, a metric, a keyword or a competitor, and it may not write copy: no field here can carry a title, a description, an outline or a proposed address, so a drafted
// page is not representable. `ownedUrls` and `evidenceKeys` are re-checked against the caller's allowlist AFTER validation, so one unknown id refuses the whole call rather than shipping half of it.

const CoverageAdjudicationSchema = z.object({
  verdict: z.enum(["improve_existing", "create_new", "consolidate_or_choose", "do_nothing", "research_needed"]),
  /** Owned addresses the verdict names, echoed EXACTLY from the supplied list. */
  ownedUrls: z.array(z.string().min(1).max(500)).max(8),
  /** Evidence ids the verdict rests on, echoed EXACTLY from the supplied list. */
  evidenceKeys: z.array(z.string().min(1).max(60)).min(1).max(24),
  alternativesRuledOut: z.array(z.object({
    alternative: z.string().min(1).max(160),
    reason: z.string().min(1).max(400),
  })).min(1).max(5),
  /** One plain first-person sentence the operator reads. Never page copy. */
  explanation: z.string().min(20).max(400),
});

// ── new page brief (N4, 2026-07-28) ───────────────────────────────────────── The ONE call a verdict of create_new may make, AFTER the comparison earned it. The model writes the page's words and its section plan; it
// may not decide THAT the page should exist, and no field here can carry a shape or an intent. Every address, question and evidence id is echoed from the caller's lists and re-checked after.

const NewPageBriefSchema = z.object({
  proposedTitle: z.string().min(10).max(120),
  metaDescription: z.string().min(40).max(200),
  /** The answer a searcher gets in the first paragraph, before anything else. */
  openingAnswer: z.string().min(60).max(800),
  /** Evidence ids, copied EXACTLY from the supplied list, that the title, description and opening answer rest on. One generic set stapled on afterwards proved none of them. */
  headKeys: z.array(z.string().min(1).max(40)).min(1).max(8),
  /** Why the pages this account already owns cannot carry this. Must name one of them. */
  whyExistingPagesLose: z.string().min(20).max(500),
  sections: z.array(z.object({
    heading: z.string().min(3).max(120),
    covers: z.string().min(20).max(400),
    /** Evidence ids copied EXACTLY from the supplied list. */
    evidenceKeys: z.array(z.string().min(1).max(40)).min(1).max(8),
  })).min(3).max(8),
  /** What the writer must cite, and what must be checked before this goes live. */
  sourceRequirements: z.array(z.string().min(10).max(240)).max(6),

  factRequirements: z.array(z.string().min(10).max(240)).max(6),
  /** Addresses and questions copied EXACTLY from the supplied OWN PAGES and OBSERVED QUESTIONS lists. */
  internalLinks: z.array(z.object({ url: z.string().min(1).max(300), anchor: z.string().min(2).max(120) })).max(4),
  faqQuestions: z.array(z.string().min(5).max(200)).max(6),
});
export type NewPageBrief = z.infer<typeof NewPageBriefSchema>;

// ── answer analysis (V1 Truth Convergence Phase 1, 2026-07-31) ────────────── What one AI engine's answer to one tracked question ACTUALLY said. The model here is a READER, never an author: every claim carries the
// answer's own wording, every entity and competitor is one the answer named, and no URL, number, ranking or fact may appear that the answer text does not contain. Nothing in this shape is ever published; it is the
// evidence a later decision reads. `position` is an ORDINAL within the answer (1 = named first), never a search rank.
/** A LIST BOUND IS HOW MUCH IS KEPT, NEVER A REASON TO THROW THE READING AWAY. These caps are presentation
 *  limits on enumerations, and `.max()` made every one of them fail-closed: one answer naming 31 entities
 *  instead of 30 failed the WHOLE batch, so five already-paid readings were discarded, left owed, and bought
 *  again on the next pass to fail the same way. Live, that is exactly what stopped the reading on 2026-08-16
 *  and left 891 answers carrying $7.75 unread while the buying continued. Over-length now TRUNCATES, because a
 *  thirty-first entity is a long answer and never an invalid one. Every per-item bound above still holds. */
const capped = <T extends z.ZodTypeAny>(item: T, max: number) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : v), z.array(item));
const AnswerAnalysisSchema = z.object({
  sections: capped(z.object({ heading: z.string().min(1).max(200), covers: z.string().min(1).max(600) }), 12),
  /** Each claim restated in the ANSWER'S OWN WORDING, plus what it is about. */
  claims: capped(z.object({ subject: z.string().min(1).max(160), text: z.string().min(1).max(400) }), 24),
  topicEntities: capped(z.string().min(1).max(120), 30),
  /** Was the account's own brand named, where in the answer, and in what light. */
  ownedBrandMention: z.object({ mentioned: z.boolean(), position: z.number().int().min(1).max(100).nullable(), context: z.string().max(400).nullable() }),
  competitors: capped(z.object({ name: z.string().min(1).max(160), position: z.number().int().min(1).max(100).nullable() }), 20),
  contentTypesRecommended: capped(z.string().min(1).max(80), 12),
  questionsAnswered: capped(z.string().min(1).max(300), 15),
  /** What this answer leaves a reader still not knowing. Named, never invented. */
  materialOmissions: capped(z.string().min(1).max(300), 10),
  caveats: capped(z.string().min(1).max(300), 10),
});
export type AnswerAnalysis = z.infer<typeof AnswerAnalysisSchema>;
// The BATCH read (V1 Closure, 2026-08-01): the SAME reader contract over many answers in ONE call, each entry echoing the observation id it was taken on, copied from the input and never minted. One answer per call
// meant five readings a pass, so one day of 140 answers needed twenty-eight of the eight passes a day runs. `observationId` is echoed exactly as it was given: the observation id alone for an answer that fits one slot,
// and `id#2` for the second PIECE of a long answer, which occupies its own slot and is merged back into one reading by the caller. A cut-off answer used to lose its tail, and everything it said there, forever.
const AnswerAnalysisBatchSchema = z.object({ analyses: z.array(AnswerAnalysisSchema.extend({ observationId: z.string().min(1).max(90) })).max(20) });
export type AnswerAnalysisBatch = z.infer<typeof AnswerAnalysisBatchSchema>;
// ── case synthesis (V1 Truth Convergence Phase 2, 2026-07-31): the SEMANTIC read over the grouping the deterministic pass already made ── The model may only merge, split, link or nest cases the caller supplied, by
// the ids and addresses it was handed. It mints no id and invents no address, number or observation, and REPORTS a conflict in `reason` rather than resolving it. Advisory: one unknown id refuses it all, and the
// registry stands.
const CaseSynthesisSchema = z.object({ merges: z.array(z.object({ keepId: z.string().min(1).max(60), absorbIds: z.array(z.string().min(1).max(60)).min(1).max(4), reason: z.string().min(1).max(300) })).max(6), splits: z.array(z.object({ fromId: z.string().min(1).max(60), moveQueries: z.array(z.string().min(1).max(200)).min(1).max(12), reason: z.string().min(1).max(300) })).max(3), pageLinks: z.array(z.object({ caseId: z.string().min(1).max(60), url: z.string().min(1).max(500), relation: z.enum(["covers", "partially_covers", "does_not_cover"]), reason: z.string().min(1).max(300) })).max(24), parentOf: z.array(z.object({ parentId: z.string().min(1).max(60), childId: z.string().min(1).max(60) })).max(12) });
export type CaseSynthesis = z.infer<typeof CaseSynthesisSchema>;
// ── winning pattern (V1 Truth Convergence Phase 3, 2026-07-31): what the pages that WIN a search have in common ── The model reads bounded FACTS about pages numbered from 0 upward, never their prose. It may cite only
// the numbers it was handed and writes every pattern in its own words. The caller throws the WHOLE reading away on any of five: an eight-word run off a supplied line in ANY field, a heading over five words handed back
// verbatim, a section or thing no cited page carries, a gap with no page of mine supplied, or an `archetype` re-voting the shape.
const SeenOnSchema = z.array(z.number().int().min(0).max(11)).min(1).max(12);
const WinningPatternSchema = z.object({
  archetype: z.enum(["informational_guide", "list", "definition", "comparison", "product", "category", "tool", "forum", "mixed", "unknown"]),
  commonHeadings: z.array(z.object({ heading: z.string().min(1).max(160), seenOn: SeenOnSchema })).max(10), commonEntities: z.array(z.object({ entity: z.string().min(1).max(120), seenOn: SeenOnSchema })).max(15),
  questionsAnswered: z.array(z.string().min(1).max(300)).max(10), openingPattern: z.string().max(300), disagreements: z.array(z.string().min(1).max(300)).max(5),
  ownedGaps: z.array(z.object({ gap: z.string().min(1).max(300), seenOn: SeenOnSchema })).max(8), uniqueNotCommon: z.array(z.object({ detail: z.string().min(1).max(300), seenOn: SeenOnSchema })).max(5),
});
export type WinningPatternRead = z.infer<typeof WinningPatternSchema>;
// ── page job (2026-08-11): what ONE owned page is FOR, in a sentence ──────── Read off that page's own stored extract: its address, its title, its heading, its section headings, its length, and its opening words when
// they are held. The model is a READER here, exactly as answer_analysis is: it names the page's purpose and its shape, it writes no copy, it proposes no change, and it may not name a subject the extract does not
// carry. `topics` are the plain subject words the page is about, lowercased, and they are what a later fit check compares a search against, so an invented topic is how a section card lands on the wrong page. A missing
// job is never a verdict about the page: it means the job is not known yet.
const PageJobSchema = z.object({
  /** One plain sentence, what this page is for. Never a recommendation. */
  job: z.string().min(10).max(200),
  pageType: z.enum(["guide", "list", "product", "category", "city", "entity", "translation", "hub", "home", "other"]),
  /** Who the page is written for, in the words a person would use. */
  audience: z.string().min(3).max(120),
  topics: z.array(z.string().min(2).max(40)).min(3).max(8),
  /** True when the page exists to sell something, false when it exists to explain something. */
  commercial: z.boolean(),
});
export type PageJob = z.infer<typeof PageJobSchema>;

// ── registry: kind → schema (the structured-drafter dispatches on this) ──────

export type StructuredDraftKind =
  | "aeo_gap"
  | "answer_block"
  | "atomic_edit"
  | "editor_judgement"
  | "tool_asset"
  | "commerce_asset"
  | "internal_link"
  | "experiment_plan"
  | "batch_adjudication"
  | "strategy_review"
  | "section_draft"
  | "outreach_pitch"
  | "coverage_adjudication" | "new_page_brief" | "answer_analysis" | "answer_analysis_batch" | "case_synthesis" | "winning_pattern" | "page_job"
  | "business_profile_inference" | "business_profile_patch" | "prompt_candidates"
  | "fact_claim_extraction" | "fact_claim_judgement" | "factual_review";

/** THE EDITOR'S JUDGE (decision/drafted-copy): the seven rulings a finished edit survives, the one sentence that decided it, and the TYPED RESOLUTION a refusal owes ("none" on a pass): the smallest correct next step, so the runtime executes data instead of parsing the sentence. Every field is owed, so a body missing one is a refusal rather than a pass. MIRRORED with drafted-copy's JudgeVerdict. */
/** `claims` REPLACES a coarse `claimsEntailed` boolean: the editor is already handed every claim with the exact evidence ids it cites and the stored words behind each, and answered yes or no about all of them at once, so the only answer the store may trust was thrown away and substantive work could never earn the receipt the factual family earns. One ruling per claim, in the canonical shape ChangeProposal.semanticReview persists. */
const EditorJudgementSchema = z.object({ pageFit: z.boolean(), usefulAndNatural: z.boolean(), placementCorrect: z.boolean(),
  claims: z.array(z.object({ i: z.number().int().min(0), by: z.array(z.string()), entailed: z.boolean() })).max(24),
  implementableNow: z.boolean(), improvesPage: z.boolean(), wouldHandToCustomer: z.boolean(), notes: z.string().min(1).max(300),
  resolution: z.enum(["none", "structural_synthesis", "use_stored_verified_evidence", "acquire_serp", "acquire_page_source", "acquire_competitor_page", "acquire_factual_source", "no_valid_treatment"]) });

/** THE CLAIMS A PAGE MAKES, and ONE OF THEM JUDGED against passages actually fetched. Their own schemas because Structured Outputs returns the schema it is given: asking `editor_judgement` for a claim list returns an editor's verdict on one finished edit and reads zero statements forever (Codex, 2026-08-18). */
const FactClaimExtractionSchema = z.object({ statements: z.array(z.object({ subject: z.string().min(1).max(200), current: z.string().min(1).max(600), locator: z.string().max(200) })).max(40) });
const FactClaimJudgementSchema = z.object({
  verdict: z.enum(["page_correct", "page_wrong", "page_imprecise", "undecidable"]), confidence: z.enum(["confirmed", "likely", "disputed", "unsupported"]),
  proposed: z.string().max(600), literal: z.string().max(400), usage: z.string().max(400), note: z.string().max(400),
  supporting: z.array(z.object({ url: z.string().max(400), quote: z.string().max(600) })).max(6), // one quote per source: independent publishers never carry the identical sentence
  // WHOSE NAME IS THIS PASSAGE ABOUT. A quote that exists in an authoritative source proves the source said it,
  // never that it said it about the SAME subject: Wikipedia's "Daria (given name)" is an encyclopedia, is
  // quotable, and even lists "Darya" among its variants, so it authorized a Slavic name from Darius as the
  // meaning of Persian دریا, which is sea. The reader now has to name the subject it actually read, per source,
  // and the code below checks the part of that answer it can check for itself.
  subjects: z.array(z.object({ url: z.string().max(400), sameEntity: z.boolean(),
    language: z.string().max(60), script: z.string().max(120).nullable(), why: z.string().max(300) })).max(6) });

/** BEACON'S OWN SENSE REVIEW of a batch of sourced corrections (decision/producers/factual-defects): one ruling per component by index, so one defective replacement never holds the valid ones hostage and the operator never does Beacon's checking (2026-08-22). */
const FactualReviewSchema = z.object({ rulings: z.array(z.object({
  index: z.number().int().min(0), publish: z.boolean(), reason: z.string().min(1).max(240),
  /** ONE ENTAILMENT RULING PER CLAIM, naming the exact fact ids weighed. The review answered one publish boolean and its claim-level reasoning was thrown away, so nothing ever recorded whether the cited passage SUPPORTS the claim: "Noor means light" could stand on a fact reading "Tehran is the capital of Iran" (Codex, 2026-08-28). `publish` is derived in code from these, never taken from the model. */
  claims: z.array(z.object({ claim: z.number().int().min(0), factIds: z.array(z.string().min(1)),
    /** IS THE PASSAGE ABOUT THE SAME THING IN THE SAME RELATIONSHIP the page's statement is about. Entailment alone
     *  cannot see this: "Afshin is a hereditary title of Oshrusana princes" entails "Afshin means a hereditary
     *  title" word for word, while the page field is a GIVEN NAME'S MEANING and the source is a biography of a man
     *  who bore the title. Same spelling, different role, and only the source COUNT stood in the way. */
    sameSubjectAndRole: z.boolean(),
    entailed: z.boolean(), why: z.string().min(1).max(200) })).min(1).max(12) })).min(1).max(12) });

/** THE AEO GAP READER'S ANSWER: a closed diagnosis vocabulary and only ids the packet supplied. A reader, never a writer. */
const AeoGapSchema = z.object({ kind: z.enum(["already_answered", "scattered_answer", "missing_information", "extraction_or_structure_gap", "authority_or_source_gap", "freshness_gap", "reachability_gap", "unknown"]),
  ownedIds: z.array(z.string().max(16)).max(12).default([]), evidenceIds: z.array(z.string().max(16)).max(12).default([]),
  missing: z.string().max(400).default(""), explanation: z.string().min(1).max(300) });

export const SCHEMA_BY_KIND = {
  aeo_gap: AeoGapSchema,
  editor_judgement: EditorJudgementSchema,
  fact_claim_extraction: FactClaimExtractionSchema,
  fact_claim_judgement: FactClaimJudgementSchema,
  factual_review: FactualReviewSchema,
  answer_block: AnswerBlockDraftSchema, atomic_edit: AtomicEditDraftSchema, tool_asset: ToolAssetSpecSchema,
  commerce_asset: CommerceAssetSpecSchema, internal_link: InternalLinkDraftSchema, experiment_plan: ExperimentPlanSchema,
  batch_adjudication: BatchAdjudicationSchema, strategy_review: StrategyReviewSchema, section_draft: SectionDraftSchema,
  outreach_pitch: OutreachPitchSchema, coverage_adjudication: CoverageAdjudicationSchema, new_page_brief: NewPageBriefSchema,
  answer_analysis: AnswerAnalysisSchema, answer_analysis_batch: AnswerAnalysisBatchSchema, case_synthesis: CaseSynthesisSchema, winning_pattern: WinningPatternSchema,
  page_job: PageJobSchema,
  business_profile_inference: BusinessProfileInferenceSchema,
  business_profile_patch: BusinessProfilePatchSchema,
  prompt_candidates: PromptCandidatesSchema,
} as const satisfies Record<StructuredDraftKind, z.ZodTypeAny>;

// ── the FULL output-shape registry ─────────────────────────────────────────── Every structured LLM output shape used ANYWHERE in the product, including the shapes whose production parsers are hand-rolled and pinned
// (judge, strategist, critic, SERP hypothesis). The gateway dispatches on SCHEMA_BY_KIND above (validate -> retry once -> fail closed); the extra entries below are the contract each hand-rolled parser must keep
// producing.

/** Every CUSTOMER-FACING PROSE string in a parsed draft, flattened - fed to the content firewalls (numeric-fidelity / placeholder / em-dash / superlative) at the ONE call site that runs them, generation time in
 *  structured-drafter.ts's `callStructuredLLM` (there is no second, later re-scan - this helper's scope IS the firewall's scope, so a key skipped here is skipped everywhere). Three kinds of field are deliberately
 *  EXCLUDED because they are not prose an operator ever pastes onto their site: - `sources`: machine-emitted citation METADATA (retrievedAt, url, finalUrl, contentHash, domain, claim) - re-stamped by
 *  source-authority.ts and verified against the real fetched page by the drafter's source- verification step. Scanning it made the firewall reject a whole draft for the digits of a citation's own retrievedAt date
 *  ("2026-07-11" -> "07,11") that the product's own prompt told the model to emit. - `proofPlan`: the MEASUREMENT METHODOLOGY the product's own prompt asks the model to write ("measure clicks over a 7/14/28-day window,
 *  target a stated lift") - an aspirational target/method description, not a factual claim about the world that needs grounding. Pilot loop 6 (2026-07-11) found BOTH live attempt-1s dying on the model's own
 *  `proofPlan.metrics` text ("target 100%") - a false reject of a field the product itself instructed the model to fill in, not an invented customer-facing fact. - `operatorSteps` / `risks`: procedural implementation
 *  instructions and internal caution notes addressed TO the operator ("Add this answer block directly under the H1", "keep claims neutral") - never copy the operator publishes verbatim. `evidenceRefs.detail` stays
 *  SCANNED on purpose (unchanged): it is the model's own description of REAL grounding data (a GSC/GA4/Clarity/DataForSEO/ ... signal Beacon already retrieved) - an invented number there means the model fabricated its
 *  OWN evidence, exactly the case this firewall exists to catch, not methodology the product asked it to write. The grounded-number ledger is unchanged, so a fabricated number IN PROSE - including one that also happens
 *  to appear inside the now-excluded proofPlan/ operatorSteps/risks text - still fails: those fields are never added to the ledger, so they can never launder an invented prose number as "grounded". */
export function draftProseStringValues(value: unknown): string[] {
  // Non-prose methodology/procedural keys, skipped at every object level (see the doc comment above for the one-line reason each is excluded). `ownedUrls` and `evidenceKeys` are IDENTIFIERS echoed back from an
  // allowlist, not prose the model wrote. Scanning them meant a real customer address containing the word "best" tripped the superlative firewall and killed the verdict on every pass, forever, at two paid calls a
  // time. A page address cannot make a claim. A case synthesis carries ids, addresses and the operator's own search phrases, all echoed from a supplied list: a page whose address says "best" makes no claim, so it can
  // never kill the reading. Its `reason` stays scanned.
  const NON_PROSE_KEYS = new Set(["sources", "proofPlan", "operatorSteps", "risks", "ownedUrls", "evidenceKeys", "keepId", "absorbIds", "fromId", "caseId", "url", "parentId", "childId", "moveQueries", "observationId"]);
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (NON_PROSE_KEYS.has(k)) continue;
        walk(val);
      }
    }
  };
  walk(value);
  return out;
}

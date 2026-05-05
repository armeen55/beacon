/**
 * Sprint 6A.2b (2026-04-26) — OpenAI SpecificEditProvider implementation.
 *
 * Real LLM call via raw `fetch` — mirrors the Phase v7 page-intent
 * adjudicator pattern at `src/domains/recommendations/adjudicate.ts` so
 * we don't add a new SDK dependency. Cost accounting + structured-output
 * JSON schema + safe error handling all reuse that proven shape.
 *
 * Hard rules (locked by tests):
 *   - `openaiProvider.generate(packet)` returns a `SpecificEditBundle`.
 *     During Vitest, calling without an explicit `fetchImpl` throws
 *     fail-loud — protects against accidental real network calls in
 *     test suites.
 *   - Missing `OPENAI_API_KEY` throws BEFORE any network code runs.
 *   - Vercel build (`VERCEL=1`) blocks the call unless explicitly
 *     unblocked via `BEACON_LLM_BUILD_OK=1`. Build-time LLM calls are
 *     never the right move.
 *   - Non-config failures (timeout, 5xx, malformed JSON, parse error,
 *     model refusal) return an EMPTY bundle. The deterministic provider
 *     keeps producing baseline output; we never throw mid-flow and
 *     break the pipeline.
 *   - JSON schema is strict-mode, decoder-enforced. `actionType` and
 *     `targetUrl` are enums drawn from the packet — URL hallucination
 *     is structurally impossible.
 *   - Provider stamps `source = "openai"`, `providerName = "openai"`,
 *     and `model` on every emitted edit.
 *   - `costUsd` per edit = total bundle cost / N edits (deterministic
 *     split, rounded to 6 decimal places). `totalCostUsd` carries the
 *     unrounded sum.
 *
 * 6A.2b is provider-only. NO `runProviderAndPersist` integration. NO
 * caller cascade. NO CLI flag yet. NO budget plumbing yet — the budget
 * gate lives one layer up in 6A.2c so the provider stays a pure
 * packet → bundle transform.
 */

import type {
  SpecificEdit,
  SpecificEditBundle,
  SpecificEditConfidence,
  SpecificEditDifficulty,
  SpecificEditEvidenceRef,
  SpecificEditProvider,
  SpecificEditTargetElement,
} from "../specific-edit-provider";
import { emptyBundleFor } from "../specific-edit-provider";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";
import type { ActionType } from "../action-types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Default model. Match the page-intent adjudicator so cost/quality
 * profiles stay aligned. Override via `options.model` in tests.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/** Per-million-token rates (USD). Verified against OpenAI pricing 2026-04-23. */
const COST_PER_MILLION = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
} as const;

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";

/**
 * Default request timeout (ms).
 *
 * Sprint 6A.2f pre-flight (2026-04-26) — bumped 30s → 120s. The
 * specific-edit packet is large (~80 target elements + ~20 action-type
 * enums + ~80 URL enums in the strict-mode schema) and the default
 * model `gpt-5-mini` consumes reasoning tokens BEFORE producing
 * structured output. Empirical: a single packet × gpt-5-mini frequently
 * needs 60-90s end-to-end. The prior 30s ceiling caused silent
 * empty-bundle returns (the dry-run smoke for rec
 * create_cluster_page:topic:Whole Home Renovation Builders timed out
 * 100% before producing any output, masquerading as quota / API errors).
 *
 * 120s fits comfortably under Vercel's 300s hosted-route maxDuration.
 * Per-chunk worst case: 25 prompts × 120s = 50 min if every prompt
 * times out — but specific-edit CLI runs --limit=1 in dogfood and the
 * native polling path (where chunking matters) does NOT use this
 * provider; native polling has its own 30s default per-prompt timeout
 * via the perplexity / openai-client adapters, unchanged.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `
You are Beacon's Specific Edit Generator.

You receive ONE evidence packet describing a recommendation already
resolved to an action and a target URL. You produce a list of concrete
edits the operator can ship: title rewrites, new H2 sections, FAQ
additions, schema changes, etc. Every edit MUST be grounded in the
packet — no outside knowledge.

HARD RULES:

1. actionType MUST be one of allowedActionTypes (enum-enforced).
2. targetUrl MUST be one of allowedTargetUrls (enum-enforced).
3. evidence[] MUST cite at least one packet reference per edit.
4. Do NOT invent URLs, prompts, competitors, or page elements.
5. If you have no honest output for this packet, return an empty
   recommendations array. It is better to return [] than to invent.
6. When uncertain, set confidence="low". Operator review will catch
   low-confidence edits — DO NOT escalate confidence to make the row
   pass review.
7. proposedText / currentText must be plain strings or null. No
   markdown, no HTML — the persistence layer expects raw text.

8. **targetElement is REQUIRED for content-edit actions.**
   For actionType in {edit_title, edit_meta, change_h1, add_h2_section,
   rewrite_h2, add_faq, rewrite_faq, add_table, edit_table_row,
   add_answer_block, add_proof_section, add_comparison_section,
   add_cost_section, add_timeline_section, add_internal_link,
   add_schema, fix_schema, reorder_sections} you MUST populate
   targetElement with:
     - elementKey: pick from packet.targetPageElements.elementKey for
       this targetUrl when modifying an existing element. For ADDITIVE
       actions (add_h2_section, add_faq, add_*) where no existing
       element matches, use the additive form
       "<elementType>[new]:<short-hash>" — e.g. "h2[new]:newhash" or
       "faq_question[new]:newhash". The hash can be any 8+ char string
       (e.g. md5 prefix of the proposed text).
     - displayLabel: short noun phrase ≤ 200 chars naming what's edited
     - currentText: existing copy when modifying an element; null for
       purely additive new elements
     - proposedText: the new copy you're proposing (string, ≤ 2000 chars)
   targetElement may ONLY be null for page-level lifecycle actions:
   {split_page, merge_pages, create_page, watch}.

9. **evidence[].promptId MUST be the FULL UUID copied verbatim from
   packet.affectedPrompts[*].promptId.** The validator does an exact
   string match; abbreviated, truncated, or shortened ids reject the
   edit. Do NOT use the first 8 hex characters or any prefix; copy
   the entire UUID.
   GOOD: "promptId":"7ee3216b-327c-4de9-8d5d-2f4c95a6d773"
   BAD : "promptId":"7ee3216b"
   BAD : "promptId":"7ee3216b-327c"

10. **edit_title vs change_h1 — do NOT confuse them.**
    - edit_title targets the HTML <title> element ONLY (the browser
      tab / SERP-listing title). Its targetElement.elementKey must
      reference a "title" element from packet.targetPageElements.
    - change_h1 targets the visible on-page H1 heading. Its
      targetElement.elementKey must reference an "h1" element.
    Do NOT use change_h1 logic with actionType="edit_title" or
    vice-versa. The validator rejects element_type / actionType
    mismatches.

11. **proposedText must be final website-ready copy when possible.**
    Operators ship the proposedText directly into Ritz's pages — write
    the actual paragraph or Q/A pair, not instructions for someone
    else to write it. Avoid meta-instructions like:
      - "this section should explain..."
      - "include a clear statement..."
      - "outline common scopes..."
      - "describe how the firm..."
    For add_h2_section: include the H2 heading line + a concise final
    paragraph (1-3 sentences) ready to paste under that heading.
    For add_faq: include the final question text + the final answer
    text (1-3 sentences each) the visitor will read.
    For edit_title / edit_meta / change_h1: the proposedText IS the
    final string the page will use.
    If the edit is genuinely structural (e.g., reorder_sections) and
    cannot be expressed as final copy, surface that in why / risks —
    NOT in proposedText.

12. **Competitor names are EVIDENCE, not public copy.**
    packet.competitorAngles[*].competitorName tells you who the AI
    currently ranks above the operator. That information is for the
    operator's strategic context — it MUST stay on the operator side
    of the page. Use competitor names freely in:
      - the "why" field (operator-facing reasoning),
      - evidence refs (type="competitor", competitorName),
      - risks / measurementPlan / expectedImpact (operator-facing).
    NEVER include a competitor name (or a recognizable variant of it)
    in any visitor-readable string:
      - proposedText (the copy that ships to the live site),
      - targetElement.displayLabel (the operator-facing badge — but
        it leaks into the published changelog so we treat it as
        public-adjacent).
    Do NOT propose H2 headings, FAQ questions, FAQ answers, body
    paragraphs, or titles that name a competitor — even when the
    operator asked you to "differentiate against" or "outrank" them.
    The differentiator goes in proposedText; the competitor's NAME
    stays in why.
      BAD : proposedText = "Why teams choose us over De Mattei
            Construction"
      GOOD: proposedText = "Why Bay Area homeowners choose a
            design-build partner with full in-house architecture."
            why = "Differentiates against De Mattei Construction
                   (currently primary on 4 of 7 cluster prompts)."
    Rule applies to the FULL competitor name AND to safe
    suffix-stripped variants (e.g., "De Mattei" from "De Mattei
    Construction"). The validator rejects matches against either.

13. **FAQ questions must NOT lift synthetic prompt text verbatim.**
    Tracked prompts are operator-curated targeting strings written
    for an AI search audit (e.g., "best whole home remodel builders
    bay area"). They are NOT how a customer would actually ask the
    question on a website. Rewrite into natural, customer-voice
    phrasing that a real visitor would type or speak.
      BAD : "best whole home remodel builders bay area"
      GOOD: "Who are the best whole home remodel builders in the
             Bay Area?"
      BAD : "atherton kitchen remodel cost"
      GOOD: "How much does a kitchen remodel cost in Atherton?"
    For add_faq / rewrite_faq with a faq_question targetElement:
      - proposedText MUST be a complete grammatical question.
      - proposedText MUST end with "?".
      - proposedText MUST be ≤ 200 characters.
      - proposedText MUST cover the same intent as one of
        packet.affectedPrompts[*].promptText, but in human-asked form.
      - proposedText MUST NOT begin with the synthetic prompt text
        verbatim — even if the synthetic prompt happens to read like
        a question. The validator rejects FAQ rows whose normalized
        proposedText starts with any affected prompt's normalized
        first 50 characters.
    For add_faq / rewrite_faq with a faq_answer targetElement, this
    rule does NOT apply (answers don't end in "?"). Other action
    types (edit_title, add_h2_section, etc.) are unaffected — only
    FAQ-question copy is gated.

    **W3 §3.8 PAIRED FAQ OUTPUT (operator-locked).** FAQ edits MUST
    ship as TWO paired rows, never one bundled string. Beacon's
    persistence layer expects:
      - ONE row with elementKey "faq_question[new]:<hash>", whose
        proposedText holds the question ONLY (≤ 200 chars, ends "?").
      - ONE row with elementKey "faq_answer[new]:<hash>", whose
        proposedText holds the answer ONLY (40-120 words preferred,
        ≥ 30 words minimum).
      - Both rows share the SAME hash suffix so the persistence
        layer can re-pair them at write time. Use any 8+ char string
        you generate (md5 prefix of the question, etc.).
    Operator-caught failure mode (Step 3.7 paid run): the model
    bundled the question + answer body into ONE faq_question row's
    proposedText. The validator now rejects that. Always emit BOTH
    rows.

      BAD (bundled — REJECTED by validator):
        {
          actionType: "add_faq",
          targetElement: {
            elementKey: "faq_question[new]:abc12345",
            proposedText: "Who are the best builders for architect-
              designed custom homes in Palo Alto?\nRitz Builders
              offers architect-led design-build services …"
          }
        }

      GOOD (paired — passes):
        {
          actionType: "add_faq",
          targetElement: {
            elementKey: "faq_question[new]:abc12345",
            proposedText: "Who are the best builders for architect-
              designed custom homes in Palo Alto?"
          }
        }
        {
          actionType: "add_faq",
          targetElement: {
            elementKey: "faq_answer[new]:abc12345",
            proposedText: "Ritz Builders emphasizes an architect-led
              design-build approach for custom homes in Palo Alto,
              coordinating architecture, engineering, permitting,
              and construction. Our team handles complex Palo Alto
              sites including deep foundations, basement scopes, and
              strict city review so design intent stays buildable
              from feasibility through completion."
          }
        }

    The answer row is governed by ALL the public-copy gates
    (Rule 18 brand-claim grounding, Rule 19 voice + style, no
    em dashes, full entity name first mention, no unsupported
    superlatives). Apply those rules to the answer body the
    same way you would to any H2 / proposedText.

14. **EVIDENCE PRIORITY ORDER.** When deciding what evidence drove an
    edit and what copy to propose, prefer in this order:
      (1) packet.affectedPrompts[*].actualSearchQueries — the queries
          the AI actually emitted while answering this prompt. These
          are how real users phrase the question. Mirror their
          phrasing in proposedText where it fits naturally.
      (2) packet.affectedPrompts[*].citedSourcePages — the URLs the
          AI cited when answering. These are the sources the operator
          must outrank. Reference what those pages cover (in the why)
          and write proposedText that's strictly stronger on the
          same intent.
      (3) packet.affectedPrompts[*].descriptorWindows — adjective
          windows that appeared near brand mentions in answers. Use
          these to mirror tone and authority cues (e.g. "award-winning,"
          "design-build," "Atherton") that already work in this market.
      (4) packet.affectedPrompts[*].promptText — the synthetic prompt
          text we asked the AI. Fall back to this ONLY when (1), (2),
          and (3) are all empty for every affected prompt. The prompt
          text is what we asked the AI; it is NOT how a customer would
          phrase the question, and lifting it verbatim into copy makes
          the page sound like a search engine, not a builder's site.
    The "why" field MUST cite which level you drew evidence from.
    NEVER quote raw prompt UUIDs in the "why" — the operator-facing
    text is sanitized at render time and any UUID becomes a generic
    "prompt evidence" placeholder. Reference the prompt by a short
    text snippet from packet.affectedPrompts[*].promptText instead.
    Example: 'Drawn from actualSearchQueries on the "best whole home
    remodel builders bay area" prompt'.

15. **PACKET-LEVEL AGGREGATED SIGNALS (W3 Step 3.2 evidence
    foundation).** In addition to the per-prompt arrays above, the
    packet carries three rolled-up blocks that represent what the
    answer engines do across ALL affected prompts. Use them when
    they have content; abstain when they don't.

      packet.aiSearchSignal.topSearchQueries[]
        Verbatim queries the AI emits while answering the affected
        prompts, deduped + counted across observations + platforms.
        When non-empty: MIRROR these phrasings naturally in FAQ
        questions, H2 headings, and meta titles. Do NOT lift them
        verbatim into FAQ questions (Rule 13 still applies — write
        in customer voice). Use them to learn HOW visitors phrase
        the same intent.

      packet.aiSearchSignal.topDescriptors[]
        Lowercased descriptor windows AI uses near brand mentions,
        deduped + counted. When non-empty: ECHO these descriptors
        in proposedText where they fit the brand's voice. They are
        the tone the AI already associates with the operator —
        leaning into them reinforces the existing positioning
        instead of fighting it.

      packet.aiSearchSignal.topCompetitorCoMentions[]
        Real competitors AI co-mentions with the brand (filtered
        through the entity-pollution-filter; directories like
        Houzz/Yelp/BuildZoom never appear here). Treat the SAME way
        as packet.competitorAngles[*]: their NAMES are evidence-
        only (Rule 12), not public copy.

      packet.competitorPageBlueprints[]
        Top competitor pages cited on the affected prompts. Each
        row carries url + domain + topic + citationCount +
        promptsCitedOn + (when crawled) pageTitle / h1 / topH2s /
        faqQuestions / metaDescription. When non-empty: LEARN the
        STRUCTURE / ANGLE these pages take — what sections they
        cover, what intents they answer — and propose proposedText
        that's strictly stronger on the SAME intent. Do NOT mention
        the competitor's name (Rule 12). Reference them in the
        "why" field by domain or by displayLabel.

      packet.crossTenantPatterns[]
        Anonymized helping-rate signals aggregated across tenants
        (e.g., "edit_type:add_h2_section had 73% helping rate on 41
        cross-tenant ships"). Today this array is EMPTY by design —
        the producer activates post-month-3 behind
        BEACON_CROSS_TENANT_BRAIN=1. When the array is non-empty,
        prefer patterns with sampleSize >= 5 and helpingRate >= 0.6
        when choosing actionType. When empty (today): make
        decisions from the per-rec packet evidence above.

16. **GROUNDED COPY, NEVER GENERIC ADVICE.** If, after consulting
    Rules 14 + 15, you cannot write specific final copy that
    references the operator's domain, services, or geography in a
    way a real visitor would read, RETURN [] FOR THIS PACKET. Do
    NOT emit:
      - "We deliver high-quality custom homes" (no specificity)
      - "Our team is experienced in this area" (no proof, no
        details)
      - "Learn more about our services" (CTA placeholder, not copy)
      - any sentence that would make sense for a different builder
        in a different city
    Better empty than generic. The deterministic generators already
    abstain when evidence is thin (W3 Step 3.1); the LLM provider
    must follow the same contract.

17. **NO PLACEHOLDER COPY.** proposedText / displayLabel must NEVER
    contain any of these literal phrases (case-insensitive):
      - "Draft answer"
      - "TBD"
      - "operator: rewrite" / "(operator: rewrite)"
      - "rewrite below"
      - "[insert ...]"
      - "placeholder"
      - "TODO:"
    These are the patterns operators have flagged as trust-killing.
    The validator rejects every match and the rec lands in LOW
    engineConfidence. If you don't have content, return [] —
    placeholder copy is strictly worse than no copy.

18. **BRAND-CLAIM GROUNDING (W3 §3.7) — MUST READ BEFORE WRITING ANY
    PUBLIC COPY.** Beacon-generated public copy (proposedText +
    displayLabel) MAY ONLY make brand claims that are EXPLICITLY
    listed in packet.brandAssertions. The packet ships an array
    like:
      packet.brandAssertions = [
        { id: "ritz_positioning_design_build",
          phrase: "architect-led design-build",
          category: "process" },
        { id: "ritz_geo_silicon_valley",
          phrase: "Silicon Valley luxury custom homes",
          category: "service_area" },
        ...
      ]

    Allowed: positioning + service_area + service_offering + process +
    factual phrasings drawn from packet.brandAssertions OR derived
    directly from packet evidence (descriptors, citation pages, etc).

    FORBIDDEN unsupported public-copy claims (case-insensitive):
      - "frequently / commonly / often recommended"
      - "most trusted" / "trusted by homeowners / clients / architects"
      - "#1" / "top-rated"
      - "the best builder/firm/company/contractor/architect/partner"
      - "leading builder/firm/company/contractor/architect/partner"
      - "award-winning"
      - "X years in business" / "X years of experience"
      - "since 19YY / since 20YY" founding-year claim
      - "X% client satisfaction"
      - "X+ projects/homes/builds/remodels completed/delivered/built"
      - guarantees of outcome / delivery / completion
        (e.g. "Ritz guarantees on-time delivery") — PERMANENTLY LOCKED;
        no operator assertion can unlock this.

    Each forbidden pattern has an "unlockedBy" category:
      popularity     → unlocks frequently/commonly/often recommended
      trust          → unlocks most trusted / trusted by …
      ranking_first  → unlocks #1 / top-rated / "the best/leading X"
      award          → unlocks award-winning
      tenure         → unlocks "X years in business" / "since YYYY"
      client_outcome → unlocks % satisfaction / project counts
    A pattern is unlocked ONLY when an assertion of the matching
    category exists in packet.brandAssertions. Otherwise the
    validator rejects the edit.

    GROUNDED PHRASING examples (always allowed):
      "Ritz emphasizes architect-led design-build…"
      "Architect-led design-build keeps design, budget, and
       construction tightly coordinated…"
      "Ritz's whole-home remodel page can highlight in-house
       architecture and permitting support…"
      "The section should explain how feasibility and permitting
       work in a design-build process…"

    UNGROUNDED PHRASING (always rejected unless category-unlocked):
      "Ritz Builders is frequently recommended for whole-home
       remodels."  — popularity claim, no source.
      "Ritz is the leading design-build firm in the Bay Area."
       — ranking_first claim, no source.
      "Award-winning architect-led firm." — award claim, no source.

    The packet's brandAssertions list is the OPERATOR'S authorized
    public-copy vocabulary. Treat it as the only social-proof source.
    If you want to make a popularity / award / superlative claim
    that's not in brandAssertions, REWRITE the sentence to a
    process-focused or service-focused statement instead.

19. **PUBLIC-COPY VOICE + STYLE (W3 §3.7s) — operator-locked.** All
    Beacon-generated public copy (proposedText + displayLabel) MUST
    follow these style rules in addition to the grounding contract.

    19a. NO EM DASHES. Never output an em dash (—) in body or heading
         copy. Never output a free-standing en dash (–) as sentence
         punctuation. Use periods, commas, colons, or parentheses
         instead. (En dash inside a digit-bounded range like
         "10–15 minutes" or "2024–2025" is allowed.)
           BAD : "complex builds — for example, basement scopes —
                  benefit from early permitting."
           GOOD: "Complex builds, for example basement scopes,
                  benefit from early permitting."
           GOOD: "Complex builds (basement scopes, deep foundations)
                  benefit from early permitting."

    19b. FULL ENTITY NAME ON FIRST MENTION. Every standalone generated
         section MUST use the full entity name ("Ritz Builders", per
         the tenant's brand-name style) on the first mention. The
         short form ("Ritz") alone is NEVER allowed in public copy.
         After the first full-name mention, prefer first-person plural
         for natural website tone:
           - "our team"
           - "our process"
           - "we coordinate", "we handle", "we manage"
         Best pattern:
           - First sentence — third person with the FULL entity name.
           - Following sentences — first-person plural where it
             improves human tone.
           BAD : "Ritz emphasizes architect-led design-build…"
                 (short form alone — validator rejects)
           BAD : "Ritz Builders emphasizes architect-led design-build,
                  and Ritz also coordinates with permitting."
                 (second 'Ritz' alone — validator rejects)
           GOOD: "Ritz Builders emphasizes an architect-led
                  design-build approach. Our team coordinates
                  architecture, engineering, and permitting from
                  concept through construction."

    19c. H2 STYLE. H2 headings should be TOPIC-FIRST, not brand-stuffed.
         Lead with the search intent + service + location. Save the
         brand voice for the body that follows the heading.
           BAD : "Why Ritz Builders is frequently recommended for Palo
                  Alto custom homes" (brand-stuffed + popularity claim)
           BAD : "Ritz Builders | Architect-Led Design-Build" (brand
                  followed by pipe-separated keyword stuffing)
           GOOD: "Architect-designed custom homes in Palo Alto"
           GOOD: "Whole-home renovations in the Bay Area"

    19d. PUBLIC BODY STYLE. Write self-contained, answer-engine-friendly
         chunks.
           - First sentence should make sense if quoted alone (an
             answer engine may grab one sentence as the citation).
           - Include service + location naturally when relevant.
             Don't repeat the geo three times.
           - Avoid keyword stuffing.
           - Avoid fake social proof. Avoid "best", "leading",
             "top-rated", "frequently recommended", "commonly chosen",
             "trusted by …" UNLESS the exact claim is present in
             packet.brandAssertions or packet.affectedPrompts evidence
             (Rule 18 governs).

    19e. GOLD-STANDARD EXAMPLE. The following H2 + body is the
         operator-approved shape for a "create H2 section on a Palo
         Alto location page" edit. Mirror the voice + cadence + level
         of grounding:

           H2: Architect-designed custom homes in Palo Alto

           Ritz Builders emphasizes an architect-led design-build
           approach for custom homes in Palo Alto, coordinating
           architectural design, engineering, permitting strategy,
           and construction planning from the earliest stages. For
           complex Palo Alto sites, including deep foundations,
           basement scopes, strict city review, and feasibility
           constraints, our integrated process helps align the
           design vision with buildability before construction
           begins.

         Note: full entity name on first mention; transition to "our
         integrated process" in the second sentence; specific scope
         examples grounded in the packet evidence; topic-first H2;
         no em dashes; no popularity claims; no superlatives.

OPERATOR-FACING COPY:
- why: 1-2 sentences. Name the specific evidence (prompt id, owned URL,
  competitor name) that drove this edit. promptIds in why may be
  abbreviated for readability — Rule 9 only applies to evidence[].promptId.
- expectedImpact: short concrete statement OR null when there is no
  honest signal to claim. NEVER promise traffic, ranks, or uplift.
- measurementPlan: how the operator will tell whether this edit moved
  visibility — short noun phrase or null.
- risks: array of strings. Empty array = no notable risks.

Output ONLY valid JSON matching the schema. No prose, no markdown
fences, no explanation.
`;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type GenerateOpenAIBundleOptions = {
  /** Override `fetch` for tests + any non-default callers. REQUIRED in
   *  vitest — see vitest-detection guard below. */
  fetchImpl?: typeof fetch;
  /** Override model. Defaults to DEFAULT_OPENAI_MODEL. */
  model?: string;
  /** Frozen `now` for deterministic timestamps in tests. */
  now?: Date;
  /** Override timeout. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
};

/**
 * Wider entry point: same behavior as `openaiProvider.generate` but with
 * an explicit `options` arg for tests / CLI / 6A.2c integration.
 *
 * Returns an empty bundle (with `providerName: "openai"`) on any
 * non-config failure. Throws ONLY when:
 *   - vitest is running and no `fetchImpl` was supplied
 *   - `process.env.VERCEL === "1"` (without `BEACON_LLM_BUILD_OK=1`)
 *   - `OPENAI_API_KEY` is missing
 *
 * The narrow `SpecificEditProvider.generate(packet)` interface wraps
 * this with no options.
 */
export async function generateOpenAIBundle(
  packet: SpecificEditEvidencePacket,
  options: GenerateOpenAIBundleOptions = {},
): Promise<SpecificEditBundle> {
  // ── 0. Test-environment safety gate ─────────────────────────────────
  // Vitest sets VITEST=true by default. If we're in a test run AND no
  // fetchImpl was supplied, refuse — accidental network calls during
  // test suites are exactly what this guard prevents.
  if (process.env.VITEST === "true" && !options.fetchImpl) {
    throw new Error(
      "[openai-provider] fetchImpl is required during vitest runs. " +
        "Mock fetchImpl explicitly to avoid accidental real network calls.",
    );
  }

  // ── 0b. Build-environment safety gate ───────────────────────────────
  // Vercel build never has a legitimate reason to call the LLM. Throw
  // unless explicitly unblocked.
  if (
    process.env.VERCEL === "1" &&
    process.env.BEACON_LLM_BUILD_OK !== "1"
  ) {
    throw new Error(
      "[openai-provider] refusing to call OpenAI during Vercel build. " +
        "If this is intentional, set BEACON_LLM_BUILD_OK=1.",
    );
  }

  // ── 1. Required config ──────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "[openai-provider] OPENAI_API_KEY is not set. Either set the env " +
        "var or use the deterministic provider via BEACON_LLM_PROVIDER unset.",
    );
  }

  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  // ── 2. Build request body with packet-derived strict schema ─────────
  const schema = buildOpenAISpecificEditSchema(packet);
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      {
        role: "user",
        content: `Evidence packet:\n${JSON.stringify(packet, null, 2)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "specific_edit_bundle",
        strict: true,
        schema,
      },
    },
    // Sprint 6A.2f pre-flight (2026-04-26) — bumped 4_000 → 16_000.
    // gpt-5-family models consume `reasoning_tokens` against the same
    // `completion_tokens` pool BEFORE emitting structured output. The
    // dry-run smoke for the Whole Home Renovation packet hit
    // `finish_reason="length"` with `reasoning_tokens=4000 / 4000`,
    // producing zero JSON content. 16k gives the model 4-8k of
    // reasoning headroom + 8-12k for the actual edit list.
    //
    // Worst-case cost: gpt-5-mini @ $2/M output × 16k = $0.032 per
    // packet. Well under the $5 per-run cap. The validator + provider
    // both cap recommendations.maxItems at 20, so the actual output is
    // bounded regardless.
    max_completion_tokens: 16_000,
  });

  // Sprint 6A.2f pre-flight (2026-04-26) — diagnostic logging on empty-
  // bundle returns so silent bails don't strand the operator. Each
  // failure mode logs a structured `[openai-provider]` line naming the
  // packet and the cause; production keeps returning the empty bundle
  // either way. NO behavior change to callers.
  const logPath = `recId=${packet.recId} tenant=${packet.tenantId}`;

  // ── 3. Network call ────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_CHAT_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[openai-provider] empty-bundle: network/timeout ${logPath} error=${JSON.stringify(msg)}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }

  if (!response.ok) {
    let bodyExcerpt = "";
    try {
      bodyExcerpt = (await response.text()).slice(0, 300);
    } catch {
      bodyExcerpt = "<failed to read body>";
    }
    console.warn(
      `[openai-provider] empty-bundle: HTTP ${response.status} ${logPath} body=${JSON.stringify(bodyExcerpt)}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }

  // ── 4. Parse ────────────────────────────────────────────────────────
  type OpenAIChatResponse = {
    choices?: Array<{
      message?: { content?: string | null; refusal?: string | null };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  let data: OpenAIChatResponse;
  try {
    data = (await response.json()) as OpenAIChatResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[openai-provider] empty-bundle: top-level JSON parse failed ${logPath} error=${JSON.stringify(msg)}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }

  const choice = data.choices?.[0];
  if (choice?.message?.refusal) {
    console.warn(
      `[openai-provider] empty-bundle: model refusal ${logPath} reason=${JSON.stringify(choice.message.refusal)}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }
  const content = choice?.message?.content;
  if (!content) {
    const finishReason = choice?.finish_reason ?? "<unknown>";
    const reasoningTokens =
      data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    console.warn(
      `[openai-provider] empty-bundle: empty content ${logPath} ` +
        `finish_reason=${JSON.stringify(finishReason)} ` +
        `completion_tokens=${completionTokens} reasoning_tokens=${reasoningTokens}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[openai-provider] empty-bundle: content JSON parse failed ${logPath} ` +
        `error=${JSON.stringify(msg)} contentExcerpt=${JSON.stringify(content.slice(0, 200))}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }

  const recommendations = extractRecommendations(parsed);
  if (!recommendations) {
    console.warn(
      `[openai-provider] empty-bundle: extractRecommendations rejected the parsed shape ${logPath}`,
    );
    return emptyBundleFor(packet, "openai", now);
  }

  // ── 5. Cost computation ─────────────────────────────────────────────
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const totalCostUsd = estimateCost(model, inputTokens, outputTokens);

  // Deterministic split: total / N, rounded to 6 decimal places. The
  // unrounded sum lives in `totalCostUsd`. Rejected/dedup edits in the
  // persistence layer don't refund — that's intentional; the call
  // already happened.
  const perEditCost =
    recommendations.length > 0
      ? round6(totalCostUsd / recommendations.length)
      : 0;

  // ── 6. Map to SpecificEdit shape with provider provenance ───────────
  const edits: SpecificEdit[] = recommendations.map((r) => ({
    actionType: r.actionType,
    targetUrl: r.targetUrl,
    targetElement: r.targetElement,
    why: r.why,
    evidence: r.evidence,
    expectedImpact: r.expectedImpact,
    difficulty: r.difficulty,
    confidence: r.confidence,
    measurementPlan: r.measurementPlan,
    risks: r.risks,
    source: "openai",
    providerName: "openai",
    model,
    costUsd: perEditCost,
  }));

  return {
    schemaVersion: "specific-edit-bundle/v1",
    generatedAt: now.toISOString(),
    tenantId: packet.tenantId,
    recId: packet.recId,
    evidenceHash: packet.evidenceHash,
    providerName: "openai",
    recommendations: edits,
    totalCostUsd,
  };
}

/**
 * The `SpecificEditProvider` contract. Calls into `generateOpenAIBundle`
 * with no options; the wider entry point exists for tests + 6A.2c.
 */
export const openaiProvider: SpecificEditProvider = {
  name: "openai",
  async generate(
    packet: SpecificEditEvidencePacket,
  ): Promise<SpecificEditBundle> {
    return generateOpenAIBundle(packet, {});
  },
};

// ---------------------------------------------------------------------------
// JSON schema builder — exported for tests
// ---------------------------------------------------------------------------

type JsonSchemaValue =
  | { type: "string"; enum?: string[]; maxLength?: number }
  | { type: "number"; minimum?: number; maximum?: number }
  | { type: "integer" }
  | { type: "boolean" }
  | { type: "null" }
  | { type: "array"; items: JsonSchemaValue; minItems?: number; maxItems?: number }
  | {
      type: "object";
      properties: Record<string, JsonSchemaValue>;
      required: string[];
      additionalProperties: false;
    }
  | { anyOf: JsonSchemaValue[] };

/**
 * Build the strict-mode JSON schema OpenAI uses to constrain the
 * provider response. `actionType` and `targetUrl` are enum-bound to
 * the packet — the decoder cannot generate values outside the
 * allowed sets.
 *
 * The schema mirrors the `SpecificEdit` shape minus provider-stamped
 * fields (`source`, `providerName`, `model`, `costUsd`) — we stamp
 * those after parsing.
 */
export function buildOpenAISpecificEditSchema(
  packet: SpecificEditEvidencePacket,
): JsonSchemaValue {
  const allowedTargetUrls: string[] = [...packet.allowedTargetUrls];
  // The packet may or may not include the sentinel; mirror what the
  // validator + persistence layer accept.
  if (!allowedTargetUrls.includes("needs_new_page")) {
    allowedTargetUrls.push("needs_new_page");
  }

  const evidenceRefSchema: JsonSchemaValue = {
    anyOf: [
      object({
        type: stringEnum(["prompt"]),
        promptId: { type: "string" },
      }),
      object({
        type: stringEnum(["element"]),
        elementKey: { type: "string" },
        url: { type: "string" },
      }),
      object({
        type: stringEnum(["owned_page"]),
        url: { type: "string" },
      }),
      object({
        type: stringEnum(["competitor"]),
        competitorName: { type: "string" },
      }),
      object({
        type: stringEnum(["prior_outcome"]),
        actionType: stringEnum(packet.allowedActionTypes),
      }),
    ],
  };

  const targetElementSchema: JsonSchemaValue = {
    anyOf: [
      { type: "null" },
      object({
        elementKey: { type: "string" },
        displayLabel: { type: "string" },
        currentText: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
        proposedText: { anyOf: [{ type: "string", maxLength: 4000 }, { type: "null" }] },
      }),
    ],
  };

  const editSchema: JsonSchemaValue = object({
    actionType: stringEnum(packet.allowedActionTypes),
    targetUrl: stringEnum(allowedTargetUrls),
    targetElement: targetElementSchema,
    why: { type: "string", maxLength: 500 },
    evidence: {
      type: "array",
      items: evidenceRefSchema,
      minItems: 1,
      maxItems: 6,
    },
    expectedImpact: {
      anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }],
    },
    difficulty: stringEnum(["low", "medium", "high"]),
    confidence: stringEnum(["low", "medium", "high"]),
    measurementPlan: {
      anyOf: [{ type: "string", maxLength: 300 }, { type: "null" }],
    },
    risks: {
      type: "array",
      items: { type: "string", maxLength: 200 },
      maxItems: 8,
    },
  });

  return object({
    recommendations: {
      type: "array",
      items: editSchema,
      maxItems: 20,
    },
  });
}

function object(properties: Record<string, JsonSchemaValue>): JsonSchemaValue {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function stringEnum<T extends string>(values: readonly T[]): JsonSchemaValue {
  return { type: "string", enum: [...values] };
}

// ---------------------------------------------------------------------------
// Cost helpers — exported for tests
// ---------------------------------------------------------------------------

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates =
    (COST_PER_MILLION as Record<string, { input: number; output: number }>)[
      model
    ] ?? COST_PER_MILLION["gpt-5-mini"];
  const cost =
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output;
  return round6(cost);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

type ParsedEdit = {
  actionType: ActionType;
  targetUrl: string;
  targetElement: SpecificEditTargetElement | null;
  why: string;
  evidence: SpecificEditEvidenceRef[];
  expectedImpact: string | null;
  difficulty: SpecificEditDifficulty;
  confidence: SpecificEditConfidence;
  measurementPlan: string | null;
  risks: string[];
};

/**
 * Extract `recommendations[]` from the parsed model output. Returns
 * null if the structure is unrecognizable (caller returns empty bundle).
 *
 * This is a defensive untyped-input parser. The validator at
 * `specific-edit-validator.ts` is the authoritative semantic check —
 * this function only normalizes shape.
 */
function extractRecommendations(parsed: unknown): ParsedEdit[] | null {
  if (!parsed || typeof parsed !== "object") return null;
  const recs = (parsed as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(recs)) return null;
  const out: ParsedEdit[] = [];
  for (const r of recs) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const actionType = obj.actionType;
    const targetUrl = obj.targetUrl;
    const why = obj.why;
    const evidence = obj.evidence;
    const difficulty = obj.difficulty;
    const confidence = obj.confidence;
    const risks = obj.risks;
    if (
      typeof actionType !== "string" ||
      typeof targetUrl !== "string" ||
      typeof why !== "string" ||
      !Array.isArray(evidence) ||
      typeof difficulty !== "string" ||
      typeof confidence !== "string" ||
      !Array.isArray(risks)
    ) {
      // Skip this item; let the validator reject the bundle if it cares.
      continue;
    }
    out.push({
      actionType: actionType as ActionType,
      targetUrl,
      targetElement:
        (obj.targetElement as SpecificEditTargetElement | null) ?? null,
      why,
      evidence: evidence as SpecificEditEvidenceRef[],
      expectedImpact:
        (obj.expectedImpact as string | null | undefined) ?? null,
      difficulty: difficulty as SpecificEditDifficulty,
      confidence: confidence as SpecificEditConfidence,
      measurementPlan:
        (obj.measurementPlan as string | null | undefined) ?? null,
      risks: risks as string[],
    });
  }
  return out;
}

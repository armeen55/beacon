export const meta = {
  name: 'prepared-output-quality-gate',
  description: 'Classify real Iranopedia prepared drafts, synthesize a deterministic quality-gate rule spec, adversarially verify it does not over-reject',
  phases: [
    { title: 'Classify', detail: 'one agent per draft kind classifies real drafts' },
    { title: 'RuleSpec', detail: 'synthesize implementable deterministic rules' },
    { title: 'Verify', detail: 'adversarially check for false rejections / false passes' },
  ],
}

const SCRATCH =
  (args && args.scratch) ||
  '/private/tmp/claude-501/-Users-armeen-beacon--claude-worktrees-objective-davinci-c81e70/aad802e7-e931-4c36-b57a-5cb5a93de511/scratchpad'

const CLASS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'drafts', 'summary'],
  properties: {
    kind: { type: 'string' },
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['recId', 'status', 'reasons'],
        properties: {
          recId: { type: 'string' },
          status: {
            type: 'string',
            enum: ['ready', 'generic_rejected', 'relevance_rejected', 'needs_factual_review', 'needs_source', 'too_thin', 'duplicate', 'safety_rejected'],
          },
          reasons: { type: 'array', items: { type: 'string' } },
          regenerate: { type: 'boolean' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const KINDS = [
  {
    kind: 'answer_block',
    file: 'k_answer_block.json',
    rules:
      'These are 40-80 word AEO answer blocks for an Iranian-culture encyclopedia (iranopedia.com). RULES: (a) GENERIC if the FIRST sentence is a context-free dictionary definition ("A gift is...", "X refers to...") with no Iran/Persian/Iranian/Farsi/entity-specific framing in the opening — even if Iran is mentioned later. (b) RELEVANCE_REJECTED if the answer is off-topic for the rec/page. (c) NEEDS_FACTUAL_REVIEW if it states a specific date/number/year/superlative ("official", "largest", "oldest", "first") that is not self-evidently safe. (d) TOO_THIN if under ~35 words or says nothing concrete. (e) NEEDS_SOURCE if it makes a verifiable claim with zero evidence (note: ALL of these have 0 evidenceRefs because they are raw-text savedOpenings — do NOT reject solely on evRefs=0; judge the prose). (f) READY only if it directly answers the topic, opens with Iran/Persian-specific framing, and invents nothing. Pay special attention to gap:category-gifts-product.',
  },
  {
    kind: 'create_page_brief',
    file: 'k_create_page_brief.json',
    rules:
      'These are new-page briefs (title/meta/opening/outline/faqQuestions/schemaTypes). RULES: (a) opening must carry Iran/Persian context. (b) title must avoid boilerplate "(2026 Guide)"/"Complete Guide" spam unless the topic is year-specific. (c) meta must be page-specific, not generic. (d) outline must be specific (>=3 real sections). (e) faqQuestions present. (f) schemaTypes must fit the page (Article/FAQPage ok for content). (g) GENERIC if it reads like a dictionary entry with no Persian specificity. Be fair: these may largely be READY — do not invent problems.',
  },
  {
    kind: 'prepared_pack',
    file: 'k_prepared_pack.json',
    rules:
      'These are PreparedMovePacks; the consequential field is structuredDraft (draftKind atomic_edit = title/meta rewrite with before/after; or answer_block). RULES for atomic_edit: (a) "after" must include the dominant entity/query naturally. (b) no boilerplate "(2026 Guide)"/"Complete Guide" unless year-specific. (c) no keyword stuffing. (d) "after" must differ meaningfully from "before". (e) NEEDS_FACTUAL_REVIEW if "after" asserts a superlative/number/date not safe. A pack with draftKind=null/status=demand_found has NO draft yet -> classify too_thin (not ready), reason "no draft generated". READY only for a clean, specific, safe rewrite.',
  },
]

phase('Classify')
const classifications = await parallel(
  KINDS.map((k) => () =>
    agent(
      `You are a strict but fair content-quality auditor for Beacon (an SEO/AEO tool for iranopedia.com, an Iranian-culture encyclopedia).\n\n` +
        `Read the real persisted drafts at: ${SCRATCH}/${k.file} (use the Read tool or \`cat\`). Each entry has a recId and the draft fields.\n\n` +
        `Classify EVERY draft in the file against these rules:\n${k.rules}\n\n` +
        `For each draft return {recId, status, reasons[], regenerate}. Set regenerate=true ONLY for status generic_rejected / relevance_rejected / too_thin (these are worth re-drafting). Be concrete in reasons (quote the offending phrase). Do not hallucinate drafts not in the file. Return the structured object for kind="${k.kind}".`,
      { label: `classify:${k.kind}`, phase: 'Classify', schema: CLASS_SCHEMA },
    ),
  ),
)
const valid = classifications.filter(Boolean)
log(`Classified ${valid.reduce((n, c) => n + c.drafts.length, 0)} drafts across ${valid.length} kinds`)

phase('RuleSpec')
const RULESPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rulesByKind', 'regenerateRecIds', 'notes'],
  properties: {
    rulesByKind: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'rules'],
        properties: {
          kind: { type: 'string' },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'status', 'test', 'rationale'],
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                test: { type: 'string' },
                rationale: { type: 'string' },
              },
            },
          },
        },
      },
    },
    regenerateRecIds: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
const ruleSpec = await agent(
  `You are designing a DETERMINISTIC, pure-TypeScript quality gate for prepared drafts (no LLM at runtime). ` +
    `Here are auditor classifications of the real drafts:\n\n${JSON.stringify(valid).slice(0, 12000)}\n\n` +
    `You may also read ${SCRATCH}/k_answer_block.json, ${SCRATCH}/k_create_page_brief.json, ${SCRATCH}/k_prepared_pack.json for the raw content.\n\n` +
    `Produce a rule spec: for each kind, an ordered list of rules, each with {id, status (the quality status it assigns), test (a precise, implementable description: regex / token-list / threshold — runnable in TS against the draft fields, NOT "ask an LLM"), rationale}. ` +
    `Critical rules to nail: GENERIC-OPENING detection (first sentence is "A/An X is/are ..." or "X refers to ..." with a generic head noun and no Iran/Persian token in the FIRST sentence) must flag gap:category-gifts-product but NOT a contextual opener; invented-number/date and superlative detection; title boilerplate "(YYYY Guide)"/"Complete Guide"; word-count bounds; no-draft packs -> too_thin. ` +
    `Also output regenerateRecIds = the exact recIds worth regenerating (generic/irrelevant/too_thin). Return structured.`,
  { label: 'synthesize-rule-spec', phase: 'RuleSpec', schema: RULESPEC_SCHEMA },
)

phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['falseRejections', 'falsePasses', 'fixes', 'verdict'],
  properties: {
    falseRejections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['recId', 'why'],
        properties: { recId: { type: 'string' }, why: { type: 'string' } },
      },
    },
    falsePasses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['recId', 'why'],
        properties: { recId: { type: 'string' }, why: { type: 'string' } },
      },
    },
    fixes: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['ship', 'fix_first'] },
  },
}
const verify = await agent(
  `You are an ADVERSARIAL reviewer. The proposed deterministic quality-gate rule spec:\n\n${JSON.stringify(ruleSpec).slice(0, 10000)}\n\n` +
    `Read the REAL drafts (${SCRATCH}/k_answer_block.json, ${SCRATCH}/k_create_page_brief.json, ${SCRATCH}/k_prepared_pack.json) and mentally EXECUTE each rule against each draft. ` +
    `Find: (1) falseRejections — GOOD drafts these rules would wrongly reject (especially the 3 create_page_briefs, which look genuinely good, and any contextual answer_block). (2) falsePasses — BAD drafts (generic/invented-number/off-topic) that would slip through as ready. (3) fixes — concrete edits to the rule tests to eliminate the above. ` +
    `The generic-opening rule MUST reject gap:category-gifts-product ("A gift is a voluntarily transferred item...") and MUST NOT reject "An Iranian wedding comprises..." — verify both. Return structured; verdict "ship" only if zero false rejections of clearly-good drafts.`,
  { label: 'adversarial-verify', phase: 'Verify', schema: VERIFY_SCHEMA },
)

return {
  classifications: valid,
  ruleSpec,
  verify,
  regenerateRecIds: ruleSpec ? ruleSpec.regenerateRecIds : [],
}

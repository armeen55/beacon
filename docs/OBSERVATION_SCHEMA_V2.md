# Observation Schema v2 — Design Doc

**Commit 3 (2026-04-24).** Part of the "Replace Profound in 2 weeks while compounding the moat" phase.

## Why this exists

Beacon's competitive wedge is **data depth per observation**, not breadth.
Profound has years of broad coverage; Beacon cannot out-breadth them in two
weeks. What Beacon can do is out-extract them — for every prompt/answer/
citation we collect, capture richer structured signal than Profound ever did.

As of 2026-04-23 the observation schema carried:

- `tracked_brand_mentioned` (bool) — binary
- `tracked_brand_cited` (bool) — binary
- `citation_count`, `owned_citation_count` (int) — counts only
- `citation_domains` (text[]) — list, no rank
- `mentions` (text[]) — canonical names, no position or order
- `position` (int) — declared but never populated (always null)
- `citation_categories` (jsonb) — declared but never populated (always `{}`)

Every polling day since the 2026-04-22 native pivot has compounded thin data.
Because answer text is stored but polls aren't cheaply re-runnable, a day of
thin extraction is effectively irrecoverable.

## What Commit 3 adds

Three nullable columns on `prompt_answer_observations`. Non-breaking migration
applied via Supabase MCP (`prompt_answer_observations_schema_v2_must_have_now_fields`).
Commit 3 ships only the schema. Commit 4 wires the extractors and backfills.

### `mention_position: integer NULL`

Character offset of the first brand mention in the answer text. Null when
the brand is not mentioned.

**Why it matters.** Early mention correlates strongly with recommendation
strength. A brand mentioned at character 47 is being presented as the
answer; a brand mentioned at character 1,200 is being listed as an
afterthought. Profound captures neither.

### `citation_rank: integer NULL`

1-indexed position of the owned domain in the citations list. Null when
the brand is not cited.

**Why it matters.** `#1 citation` and `#8 citation` are dramatically
different business signals. The #1 citation is where the user clicks
through; the #8 citation is barely visible. Profound ships the domain list
but not the rank within it.

### `primary_recommendation: boolean NULL`

Heuristic combining position + order: true iff the brand is mentioned AND
the first mention is in the first 20% of answer text AND the brand is one
of the first 2 distinct entities by order of appearance.

**Why it matters.** Captures the difference between "Beacon is THE answer"
and "also mentioned" — the single most sellable-to-customers signal in the
schema. A customer prospect asking "Am I your best recommendation?" can be
answered directly from this field.

## What comes next

**Commit 4 — extraction v1 + backfill.** Deterministic extractors in
`src/domains/prompt-answer-observations/extraction.ts`, wired into both
Perplexity and OpenAI adapters, plus an idempotent backfill script for the
~200 Apr-22+ observations that already have answer text stored.

**Commit 6 — extraction v2.** High-value-soon fields in a follow-up
migration: `descriptor_window` (text[]), `competitor_co_mentions` (text[]),
`citation_domain_classes` (text[]), `answer_structure` (enum).

**Month 3 — LLM-as-judge.** Sentiment, framing classification, authority
scoring. Deferred per product decision; rich per-observation signal from
v2/v1 is the foundation those later layers build on.

## What's explicitly NOT in this schema

- `mention_order` — most of its signal is already in `mention_position` +
  `primary_recommendation`; not worth the column.
- `geo_cues` — prompt metadata already carries `location_scope`; answer-side
  geo cues would mainly confirm vs deny.
- LLM-derived fields (sentiment polarity, recommendation framing enum,
  authority score, counter-narrative flag) — too much for deterministic
  extraction; Month 3 work.
- Word-level / reading-level / emotion / length buckets — low decision
  value, high noise, not worth the engineering cost.
- LLM-generated "recommendation likelihood %" — not reproducible, dangerous
  confidence signal.

## Backward compatibility

- All three columns are nullable with no default. The 14,516 existing rows
  as of 2026-04-24 have NULL in all three after migration — verified.
- TypeScript type `PromptAnswerObservation` marks all three fields as
  `?: X | null` so any code still deserializing older rows compiles without
  a migration.
- Commit 2's pure-split abstain guard in `url-verdict.ts` is unaffected —
  it reads `source_type` on `DailyPoint`, not these new fields.

# AI Prompt Stack: how to run 150 prompts across AI platforms (2026-07-09)

Decision doc. One question: the operator has 100 to 200 prompts ready for two sites
(call it 150 total across both tenants) and must pick HOW to run them regularly across
ChatGPT, Gemini, and Perplexity, capturing the answer plus who gets cited, under about
$50 a month.

## Executive answer (5 sentences)

Run the three chat surfaces on NATIVE provider keys, not through DataForSEO: native
OpenAI (gpt-4o-mini + web_search), native Perplexity (sonar), and native Gemini
(2.5 Flash + Google Search grounding) cost roughly $0.012, $0.009, and about $0.002 per
answer, versus DataForSEO's flat ~$0.03 per answer for the same call, so native is about
3x cheaper for identical data. At 150 prompts x 3 platforms, native lands at about $14 a
month on a weekly cadence and about $41 a month on a Mon-Wed-Fri cadence, both under $50
total, while the all-DataForSEO route is $58 (weekly) to $176 (Mon-Wed-Fri) and blows the
cap. All three native stacks return citations reliably (OpenAI url_citation annotations,
Perplexity search_results, Gemini groundingChunks), which is the signal Beacon actually
needs: which domains an AI points people to. Keep DataForSEO for two narrow jobs only,
the Claude surface (no cheap native web-search-with-citations path) and the near-free
Google AI Overview citation proxy piggybacked on SERP calls we already pay for. The exact
thing to build first is already 80% there: extend src/domains/ai-visibility/run-engine-poll.ts
to add a native Gemini grounding path (it currently routes Gemini through DataForSEO) and
raise its 25-prompt nightly cap to cover the full 150-prompt library in batches.

## Cost table (150 prompts total across both tenants, 3 platforms per run)

Weekly = 4.33 runs/month. Mon-Wed-Fri = 13 runs/month. Cost is per-answer x prompts x
platforms x runs.

| Option | Platforms covered | Citations quality | $/mo WEEKLY | $/mo MON-WED-FRI |
|---|---|---|---|---|
| A. DataForSEO LLM Responses (all 3) | ChatGPT, Gemini, Perplexity, +Claude | Good (annotations + fanouts) | ~$58 | ~$176 |
| B. Native hybrid (OpenAI + Perplexity + Gemini) | ChatGPT, Gemini, Perplexity | Good (per-provider citations) | ~$14 | ~$41 |
| C. DataForSEO AI Overview SERP proxy | Google AI Overviews only | Good, Google surface only | ~$2 | ~$6 |
| D. RECOMMENDED: B + C piggyback (+ occasional Claude via DataForSEO) | ChatGPT, Gemini, Perplexity, Google AIO, Claude sample | Good across 4-5 surfaces | ~$16 to $20 | ~$45 to $48 |

Reference point for Q1's stated volume (150 x 3 x 12 runs = 5,400 calls/month):
Option A = ~$162/month, Option B = ~$38 to $41/month.

## What each stack extracts (Q3)

| Signal | DataForSEO LLM Responses | OpenAI web_search | Perplexity sonar | Gemini grounding | DataForSEO AI Overview |
|---|---|---|---|---|---|
| Full answer text | yes | yes | yes | yes | AI Overview text only |
| Source citations (title + url) | yes (annotations) | yes (url_citation) | yes (search_results) | yes (groundingChunks) | yes (references) |
| Competitor domains cited | yes (parse domains) | yes | yes | yes | yes |
| Query fanouts / related questions | yes (fan-out queries) | no | related_questions on some tiers | no | People Also Ask on SERP |
| Brand position in the answer | parse from text | parse from text | parse from text | parse from text | own_rank vs cited already computed |

Beacon already parses citation domains and brand position: src/domains/serp/dataforseo-llm-mentions.ts
extracts cited domains, and src/domains/prompt-answer-observations/extraction.ts has
extractMentionPosition + extractCitationRank. Fanouts already land in profound_fanout_rows.

## Option A detail: DataForSEO AI Optimization / LLM Responses (Q1)

Endpoints (POST, one per engine), all live-verified on this account already:
- /v3/ai_optimization/chat_gpt/llm_responses/live
- /v3/ai_optimization/gemini/llm_responses/live
- /v3/ai_optimization/claude/llm_responses/live
- /v3/ai_optimization/perplexity/llm_responses/live

Platforms: ChatGPT, Gemini, Claude (Standard + Live methods) and Perplexity (Live only).

Response includes: full answer text in typed sections, annotations array (title + url) when
web_search is on, reasoning chain for reasoning models, web_search boolean, fan-out queries,
plus input_tokens / output_tokens / reasoning_tokens / money_spent. This is the richest single
response shape because it hands back citations AND fanouts in one call.

Price: Live base fee is $0.0006 per request PLUS the model's own token + web-search cost
passed straight through. In practice a forced-web-search gpt-4o-mini call measured $0.0271 on
this account (repo pins $0.03 as the round-up); the docs example was $0.0296424 for a
gpt-4.1-mini call (8,174 in / 483 out) with web search. Standard queue is cheaper base
($0.0002) but the LLM pass-through dominates, so the queue choice barely moves the number.

Rate limits: up to 2,000 API calls/min; max 30 simultaneous Live requests per account per
platform; Live ChatGPT execution up to 120s per task.

Cost for 150 x 3 x 12 runs = 5,400 calls x $0.03 = ~$162/month. Verdict: convenient (one
integration, one cap, four engines, fanouts included) but ~3x the native price. Right tool
for Claude and for occasional deep pulls, wrong tool for the daily bulk.

## Option B detail: native provider APIs (Q2)

Assume a ~500-token question and ~800-token answer with search enabled.

OpenAI (gpt-4o-mini + web_search tool):
- Tool fee $10.00 / 1,000 calls = $0.010/call.
- Search content billed as a fixed 8,000-token input block for gpt-4o-mini / gpt-4.1-mini,
  at $0.15/1M input = $0.0012; prompt 500 in ~ $0.00008; output 800 at $0.60/1M = $0.00048.
- Total ~ $0.0118/call. Returns url_citation annotations reliably. gpt-5.4-nano
  ($0.20 in / $1.25 out) lands about the same once the $0.01 tool fee dominates.

Perplexity (sonar):
- Token price $1/1M in and $1/1M out; request fee by context size $5 (low) / $8 (medium)
  / $12 (high) per 1,000 requests.
- ~500 in + 800 out ~ $0.0013 tokens + $0.008 medium request fee = ~ $0.0093/call.
- Citations included in the per-token price (no separate citation charge on standard sonar
  and sonar-pro as of 2026); returns a search_results / citations array by default.

Google Gemini (2.5 Flash + Grounding with Google Search):
- Token price ~ $0.30/1M in, $2.50/1M out; 500 in + 800 out ~ $0.00215/call.
- Grounding is a separate line: $35 / 1,000 grounded prompts for 2.5 models, BUT the first
  1,500 grounded requests/day are free (shared quota). At 150 Gemini prompts per run day we
  are far under 1,500/day, so grounding is effectively FREE for this volume; Gemini 3.x gives
  5,000 grounded prompts/month free then $14/1,000, also free at 1,950/month.
- Effective cost ~ $0.002/call. Returns groundingMetadata with groundingChunks (web.uri +
  web.title); note the uris are Google redirect links that need one resolution step.

Native rate limits: OpenAI and Perplexity are usage-tier RPM/TPM limited (raise tier by
spend); Gemini free grounding is 1,500 RPD (2.5) shared across the project.

Blended native per prompt across all 3 = $0.0118 + $0.0093 + $0.002 = ~$0.023 (or ~$0.021
with Gemini grounding on the free tier). Cost for 150 x 3 x 12 runs = ~$38 to $41/month.
Verdict: cheapest path to the same citations, and the repo already holds native OpenAI and
Perplexity keys. Cost is that it is 3 integrations, 3 rate-limit regimes, and no fanouts
from OpenAI/Gemini natively (fanouts still come from DataForSEO or Profound).

## Option C detail: DataForSEO AI Overview SERP as a proxy (Q4)

A single DataForSEO SERP call ($0.003 standard, per SERP_COST_USD in dataforseo-serp.ts;
~$0.006 advanced) returns the Google AI Overview block with its cited references for that
query, no separate LLM charge. It only covers ONE surface (Google AI Overviews), not the
ChatGPT/Perplexity/Gemini chat answers, so it is a proxy, not a replacement. But it is nearly
free and Beacon already parses it: src/domains/serp/ai-overview-gaps.ts diffs "you rank 3 for
X but the AI answer cites someone else." 150 queries x 13 runs = ~$6/month. Use it as the
always-on Google citation signal layered under the chat polls.

## Other cheaper levers (Q4)

- Cadence is the biggest lever: weekly (4.33 runs) is ~63% cheaper than the 12-run baseline;
  Mon-Wed-Fri (13 runs) is the practical ceiling that still fits $50 on native.
- Delta polling: poll the full 150 weekly, but re-poll only prompts whose SERP rank or AI
  Overview citation changed on the off days (the ai-overview-gaps diff already flags movers).
- Cache unchanged answers: dataforseo-llm-mentions.ts already caches for ~20h; extend the
  same TTL cache to the native paths so a same-day re-request never double-charges.
- Gemini grounding free tier makes the Google-answer chat surface essentially free at this
  volume, so prefer native Gemini over the DataForSEO Gemini route.
- DataForSEO Standard queue ($0.0002 base) over Live ($0.0006) when latency does not matter,
  though the LLM pass-through dominates either way.

## Recommendation (Q5)

Primary stack: Option D. Run ChatGPT, Perplexity, and Gemini on NATIVE keys (OpenAI
gpt-4o-mini + web_search, Perplexity sonar, Gemini 2.5 Flash grounding), layer the
near-free DataForSEO AI Overview SERP proxy under them for the Google surface, and reserve
DataForSEO LLM Responses for the Claude surface and occasional deep fanout pulls.

Cadence: Mon-Wed-Fri for the two live tenants comes to ~$45 to $48/month all-in and stays
under $50; if the operator wants clear headroom, weekly is ~$16 to $20/month. Because native
spend runs on the operator's own OpenAI/Perplexity/Gemini keys, the existing $50 DataForSEO
monthly cap (DEFAULT_MONTHLY_CAP_USD, dataforseo-serp.ts) stays intact and now only governs
SERP + AI Overview + Claude, which together are a few dollars a month.

Build first (exact module to extend): src/domains/ai-visibility/run-engine-poll.ts. It
already polls ChatGPT and Perplexity on native keys and routes Gemini + Claude through
DataForSEO. Two changes: (1) add a native Gemini grounding path (new branch alongside the
existing openAIChatCompletion call, writing the same PromptAnswerObservation via
syncPromptAnswerObservations) so Gemini rides the free grounding tier instead of $0.03
DataForSEO calls; (2) raise NIGHTLY_PROMPT_CAP from 25 and batch the full 150-prompt library
across the week so the whole library is covered without breaching per-run rate limits. Leave
dataforseo-llm-mentions.ts as the Claude/fallback engine and ai-overview-gaps.ts as the
Google citation proxy; both already flow into the same observation tables.

Trade-off owned plainly: native gives up DataForSEO's built-in fanout queries on the OpenAI
and Gemini surfaces. That is fine because Beacon already sources fanouts from Profound
(profound_fanout_rows) and from the DataForSEO Claude call we keep, so no fanout signal is
lost.

## Sources

- DataForSEO LLM Responses overview: https://docs.dataforseo.com/v3/ai_optimization-llm_responses-overview/
- DataForSEO ChatGPT LLM Responses live (response shape + example cost): https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_responses-live/
- DataForSEO AI Optimization API product page: https://dataforseo.com/apis/ai-optimization-api
- DataForSEO LLM Responses pricing (base fee tiers): https://dataforseo.com/pricing/ai-optimization/llm-responses
- DataForSEO LLM Scraper pricing: https://dataforseo.com/pricing/ai-optimization/llm-scraper
- DataForSEO how to track LLM responses: https://dataforseo.com/help-center/how-to-track-llm-responses-with-dataforseo-apis
- OpenAI API pricing (models + web search tool $10/1k calls): https://developers.openai.com/api/docs/pricing
- OpenAI GPT-4o Search Preview model: https://platform.openai.com/docs/models/gpt-4o-search-preview
- Perplexity Sonar pricing (token + per-request context fees): https://docs.perplexity.ai/docs/getting-started/pricing
- Perplexity API pricing breakdown: https://www.aipricing.guru/perplexity-pricing/
- Google Gemini API pricing (grounding $35/1k, free tiers): https://ai.google.dev/gemini-api/docs/pricing
- Gemini grounding free-quota clarification (2.5 Flash paid Tier 1): https://discuss.ai.google.dev/t/grounding-free-quota-clarifying-2026-rules-for-gemini-2-5-flash-paid-tier-1/144593

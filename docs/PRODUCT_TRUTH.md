# Beacon Product Truth

> This is the operator-approved definition of Beacon. It is the durable answer to what the product is,
> who it serves, how it behaves, and what the MVP must prove. Only the operator may change this file.
> Agents may identify contradictions or propose amendments, but must receive explicit operator approval
> before editing it. Implementation state belongs in `HANDOFF_VERIFIED_STATE.md`, not here.

## One-sentence promise

Beacon lets a business run SEO and AEO on autopilot by continuously researching its market, deciding the
highest-impact changes, preparing exact implementation-ready work, verifying what the operator implemented,
and learning from the result.

Beacon should feel like installing an excellent SEO/AEO operator inside a business, not like buying another
analytics dashboard or recommendation generator.

## Product outcome

For a business that uses Beacon consistently for 90 days:

- organic clicks and impressions should be moving toward a recent peak or a new all-time high;
- the business should be appearing and being cited more often across important AI-answer surfaces;
- the operator should spend minutes reviewing high-quality work, not hours collecting or joining evidence;
- every recommendation should be understandable, implementation-ready, and supported by inspectable evidence;
- Beacon should know what was implemented, what happened afterward, and what it learned.

Revenue attribution is not an MVP promise. The MVP measures search clicks, impressions, rankings, AI mentions,
AI citations, implementation state, and directional outcomes.

## Account model

- One account represents one business and exactly one website.
- One user owns the account in the MVP.
- A user never switches among multiple websites inside one account.
- A second business uses a separate account and login.
- Do not build organizations, workspaces, teams, invitations, permissions matrices, or site switchers.
- Keep tenant isolation production-grade so additional customers can sign up safely.
- The product is United States and English only for this version.
- Customer names, domains, verticals, and examples must come from stored account data. Never hardcode a real
  customer into generic copy, defaults, fixtures used by customer surfaces, source allowlists, or decisions.

The canonical account identity must remain generic. Builder fields, publishing modes, cities, budgets, and
vertical-specific assumptions belong in the account's structured Business Profile only when relevant.

## Canonical business records

There is one canonical record for each concept:

- **Account**: customer identity and lifecycle.
- **Membership**: authenticated user to account relationship.
- **Website**: the account's one canonical domain and URL identity.
- **Business Profile**: confirmed structured truth about the business.
- **Connection**: one customer-owned external data source and its health.
- **Page**: one discovered page on the website.
- **Evidence Observation**: one provider result with source, timestamp, provenance, and cost.
- **Evidence Snapshot**: the normalized evidence available for a page, topic, prompt, or account.
- **Research Run**: durable visit-driven work, phase, lease, progress, spend, and errors.
- **Change Proposal**: one ranked recommendation with exact work and a decision receipt.
- **Change Bundle**: the atomic components implemented together on one page.
- **Shipment**: the operator-confirmed implementation and verified live state.
- **Measurement**: the dated outcome reads associated with a Shipment.

Do not create parallel versions of these records or duplicate status vocabularies. Replace superseded paths
in the same slice that introduces the canonical path.

## Structured Business Profile

Beacon infers a Business Profile from the website, then asks the operator to confirm or edit it. The profile
contains only fields supported by evidence or operator confirmation:

- business name and canonical website;
- business type and site archetype;
- products, services, or editorial topics;
- target audiences and customer problems;
- geographic scope when relevant;
- differentiators and trust claims;
- important conversion or authority pages;
- topics the business should own;
- topics the business must not cover;
- factual, legal, brand, and editorial constraints;
- likely competitors, each with discovery evidence;
- confidence and source URLs for every inferred section.

If an operator edits the summary in natural language, Beacon uses its OpenAI key to convert the edit into a
strict structured patch, shows the resulting changes, and waits for confirmation. It never silently changes
confirmed business truth.

## The four product surfaces

Beacon has four primary customer surfaces. Depth belongs inside these surfaces, not in new dashboards.

### Today

Today answers three questions in under ten seconds:

1. What materially changed?
2. Is search and AI visibility moving in the right direction?
3. What are the three smartest things to do next?

Today contains:

- meaningful outliers or connection failures that change what can be trusted;
- a compact Google and AI visibility overview;
- progress toward the account's recovery, growth, or balanced goal;
- the top three ranked Changes;
- current measurement activity and recent outcomes;
- honest research progress when new evidence is being prepared.

Saved information renders immediately. Research starts or resumes after the page responds.

### Changes

Changes is the complete ranked execution queue. It can grow as the operator scrolls, but it must remain
ranked rather than becoming an idea dump.

Lifecycle:

`Suggested -> Approved -> Implemented -> Measuring -> Result`

A Suggested Change may be Dismissed by the operator or Withdrawn by Beacon when its evidence expires or
becomes invalid. These are terminal dispositions, not additional lifecycle stages. A dangerous Change
requires the approved two-step confirmation before entering Approved. Implementation must converge on one
canonical stage vocabulary and one canonical terminal disposition, never several competing status systems.

Every list item shows:

- exact action;
- affected page or new-page target;
- objective;
- estimated effort;
- evidence strength and confidence;
- why it ranks above the next opportunity;
- whether it is safe, bundled, overlapping, or destructive.

Every Change detail has two layers:

1. A simple decision layer with the recommendation, why it matters, and exact work.
2. An expandable investigation showing all material evidence and rejected alternatives.

The queue can include every useful website change, including:

- title and meta description;
- opening or direct answer;
- section addition, removal, or rewrite;
- full-page rewrite;
- factual correction;
- source pack and citations;
- internal links and anchor text;
- structured data;
- page consolidation;
- redirect, canonical, or noindex;
- new article, service page, location page, comparison page, category, or hub;
- information architecture and navigation changes.

Beacon recommends whatever has the highest expected impact, whether atomic or large. It does not manufacture
five tiny tasks when one coherent Change Bundle is the honest unit of work.

### Results

Results answers:

- Was the change implemented?
- Did Beacon verify it on the live website?
- What happened afterward?
- How confident is the read?
- What did Beacon learn?

Results is visually understandable before it is analytical. It shows dates, observed movement, evidence
availability, overlap, and uncertainty without causal overclaim.

### Connections

Connections contains customer-owned sources only:

- Google Search Console: strongly recommended, never required to enter the product;
- Google Analytics 4: optional;
- Microsoft Clarity: optional;
- Wix: optional first CMS integration;
- future CMS integrations only after the MVP loop works.

Google Business Profile is a high-value future connection for local businesses, but is not part of this MVP.

Beacon-owned OpenAI, DataForSEO, public crawling, caches, and research services are included infrastructure,
not customer connections. They never require a customer API key or show a Connect button.

## Onboarding

Onboarding must take minutes, feel premium, and show intelligence before asking for optional connections.

### Step 1: Website

The user enters one website. Beacon validates reachability, redirects, robots behavior, sitemaps, and canonical
domain without publishing or installing code.

### Step 2: Automatic understanding

Beacon reads the site, discovers pages, classifies the business, identifies important topics and pages, and
builds a first structured Business Profile.

### Step 3: Confirm business truth

Beacon presents a clear editable summary. The user confirms it, edits individual fields, or describes changes
in natural language. Natural-language edits become a strict structured patch and require confirmation.

### Step 4: Goal

The user selects:

- recover lost visibility;
- grow into new demand;
- balanced recovery and growth.

The default recommendation is based on available evidence, but the user decides.

### Step 5: Topics and AI prompts

Beacon generates a broad prompt candidate universe, organizes it into understandable topic groups, and
recommends 20 to 50 core prompts. The user approves the recommendation by group, edits exceptions, adds
prompts, or removes prompts. The user is never required to review 150 individual rows.

### Step 6: Optional connections

Beacon explains what each source unlocks. Search Console is strongly recommended. Every connection can be
skipped, and Beacon still produces useful research from the public site and Beacon-owned DataForSEO.

### Step 7: First findings

Beacon shows a genuine initial preview, begins the full durable Research Run, and lands the user on Today.
The user can navigate normally while research continues.

## Prompt and question model

Beacon maintains two deliberately different sets.

### Core tracking prompts

- Start with 20 to 50 operator-approved prompts.
- Represent the account's most important category, problem, comparison, commercial, factual, trust, and
  brand questions.
- Run repeatedly across supported AI engines so movement is comparable over time.
- Remain stable unless evidence supports a deliberate replacement.
- Every addition, removal, or wording change is versioned so trend discontinuities are visible.

Core prompts are tracked daily on active account days. One canonical daily sample per prompt and engine
begins automatically on the first authenticated visit of the account's reporting day; a day the app is
never opened records no observation and is never fabricated or backfilled. The existing Update data control
may request up to two additional same-day samples after the canonical one, labeled sample 2 and sample 3;
they measure volatility and never pretend to be separate days. Cost is proven by actual provider receipts.

### Research queries

- Include AI fan-out queries, People Also Ask questions, related searches, GSC queries, keyword expansions,
  headings, entities, competitor terms, and discovered follow-up questions.
- May grow into the hundreds or thousands.
- Drive investigation and opportunity discovery.
- Are cached and deduplicated.
- Do not automatically become permanent tracking prompts.

Beacon may maintain 100 to 200 core-prompt candidates behind the approved set. It periodically proposes a
small justified replacement when a candidate becomes materially more important.

## Beacon-owned research providers

### DataForSEO

DataForSEO is Beacon's external SEO and AI-observation backbone. Remove SEMrush, Profound, borrowed-account,
and provider-specific native polling architectures rather than keeping compatibility pipelines alive.

The MVP uses DataForSEO for:

- ChatGPT search-mode scraping: answers, sources, brands, results, and query fan-outs; the Gemini
  scraper where it provides material distinct evidence;
- standardized ChatGPT, Perplexity, Gemini, and Claude response observations;
- Google organic SERPs, AI Overview, AI Mode, featured snippets, People Also Ask, and related searches;
- keyword suggestions, related keywords, keyword ideas, search intent, volume, trends, and difficulty;
- keywords for a site;
- ranked keywords for domains, URLs, and competitor pages;
- relevant pages, SERP competitors, domain intersections, and page intersections;
- historical keyword and SERP evidence where it materially improves a decision.

The provider's brand-mentions corpus product is outside the MVP. Endpoint URLs, current prices,
concurrency limits, and sandbox mechanics are implementation details that belong in code contracts and
the implementation plan, never in this document.

Collection rules:

- use United States and English;
- repeated measurements use full model version identifiers; Beacon records both the requested model and
  the model version actually served, and every model change creates a visible measurement boundary so
  model drift cannot masquerade as visibility movement;
- preserve provider, endpoint, model, query, location, language, timestamp, cost, and response provenance;
- never claim an API observation perfectly reproduces a personalized consumer application;
- request web search where supported; record the provider-reported search state separately from whether
  citations were actually returned; citation-free answers are weaker evidence and never prove that useful
  web research occurred;
- treat missing citations or fan-outs as missing evidence, never as an empty factual truth;
- use live methods for visit-driven work unless a durable queued result can be resumed without a scheduler;
- respect provider concurrency and function-duration limits;
- batch to the largest safe supported input size;
- never spend twice for an equivalent fresh observation.

### OpenAI

Beacon's OpenAI key powers internal semantic work, not visibility measurement:

- Business Profile inference and natural-language profile patches;
- topic and intent clustering;
- prompt generation and deduplication;
- entity, outline, and competitor-pattern synthesis;
- recommendation ranking explanations;
- exact titles, descriptions, answers, sections, source packs, and full-page drafts;
- final semantic validation and conflict adjudication.

Every OpenAI result uses a strict JSON Schema through the canonical AI Gateway and is validated again on the
server. A refusal, incomplete response, or schema failure produces no artifact. Retry a bounded number of
times, then preserve a structured failure. Never accept unsourced fallback prose as a product record.

Deterministic code owns identity, authorization, URLs, metrics, calculations, dates, costs, caching,
deduplication, provenance, approval, verification, and measurement.

## Research funnel

Beacon's intelligence is a joined evidence system, not one giant prompt.

For an existing page or new-page opportunity:

1. Read the confirmed Business Profile and constraints.
2. Read or refresh the website inventory and content hashes.
3. Identify relevant GSC queries and movement when connected.
4. Expand the topic using DataForSEO site, related, suggestion, idea, intent, and volume endpoints.
5. Join relevant core prompts, AI answers, citations, brands, and fan-out queries.
6. Run SERPs for the strongest retained queries.
7. Identify recurring winning domains and exact pages.
8. Fetch allowed public competitor pages and extract titles, metadata, headings, answers, entities, links,
   structured data, freshness, and cited sources.
9. Compare winning patterns with the account's existing coverage and authority.
10. Generate candidate actions.
11. Reject unsafe, duplicative, cannibalizing, low-evidence, or lower-impact alternatives.
12. Produce one ranked Change Proposal with a complete decision receipt.

Broad research is welcome; indiscriminate expensive research is not. A page may collect 500 or more raw
keyword candidates, then normalize, cluster, and retain a smaller meaningful set before running expensive
SERPs and page teardowns.

## Evidence and decision receipts

Every recommendation stores:

- exact problem;
- objective and expected metric;
- page, topic, and prompt scope;
- evidence references;
- evidence freshness;
- important missing evidence;
- competitor and winning-page patterns;
- keyword and intent support;
- AI-answer and citation support;
- alternatives considered and why they lost;
- risk and destructive-action classification;
- expected effort;
- confidence and the reasons for that confidence;
- exact proposed work;
- measurement plan.

The simple surface explains why the recommendation is smartest. The expanded receipt proves it.

## Autonomy and approval

Beacon is autonomous in research, analysis, ranking, preparation, refreshing, verification, and measurement.

Beacon never publishes or changes the live website without explicit operator approval. In this MVP, the
operator applies the change manually and marks what was implemented.

Dangerous actions require stronger two-step review:

- redirect;
- canonical;
- noindex;
- deletion;
- consolidation that removes a live page;
- factual change with meaningful legal, medical, financial, or brand risk.

Wix may be read for context. Automated CMS publishing is not part of the MVP.

## Implementation and verification

When the operator marks a Change implemented:

1. Record the implementation timestamp.
2. Record which Change Bundle components were actually applied.
3. Crawl the live page.
4. Compare the live result with the approved proposal.
5. Mark verified, partially verified, not found, or blocked.
6. Start measurement only after implementation is verified or explicitly operator-confirmed.

Search Console submission is a possible later enhancement, not an MVP requirement.

## Measurement

Measurement is honest and useful before it is statistically impressive:

- immediate: implementation and crawl verification;
- day 7: early movement;
- day 14: provisional read;
- day 28: primary directional read;
- day 56: runs when the day-28 read was confounded, insufficient, or unclear, or when the Change was
  classified as destructive; otherwise Beacon omits the day-56 read.

Measurement reads are computed from historical source data on the first visit after a window becomes due.
A late visit computes every due read in order. No measurement window requires scheduled execution.

Search data can lag, so Results shows the source watermark and never treats missing recent data as a loss.

Primary metrics:

- clicks;
- impressions;
- average position and query/page movement;
- non-brand search movement where query evidence exists;
- AI mentions;
- AI citations;
- cited pages and domains;
- core-prompt presence by engine.

The account's recent peak is the best rolling 28-day period in the preceding 12 months.

## Overlapping changes

Multiple edits applied to one page together form one Change Bundle. Beacon records the components but
measures the bundle effect. It does not invent component-level causal attribution.

If multiple independent Shipments overlap on the same page or measurement window:

- label the read confounded or bundled;
- show the combined movement;
- preserve component and timing metadata;
- learn correlations across future comparable outcomes;
- never claim that one component caused a percentage of the result without defensible evidence.

## Cross-account learning

Beacon may learn anonymized outcome patterns across accounts only when enough real outcomes exist.

Allowed shared learning:

- abstract action type;
- page and intent archetype;
- evidence features;
- implementation components;
- measurement window;
- anonymized directional result.

Never share or expose customer names, domains, URLs, queries unique to a customer, copy, credentials, or
private metrics. At small sample sizes, do not pretend cross-account learning is meaningful.

Cross-account learning is post-MVP. The MVP preserves the record shapes needed for future anonymized
learning but builds no cross-account aggregation, scoring, model, or customer-facing claim. Ordinary
canonical outcome fields are preserved as usual; no speculative future-learning fields are added solely
for this deferred capability.

## Visit-driven runtime

This MVP has no cron, scheduler, GitHub Action, or third-party workflow platform.

On every authenticated visit:

1. Render the most recent saved customer snapshot immediately.
2. Acquire a durable account-scoped Research Run lease.
3. Resume the next incomplete bounded phase after the response.
4. Persist progress and evidence after every phase.
5. Continue through active-tab requests while the user remains in Beacon.
6. Pause safely when the app is closed.
7. Resume from durable state on the next visit.

The runtime must use durable Supabase state, leases, and idempotency keys. In-memory guards may optimize one
process but are never the correctness mechanism. Paid calls never run directly on the render path.

Progress is evidence-based, never decorative:

- pages read out of pages discovered;
- prompts checked out of 50;
- engines completed;
- keywords retained;
- SERPs analyzed;
- competitor pages compared;
- proposals prepared.

If the app is completely closed, work may pause. The UI must never imply that unscheduled work continued.

## Caching and spend

- Public provider evidence is cached by canonical endpoint, input, location, language, model, and version.
- Public website snapshots are content-hash aware.
- Tenant-derived conclusions remain tenant-scoped even when raw public evidence is safely reusable.
- Cache lifetimes reflect volatility; no universal TTL.
- Every paid call has an idempotency key, actual cost receipt, account attribution, and fail-closed spend cap.
- Batch where the provider charges primarily per task.
- A cache hit must be observable internally and cost zero.
- Cost optimization may never silently reduce the promised evidence coverage.

Before onboarding is completed, Beacon may spend at most $2 total for that account. No recurring paid
observation work begins before activation. If the cap is reached, onboarding completes honestly with
partial evidence rather than spending more or blocking the user. This pre-activation lifetime cap is
separate from the active account's recurring spend cap.

## Product voice and experience

Beacon speaks like a confident expert working for the customer:

- first person when describing Beacon's work;
- plain English before technical detail;
- concrete numbers when trustworthy;
- one obvious next action;
- no provider, pipeline, cron, experiment, treatment, or internal status jargon on primary surfaces;
- no fake precision, causal overclaim, raw identifiers, or bare zeros;
- no hardcoded customer names;
- no em or en dashes in customer-facing copy.

The UI should be calm, premium, fast, and visually explanatory. Progressive disclosure is preferred:
simple decision first, full investigation on demand. A progress bar is used only when backed by persisted
units of completed work.

## MVP acceptance criteria

The MVP is complete only when a brand-new account can:

1. Sign up and enter one website.
2. Receive and confirm a structured Business Profile.
3. Choose a goal.
4. Approve Beacon's recommended 20 to 50 core prompts by topic group.
5. Skip or connect customer-owned sources.
6. See a real first finding and durable research progress.
7. Receive deeply researched existing-page and new-page Changes.
8. Inspect why each Change outranks alternatives.
9. Approve and manually implement a Change Bundle.
10. Have Beacon verify the live implementation.
11. See honest 7, 14, 28, and when needed 56-day Results.
12. Remain fully isolated from every other account.

The MVP must prove this loop for both a content-rich publisher and a local-service business without
hardcoding either business or creating separate product paths.

## Explicit non-goals

Do not build until separately approved:

- multiple websites per account;
- teams, invitations, permissions, or billing;
- automated publishing;
- external schedulers or workflow platforms;
- email digests;
- revenue attribution;
- Google Business Profile;
- additional CMS integrations;
- translations or non-US research;
- a chat or Ask surface;
- standalone keyword, competitor, prompt, or diagnostics dashboards;
- speculative agents, experiments, future-intelligence systems, or duplicated pipelines.

## Build order

1. Reconcile generic Account, Website, and Business Profile records and remove customer and vertical
   special cases.
2. Establish one canonical DataForSEO evidence boundary while deleting the Profound, SEMrush,
   borrowed-account, GitHub Actions, and phantom native-provider architecture it replaces.
3. Replace free-form Chat Completions generation with the canonical Responses API and strict Structured
   Outputs gateway.
4. Build durable visit-driven Research Runs with Supabase phases, leases, idempotency, progress, pause,
   and resume.
5. Build the complete onboarding and core-prompt approval flow on those real foundations.
6. Build the complete DataForSEO research funnel and caching.
7. Produce one deeply evidenced existing-page Change Bundle.
8. Produce one deeply evidenced new-page Change.
9. Build one canonical Shipment with live implementation verification.
10. Complete 7/14/28/56 measurement, overlap honesty, and both-archetype dogfooding.

Each step is one bounded vertical slice with a behavioral acceptance test. Delete superseded code in the
same slice. No slice may build a temporary duplicate pipeline for a later slice to replace.

## Protection against future bloat

- The four surfaces and five code kernels are boundaries, not invitations for more subsystems.
- One customer outcome per task.
- Prefer replacing and deleting over adding parallel abstractions.
- No feature without the eight-field proposal required by `AGENTS.md`.
- No new route, top-level domain, dependency, provider, record type, or status vocabulary without operator
  approval.
- A feature unused by real operator workflow for 30 days is reviewed for deletion.
- Suggestions and aggressive critique are welcome. Product changes require operator approval.
- Only the operator may change this Product Truth.
- Git history is the archive; do not create roadmap, audit, report, or task-summary documents.

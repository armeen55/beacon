# Beacon Product Truth

> This is the operator-approved definition of Beacon. It is the durable answer to what the product is,
> who it serves, how it behaves, and what the MVP must prove. Only the operator may change this file.
> Agents may identify contradictions or propose amendments, but must receive explicit operator approval
> before editing it. Implementation state belongs in `HANDOFF_VERIFIED_STATE.md`, not here.

## One-sentence promise

Beacon lets a business run SEO and AEO on autopilot by continuously researching its market, deciding the
highest-impact changes, preparing exact implementation-ready work, verifying what the operator implemented, and learning from the result.

Beacon should feel like installing an excellent SEO/AEO operator inside a business, not like buying another analytics dashboard or recommendation generator.

## What V1 replaces

V1 replaces on-page SEO, content SEO, AEO research, content planning, and actionable technical SEO. Offsite
links, digital PR, and local SEO are not V1. A new account reaches its first useful result in roughly 3 to 5
minutes from cached evidence, and deeper research continues durably for up to roughly an hour with the stage it is in named honestly.

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

- One account represents one business and exactly one website. One user owns it in the MVP.
- A user never switches among multiple websites inside one account. A second business uses a separate login.
- Do not build organizations, workspaces, teams, invitations, permissions matrices, or site switchers.
- Keep tenant isolation production-grade so additional customers can sign up safely.
- The product is United States and English only for this version.
- Customer names, domains, verticals, and examples must come from stored account data. Never hardcode a real
  customer into generic copy, defaults, fixtures used by customer surfaces, source allowlists, or decisions.

The canonical account identity must remain generic. Publishing modes, cities, budgets, and vertical-specific
assumptions belong in the account's structured Business Profile only when relevant.

## Canonical business records

There is one canonical record for each concept:

- **Account**: customer identity and lifecycle. **Membership**: authenticated user to account relationship.
- **Website**: the account's one canonical domain and URL identity.
- **Business Profile**: confirmed structured truth about the business.
- **Connection**: one customer-owned external data source and its health.
- **Page**: one discovered page on the website, with crawl state, content hash, and completeness.
- **Evidence Observation**: one provider result with source, timestamp, provenance, and cost.
- **Evidence Snapshot**: the normalized evidence available for a page, topic, prompt, or account.
- **Research Run**: durable work, phase, lease, progress, spend, and errors.
- **Change Proposal**: one ranked recommendation with exact work and a decision receipt.
- **Change Bundle**: the atomic components implemented together on one page.
- **Shipment**: the operator-confirmed implementation and verified live state.
- **Measurement**: the dated outcome reads associated with a Shipment.

Do not create parallel versions of these records or duplicate status vocabularies. Replace superseded paths
in the same slice that introduces the canonical path.

## Structured Business Profile

Beacon infers a Business Profile from the website, then asks the operator to confirm or edit it. The profile
contains only fields supported by evidence or operator confirmation: business name and canonical website;
business type and site archetype; products, services, or editorial topics; target audiences and customer
problems; geographic scope when relevant; differentiators and trust claims; important conversion or authority
pages; topics the business should own; topics it must not cover; factual, legal, brand, and editorial
constraints; likely competitors with discovery evidence; and confidence plus source URLs for every inferred
section.

If an operator edits the summary in natural language, Beacon uses its OpenAI key to convert the edit into a
strict structured patch, shows the resulting changes, and waits for confirmation. It never silently changes
confirmed business truth.

## Competitors

Competitors are discovered automatically from evidence, never typed in as a required setup step. Recurring
presence on the account's important search results and recurring citation inside AI answers are the two
discovery signals. Every discovered domain is classified as a commercial competitor, a citation authority, a
publisher, a marketplace or directory, a government or educational source, a social platform, owned, or
irrelevant, and each classification shows the evidence behind it in plain language. The operator can pin a
domain, exclude one, or correct a classification, and Beacon respects that correction afterward.

## The five product surfaces

Beacon has five primary customer surfaces: Today, Visibility, Changes, Results, and Connections. Depth belongs
inside these surfaces, not in new dashboards.

### Today

Today answers three questions in under ten seconds, entirely from saved truth:

1. What materially changed?
2. Is search and AI visibility moving in the right direction?
3. What are the smartest things to do next?

Today contains:

- meaningful outliers or connection failures that change what can be trusted;
- a compact Google and AI visibility overview;
- progress toward the account's recovery, growth, or balanced goal;
- at most the three strongest next Changes, and fewer when fewer are genuinely earned;
- current measurement activity and recent outcomes;
- one stable research status line whose counts come from durable stored work, never from a live guess.

Saved information renders immediately. Research is already running on its own schedule; a visit recovers or
resumes it rather than being the reason it happens.

### Visibility

Visibility is ONE surface with two tabs. The Google tab shows clicks, impressions, average position, and query
and page movement. The AI answers tab shows presence, mentions, citations, and cited pages for each tracked
prompt and engine. Both tabs drill down to the exact stored observation with its date, engine, model, and
receipt. There is no composite AI visibility score and no second execution queue on this surface: Visibility
explains where the business stands, and every action lives in Changes.

### Changes

Analysis is Beacon's work; a customer-facing Change contains the complete deliverable: exactly what to add,
replace, delete, move, link, redirect or create, exactly where, and the final copy whenever copy is involved
(operator-approved 2026-08-14). Opportunity discovery stays continuous, but an opportunity without its
finished deliverable is internal research: it feeds a small status count, never the ranked execution queue,
never leads Today, and never offers completion controls. Zero finished Changes is an honest state.

Canonical lifecycle:

`needs_review -> ready -> implemented_pending_verification -> measuring -> result`

`dismissed` (the operator declines) and `withdrawn` (Beacon retires a Change whose evidence expired or became
invalid) are terminal dispositions, not additional stages. There is no separate Approved stage. A dangerous
Change requires the two-step confirmation before it becomes ready. Implementation must converge on this one
stage vocabulary and one terminal disposition, never several competing status systems.

Every list item shows: the exact action; the affected page or new-page target; the objective; estimated effort;
evidence strength and confidence; why it ranks above the next opportunity; and whether it is safe, bundled,
overlapping, or destructive.

Every Change detail has two layers:

1. A simple decision layer with the recommendation, why it matters, and exact work.
2. An expandable investigation showing all material evidence and rejected alternatives.

The queue can include every useful website change: title and meta description; opening or direct answer;
section addition, removal, or rewrite; full-page rewrite; factual correction; source pack and citations;
internal links and anchor text; structured data; page consolidation; redirect, canonical, or noindex; a new
article, service page, location page, comparison page, category, or hub; and information architecture and
navigation changes. A technical finding enters the queue only when it names a concrete URL and the exact fix.

One coherent implementation moment is one Change Bundle whose atomic components are visible inside it. Beacon
does not manufacture five tiny tasks when one bundle is the honest unit of work, and it does not hide the
components inside an opaque single row.

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

- Google Search Console: strongly recommended, optional, and never required to enter the product;
- Google Analytics 4: optional;
- Microsoft Clarity: optional.

GA4 and Clarity are small evidence modifiers. Neither is ever a primary decision engine, and neither is ever
sufficient on its own to justify a draft. Google Business Profile is a high-value future connection for local
businesses, but is not part of this MVP. There is no CMS connection in V1.

Beacon-owned OpenAI, DataForSEO, public crawling, caches, schedulers, and research services are included
infrastructure, not customer connections. They never appear as a connection, require a customer API key, or
show a Connect button.

## Onboarding

Onboarding is seven steps, entirely generic, and must take minutes, feel premium, and show real intelligence
before asking for optional connections. If onboarding is incomplete, the next authenticated visit resumes it
automatically at the step the account actually reached.

### Step 1: Website

The user enters one website. Beacon validates reachability, redirects, robots behavior, sitemaps, and canonical
domain without publishing or installing code.

### Step 2: Automatic understanding

Beacon crawls the site, builds the owned-page inventory, classifies the business, identifies important topics
and pages, and builds a first structured Business Profile.

### Step 3: Confirm business truth

Beacon presents a clear editable summary. The user confirms it, edits individual fields, or describes changes
in natural language. Natural-language edits become a strict structured patch and require confirmation.

### Step 4: Goal

The user selects: recover lost visibility; grow into new demand; or balanced recovery and growth. The default
recommendation is based on available evidence, but the user decides.

### Step 5: Topics and AI prompts

Beacon generates a broad prompt candidate universe, organizes it into understandable topic groups, and
recommends 20 to 50 core prompts. The user approves the recommendation by group, edits exceptions, adds
prompts, or removes prompts. The user is never required to review 150 individual rows.

### Step 6: Optional connections

Beacon explains what each source unlocks. Search Console is strongly recommended. Every connection can be
skipped, and Beacon still produces useful research from the public site and Beacon-owned DataForSEO.

### Step 7: First findings

Beacon shows a genuine initial preview, begins the full durable Research Run, and lands the user on Today.
The user can navigate normally while research continues. Activation makes the account eligible for daily
tracking from that day forward.

A minimal Pause research control stops future scheduled work for the account without deleting any history.
Resuming starts tracking again from the current day; it never fabricates or backfills the days that were
paused.

## Prompt and question model

Beacon maintains two deliberately different sets.

### Core tracking prompts

- A generic account starts with 20 to 50 operator-approved core prompts. An account that already approved its
  set keeps exactly that set; the live account's 35 approved questions stay intact and are not regenerated.
- They represent the account's most important category, problem, comparison, commercial, factual, trust, and
  brand questions.
- They run repeatedly across the canonical engines so movement is comparable over time.
- They remain stable unless evidence supports a deliberate replacement.
- Every addition, removal, or wording change is versioned so trend discontinuities are visible.

The four canonical engines are ChatGPT, Claude, Gemini, and Perplexity. Google AI Overview and AI Mode are
search-result evidence about Google; they are never presented as additional conversational engines.

There is exactly ONE canonical observation per active prompt, per engine, per reporting day, and it is
sample 1. The Update data control may add at most samples 2 and 3 on the same day; those measure volatility
and never pretend to be separate days. Observation identity is account, reporting date, prompt, prompt
version, engine, and sample number, enforced by the database. Today that identity is stored as `tenant_id`,
`prompt_id`, `prompt_version`, `engine`, `reporting_day`, and `sample_slot`, where slot 0 IS sample 1; that
mapping is the contract and neither half may drift from the other. A day with no observation stays visibly
missing forever. Missing days are never fabricated, estimated, or backfilled. Cost is proven by actual
provider receipts.

### Research queries

- They include AI query fan-outs, People Also Ask questions, related searches, GSC queries, keyword
  expansions, headings, entities, competitor terms, and discovered follow-up questions.
- They may grow into the hundreds or thousands.
- They drive investigation and opportunity discovery.
- They are cached and deduplicated.
- They do not automatically become permanent tracking prompts.

A query fan-out is an actual search query the provider reports the engine issued: the `fan_out_queries` field
returned by DataForSEO, and nothing else. A tracked prompt is never its own fan-out. Keywords Beacon derives
itself are research queries with exact provenance naming how they were derived, and they are never labeled
fan-outs on any surface or in any store.

Beacon may maintain 100 to 200 core-prompt candidates behind the approved set. It periodically proposes a
small justified replacement when a candidate becomes materially more important.

## Beacon-owned research providers

### DataForSEO

DataForSEO is Beacon's external SEO and AI-observation backbone. Remove SEMrush, Profound, borrowed-account,
and provider-specific native polling architectures rather than keeping compatibility pipelines alive.

The MVP uses DataForSEO for:

- ChatGPT search-mode scraping: answers, sources, brands, results, and query fan-outs; the Gemini
  scraper where it provides material distinct evidence;
- standardized ChatGPT, Claude, Gemini, and Perplexity response observations;
- Google organic SERPs, AI Overview, AI Mode, featured snippets, People Also Ask, and related searches;
- keyword suggestions, related keywords, keyword ideas, search intent, volume, trends, and difficulty;
- keywords for a site, and ranked keywords for domains, URLs, and competitor pages;
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
- respect provider concurrency and function-duration limits;
- batch to the largest safe supported input size;
- never spend twice for an equivalent fresh observation.

### Public website crawling

The website is the account's identity and its most important evidence, not a connector. Beacon builds and
maintains a complete owned-page inventory by public crawling: robots directives first, then sitemaps followed
through every level of nesting, then discovered internal links. Each page carries its crawl state, a content
hash, a completeness verdict of complete, partial, blocked, unsupported, missing, or stale, and, where
crawling is permitted, the full useful main content rather than a fragment.

A partial snapshot never supports a full-page rewrite; it supports only work its evidence actually covers.
Crawling is background research work with its own budget and politeness rules. A customer surface render never
triggers a crawl.

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
5. Join relevant core prompts, AI answers, citations, brands, and provider-reported fan-out queries.
6. Run SERPs for the strongest retained queries.
7. Identify recurring winning domains and exact pages, and classify them.
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

Every recommendation stores: the exact problem; the objective and expected metric; page, topic, and prompt
scope; evidence references and their freshness; important missing evidence; competitor and winning-page
patterns; keyword and intent support; AI-answer and citation support; alternatives considered and why they
lost; risk and destructive-action classification; expected effort; confidence and the reasons for it; the
exact proposed work; and the measurement plan.

The whole answer journey stays traceable by stable identity and receipts, end to end: prompt, engine and
model version, the answer itself, the exact provider-reported fan-outs, cited URLs and passages, cited
domains, the content of the cited pages, keyword evidence, search results, the winning patterns found there,
the account's owned coverage, the opportunity, the exact Change, the implementation, the measurement, and the
learned outcome. Any link in that chain must be reachable from any other. The simple surface explains why the
recommendation is smartest; the expanded receipt proves it.

## Autonomy, approval, and Ready work

Beacon is autonomous in research, analysis, ranking, preparation, refreshing, verification, and measurement.

Beacon never publishes or changes the live website without explicit operator approval. Publishing is manual
for every customer on every CMS: Beacon prepares the exact work, the operator applies it, and then marks what
was implemented. Beacon assumes no CMS connection, mapping, or publishing capability.

Ready work is complete work. A full-page rewrite or a new page carries complete publishable copy, not an
outline, with an explicit KEEP, CHANGE, ADD, and REMOVE plan that preserves the existing content still worth
keeping. Every factual claim in prepared copy is supported by a named source. A draft that is still partial
stays private and never appears as Ready.

Dangerous actions require stronger two-step review and hold for explicit confirmation:

- redirect;
- canonical;
- noindex;
- deletion;
- consolidation that removes a live page;
- factual change with meaningful legal, medical, financial, or brand risk.

## Implementation and verification

When the operator marks a Change implemented:

1. Record the implementation timestamp. Marking a new page implemented requires its live URL.
2. Record which Change Bundle components were actually applied; a partial bundle records which components
   appeared and which did not.
3. Crawl the live page.
4. Independently verify the actual wording or structure against the approved proposal rather than trusting
   the operator's word that it shipped.
5. Mark verified, partially verified, not found, or blocked.
6. Start measurement only after implementation is verified or explicitly operator-confirmed.

Search Console submission is a possible later enhancement, not an MVP requirement.

## Measurement

Measurement is honest and useful before it is statistically impressive:

- immediate: implementation and crawl verification;
- day 7: early movement;
- day 14: provisional read;
- day 28: primary directional read, and the only window that may be called a win;
- day 56: runs when the day-28 read was confounded, insufficient, or unclear, or when the Change was
  classified as destructive; otherwise Beacon omits the day-56 read.

Measurement reads are computed from historical source data as each window becomes due. Scheduled work
computes due reads without a visit; a visit computes any still-outstanding read in order. A read is never
skipped because nobody opened the app.

Search data can lag, so Results shows the source watermark and never treats missing recent data as a loss.

Primary metrics: clicks; impressions; average position and query or page movement; non-brand search movement
where query evidence exists; AI mentions; AI citations; cited pages and domains; and core-prompt presence by
engine.

The account's recent peak is the best rolling 28-day period in the preceding 12 months.

## Overlapping changes

Multiple edits applied to one page together form one Change Bundle. Beacon records the components but
measures the bundle effect. It does not invent component-level causal attribution.

When independent Shipments overlap on the same page or measurement window, they form an overlap graph, and
learning happens at the honest level of that bundle or cluster rather than being assigned to one component.
Beacon labels the read confounded or bundled, shows the combined movement, preserves component and timing
metadata, learns correlations across future comparable outcomes, and never claims that one component caused a
percentage of the result without defensible evidence.

## Cross-account learning

Beacon may learn anonymized outcome patterns across accounts only when enough real outcomes exist. The
allowed shared shape is abstract action type, page and intent archetype, evidence features, implementation
components, measurement window, and anonymized directional result. Never share or expose customer names,
domains, URLs, queries unique to a customer, copy, credentials, or private metrics. At small sample sizes, do
not pretend cross-account learning is meaningful.

Cross-account learning is post-MVP. The MVP preserves the record shapes needed for future anonymized
learning but builds no cross-account aggregation, scoring, model, or customer-facing claim. Ordinary
canonical outcome fields are preserved as usual; no speculative future-learning fields are added solely
for this deferred capability.

## Daily runtime

Tracking runs every calendar day, whether or not anyone opens the app. An account never loses a day because
the operator was busy.

- ONE global dispatcher, scheduled inside Supabase (pg_cron with pg_net, its secret held in Vault), fires on
  a fixed schedule.
- It invokes ONE guarded non-customer scheduler endpoint. That endpoint is not a customer surface, is
  authenticated by the stored secret, and fails closed.
- The scheduler claims a bounded amount of work per invocation under database-time leases, so two
  invocations can never do the same work twice and an interrupted invocation is reclaimed, not lost.
- It drives the SAME canonical runtime that a visit drives. There is exactly one research pipeline, one set
  of phases, and one progress record. No parallel scheduled implementation may exist.
- An authenticated visit and the Update data control become recovery and resume triggers: they pick up
  whatever the schedule could not finish, and they never become the only reason work happens.

The runtime uses durable Supabase state, leases, and idempotency keys. In-memory guards may optimize one
process but are never the correctness mechanism. Paid calls never run on the render path.

Progress is evidence-based, never decorative: pages read out of pages discovered; prompts checked out of the
account's approved set; engines completed; keywords retained; SERPs analyzed; competitor pages compared;
proposals prepared. Every count is read from durable stored work. The UI never implies progress it cannot
prove, and it never presents a missed day as a completed one.

## Caching and spend

- Public provider evidence is cached by canonical endpoint, input, location, language, model, and version;
  public website snapshots are content-hash aware; cache lifetimes reflect volatility, with no universal TTL.
- Tenant-derived conclusions remain tenant-scoped even when raw public evidence is safely reusable.
- Every paid call has an idempotency key, actual cost receipt, account attribution, and fail-closed spend cap.
- Batch where the provider charges primarily per task. A cache hit is observable internally and costs zero.
- Cost optimization may never silently reduce the promised evidence coverage.

Before onboarding is completed, Beacon may spend at most $2 total for that account. No recurring paid
observation work begins before activation. If the cap is reached, onboarding completes honestly with
partial evidence rather than spending more or blocking the user. This pre-activation lifetime cap is
separate from the active account's recurring spend cap.

## Product voice and experience

Beacon speaks like a confident expert working for the customer:

- first person when describing Beacon's work; plain English before technical detail;
- concrete numbers when trustworthy; one obvious next action;
- no provider, pipeline, scheduler, experiment, treatment, or internal status jargon on primary surfaces;
- no fake precision, causal overclaim, raw identifiers, bare zeros, or hardcoded customer names;
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
7. Be tracked every calendar day afterward without opening the app, with missed days visibly missing.
8. Receive deeply researched existing-page and new-page Changes.
9. Inspect why each Change outranks alternatives, and see where it stands in Visibility.
10. Mark a Change Bundle implemented after applying it manually, and have Beacon verify the live result.
11. See honest 7, 14, 28, and when needed 56-day Results.
12. Remain fully isolated from every other account.

The MVP must prove this loop for both a content-rich publisher and a local-service business without
hardcoding either business or creating separate product paths.

## Explicit non-goals

Do not build until separately approved: multiple websites per account; teams, invitations, permissions, or
billing; automated publishing; any CMS connection or integration; external schedulers or workflow platforms
outside the approved Supabase-scheduled dispatcher; email digests; revenue attribution; Google Business
Profile; offsite link, digital PR, or local SEO features; translations or non-US research; a chat or Ask
surface; standalone keyword, competitor, prompt, or diagnostics dashboards; and speculative agents,
experiments, future-intelligence systems, or duplicated pipelines.

One new customer route, `/visibility`, and one non-customer scheduler endpoint are approved. Nothing else.

## Build order

1. Reconcile generic Account, Website, and Business Profile records and remove customer and vertical
   special cases.
2. Establish one canonical DataForSEO evidence boundary while deleting the Profound, SEMrush,
   borrowed-account, and phantom native-provider architecture it replaces.
3. Replace free-form Chat Completions generation with the canonical Responses API and strict Structured
   Outputs gateway.
4. Build durable Research Runs with Supabase phases, leases, idempotency, progress, pause, and resume, then
   drive them from the scheduled dispatcher with visits as recovery.
5. Build the complete onboarding and core-prompt approval flow on those real foundations.
6. Build the complete public crawl inventory, DataForSEO research funnel, and caching.
7. Produce one deeply evidenced existing-page Change Bundle, then one deeply evidenced new-page Change.
8. Build one canonical Shipment with independent live implementation verification.
9. Build Visibility over the stored observations with drill-down to receipts.
10. Complete 7/14/28/56 measurement, overlap honesty, and both-archetype dogfooding.

Each step is one bounded vertical slice with a behavioral acceptance test. Delete superseded code in the
same slice. No slice may build a temporary duplicate pipeline for a later slice to replace.

## Protection against future bloat

- The five surfaces and five code kernels are boundaries, not invitations for more subsystems.
- One customer outcome per task.
- Prefer replacing and deleting over adding parallel abstractions.
- No feature without the eight-field proposal required by `AGENTS.md`.
- No new route, top-level domain, dependency, provider, record type, or status vocabulary without operator
  approval.
- A feature unused by real operator workflow for 30 days is reviewed for deletion.
- Suggestions and aggressive critique are welcome. Product changes require operator approval.
- Only the operator may change this Product Truth.
- Git history is the archive; do not create roadmap, audit, report, or task-summary documents.

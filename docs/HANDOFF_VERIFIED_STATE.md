# Beacon Verified State

> This file says what is implemented and verified now. The target product is `PRODUCT_TRUTH.md`. Never describe
> target behavior here as shipped behavior. Update this file only after a verified deployed state change.

## Current foundation

- Branch: `main`; verified starting commit before the MVP rebuild: `4669fbb5`.
- Stack: Next.js App Router, strict TypeScript, Supabase, Vercel.
- Production TypeScript is approximately 69,000 lines; tests 4,750; combined approximately 73,700.
- The foundation guard caps production, tests, combined LOC, domains, routes, exports, files, dependencies, and
  Markdown. `npm run gate` runs the guard, typecheck, tests, and build.
- Five kernels exist (Account, Evidence, Decision, Measurement, Runtime); four primary surfaces (Today, Changes,
  Results, Connections).
- Supabase authentication provisions one membership and one tenant per new user.
- One login resolves exactly one account, fail-closed (2026-07-23; loop-proofed 2026-07-26): on product paths the
  middleware injects the single membership's account; zero, multiple, erroring, or timed-out lookups redirect to
  login. Public paths skip the membership gate, so a stranded authenticated session can always reach login, the
  signup recovery card (retry provisioning + sign out), and sign-out instead of looping. Login and signup render
  mapped plain-language messages, never raw codes. No account switcher, enumeration, or selection cookie exists;
  an authenticated request never reaches an env-tenant fallback. `BEACON_OPERATOR_MODE` is presentation-only.
  `provisional_name` is an internal signup seed; surfaces render the BusinessProfile name, then the domain.
- Canonical Account, Website, and BusinessProfile records exist (Slice 1 + closure, 2026-07-23): the Account is
  the `tenants` row (vertical columns retired to unread legacy) resolved through account-scoped Supabase queries;
  Website is the one canonical projection of `Account.domain` (the only persisted website authority; Settings
  shows it read-only); BusinessProfile lives in the Account kernel as provenance-carrying sections (value, origin,
  confidence, source URLs) over the approved Product Truth fields, backed by the `business_config` row at
  schemaVersion 2 with raw pre-canonical JSON preserved under an inert `legacy` key. Profile reads are async and
  Supabase-only: a cold first read resolves the real identity, a missing row or transient failure is never cached,
  and no file, env, founder, or process-global fallback exists. Provisioning writes a generic row; missing
  configuration fails generic at every former leak site.
- Test fixtures carry generic account identities and domains; synthetic non-Latin-script sample content is
  retained deliberately for multilingual behavioral coverage.
- Revenue settings and the operator revenue model were removed (an MVP non-goal); unit economics is dormant.
- Publishing remains manual.
- No account can become stranded (2026-07-26): signup writes the real `business_name` column (every prior signup
  failed on a nonexistent `provisional_name` insert); an id collision can never attach a new user to an existing
  tenant; the callback resumes unfinished onboarding by resolved status. One lifecycle resolver gates the product
  pages: pending resumes `/onboard`, paused/cancelled read one honest notice, a failed or anomalous read is
  bounded retry, never a redirect, lockout, or onboarding bounce. Active accounts manage tracked questions in
  Settings, Business info via ONE shared prompt service and editor also used by Step 5 (which hydrates from the
  approved set): unchanged wording keeps its row id and history, a rewording carries `superseded:<oldId>`, legacy
  seed rows are untouched, 10..100 enforced, a valid save resumes the same paused Research Run on the next visit.
  jsonb `tags` reads pass JSON (contains() silently errored to empty, which would have kept research paused after
  a save). Copy is true: no Wix auto-publish or per-charge approval claims, no raw exception text, research is
  visit-driven, Today's paused line carries the control that fixes it.

## What is real but incomplete

- The seven-step onboarding and 50-core-prompt approval flow is live and CONNECTED (Slice 5 + closure, 2026-07-24)
  on `/onboard`: one basis, website to activation. Every `tracked_prompts` row carries a deterministic basis
  fingerprint; only current-basis rows render, count, approve, or activate, and approval's other-basis sweep
  (locally pending-only, 2026-07-26) keeps stale prompts untracked pre-activation. Website replacement
  mid-onboarding is one atomic idempotent RPC: new domain, goal cleared, prompts deactivated with history kept,
  profile reset, crawl restarted. Profile confirmation is truthful (every section operator confirmed). The prompt
  step has include/exclude, edit, group, remove behind group disclosure, server-validated per tenant and basis;
  new rows carry all four engines; the deterministic fallback never pads. Pre-activation OpenAI spend durably
  reserves projected cost BEFORE each call against the lifetime $2 cap, reconciling to actual (write failure
  overcounts and blocks); live-validated at $0.0378. Page snapshots persist (14 real upserts). Connections shows
  "Return to setup" while onboarding. Pending accounts start no Research Run at either boundary; activation is
  idempotent, requires 10..100 current-basis approved prompts plus website, confirmed profile, goal, and terms,
  starting exactly one durable Research Run. Verified end to end rendered, desktop and mobile, with real crawl,
  real model calls, mid-flow website/goal changes. One inert synthetic pending account remains for review.
- Durable visit-driven Research Runs exist (Slice 4, 2026-07-24): every authenticated visit renders the saved
  surfaces first, then claims or resumes the account's Research Run through an atomic database-time lease RPC. At
  most one unfinished run per account across all dates (partial unique index): the claim resumes it whatever day
  it started (same row, phase, cursor, progress; a live foreign lease blocks, an expired one reclaims), a
  same-UTC-day completion blocks a redundant pass; a new daily cycle (database-time key) starts only when none is
  open. A partially failed refresh durably persists the providers that synced before pausing. Seven phases mirror
  the real work (refresh sources, GSC backfill, keyword discovery, AI observation, search analysis, winning pages,
  surface publish); progress, phase, cursors durable; a killed invocation resumes at the persisted phase;
  concurrency cannot duplicate work; Today shows ONE stable status line (2026-07-26): an open error-free run reads
  "Research in progress" with the durable AI-check count (only while that phase is current), identical across
  lease states; a pause names its reason only for the recording phase; a failed tracked-question read pauses as
  its own transient reason, never a false "no questions". The scoreboard sentence carries no measuring count (the
  proof strip owns measurement). The truth boundary holds: a failed connector, backfill, or publication pauses the
  run with a bounded error, never advancing or presenting as completed; a phantom state conflict (a memoized stale
  read once paused a healthy run and zeroed its receipt) retries its phase ONCE under the same lease and attempt
  identity at $0, discarding stale counters; only a second conflict pauses; admin Supabase reads opt out of fetch
  caching and request memoization so they always hit Postgres; lease mutations are database-time security-definer
  RPCs (an expired owner cannot mutate; completed rows reject mutation); each phase's idempotency key persists
  before its side effect and survives interrupted retries; completion copy names its finish time and never claims
  research is current. All three migrations applied; the claim RPC smoke-proven against the real database.
- The DataForSEO research funnel is lifecycle-true and feeds ONE canonical evidence input (Slice 6 + closures
  6B..6I, 2026-07-25). A TYPED registry (wrong fields fail tsc; model never caller-supplied) owns each ask:
  chatgpt llm_responses web_search ONLY (live o4-mini rejected force, 40501), claude web + force + US, gemini
  web_search, perplexity Live, the scraper force + expand_citations; providerCall routes Standard-vs-Live; the
  boundary returns the FULL envelope and never auto-retries paid work after a refusal or ambiguity. Money:
  tenant-independent `evidence_cache` + single-flight claim + dry-run default + breaker + ATOMIC reserve BEFORE
  the network + reconcile; reservation cap with bounded overshoot; persistence FAILS CLOSED to a zero-row UPDATE.
  Every failure carries a structured disposition; ONE paid-response policy: only in-body 40401/40403 on a FREE
  collect earn a single repost; a rejected paid response at REPORTED cost 0 releases only when EVERY status is an
  exact temporary code (a 40203 daily ceiling releases for tomorrow), else refunds into a DURABLE blocked hold
  (raw 401/402/404 too); an UNCERTAIN (possibly charged) outcome is QUARANTINED INDEFINITELY, reservation kept,
  recovered only via free tasks_ready (Standard; Live has none); holds carry reasons, cleared only by the
  operator. A BLOCKED response PAUSES the run visibly with the provider's reason, stopping the batch; quarantined
  stays explicitly unavailable; a model-cache read failure makes zero calls. Rows expire on the registry ttl;
  completion counts only CURRENT CANONICAL pairs/queries (pruned, stale-done outstanding, weekly re-entry); the
  per-cycle receipt is real. Every AI observation carries a frozen MODE: consumer_search (the ChatGPT scraper) is
  THE canonical ChatGPT signal on every core prompt; standardized_response is canonical for the other three
  engines plus a bounded 20-prompt AUXILIARY chatgpt sample that inflates no denominator and never pauses the run.
  Presence, recurrence, winning pages, history ids, the hash: all mode-true (a citation seen via both chatgpt
  modes counts once, consumer preferred). Gemini wrappers resolve redirect-only (hardened SSRF screen, bounded) to
  the real source before ranking, viaUrl kept; unresolved never rank. Funnel state is Supabase-only, basis-scoped
  (optimistic row_version). The canonical EvidenceSnapshot carries the research bundle (retained keywords; AI
  observations with prompt text, tri-state citations, webSearchReported, model drift; SERP evidence; winning pages
  with provenance; per-run receipt), the ONE public evidence input; the hash fingerprints MATERIAL content only.
  Proof is hermetic AND live-validated (2026-07-25, $2 provider day cap proven): labs, Standard SERP, all four
  engines and the scraper ran for $0.07: free Standard collection, durable Live persistence, $0 repeat hits, a
  cent-exact ledger, a crashed POST quarantined then recovered free by its tag. Production research is ENABLED
  (2026-07-25).
- OpenAI generation flows through one strict Responses API gateway (Slice 3, 2026-07-23): /v1/responses with
  json_schema strict:true; every call site converted; the Completions transport and prose JSON recovery are
  deleted. Account-scoped end to end (2026-07-24): the structured-output cache is tenant-scoped with the account
  in the key hash and on every entry (old global blob inert), de-templating history never crosses accounts,
  tenantId is required from drafter entry through cache, budget, transport, provenance, and error ledger; invalid
  envelopes retain real usage cost. The LLM budget is per-account on BOTH layers (tenant-scoped file backstop;
  durable Supabase ledger authoritative); one account's spend never throttles another. A regression sweep converts
  every SCHEMA_BY_KIND entry through the strict-subset conversion. Transport and live behavior are validated; the
  OpenAI key enables this path directly, no secondary flag.
- DOING NOTHING IS THE DEFAULT AND AN EXACT RESULTS PAGE MUST EXPLAIN THE ACTION (2026-07-27): each page is
  diagnosed against its OWN exact query rows and the shipped click curve BEFORE any draft; an action needs
  impressions to trust, a real gap at that position, and enough recoverable clicks to be worth a morning. A row I
  hold nothing about is not a page I judged. HOLDING the live results page is not READING it: ActionDiagnosis reads
  the line Google displays for the page, the wording that recurs across the SITES beating it (one site twice is that
  site's style), and the gap between them, so only a named cause with a competing explanation ruled out becomes
  work; token containment is deleted. Nothing reaches a drafter before a diagnosis, so an unsupported change costs
  nothing. Confidence follows evidence completeness, never the draft. A page's own words are readable through a
  targeted reader over the snapshot columns the shared projection drops (explicit account, three URLs, bounded,
  fails closed), so drafts are checked against the page itself. An investigation gets BOTH halves of its evidence:
  the results page for that exact search and the pages that win it, priority first, noise domains excluded; only a
  query with no results page yet can be closed by buying one. The diagnosis and every alternative it ruled out are
  receipt items, and every count is derived from real items. A held Ready change is re-judged and set aside when the
  evidence stops supporting it. Copy is honest about its own limits: search averages cover every country and device,
  so a page missing from one collected results page is a different slice of Google and never proof it does not rank,
  and a rank counting ads and packs is never printed as a position. Decision generation 5: NEW-PAGE GENERATION IS
  DELETED (2026-07-28), because turning a competitor's example prompt into a page shipped duplicates of pages the
  account already owned. Nothing creates, drafts or resurrects one; stored rows still decode, render and measure,
  and the queue refuses the kind as well as the basis. Live replay 2026-07-27 (SHA
  e92bdbd1): 0 actionable, 23 investigations, 164 watch, 31 do nothing, 0 Ready; the next pass buys the three
  searches with no results page yet. ONE canonical path produces the ranked queue AND at most one deep
  existing-page Change per pass: receipt-first, citable research REQUIRED, thin evidence = refusal.
  Parts bundle ONLY when they are one repair; a bundle REPLACES its shallow rows. Evidence tells the truth about itself: query identity on the receipt, winners attaching ONLY on
  exact URL or exact member query or prompt, a page that arrived by rank never called an AI citation, internal links
  withheld while no body backs them, metric sentences naming their scope, and a producer failure never publishing a
  fresh timestamp over stale proposals. Page snapshots read Supabase. Business Info is provenance-safe. Results
  bands are maturity-true: early = Promising, Win = 28-day only, still-measuring carries no verdict. Today counts
  the full Ready list, names how many pages are under investigation, and carries the decision's own verdict for the
  page it blames; manual implementation and 7/14/28 stand.
## Known target mismatches

- Profound and SEMrush survive only as historical-row reads and inert comments (Slice 2 removed the connector
  provider, health entries, question seeding, drafter sources, the customer-visible AEO confidence gate, the
  vendor benchmark, the Actions dispatch, and the provider-import architecture); never revive them.
- Production DataForSEO is ENABLED (operator-approved 2026-07-25): credentials are the sole activation, bounded by
  the proved $2 provider-day cap and the default $50 tenant month cap.
- Real-customer names remain in historical code comments outside the Account boundary (executable strings and
  fixtures are clean).
- Legacy `.data`/dual-write code remains for non-account stores; the Account/Profile path no longer uses it.

## Environment readiness

Verified variable-name presence without reading or printing values:

- Local and Vercel production have Supabase and OpenAI credentials.
- Vercel production has Google OAuth client credentials and a GSC site configuration.
- DataForSEO credentials are live-validated locally AND set on Vercel production (Encrypted, Production scope,
  redeploy dpl_GigNyZia97r2gpH3yesXbRiqWXBo); missing credentials fail closed. Never place credentials in chat,
  documentation, commits, or command output.

## Current routes

- Today `/`; Changes `/changes` and `/changes/[id]`; Results `/results`; Connections `/settings/connectors`
- Minimal settings, onboarding, login, signup, Google callback, and version routes

New customer routes require operator approval.

## Next slice

New-page generation stays DELETED (N1, generation 5). N2 built the non-actionable research packet; N3a gave it a
production consumer naming the strongest of 53 live packets. NEXT is N3b, owned-page coverage mapping and the
five-verdict adjudication, which nothing yet produces; then N3c, N4 (drafts only on an earned create_new), Shipment.

## Verification

- Use the real main tree at `/Users/armeen/beacon`; preserve untracked `.codex/` and `supabase/` content.
- Run `npm run gate` before completion.
- An accepted implementation plan authorizes commit, push to `origin/main`, Vercel deployment, and hosted smoke
  verification, subject to the destructive and external-state pauses in `AGENTS.md`.

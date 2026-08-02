# Beacon Verified State

> This file says what is implemented and verified now. The target product is `PRODUCT_TRUTH.md`. Never describe
> target behavior here as shipped behavior. Update this file only after a verified deployed state change.

## Current foundation

- Branch `main`; MVP rebuild started at `4669fbb5`. Stack: Next.js App Router, strict TypeScript, Supabase, Vercel.
- Production TypeScript is 79,886 lines; tests 11,193; combined 91,079 (ceilings at these exact counts).
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
- Test fixtures carry generic identities; synthetic non-Latin-script sample content is retained for coverage.
- Revenue settings were removed (an MVP non-goal); unit economics is dormant; publishing remains manual.
- No account can become stranded (2026-07-26): signup writes the real `business_name` column (every prior signup
  failed on a nonexistent `provisional_name` insert); an id collision can never attach a new user to an existing
  tenant; the callback resumes unfinished onboarding by resolved status. One lifecycle resolver gates the product
  pages: pending resumes `/onboard`, paused/cancelled read one honest notice, a failed or anomalous read is
  bounded retry, never a redirect, lockout, or onboarding bounce. Active accounts manage tracked questions in
  Settings, Business info via ONE shared prompt service and editor also used by Step 5 (which hydrates from the
  approved set): unchanged wording keeps its row id and history, a rewording carries `superseded:<oldId>`, legacy
  seed rows are untouched, 10..100 enforced in Settings, a valid save resumes the same paused Research Run on the next visit.
  jsonb `tags` reads pass JSON (contains() silently errored to empty, which would have kept research paused after
  a save). Copy is true: no auto-publish or per-charge approval claims, no raw exception text, research today
  runs when the app is opened, Today's paused line carries the control that fixes it.

## What is real but incomplete

- The seven-step onboarding and approved-question flow is live and CONNECTED (Slice 5 + closure, 2026-07-24)
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
  idempotent, requires the setup window server side (approval holds 20..50, floor bending to a thin candidate pool; activation re-checks 10..50 on the set that survived it) plus website, confirmed profile, goal, and terms,
  starting exactly one durable Research Run. Verified end to end rendered, desktop and mobile, with real crawl,
  real model calls, mid-flow website/goal changes. One inert synthetic pending account remains for review.
- Durable Research Runs exist (Slice 4, 2026-07-24), triggered today by an authenticated visit. That trigger is
  the CURRENT MECHANISM ONLY, not the product's design: Product Truth requires daily tracking without a visit,
  and the Dream V1 program replaces the trigger with a Supabase-scheduled dispatcher driving this same runtime,
  leaving visits as recovery. Everything below describes the runtime as built. Every authenticated visit renders the saved
  surfaces first, then claims or resumes the account's Research Run through an atomic database-time lease RPC. At
  most one unfinished run per account across all dates (partial unique index): the claim resumes it whatever day
  it started (same row, phase, cursor, progress; a live foreign lease blocks, an expired one reclaims), a
  same-day completion (the operator's Pacific day, computed in the claim RPC) blocks a redundant pass; a new daily cycle starts only when none is
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
  6B..6I, 2026-07-25). A TYPED registry owns each engine's ask; providerCall routes Standard-vs-Live; the
  boundary returns the FULL envelope and never auto-retries paid work after a refusal or ambiguity. Money:
  tenant-independent `evidence_cache`, single-flight claim, breaker, ATOMIC reserve before the network,
  reconcile; persistence fails closed. One paid-response policy: temporary codes release, everything else
  refunds into a durable blocked hold; an uncertain outcome is quarantined, recovered only via free
  tasks_ready; a BLOCKED response pauses the run visibly. Completion counts only current canonical pairs.
  Every observation carries a frozen MODE: consumer_search is THE canonical ChatGPT signal;
  standardized_response is canonical for the other engines plus a bounded auxiliary chatgpt sample.
  Gemini wrappers resolve to the real source before ranking. Funnel state is Supabase-only, basis-scoped.
  The canonical EvidenceSnapshot is the ONE public evidence input; the hash fingerprints material content
  only. Proof is hermetic AND live-validated (2026-07-25, $0.07 across all engines, cent-exact ledger).
  Production research is ENABLED (2026-07-25). Full mechanics: git history of this section.
- OpenAI generation flows through one strict Responses API gateway (Slice 3, 2026-07-23): json_schema
  strict:true, every call site converted, the Completions transport deleted. Account-scoped end to end
  (2026-07-24): tenant-scoped cache, budget, transport, provenance, and error ledger; the per-account LLM
  budget rides a tenant-scoped file backstop with the durable Supabase ledger authoritative; one account's
  spend never throttles another. The OpenAI key enables this path directly, no secondary flag.
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
  and a rank counting ads and packs is never printed as a position. Decision generation 6: PROMPT-TO-PAGE
  GENERATION STAYS DELETED (2026-07-28), because turning a competitor's example prompt into a page shipped
  duplicates of pages the account already owned. The ONLY door to a new page is an EARNED create_new, proved by
  a bought page comparison; no other trigger creates, drafts or resurrects one. Live replay 2026-07-27 (SHA
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
  provider, seeding, drafter sources, confidence gate, benchmark, and Actions dispatch); never revive them.
- Production DataForSEO is ENABLED (operator-approved 2026-07-25): credentials are the sole activation, bounded
  by the provider $25 day cap, a $250 per-account month cap and a $500 global breaker (raised 2026-07-31).
- Real-customer names remain only in historical code comments (executable strings and fixtures are clean).
- Legacy `.data`/dual-write code remains for non-account stores; the Account/Profile path no longer uses it.

## Environment readiness

Verified variable-name presence without reading or printing values:

- Local and Vercel production have Supabase and OpenAI credentials.
- Vercel production has Google OAuth client credentials and a GSC site configuration.
- DataForSEO credentials are live-validated locally AND set on Vercel production; missing credentials fail
  closed. Never place credentials in chat, documentation, commits, or command output.

## Current routes

- Today `/`; Changes `/changes` and `/changes/[id]`; Results `/results`; Connections `/settings/connectors`;
  minimal settings, onboarding, login, signup, Google callback, and version routes. New customer routes
  require operator approval.

## V1 Truth Convergence (Phases 0-9 complete, 2026-08-01)

Canonical `ai_observations` keeps every AI answer whole (identity: tenant, prompt, version, engine, reporting
day, sample slot; journey keeps fan-outs, retrieved-not-cited and citations apart; pao is a projection).
Tracked prompts carry `version` and `core`; the planner observes slot 0 daily (on visit today, on schedule
under Dream V1), slots 1-2 via Update data (max 3/day), and never fabricates a missed day. Cases are a partition (one owner per anchor); freshness
is one leaf matrix; diagnosis is a 15-cause ladder with competing explanations and a falsifier on every
proposal. `change_proposals` holds ONE current row per (account, case, page, action family) with supersession
chains. A marked change is a Shipment: write-once `implemented_at` stamp and baseline, live verification, and
28-day windows anchored on the stamp (conditional day-56). AI outcomes read slot-0 rows; mention rate divides
by analyzed. Today is four total states reading one release blob, so no two surfaces disagree on a count. All
four 2026-07-31 migrations applied to production before the push. The live account runs the operator's own
35 approved questions and nothing else (an earlier 85 here summed two tenants; the synthetic onboarding
account's 50 candidates are core-flagged off, reversibly, and 50 legacy seeds stay deactivated).

## V1 Closure and Decision Honesty (2026-08-01 and 2026-08-02, deployed with this state)

The loop's integrity breaks are closed: one derived BrandIdentity with a deterministic text and citation
matcher behind the model; whole-range paginated reads that throw rather than truncate; retrieved-but-not-
cited derived by canonical url subtraction; batched analysis; terminal pair states on the canonical row; the
open-tab continuation controller; one Pacific reporting day including the cycle key RPC; origin receipts on
fan-out keywords; atomic supersession; lint in the gate; the proxy convention. On top of that, pinned by end
to end tests: the deep read has five doors and each earns on ITS OWN evidence (an AI citation loss or a
coverage verdict needs no Google click deficit; a door that did not measure clicks may not conclude a
wording change; two pages splitting a search can only consolidate or refuse). The owned page is one bounded
representation of everything the store holds with a derived completeness verdict; the store keeps samples,
so whole-page questions answer yes or unknown, never a false no, and absence claims are filtered against the
held page before they fire. Analysis coverage is resumable by piece: the answer hash lands only at full
coverage, a partial stays due and resumes at the first unread piece, and every completed-check denominator
counts only settled readings. A full rewrite or new page is Ready only when every planned section and the
opening drafted and validated; source packs name the source whole or say the operator picks it and hold for
review, and the component card renders where, why, and the sources. The first live run is the operator's.

## Verification

- Use the real main tree at `/Users/armeen/beacon`; preserve untracked `.codex/` and `supabase/` content. Run
  `npm run gate` before completion. An accepted plan authorizes commit, push to `origin/main`, deployment, and
  hosted smoke verification, subject to the destructive and external-state pauses in `AGENTS.md`.

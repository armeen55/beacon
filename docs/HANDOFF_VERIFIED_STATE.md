# Beacon Verified State

> This file says what is implemented and verified now. The target product is `PRODUCT_TRUTH.md`. Never describe
> target behavior here as shipped behavior. Update this file only after a verified deployed state change.

## Current foundation

- Branch: `main`; verified starting commit before the MVP rebuild: `4669fbb5`.
- Stack: Next.js App Router, strict TypeScript, Supabase, Vercel.
- Production TypeScript is approximately 69,000 lines; tests 4,750; combined approximately 73,700.
- The foundation guard caps production, tests, combined LOC, domains, routes, exports, files, dependencies, and
  Markdown. `npm run gate` runs the guard, typecheck, tests, and build.
- Five kernels exist (Account, Evidence, Decision, Measurement, Runtime); four primary surfaces (Today, Changes, Results, Connections).
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
- No account can become stranded (2026-07-26): signup writes the real `business_name` column (every prior new
  signup failed on a nonexistent `provisional_name` insert); an id collision can never attach a new user to an
  existing tenant; the auth callback resumes unfinished onboarding by resolved status. One lifecycle resolver
  (`domains/account/lifecycle.ts`) gates the product pages: pending resumes `/onboard`, paused/cancelled read one
  honest notice, a failed or anomalous read is bounded retry, never a redirect, lockout, or onboarding bounce.
  Active accounts manage tracked questions in Settings, Business info (`#tracked-ai- prompts`) via ONE shared
  prompt service and editor also used by Step 5 (which hydrates from the approved set): unchanged wording keeps
  its row id and history, a rewording carries `superseded:<oldId>`, legacy seed rows are untouched, 10..100
  enforced, a valid save resumes the same paused Research Run on the next visit. jsonb `tags` reads pass JSON
  (contains() silently errored to empty, which would have kept research paused after a valid save). Copy is true:
  no Wix auto-publish or per-charge approval claims, no raw exception text, research is visit-driven, and Today's
  paused line carries the one control that fixes it.

## What is real but incomplete

- The seven-step onboarding and 50-core-prompt approval flow is live and CONNECTED (Slice 5 + closure, 2026-07-24)
  on `/onboard`: one basis runs from website to activation. Every `tracked_prompts` row carries a deterministic
  basis fingerprint (account, domain, confirmed research-affecting fields, goal, generation version); only
  current-basis rows render, count, approve, or activate, and approval's other-basis sweep (now locally pending-
  only, 2026-07-26) keeps stale prompts from staying tracked pre-activation. Website replacement mid-onboarding is
  one atomic idempotent RPC: new domain, goal cleared, prompt rows deactivated with history kept, profile reset,
  crawl restarted. Profile confirmation is truthful (every section operator- confirmed). The prompt step has per-
  prompt include/exclude, edit, group, remove behind group disclosure, server-validated per tenant and basis; new
  rows carry all four engines as scope only; the deterministic fallback never pads. Pre-activation OpenAI spend
  durably reserves projected cost BEFORE each call against the lifetime $2 cap and reconciles to actual (write
  failure overcounts and blocks); live-validated for $0.0378 across two synthetic accounts. Page snapshots persist
  (14 real upserts on the walk). Connections shows "Return to setup" while onboarding. Pending accounts can start
  no Research Run at the runtime or claim-RPC boundary; activation is idempotent, requires 10..100 current-basis
  approved prompts plus website, confirmed profile, goal, and terms, and starts exactly one durable Research Run.
  Verified end to end rendered, desktop and mobile, with real crawl, real model calls, mid-flow website and goal
  changes. One inert synthetic pending account (`tenant-smoke-onboard`) remains for operator review.
- Durable visit-driven Research Runs exist (Slice 4, 2026-07-24): every authenticated visit renders the saved
  surfaces first, then claims or resumes the account's Research Run through an atomic database-time lease RPC. At
  most one unfinished run per account across all dates (partial unique index): the claim resumes it whatever day
  it started (same row, phase, cursor, attempt key, progress; a live foreign lease blocks, an expired one
  reclaims), a same-UTC-day completion blocks a redundant pass, and a new daily cycle (database-time key) starts
  only when none is open. A partially failed refresh durably persists the providers that actually synced before
  pausing. Seven phases mirror the real work (refresh sources, bounded GSC backfill, keyword discovery, core-
  prompt AI observation, search analysis, winning-page comparison, surface publish); progress, phase, and cursors
  are durable; a killed invocation resumes at the persisted phase after lease expiry; concurrent instances cannot
  duplicate work; Today shows ONE stable persisted status line (2026-07-26): an open error-free run reads
  "Research in progress" with the durable AI-check count (only while that phase is current), identical across
  lease states so it never flips on a healthy provider wait; a pause names its reason only for the phase that
  recorded it; a failed tracked-question read pauses as its own transient reason, never a false "no questions".
  The scoreboard sentence carries no measuring count (the proof strip owns measurement, one count per cohort). The
  truth boundary is enforced: a failed connector, backfill, or publication pauses the run at its phase with a
  bounded error and never advances or presents as completed; lease mutations are database-time security-definer
  RPCs (an expired owner cannot mutate; completed rows reject mutation); each phase's idempotency key persists
  before its side effect and survives interrupted retries; completion copy names its finish time and never claims
  research is current. The warm-receipt store, process-local scheduled Set, and once-daily Pacific gate are
  deleted; all three migrations are applied and the claim RPC was smoke- proven against the real database.
- The DataForSEO research funnel is lifecycle-true and feeds ONE canonical evidence input (Slice 6 + closures
  6B..6I, 2026-07-25). A TYPED registry (CapabilityInputByKey; wrong fields fail tsc; model never caller-supplied)
  owns each ask, live-verified: chatgpt llm_responses web_search ONLY (the live o4-mini is reasoning and rejected
  force, 40501), claude web + force + US, gemini web_search only, perplexity Live, the scraper force +
  expand_citations; providerCall routes Standard-vs-Live from task_post_supported; the boundary returns the FULL
  bounded envelope and never auto-retries paid work after a refusal or ambiguity. Money: tenant- independent
  `evidence_cache` + single-flight claim + dry-run default + breaker + ATOMIC reservation BEFORE the network +
  reconcile; reservation-based cap with bounded overshoot; persistence and reads FAIL CLOSED to a zero- row
  UPDATE. Every failure carries a structured disposition; ONE paid-response policy: only in-body 40401/40403 on a
  FREE collect earn ONE repost per incident; a rejected paid response at REPORTED cost 0 releases only when EVERY
  status is an exact temporary code (a daily-ceiling 40203 releases for tomorrow), else refunds into a DURABLE
  blocked hold (raw 401/402/404 too); an UNCERTAIN (possibly charged) outcome is QUARANTINED INDEFINITELY,
  reservation kept, recovered only via free tasks_ready (Standard; Live has none); holds carry on- row reasons,
  clearing only by operator action (quarantined_at, plus posted_attempt_at when uncertain). A BLOCKED response
  PAUSES the run visibly with the provider's reason and stops the batch; quarantined stays explicitly unavailable
  so no key stalls a phase; a model-cache read failure makes zero provider calls. Rows expire on the registry ttl;
  completion counts only CURRENT CANONICAL pairs/queries (pruned, stale-done outstanding, weekly re-entry); run id
  and per-cycle receipt are real. Every AI observation carries a frozen retrieval MODE: consumer_search (the
  ChatGPT scraper) is THE canonical citation-grade ChatGPT signal on every core prompt; standardized_response is
  canonical for the other three engines plus a bounded 20-prompt AUXILIARY chatgpt sample that inflates no
  denominator and never pauses the run (aux block = unsupported). Presence, recurrence, winning pages, history
  ids, the hash: all mode-true (a citation seen via both chatgpt modes counts once, consumer preferred; legacy
  rows count as before). Gemini vertexaisearch wrappers resolve redirect-only (hardened SSRF screen, bounded) to
  the real source before ranking, viaUrl kept; unresolved never rank. Funnel state is Supabase-only, basis-scoped
  (research_state, optimistic row_version). The canonical EvidenceSnapshot carries the research bundle (retained
  keywords; AI observations with prompt text, tri-state citations, webSearchReported, model drift; SERP evidence;
  winning pages with appearance provenance; per-run receipt), the ONE public evidence input; the hash fingerprints
  MATERIAL content, never clocks. Proof is hermetic on fixtures AND live-validated (2026-07-25, $2 provider day
  cap proven): labs, Standard SERP, all four engines and the scraper ran end to end for $0.07 with free Standard
  collection, durable Live persistence, $0 repeat hits, a cent-exact ledger, and a crashed POST quarantined then
  recovered free by its tasks_ready tag. Production research is ENABLED (2026-07-25).
- OpenAI generation flows through one strict Responses API gateway (Slice 3, 2026-07-23): /v1/responses with
  json_schema strict:true; every call site converted; the Completions transport and prose JSON recovery are
  deleted. Account-scoped end to end (2026-07-24): the structured-output cache is tenant-scoped with the account
  in the key hash and on every entry (old global blob inert), de-templating history never crosses accounts,
  tenantId is required from drafter entry through cache, budget, transport, provenance, and error ledger; invalid
  envelopes retain real usage cost. The LLM budget is per-account on BOTH layers (tenant-scoped file backstop;
  durable Supabase ledger authoritative); one account's spend never throttles another. A regression sweep converts
  every SCHEMA_BY_KIND entry through the strict-subset conversion. Transport and live behavior are validated; the
  OpenAI key enables this path directly, no secondary flag.
- One canonical path produces the ranked Changes queue AND one deep Change Bundle PER ARCHETYPE per pass at most
  (Slices 7+8, 2026-07-25): the strongest page rewrite and researched topic (pure insertions; citable research
  REQUIRED; threshold-gated cannibalization): receipt-first plain-English evidence with an honest missing list;
  deterministic; thin evidence = refusal. A bundle REPLACES its shallow rows at generation and load, rides
  ChangeProposal, renders as the flagship row and two-layer /changes/[id] detail, and stays manual. Proposals are
  BASIS-STAMPED (2026-07-26): a row off the current basis, or owing a source, demotes to To do in presentation
  only, and the surfaces say why. Page snapshots read Supabase; page-surgeon generation is gone. Business Info is
  universal and provenance-safe: displayed fields confirm on save, blank optionals keep prior value AND origin, no
  save merges over a failed read; research needs offerings or topics. Results bands are maturity-true everywhere:
  early improvement = Promising, Win = 28-day only, still-measuring carries no verdict, lifts never mis-signed.
  Today counts the full Ready list and the bleeding-page alarm links to its fix; manual implementation and 7/14/28
  measurement stand. Research is DECISION-LED (2026-07-26): one deterministic account-scoped agenda fills the 40
  paid search looks (own-page queries declining-first, tracked questions + fan-outs, one strong keyword per
  confirmed theme, bounded volume exploration), every topical judgment anchored against the account's own over-
  frequent tokens; the existing-page receipt topic-filters AI observations and winning pages (previously
  unfiltered), weak evidence drops to the honest refusal, and cannibalization needs a strong shared token at the
  same 0.6 calibration. Verified against the completed live pass: money queries take the first slots, news
  exploration bounded to 8 of 40.

## Known target mismatches

- Profound and SEMrush survive only as historical-row reads and inert comments (Slice 2 removed the connector
  provider, health entries, question seeding, drafter sources, the customer-visible AEO confidence gate, the
  vendor benchmark, the Actions dispatch, and the provider-import architecture); never revive them.
- Production DataForSEO is ENABLED (operator-approved 2026-07-25): credentials are the sole activation,
  bounded by the proved $2 provider-day cap and the default $50 tenant month cap.
- Real-customer names remain in historical code comments outside the Account boundary (executable strings and fixtures are clean).
- Legacy `.data`/dual-write code remains for non-account stores; the Account/Profile path no longer uses it.

## Environment readiness

Verified variable-name presence without reading or printing values:

- Local and Vercel production have Supabase and OpenAI credentials.
- Vercel production has Google OAuth client credentials and a GSC site configuration.
- DataForSEO credentials are live-validated locally AND set on Vercel production (Encrypted, Production
  scope, applied via redeploy dpl_GigNyZia97r2gpH3yesXbRiqWXBo); missing credentials still fail closed.

Never place credentials in chat, documentation, commits, or command output.

## Current routes

- Today `/`
- Changes `/changes` and `/changes/[id]`
- Results `/results`
- Connections `/settings/connectors`
- Minimal settings, onboarding, login, signup, Google callback, and version routes

New customer routes require operator approval.

## Next slice

Slices 1 through 8 are complete and deployed. The next build-order step is Slice 9: one canonical Shipment
with live implementation verification. It requires the eight fields from `AGENTS.md` and explicit operator
approval before implementation; production research requires only the existing DataForSEO credentials and
no enablement flag or parallel activation path.

## Verification

- Use the real main tree at `/Users/armeen/beacon`.
- Preserve unrelated untracked `.codex/` and `supabase/` content.
- Run `npm run gate` before completion.
- An accepted implementation plan authorizes commit, push to `origin/main`, Vercel deployment, and hosted smoke
  verification, subject to the destructive and external-state pauses in `AGENTS.md`.

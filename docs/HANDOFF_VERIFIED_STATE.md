# Beacon Verified State

> This file says what is implemented and verified now. The target product is `PRODUCT_TRUTH.md`. Never describe
> target behavior here as shipped behavior. Update this file only after a verified deployed state change.

## Current foundation

- Branch: `main`; verified starting commit before the MVP rebuild: `4669fbb5`.
- Stack: Next.js App Router, strict TypeScript, Supabase, Vercel.
- Production TypeScript is approximately 70,600 lines; tests approximately 4,700; combined approximately 75,300.
- The foundation guard caps production, tests, combined LOC, domains, routes, exports, files, dependencies, and
  Markdown. `npm run gate` runs the guard, typecheck, tests, and build.
- Five kernels exist: Account, Evidence, Decision, Measurement, Runtime.
- Four primary surfaces exist: Today, Changes, Results, Connections.
- Supabase authentication provisions one membership and one tenant per new user.
- One login resolves exactly one account, fail-closed (2026-07-23): the middleware injects the single membership's
  account; zero, multiple, erroring, or timed-out membership lookups all redirect to login (`no_account` /
  `multiple_accounts_unsupported` / `account_unavailable`). No account switcher, enumeration, or selection cookie
  exists (the retired `beacon_tenant` cookie is never read and is actively expired); an authenticated request can
  never reach an env-tenant fallback. `BEACON_OPERATOR_MODE` is presentation-only: OAuth connector ownership and
  every measurement/publish mutation require the authenticated account owner's membership row. `provisional_name`
  is an internal signup seed; surfaces render the BusinessProfile name, then the domain.
- Canonical Account, Website, and BusinessProfile records exist (Slice 1 + closure, 2026-07-23): the Account is
  the `tenants` row (vertical columns retired to unread legacy) resolved through account-scoped Supabase queries;
  Website is the one canonical projection of `Account.domain` (the only persisted website authority; Settings
  shows it read-only); BusinessProfile lives in the Account kernel as provenance-carrying sections
  (`ProfileSection`: value, origin, confidence, source URLs) over the approved Product Truth fields, backed by the
  `business_config` row at schemaVersion 2 with raw pre-canonical JSON preserved under an inert `legacy` key.
  Profile reads are async and Supabase-only: a cold first read resolves the real identity, a missing row or
  transient failure is never cached as identity, and no file, env, founder, or process-global fallback exists.
  Provisioning writes a generic row; missing configuration fails generic at every former leak site.
- Test fixtures carry generic account identities and domains; synthetic non-Latin-script sample content is
  retained deliberately for multilingual behavioral coverage.
- Revenue settings and the operator revenue model were removed (revenue attribution is an MVP non-goal);
  the unit-economics pass is dormant with no configurable model.
- Publishing remains manual.

## What is real but incomplete

- The seven-step onboarding and 50-core-prompt approval flow is live and CONNECTED (Slice 5 + closure, 2026-07-24)
  on `/onboard`: one onboarding basis runs from website to activation. Every derived artifact carries a
  deterministic basis fingerprint (account, domain, confirmed research-affecting fields, goal, generation version)
  on its `tracked_prompts` rows; only current-basis rows render, count, approve, or activate, and approval sweeps
  every other-basis active row so an abandoned goal or profile never leaves stale prompts tracked. Replacing the
  website mid-onboarding is one atomic RPC (`replace_onboarding_website`, applied): new domain, goal cleared,
  prompt rows deactivated (history kept), profile reset, crawl restarted; the same domain re-submitted stays
  idempotent. Profile confirmation is truthful (every section operator-confirmed; a name-only edit or single patch
  never advances it). The prompt step has real per-prompt controls (include/exclude, edit, group, remove) behind
  group-level disclosure, server-validated against the current tenant and basis; new rows carry all four intended
  engines as tracking scope only. The deterministic fallback asks natural per-family questions from confirmed
  facts and never pads. Pre-activation OpenAI spend reserves the projected cost durably BEFORE each call against
  the lifetime $2 cap and reconciles to actual (a write failure overcounts and blocks, never undercounts);
  live-validated on the real API and the rendered walk for $0.0378 across two synthetic accounts. Page snapshots
  persist again (the dead `images` field is deleted; 14 real snapshots upserted on the walk). Connections shows a
  status-derived "Return to setup" while onboarding. Pending accounts can start no Research Run at either the
  runtime or claim-RPC boundary; activation is idempotent, requires 10..100 current-basis approved prompts plus
  website, fully confirmed profile, goal, and terms, and starts exactly one durable Research Run. Verified end to
  end on the rendered app, desktop and mobile, with a real crawl, real model calls, and mid-flow website and goal
  changes (the old prompt set visibly stranded and regenerated). One synthetic pending account
  (`tenant-smoke-onboard`) remains for operator review per the no-unapproved-deletion rule; it is inert.
- Durable visit-driven Research Runs exist (Slice 4, 2026-07-24): every authenticated visit renders the saved
  surfaces first, then claims or resumes the account's Research Run through an atomic database-time lease RPC. At
  most one unfinished run exists per account across all dates (partial unique index, 2026-07-24): the claim
  resumes the one unfinished run whatever day it started (same row, phase, cursor, attempt key, progress; a live
  foreign lease blocks creation, an expired one reclaims), a same-UTC-day completion blocks a redundant pass, and
  a new daily cycle (key computed at database time) starts only when no run is open. A partially failed connector
  refresh durably persists the providers that actually synced (deduplicated across retries) before pausing, so a
  mixed attempt never strands its succeeded sources. Seven phases mirror the real work (refresh stale sources, one
  bounded GSC backfill chunk, keyword discovery, core-prompt AI observation, retained-query search analysis,
  winning-page comparison, evidence-conditioned surface publish); progress, phase, and cursors are durable; a
  killed invocation resumes at the persisted phase after lease expiry; concurrent instances cannot duplicate work;
  Today shows one honest persisted status line (a dead lease reads paused). The truth boundary is enforced
  (2026-07-24): a failed connector, backfill, or surface publication pauses the run at its phase with a bounded
  error and never advances, publishes, or presents as completed research; lease mutations (advance, pre-phase
  renew, finish) are database-time security-definer RPCs so an expired owner cannot mutate a run and completed
  rows reject all mutation; each phase's idempotency key is persisted before its side effect and reused across
  interrupted retries; completion copy says "Latest research pass finished today/(date) at h:mm" and never claims
  research is current. The old warm-receipt store, process-local scheduled Set, and once-daily Pacific gate are
  deleted; all three migrations are applied to production and the claim RPC was smoke-proven against the real
  database (service role executes, a live foreign lease loses, an expired lease reclaims yesterday's row by the
  same id with its attempt key intact, a same-UTC-day completion short-circuits, a later day creates, and a direct
  second open-row insert violates the index). Verified end to end on the rendered app: a real visit completed
  cycle tenant-iranopedia:2026-07-24 (2 sources refreshed, surface published, lease released) and Today rendered
  the honest completion line for that pass.
- The DataForSEO research funnel is lifecycle-true and feeds ONE canonical evidence input (Slice 6 + closures
  6B..6I, 2026-07-25). A TYPED registry (CapabilityInputByKey; wrong fields fail tsc; model never caller-supplied)
  owns each engine ask, live-verified: chatgpt llm_responses web_search ONLY (the live o4-mini is reasoning and
  rejected force, 40501), claude web + force + US, gemini web_search only, perplexity Live, the scraper force +
  expand_citations; providerCall routes Standard-vs-Live from task_post_supported. The boundary returns the FULL
  bounded envelope; Beacon never auto-retries a paid request after a refusal or ambiguity. Money:
  tenant-independent `evidence_cache` + single-flight claim + dry-run default + breaker + ATOMIC reservation
  BEFORE the network + reconcile; reservation-based cap with bounded overshoot; persistence and reads FAIL CLOSED
  to a zero-row UPDATE. Every failure carries a structured disposition; every PAID response passes ONE policy:
  ONLY in-body 40401/40403 on a FREE collect earn ONE repost per incident; a rejected paid response with
  provider-REPORTED cost 0 releases only when EVERY status (top and task) is an exact temporary code, else refunds
  into a DURABLE blocked hold no revisit retries (raw 401/402/404 too); an UNCERTAIN (possibly charged) outcome is
  QUARANTINED INDEFINITELY, reservation kept, recovered only via free tasks_ready (Standard; Live has none); holds
  carry on-row reasons, clearing only by operator action (quarantined_at, plus posted_attempt_at when uncertain).
  A BLOCKED response PAUSES the run visibly with the provider's reason, stops the batch, never becomes unavailable
  coverage; quarantined stays explicitly unavailable so no key stalls a phase. A model-cache read failure makes
  zero provider calls. Rows expire on the registry ttl so re-observation re-buys; completion counts only CURRENT
  CANONICAL pairs/queries (pruned, stale-done outstanding, weekly re-entry); run id and per-cycle receipt are
  real. Every AI observation carries a frozen retrieval MODE: consumer_search (the ChatGPT scraper's consumer
  search look) is THE canonical citation-grade ChatGPT signal on every core prompt; standardized_response is
  canonical for the other three engines plus a bounded 20-prompt AUXILIARY chatgpt sample that inflates no
  denominator, never substitutes for missing consumer coverage, never pauses the run (aux block = unsupported).
  Presence, recurrence, winning pages, history ids, the hash: all mode-true (a citation seen via both chatgpt
  modes counts once, consumer preferred; legacy rows count as before). Gemini vertexaisearch wrappers resolve
  redirect-only (hardened SSRF screen, wrapper-host requests only, bounded) to the real source before ranking,
  viaUrl kept; unresolved wrappers never rank. Funnel state is Supabase-only, basis-scoped (research_state,
  optimistic row_version). The canonical EvidenceSnapshot carries the research bundle (retained keywords; AI
  observations with prompt text, tri-state citations, webSearchReported, model drift; SERP evidence with
  observedAt; winning pages with appearance provenance; per-run receipt), the ONE public evidence input; the hash
  fingerprints MATERIAL content, never clocks. Proof is hermetic on fixtures AND live-validated (2026-07-25, $2
  provider day cap proven): labs, Standard SERP, all four engines and the scraper ran end to end for $0.07 with
  free Standard collection, durable Live persistence, $0 repeat hits, a cent-exact ledger, and a crashed POST
  quarantined then recovered free by its tasks_ready tag. Production research is ENABLED (2026-07-25).
- OpenAI generation flows through one strict Responses API gateway (Slice 3, 2026-07-23): /v1/responses with
  native strict Structured Outputs (json_schema, strict true), double validation (provider schema + server Zod),
  fail-closed refusal/incomplete/invalid handling with no artifact, budget checks before network, per-attempt
  spend with real usage cost, provenance on drafted results, cache hits at zero cost. The free-form Chat
  Completions transport and prose JSON recovery are deleted. The path is explicitly account-scoped end to end
  (2026-07-24 closure): the structured-output cache is tenant-scoped storage with the account in the key hash and
  on every entry (the old global cache blob is inert and never read), de-templating history never crosses
  accounts, tenantId is required from the drafter entry point through cache, budget, transport, provenance, and
  the error ledger, and post-network invalid envelopes retain real usage cost. The LLM budget is per-account on
  BOTH layers (2026-07-24): the file-layer backstop is tenant-scoped with the explicit account required before any
  ledger I/O (the old shared global blob is inert), and the durable Supabase ledger remains authoritative; one
  account's spend can never throttle another. A committed regression sweep converts every SCHEMA_BY_KIND entry
  through the strict-subset conversion. Transport and live provider behavior are validated; the existing OpenAI
  key enables this canonical path directly, with no secondary feature flag.
- One canonical path produces the ranked Changes queue AND one deep Change Bundle PER ARCHETYPE per pass at most
  (Slices 7+8, 2026-07-25): the strongest page rewrite and researched topic (pure insertions; citable research
  REQUIRED; threshold-gated cannibalization): receipt-first plain-English evidence with an honest missing list;
  gated, deterministic; thin evidence = refusal. A bundle REPLACES its shallow rows at generation and load, rides
  ChangeProposal (one decoder serves all rows), renders as the flagship row and two-layer /changes/[id] detail
  (Results takes New page), and stays manual. Proposals are BASIS-STAMPED (2026-07-26): a row off the current
  basis, or owing a source, demotes to To do in presentation only, and the surfaces say why. Page snapshots read
  Supabase; the page-surgeon generation is gone. Business Info is universal and provenance-safe: displayed fields
  confirm on save, blank optionals keep prior value AND origin, no save merges over a failed read; research needs
  offerings or topics. Results bands are maturity-true everywhere: early improvement = Promising, Win = 28-day
  only, still-measuring carries no verdict or causal claim, lifts never mis-signed. Today counts the full Ready
  list and the bleeding-page alarm links to its fix; manual implementation and 7/14/28 measurement stand.
## Known target mismatches

- Profound and SEMrush survive only as historical-row reads and inert comments (Slice 2 removed the connector
  provider, health entries, question seeding, drafter sources, the customer-visible AEO confidence gate, the
  vendor benchmark, the Actions dispatch, and the provider-import architecture); never revive them.
- Production DataForSEO is ENABLED (operator-approved 2026-07-25): credentials are the sole activation,
  bounded by the proved $2 provider-day cap and the default $50 tenant month cap.
- Real-customer names remain in historical code comments outside the Account boundary (executable strings and
  fixtures are clean).
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

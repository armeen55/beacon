# Beacon Verified State

> This file says what is implemented and verified now. The target product is `PRODUCT_TRUTH.md`. Never describe
> target behavior here as shipped behavior. Update this file only after a verified deployed state change.

## Current foundation

- Branch: `main`; verified starting commit before the MVP rebuild: `4669fbb5`.
- Stack: Next.js App Router, strict TypeScript, Supabase, Vercel.
- Production TypeScript is approximately 70,400 lines; tests approximately 3,900; combined approximately 74,300.
- The foundation guard caps production, tests, combined LOC, domains, routes, exports, files, dependencies, and
  Markdown. `npm run gate` runs the guard, typecheck, tests, and build.
- Five kernels exist: Account, Evidence, Decision, Measurement, Runtime.
- Four primary surfaces exist: Today, Changes, Results, Connections.
- Supabase authentication provisions one membership and one tenant per new user.
- One login resolves exactly one account, fail-closed (2026-07-23): the middleware injects the single
  membership's account; zero, multiple, erroring, or timed-out membership lookups all redirect to login
  (`no_account` / `multiple_accounts_unsupported` / `account_unavailable`). No account switcher, account
  enumeration, or selection cookie exists (the retired `beacon_tenant` cookie is never read and is actively
  expired), and an authenticated request can never reach an env-tenant fallback. `BEACON_OPERATOR_MODE` is
  presentation-only: OAuth connector ownership and every measurement/publish mutation require the
  authenticated account owner's membership row. The Account's `provisional_name` is an internal signup seed;
  active surfaces render the BusinessProfile name with the Website domain as fallback.
- Canonical Account, Website, and BusinessProfile records exist (Slice 1 + closure, 2026-07-23): the
  Account is the `tenants` row (vertical columns retired to unread legacy) resolved through account-scoped
  Supabase queries; Website is the one canonical projection of `Account.domain` (the only persisted website
  authority; Settings shows it read-only); BusinessProfile lives in the Account kernel as provenance-carrying
  sections (`ProfileSection`: value, origin, confidence, source URLs) over the approved Product Truth fields,
  backed by the `business_config` row at schemaVersion 2 with raw pre-canonical JSON preserved under an inert
  `legacy` key. Profile reads are async and Supabase-backed only: a cold first read resolves the real account
  identity, a missing row or transient failure is never cached as identity, and no file, env, founder, or
  process-global site fallback exists (`business-config.ts` and `site-config.ts` are deleted). Provisioning
  writes a fully generic row; missing configuration fails generic at every former leak site.
- Test fixtures carry generic account identities and domains; synthetic non-Latin-script sample content is
  retained deliberately for multilingual behavioral coverage.
- Revenue settings and the operator revenue model were removed (revenue attribution is an MVP non-goal);
  the unit-economics pass is dormant with no configurable model.
- Publishing remains manual.

## What is real but incomplete

- The complete seven-step onboarding and 50-core-prompt approval flow is live (Slice 5, 2026-07-24) on
  `/onboard` (`/onboard/done` is a compatibility redirect): website submit with a bounded public crawl and
  no prompt writes or paid checks; strict grounded BusinessProfile inference through the canonical gateway
  (returned source URLs validated against the supplied crawl set; refusal or cap falls back to an honest
  deterministic fact-based profile); an editable confirm step where natural-language instructions become a
  whitelisted structured patch that persists only after the customer confirms the displayed diff; the
  recover/grow/balanced goal on `tenants.growth_goal`; a model-built candidate universe (about 100 prompts
  in 5 to 10 topic groups across seven intent families, exactly 50 recommended) persisted as inactive
  `tracked_prompts` rows with deterministic per-account ids so retries never duplicate; declarative
  group-level approval (bounds 10..100, edits version new rows, unselected candidates stay inactive);
  optional connections that never block; and a real crawl-derived first finding before activation.
  Every prompt row carries the canonical tenant id for both `tenant_id` and `account_id` (never the slug);
  the old two-prompt launch, pre-approval seeding, day-zero SERP attempts, keep-scanning workflow, and
  25-prompt cap are deleted. Pre-activation OpenAI spend is capped at a lifetime $2 per account on the
  durable ledger platform `onboarding-openai` (fail-closed when unreadable) and the two live strict
  contracts were validated against the real API for $0.0135. Pending accounts can start no Research Run
  at either the runtime or claim-RPC boundary; activation is idempotent, requires website + confirmed
  profile + goal + approved prompts + terms, and starts exactly one durable Research Run. Verified end to
  end on the rendered app at desktop and mobile with two synthetic accounts (real crawls, real model calls,
  activation landing on Today); all synthetic rows removed. The onboarding gate bug that bounced every
  visit to login (a select of the nonexistent `provisional_name` column) is fixed.
- Durable visit-driven Research Runs exist (Slice 4, 2026-07-24): every authenticated visit renders the
  saved surfaces first, then claims or resumes the account's Research Run through an atomic database-time
  lease RPC. At most one unfinished (running or paused) run exists per account across all dates, enforced
  by a partial unique index (claim-semantics repair, 2026-07-24): the claim resumes the single unfinished
  run regardless of the day it started (same row, phase, cursor, attempt key, and progress; a live foreign
  lease blocks creation and an expired one is reclaimed), a run completed earlier the same UTC day blocks
  a redundant pass, and a new daily cycle (its key computed at database time) starts only when no run is
  open. A partially failed connector refresh persists the identities of the providers that actually synced
  (deduplicated across retries; the visible count is that unique set's size) durably before pausing, so a
  mixed attempt never strands its succeeded sources. Three phases mirror today's real work
  (refresh stale sources, one bounded GSC backfill chunk, evidence-conditioned surface publish); progress,
  phase, and cursors are durable, a killed invocation resumes at the persisted phase after lease expiry,
  concurrent instances cannot duplicate work, and Today shows one honest persisted status line (a dead
  lease presents as paused; hidden when there is nothing to say). The truth boundary is enforced
  (2026-07-24 repair): a failed connector, backfill, or surface publication pauses the run at its phase
  with a bounded error and can never advance, publish, or present as completed research; lease mutations
  (advance, pre-phase renew, finish) are database-time security-definer RPCs so an expired owner cannot
  mutate a run and completed rows reject all mutation; each phase's idempotency key is persisted before
  its side effect and reused across interrupted retries; completion copy says "Latest research pass
  finished today/(date) at h:mm" and never claims research is current. The old warm-receipt store, process-local
  scheduled Set, and once-daily Pacific gate are deleted; all three migrations are applied to production and the
  claim RPC was smoke-proven against the real database (service role executes, a live foreign lease loses,
  an expired lease reclaims yesterday's row by the same id with its attempt key intact, a same-UTC-day
  completion short-circuits, a later day creates, and a direct second open-row insert violates the index). Verified end to end on the rendered app: a real
  visit completed cycle tenant-iranopedia:2026-07-24 (2 sources refreshed, surface published, lease
  released) and Today rendered the honest completion line for that pass.
- One canonical DataForSEO boundary exists (Slice 2, 2026-07-23): every call flows through
  `dataForSeoRequest` with typed states (not_configured / dry_run / capped / ok / error), dry-run the
  default, the global breaker and per-platform monthly cap failing closed before any network access,
  actual provider cost recorded per account with provenance and a deterministic idempotency key.
  Endpoint coverage is still keyword volume + one-query Google organic SERP. The boundary is
  implemented and deployed; transport behavior is hermetically validated; the live provider response
  is NOT yet validated (no credentials, no paid call has ever been made).
- Google SERP parsing already recognizes organic results, AI Overview citations, featured snippets, and PAA.
- OpenAI generation flows through one strict Responses API gateway (Slice 3, 2026-07-23): /v1/responses with
  native strict Structured Outputs (json_schema, strict true), double validation (provider schema + server
  Zod), fail-closed refusal/incomplete/invalid handling with no artifact, budget checks before network,
  per-attempt spend with real usage cost, provenance on drafted results, cache hits at zero cost. The free-form
  Chat Completions transport and prose JSON recovery are deleted. The path is explicitly account-scoped
  end to end (2026-07-24 closure): the structured-output cache is tenant-scoped storage with the account in
  the key hash and on every entry (the old global cache blob is inert and never read), de-templating history
  never crosses accounts, tenantId is required from the drafter entry point through cache, budget, transport,
  provenance, and the error ledger, and post-network invalid envelopes retain real usage cost. The LLM
  budget is per-account on BOTH layers (2026-07-24): the file-layer backstop is tenant-scoped with the
  explicit account required before any ledger I/O (the old shared global blob is inert), and the durable
  Supabase ledger remains authoritative; one account's spend can never throttle another. A committed
  regression sweep converts every SCHEMA_BY_KIND entry through the strict-subset conversion. Transport
  behavior is hermetically validated; the live provider response is NOT yet validated (no paid call under
  the rebuild authorizations).
- Recommendation, manual implementation, verification, and 7/14/28 measurement foundations exist.

## Known target mismatches

- Profound and SEMrush survive only as historical-row reads and inert comments (Slice 2 removed the
  connector provider, runtime health entries, question seeding, drafter sources, the customer-visible AEO
  confidence gate, the vendor-named benchmark, the GitHub Actions dispatch, and the provider-import
  architecture). SEMrush and borrowed-account assumptions must not be revived.
- Four AI engines are declared in types, but the active runners that would populate those observations are absent.
- DataForSEO Labs, ChatGPT Scraper, LLM Responses, LLM Mentions, full keyword research, and competitor/domain
  endpoints are not implemented.
- Real-customer names remain in historical code comments outside the Account boundary (executable strings and
  fixtures are clean).
- Legacy `.data`/dual-write code remains for non-account stores; the Account/Profile path no longer uses it.

## Environment readiness

Verified variable-name presence without reading or printing values:

- Local and Vercel production have Supabase and OpenAI credentials.
- Vercel production has Google OAuth client credentials and a GSC site configuration.
- Neither local nor Vercel production currently has verified DataForSEO credentials or production provider
  settings. Required before live provider validation: DataForSEO authentication, provider selection, an
  explicit dry-run decision, and a fail-closed spend cap.

Never place credentials in chat, documentation, commits, or command output.

## Current routes

- Today `/`
- Changes `/changes` and `/changes/[id]`
- Results `/results`
- Connections `/settings/connectors`
- Minimal settings, onboarding, login, signup, Google callback, and version routes

New customer routes require operator approval.

## Next slice

Slices 1 through 5 are complete and deployed. The next build-order step is Slice 6: the complete
DataForSEO research funnel and caching. It requires the eight fields from `AGENTS.md` and explicit
operator approval before implementation.

## Verification

- Use the real main tree at `/Users/armeen/beacon`.
- Preserve unrelated untracked `.codex/` and `supabase/` content.
- Run `npm run gate` before completion.
- An accepted implementation plan authorizes commit, push to `origin/main`, Vercel deployment, and hosted smoke
  verification, subject to the destructive and external-state pauses in `AGENTS.md`.

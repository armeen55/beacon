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

- The complete seven-step onboarding and 50-core-prompt approval flow is live and CONNECTED (Slice 5 +
  connected-state closure, 2026-07-24) on `/onboard` (`/onboard/done` redirects): one onboarding basis
  runs from website to activation. Every derived artifact carries a deterministic basis fingerprint
  (account, canonical domain, confirmed research-affecting profile fields, goal, generation version)
  tagged onto its `tracked_prompts` rows; only current-basis rows render, count, approve, or activate,
  and approval sweeps every other-basis active row so an abandoned goal or profile can never leave stale
  prompts tracked. Replacing the website mid-onboarding is one atomic service-role RPC
  (`replace_onboarding_website`, applied): new domain, goal cleared, all prompt rows deactivated (history
  kept), profile reset to the canonical empty record, crawl force-restarted; re-submitting the same domain
  stays idempotent. Profile confirmation is truthful (every business section operator-confirmed; a
  name-only edit or a single confirmed patch never advances the confirm step). The prompt step has real
  individual controls (include/exclude, inline edit, add to a group, remove) behind group-level
  progressive disclosure, server-validated against the current tenant and basis; new rows carry all four
  intended engines (chatgpt, perplexity, gemini, claude) as tracking scope only. The deterministic
  fallback asks natural per-family questions from confirmed facts, returns fewer honestly, and never pads
  with numbered filler. Pre-activation OpenAI spend reserves the projected cost durably BEFORE each real
  call against the lifetime $2 cap and reconciles to actual after (any write failure overcounts and blocks,
  never undercounts; cache hits and the fallback reserve nothing); live-validated on the real API and the
  rendered walk for $0.0378 total across two synthetic accounts. Page snapshots persist again (the dead
  `images` field the production table never had is deleted; 14 real snapshots upserted on the walk). The
  Connections page shows a status-derived "Return to setup" for accounts still onboarding (no redirect
  parameter exists). Pending accounts can start no Research Run at either the runtime or claim-RPC
  boundary; activation is idempotent, requires 10..100 current-basis approved prompts plus website +
  fully confirmed profile + goal + terms, and starts exactly one durable Research Run. Verified end to
  end on the rendered app at desktop and mobile with a real crawl, real model calls, a mid-flow website
  change, and a mid-flow goal change (the old prompt set visibly stranded and regenerated). One synthetic
  pending account (`tenant-smoke-onboard`, ritzbuilders.com data) remains in the database for operator
  review per the no-unapproved-deletion rule; it is inert (pending accounts do no work).
- Durable visit-driven Research Runs exist (Slice 4, 2026-07-24): every authenticated visit renders the
  saved surfaces first, then claims or resumes the account's Research Run through an atomic database-time
  lease RPC. At most one unfinished (running or paused) run exists per account across all dates, enforced
  by a partial unique index (claim-semantics repair, 2026-07-24): the claim resumes the single unfinished
  run regardless of the day it started (same row, phase, cursor, attempt key, and progress; a live foreign
  lease blocks creation and an expired one is reclaimed), a run completed earlier the same UTC day blocks
  a redundant pass, and a new daily cycle (its key computed at database time) starts only when no run is
  open. A partially failed connector refresh persists the identities of the providers that actually synced
  (deduplicated across retries; the visible count is that unique set's size) durably before pausing, so a
  mixed attempt never strands its succeeded sources. Seven phases mirror today's real work
  (refresh stale sources, one bounded GSC backfill chunk, keyword discovery, core-prompt AI observation,
  retained-query SERP analysis, winning-page comparison, evidence-conditioned surface publish); progress,
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
- The DataForSEO research funnel is lifecycle-true and feeds ONE canonical evidence input (Slice 6 +
  closures 6B/6C/6D, 2026-07-25). A TYPED capability registry (CapabilityInputByKey; wrong or
  cross-engine fields fail TypeScript; the model is never caller-supplied) owns every provider contract.
  Requests are WEB-ENABLED per engine exactly as documented (chatgpt/claude web_search + force + US
  context gated on the resolved model, gemini web_search only, perplexity Live, the keyword-based
  scraper) and every llm_responses ask carries max_output_tokens; providerCall resolves the one
  method-compatible model and routes Standard-vs-Live from task_post_supported, never hardcoded. The
  boundary returns the FULL bounded envelope; official fixtures travel transport to Snapshot in tests.
  Money: tenant-independent `evidence_cache` + single-flight claim + dry-run default + breaker + ATOMIC
  reservation BEFORE the network + reconcile after; an accepted task POST reports its cost into the
  per-cycle receipt exactly once; the monthly cap is reservation-based with bounded overshoot (stated
  honestly, not "hard"); cache persistence FAILS CLOSED down to a zero-row UPDATE. Every failure carries
  a structured disposition, never a parsed string: 50xxx and transport blips keep the task id and stay
  free; 40401/40403/404 earn ONE clean repost per incident; auth/payment/contract errors pause without
  reposting; an UNCERTAIN post or an unpersisted accepted task id is QUARANTINED (migration slice6d:
  quarantined rows are inert to every claim branch, a crashed-mid-POST receipt quarantines on first
  touch, recovery is only the free tasks_ready listing matched by our tag, bounded at four days then one
  clean release). Collected task rows expire on the registry ttl so weekly re-observation truly re-buys;
  completion counts only the CURRENT active pairs and chosen queries (obsolete rows pruned, stale-done
  outstanding, budgets per incident, unsupported/failed/AI Mode coverage re-enters weekly); scraper
  observations carry distinct history ids; the real research-run id and a per-cycle receipt replace the
  manufactured run id and lifetime counters. Funnel state is Supabase-only and basis-scoped
  (research_state, optimistic row_version). The canonical EvidenceSnapshot carries the research bundle
  (retained keywords, AI observations with prompt text + tri-state citations + webSearchReported +
  model drift as distinct rows, SERP evidence with observedAt, winning pages with own-appearance
  provenance, per-run receipt) and is the ONE public evidence input; evidenceHash fingerprints MATERIAL
  content, never clocks or counters. Proof is hermetic on exact official fixtures only: NO DataForSEO
  credentials exist anywhere, no paid call has ever been made, and the live path stays UNVERIFIED until
  the $2-bounded live validation runs.
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
- The four-engine observation paths are implemented but have never run live (no DataForSEO credentials);
  until credentials land, dry-run keeps every funnel phase at zero paid coverage and Today's counters
  honestly reflect that.
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

Slices 1 through 6 are complete and deployed. The next build-order step is Slice 7: one deeply
evidenced existing-page Change Bundle from the canonical research foundation (consuming
`loadFunnelEvidence` and the Evidence Snapshot). It requires the eight fields from `AGENTS.md` and explicit
operator approval before implementation.

## Verification

- Use the real main tree at `/Users/armeen/beacon`.
- Preserve unrelated untracked `.codex/` and `supabase/` content.
- Run `npm run gate` before completion.
- An accepted implementation plan authorizes commit, push to `origin/main`, Vercel deployment, and hosted smoke
  verification, subject to the destructive and external-state pauses in `AGENTS.md`.

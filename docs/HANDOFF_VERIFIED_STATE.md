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

- URL-first onboarding crawls a bounded part of the site and shows a first scorecard.
- Launch currently seeds only two brand prompts, not the approved 50-prompt system.
- On-visit refresh uses Next `after()` and a once-daily receipt, but lacks a durable phased Research Run and
  cross-instance lease.
- DataForSEO code currently implements basic keyword volume and one-query Google organic SERP only.
- Google SERP parsing already recognizes organic results, AI Overview citations, featured snippets, and PAA.
- OpenAI drafting validates JSON with Zod after free-form generation; it is not yet the approved Responses API
  plus native strict Structured Outputs gateway.
- Recommendation, manual implementation, verification, and 7/14/28 measurement foundations exist.

## Known target mismatches

- Profound source names and gates remain in schemas, prompt seeding, decisions, runtime health, and historical
  reads after the connector was removed (including a customer-visible confidence gate on change cards).
- A SEMrush-sourced CTR benchmark constant remains in forecast calibration.
- SEMrush and borrowed-account assumptions must not be revived.
- Four AI engines are declared in types, but the active runners that would populate those observations are absent.
- A GitHub Actions first-scan dispatch remains connected to onboarding (inert: no PAT, workflow file absent)
  and conflicts with the approved visit-driven runtime.
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

Slice 1 (generic Account, Website, BusinessProfile) plus its closure repair and the account-isolation
contraction are complete and deployed. The next build-order step is Slice 2: one canonical DataForSEO
evidence boundary, deleting the Profound gates and reads, the SEMrush benchmark constant, the GitHub Actions
first-scan dispatch, and the phantom native-provider architecture it replaces. It requires the eight fields
from `AGENTS.md` and explicit operator approval before implementation.

## Verification

- Use the real main tree at `/Users/armeen/beacon`.
- Preserve unrelated untracked `.codex/` and `supabase/` content.
- Run `npm run gate` before completion.
- An accepted implementation plan authorizes commit, push to `origin/main`, Vercel deployment, and hosted smoke
  verification, subject to the destructive and external-state pauses in `AGENTS.md`.

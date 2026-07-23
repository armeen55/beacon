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
- Canonical Account, Website, and BusinessProfile records exist (Slice 1, 2026-07-23): the Account is the
  `tenants` row with vertical columns retired to unread legacy; Website is a typed projection of the
  account's one domain; BusinessProfile is the tenant-keyed `business_config` row, resolved per account
  through Supabase only (no env, file, founder, or curated-code fallback). Provisioning writes a fully
  generic row. Missing configuration fails generic at every former leak site. Test fixtures carry no real
  customer identity.
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

Slice 1 (generic Account, Website, BusinessProfile) is complete and deployed. The next build-order step is
Slice 2: one canonical DataForSEO evidence boundary, deleting the Profound gates and reads, the SEMrush
benchmark constant, the GitHub Actions first-scan dispatch, and the phantom native-provider architecture it
replaces. It requires the eight fields from `AGENTS.md` and explicit operator approval before implementation.

## Verification

- Use the real main tree at `/Users/armeen/beacon`.
- Preserve unrelated untracked `.codex/` and `supabase/` content.
- Run `npm run gate` before completion.
- An accepted implementation plan authorizes commit, push to `origin/main`, Vercel deployment, and hosted smoke
  verification, subject to the destructive and external-state pauses in `AGENTS.md`.

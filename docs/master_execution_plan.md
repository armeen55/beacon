# Beacon Master Context Vault

> **PURPOSE:** the durable product, trust, and boundary decisions still in force — not chronology, not
> architecture diagrams (→ `architecture.md`), not current state (→ `HANDOFF_VERIFIED_STATE.md`), not the
> plan (→ `NEXT_PHASE_EXECUTION_PLAN.md`). Git history holds the full pre-rebuild decision log. Ceiling: 150.

## Identity

`beacon`, private, v0.1.0. Next.js 16 App Router, React 19, TypeScript strict. Supabase is the production
repository (per-tenant, per-site scoped). Single-user internal product first; no auth/billing/teams/RLS/agency
scope unless the operator explicitly asks. Deployed on Vercel (`main` → `beacon-bice.vercel.app`).

## Durable product decisions

- **The loop is Today → Changes → Results, plus Connections.** Today explains the current state and gives one
  command; Changes is the ranked execution queue (To do / Ready), not a second analytics dashboard, with exact
  copy leading; Results shows movement. Research/receipt detail stays reachable but never competes in the
  primary sidebar.
- **Publishing is manual and on a separate safety path.** Beacon never edits the live site. "Mark implemented"
  records a shipped change; a crawl/index directive is always held for review, never one tap.
- **Customer language never promises scheduled work.** Autonomous work is described as advancing while Beacon
  is used or as new evidence arrives. Vercel crons are intentionally empty; no customer copy may depend on or
  infer a cron. Scheduling background preparation is never presented as completed work.
- **Beacon voice:** first person, a concrete number when one exists, a next step, plain English, no lab/vendor
  jargon on primary surfaces, no em/en dashes. Wins in one sentence; misses owned plainly.

## Durable trust and measurement boundaries

- **Tenant isolation, fail-closed.** Every background/post-response builder keeps its tenant explicit through
  every nested read; request-ambient or process-default tenant selection is forbidden. Empty tenant fails
  closed; absolute edit targets get a final owned-domain check before display.
- **Trustworthy observation.** A failed crawl response is never a page change; HTTP errors and sub-500-char
  CMS shells are rejected; the last trustworthy snapshot is preserved. Recommendations grounded in a crawl
  older than 45 days stay visible but state the exact age and cannot hold high confidence.
- **Measurement is immutable and never causal.** proof-gsc/Results is the only customer-facing measurement
  truth. The 28-day read is the primary decision; a predeclared run appends one immutable read per window and
  computation version, and a later pass reuses the earlier decision rather than recomputing history. Cross-
  regime windows abstain. Citation rate = share of observations citing the owned brand.
- **Compound-action boundary.** Same-page edits shipped on the same date are one package with a stable combo
  identity; Results may report the package outcome but never credits or trains an individual lever. A later
  edit inside the window is accidental overlap and is quarantined.
- **Availability vs freshness are separate contracts.** Today/Changes always serve the last complete
  tenant-scoped snapshot; a mutation marks it stale but never deletes it; a replacement appears only after the
  whole new release is built. Customer instructions never ask for timed waits or double refreshes.

## Future ideas (parked; not active work)

Move to `NEXT_PHASE_EXECUTION_PLAN.md` only when an idea becomes active, operator-approved work.

- Dark mode; PDF/weekly proof export; onboarding guided tour; Playwright E2E smoke.
- Multi-model AI sampling (Perplexity/ChatGPT/Gemini) wired to prod; revenue bridge (calls/forms/LSA/GBP).
- Auth + billing + agency multi-tenant with real RLS (explicitly out of scope until requested).
- Citation genealogy, prompt mining, founder-authority tracking, real-time competitor monitoring.

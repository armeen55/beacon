# Beacon — MVP REBUILD START HERE

> This is the single current-state document. Read it first. Foundation is frozen and deployed; the next phase
> is the MVP rebuild, which EXTENDS this foundation. Exact deployed SHA + deployment id are in the latest
> `docs/VERIFICATION_LOG.md` entry. Ceiling: 200 lines.

## What Beacon is now

A small, mechanically protected, fully deployed foundation on **five kernels** behind **four surfaces**. All
domain logic lives in `src/domains/{account,evidence,decision,measurement,runtime}/`; `src/app` and
`src/components` consume each kernel through its public facade (`index.ts`) only. Single-user internal product
(tenant `tenant-iranopedia`); no auth/billing/teams unless explicitly requested.

## Final foundation numbers (see VERIFICATION_LOG for the exact SHA/deploy)

- production TypeScript ≈ 70,400  ·  test ≈ 3,900  ·  combined ≈ 74,300 (guard hard cap 100,000; target 60,000)
- top-level domains: **5** (account, evidence, decision, measurement, runtime)
- exported symbols: 1,936 (capped; target 1,200)  ·  tracked Markdown: 15 files / ~1,935 lines
- 211 behavioral tests · four surfaces verified on the real main tree (Iranopedia data)

Combined LOC is above the ≤65k goal because the six connector boundaries and the persistence layer are
mandatory working capability. The tracked path to ≤65k is the Supabase-only persistence cleanup (see
NEXT_PHASE step 1).

## The five kernels + dependency direction

Account → Evidence → Decision → Measurement; Runtime orchestrates. Forbidden (guard-enforced): Evidence
importing Decision/Measurement; Measurement importing Decision. Six pre-existing leaks are grandfathered
(`foundation-budget.json` → `kernelDirectionExceptions`) and tracked for severance; no new leak may be added.

## Allowed routes

Four surfaces: Today (`/`), Changes (`/changes`, `/changes/[id]`), Results (`/results`), Connections
(`/settings/connectors`). Plus `/settings`, `/settings/config`, `/onboard`, `/onboard/done`, `/login`,
`/signup`; API `api/connectors/google/callback` and `api/version`. New customer routes need operator approval.

## Canonical data records (one per concept)

Tenant / Membership / Site / Connection (account) · EvidenceSnapshot (evidence, normalizes all six sources) ·
ChangeProposal (decision: one existing-page path + one new-page path, one validator, one ranker) ·
Shipment / Measurement (measurement: 7/14/28-day reads). Supabase is the production repository, every op
tenant- and site-scoped; all historical production records preserved.

## Six connector boundaries

Google Search Console · Google Analytics 4 · Microsoft Clarity · DataForSEO SERP · native AI visibility · Wix
(read for context; write only on explicit approval). Publishing is manual; Beacon never edits the live site.

## Foundation guard budgets (`foundation-budget.json`)

production ≤71,000 · tests ≤5,000 · combined hard cap 100,000 (target 60,000) · domains ≤5 · exports ≤1,936 ·
new file ≤500 lines / hard max 800 (30 grandfathered, non-increasing) · Markdown ≤20 files / ≤3,000 lines with
per-file ceilings and a name/archive block · runtime deps allowlisted · facade boundary + kernel direction
enforced. Remaining grandfathered giant files (shrink, never grow) are listed in `files.grandfathered` — the
largest are `decision/llm/structured-drafter.ts`, `lib/connectors/ga4/data-api.ts`, and
`settings/connectors/actions.ts`; each mixes concerns and is a split candidate.

## How to run

- **Local (real main tree, Iranopedia data):** dev server `beacon-audit` (port 3141, runs from
  `/Users/armeen/beacon`). Verify surfaces there — never the `beacon-iranopedia`/`beacon-filemode` worktree
  configs' old copies (now repointed). Clear `.next` before a clean render check after file moves.
- **Full gate:** `npm run gate` (guard:foundation + typecheck + test + build). CI: `.github/workflows/foundation.yml`.

## Tomorrow's first MVP feature must state (before any code — see AGENTS.md)

1. exact user problem · 2. existing kernel it extends · 3. public API change · 4. max net LOC · 5. old code
deleted/replaced · 6. behavioral test · 7. success signal · 8. kill condition.

## The one next step

Wait for the operator to describe tomorrow's MVP. Do not begin the MVP, add a feature, produce an ideas list,
or start another cleanup until that definition arrives.

> Open decision for the operator: `docs/OPERATOR_PRODUCT_SPEC_2026-07-09.md` was kept (memory marks it "THE
> contract") though the reset removed old specs — delete it or keep it as canonical.

# Beacon — instructions for Codex (Code / CLI / any agent)

**Read first, in order:** `docs/PRODUCT_TRUTH.md`, then `docs/HANDOFF_VERIFIED_STATE.md`, before non-trivial work.

This file is the **portable** project contract (use here, in Codex, or anywhere else). Cursor-specific rules live in `.cursor/rules/core.mdc` — keep them aligned when both are in use.

---

## Product

- Build Beacon as the product defined in `docs/PRODUCT_TRUTH.md`, not a throwaway prototype.
- The MVP is a tenant-scoped SaaS: one user, one account, one website.
- Do **not** add billing, teams, permissions, webhooks, cron jobs, schedulers, automated publishing, or
  unapproved integrations.
- Keep files modular and reasonably small.
- Do not modify unrelated files.
- Reuse existing patterns whenever possible.
- Explain the plan before implementing major changes.
- Do not leave placeholder comments like "rest of logic here".
- Prefer production-shaped architecture without premature SaaS complexity.
- **Pages stay thin**; domain logic belongs in `src/domains`.

---

## Execution contract (Beacon override of base Codex rules)

When the operator (Armeen) **accepts an execution plan** for a step or phase, that
acceptance authorizes the full landing-strip — not just local edits. Concretely,
"accepted execution plan" means I am authorized to:

- edit files
- run tests
- create logical commits (one per coherent step)
- push to `origin/main` (or the agreed branch)
- let Vercel auto-deploy
- verify hosted production / preview rendering

Rule: do NOT stop after local tests pass and call the work "done" if the product is
not deployed. Continuous execution through deploy is the contract.

**Always pause** before:
- destructive operations (file deletion, branch deletion, `rm -rf`, force-push, `git reset --hard`)
- data deletion in `.data/` or Supabase
- modifying hosted environment variables (Vercel, Supabase config)
- irreversible migrations (schema changes that drop data)
- paid API runs that would exceed an agreed budget

After every commit/push/deploy, **report exactly** what was committed (per-step summary),
what was pushed (commit SHAs), what deployed (Vercel build status), and what was verified
(hosted smoke results). Truth-up immediately if any step couldn't run from this environment
(e.g., Vercel CLI unavailable, hosted env vars unreadable) — never imply work is deployed
when it's not.

---

## Documentation policy

- `docs/HANDOFF_VERIFIED_STATE.md` is the concise current state. Update it only when the verified state changes.
- `docs/PRODUCT_TRUTH.md` is the complete product contract. Only the operator may approve edits.
- A completed task normally edits zero or one Markdown file.
- Never create verification logs, architecture duplicates, task summaries, dated audits, roadmaps, WIP logs,
  migration READMEs, component READMEs, or in-repo archives. Git history and deployed state are the archive.

**Finish** with: **Task completed**, 1–5 bullets of what changed, and **exactly one** next best recommendation aligned with the current handoff and operator-approved product truth.

**Do not:** create new docs unless necessary, duplicate plans, or preserve superseded product ideas as active context.

---

## Model / capability tier (Codex mapping)

Before starting and again at the end of each task, recommend **one** tier and a one-line reason:

| Tier | Codex mapping (typical) | Use when |
|------|---------------------------|----------|
| **Fast** | Haiku / fast models | Simple UI, loading states, styling, cleanup, bounded components, straightforward CRUD, repetitive safe edits |
| **Balanced** | Sonnet | Logic changes, behavior changes, medium refactors, data flow, routes, reasoning-heavy but bounded work |
| **Max** | Opus | Architecture, phase transitions, multi-file system design, ambiguous or high-risk work, trust/scoring/attribution/persistence/core wedge |

**Final output must include:** `Recommended capability for next step: [Fast / Balanced / Max]` + one-line why.

*(If you also use Cursor, you can map Fast→Composer 2, Balanced→Opus 4.6, Max→Opus 4.6 Max for that tool.)*

---

## Repo quick facts

- **Stack:** Next.js (App Router), TypeScript strict, Supabase. Supabase is the REQUIRED production
  persistence destination. Legacy `.data/`/dual-write code is current removal work and must not be extended.
- **Data:** `.data/` is **gitignored** — not committed; keep local backups of CSVs/exports you care about.
- **Quality gate:** `npm run gate` (guard:foundation + typecheck + test + build) before considering work done.
- **Migrations:** applied SQL migrations are immutable and date-prefixed. Use the configured Supabase
  management connection; never print credentials or run irreversible migrations without approval.

## Product-experience floor

- Four primary surfaces only: Today, Changes, Results, Connections.
- Customer-facing UI is generic and tenant-driven; no real customer name or domain is hardcoded.
- First render saved truth immediately; visit-driven work resumes after the response and persists real progress.
- All OpenAI outputs use strict Structured Outputs plus server validation.
- DataForSEO is the SEO and external AI-observation backbone. Do not revive SEMrush, Profound, borrowed-account,
  or parallel native-provider architectures.
- Publishing is manual. Beacon may research, recommend, verify, and measure autonomously.
- Reuse UI primitives, tokens, and existing layout patterns. No one-off design systems or component families.

---

## FOUNDATION FREEZE — permanent bloat firewall (2026-07-22, BINDING)

Beacon was rebuilt from 449,894 lines to a ~95k Foundation on three kernels
(Evidence, Decision, Measurement) behind four surfaces (Today, Changes, Results,
Connections). It grew to 500k because the workflow rewarded code production —
concurrent feature factories, speculative subsystems, per-incident guards, and
"keep working continuously" with no terminal condition. These rules exist so
that can never happen again. They override the older single-user notes above
(Beacon is now a tenant-scoped SaaS foundation).

### Machine-enforced budget (the firewall)
`npm run guard:foundation` (config `foundation-budget.json`, script
`scripts/check-foundation-budget.mjs`, CI `.github/workflows/foundation.yml`)
FAILS when production/test/combined LOC, customer routes, top-level domains,
public exports, file sizes, or dependencies exceed budget. Run it in the gate:
`npm run gate`. Ceilings are NON-INCREASING — ratchet them down as code shrinks,
never up without explicit operator approval.

### Growth policy
- `foundation-budget.json` is the authoritative numeric ceiling for every budget (LOC, routes, domains,
  exports, files, deps, Markdown). Prose never overrides it; today it caps tests at 5,000.
- Absolute MVP hard cap: 100,000 combined.
- Ordinary feature task: ≤750 net new lines.
- >750 net requires explicit operator approval. >2,000 must be decomposed or
  REPLACE equivalent existing code — and a replacement DELETES the superseded
  path in the same phase (never two pipelines after cutover).
- No new top-level domain, customer route, or dependency without explicit approval.

### Architecture rules
- Five public product boundaries only: Account, Evidence, Decision, Measurement,
  Runtime. Surfaces import facades, never a kernel's private internals.
- Dependency direction: Account -> Evidence -> Decision -> Measurement; Runtime
  orchestrates. Measurement never imports drafting/UI/page-surgeon-as-public.
- One canonical type per business record (User/Tenant/Membership/Site/Connection/
  Page/EvidenceSnapshot/ChangeProposal/Shipment/Measurement). No duplicate status
  unions or shapes. No barrel-exporting everything.
- One production persistence path (Supabase); a tiny in-memory repo for tests. No
  file/JSON dual-write, no seed/demo data as live infrastructure, no implicit
  tenant resolution. Every op explicitly tenant- and site-scoped, fail-closed.
- No speculative systems (billing, teams, cron, schedulers, auto-publishing, agent
  frameworks, experiments, "future intelligence") until a real MVP workflow needs
  it. Publishing is manual: recommend, operator applies, Mark implemented.

### Tests protect promises, not implementations
Keep behavioral contracts: tenant isolation, six connector contracts, cold
existing-page + new-page generation, factual/destructive safety, historical
measurement, 7/14/28 + overlap honesty, four-surface smoke, spend-cap fail-closed.
Delete exact-copy, layout, source-string-scanning, intermediate-pipeline, and
one-test-per-helper tests. Structural guarantees live in the guard script, not in
readFileSync source scans.

### Every feature proposal states (no implementation without all eight)
1. Exact user problem. 2. Existing kernel it extends. 3. Public API change if any.
4. Max net LOC. 5. Old code deleted/replaced. 6. Behavioral test added.
7. Success signal. 8. Kill condition if not useful.

### Process
- One customer outcome per task. Never "build 20 ideas" / "Beacon 500" / indefinite
  continuous-feature prompts. Give a terminal outcome; stop when it and its test pass.
- At most two implementation agents + one reviewer, disjoint ownership. Only the
  orchestrator runs git. Report net growth (prod/test add+delete, routes, deps,
  public API) every task.

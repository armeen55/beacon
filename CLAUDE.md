# Beacon — instructions for Claude (Code / CLI / any agent)

**Read first:** `docs/HANDOFF_VERIFIED_STATE.md`, then `docs/NEXT_PHASE_EXECUTION_PLAN.md` before non-trivial work.

This file is the **portable** project contract (use here, in Claude Code, or anywhere else). Cursor-specific rules live in `.cursor/rules/core.mdc` — keep them aligned when both are in use.

---

## Product

- Build Beacon as a real long-term product, not a throwaway prototype.
- Optimize for a premium **single-user internal** app first.
- Do **not** add auth, billing, teams, permissions, webhooks, cron jobs, or external integrations unless explicitly asked.
- Keep files modular and reasonably small.
- Do not modify unrelated files.
- Reuse existing patterns whenever possible.
- Explain the plan before implementing major changes.
- Do not leave placeholder comments like "rest of logic here".
- Prefer production-shaped architecture without premature SaaS complexity.
- **Pages stay thin**; domain logic belongs in `src/domains`.

---

## Execution contract (Beacon override of base CLAUDE Code rules)

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

## Supabase ownership (agent responsibility)

Beacon agents OWN all Supabase work — migrations, tables, indexes, functions/RPCs, RLS,
schema-cache reloads, verification, transactional tests, repairs, migration bookkeeping — through
the configured Supabase MCP / management connection (project ref `vlxwevsdvwxvopkjsewo`).

- **Do NOT delegate routine SQL Editor work to the operator.** Pause for a human only when Supabase
  itself requires a login/authorization the agent genuinely cannot perform.
- A temporary MCP transport failure (`net::ERR_FAILED`) is **not** a reason to hand SQL to the
  operator: retry with backoff, use the foreground MCP context (never a background subagent that
  lacks it), check `npm run supabase:management-check`, and wait for recovery.
- The shell `SUPABASE_ACCESS_TOKEN` may be stale (401) — never treat it as authoritative; prefer the
  MCP, then a write-scoped `SUPABASE_MGMT_TOKEN`. Never print secrets.
- If every management path is down after reasonable retries: pause, report "Supabase management
  connector unavailable", preserve work, and retry when it recovers — do not improvise unsafe DDL or
  delegate it.

---

## Documentation sync (mandatory)

After **any** task that changes behavior or plans, update if impacted:

1. `docs/HANDOFF_VERIFIED_STATE.md` — current state + next 3 actions  
2. `docs/NEXT_PHASE_EXECUTION_PLAN.md` — mark steps done / reorder if needed  
3. `docs/VERIFICATION_LOG.md` — dated entry: what changed, what verified (`npm run typecheck` / `npm run test` / `npm run build` as applicable)  
4. `docs/master_execution_plan.md` — new ideas or decisions only when relevant  

**The $250 ritual (mandatory before calling any UI change done):** answer in the report:
does this screen convince a stranger to pay $250/mo? What number does it show? What decision
does it enable? What would you cut? A weak answer means the change is not done.

**Finish** with: **Task completed**, 1–5 bullets of what changed, **exactly one** next best recommendation (aligned with `NEXT_PHASE_EXECUTION_PLAN.md`).

**Do not:** create new docs unless necessary, duplicate plans, or leave docs stale after code changes.

---

## Model / capability tier (Claude mapping)

Before starting and again at the end of each task, recommend **one** tier and a one-line reason:

| Tier | Claude mapping (typical) | Use when |
|------|---------------------------|----------|
| **Fast** | Haiku / fast models | Simple UI, loading states, styling, cleanup, bounded components, straightforward CRUD, repetitive safe edits |
| **Balanced** | Sonnet | Logic changes, behavior changes, medium refactors, data flow, routes, reasoning-heavy but bounded work |
| **Max** | Opus | Architecture, phase transitions, multi-file system design, ambiguous or high-risk work, trust/scoring/attribution/persistence/core wedge |

**Final output must include:** `Recommended capability for next step: [Fast / Balanced / Max]` + one-line why.

*(If you also use Cursor, you can map Fast→Composer 2, Balanced→Opus 4.6, Max→Opus 4.6 Max for that tool.)*

---

## Repo quick facts

- **Stack:** Next.js (App Router), TypeScript strict, `.data/*.json` + optional Supabase dual-write (`DUAL_WRITE=true`).
- **Data:** `.data/` is **gitignored** — not committed; keep local backups of CSVs/exports you care about.
- **Quality gate:** `npm run typecheck && npm run test` before considering work done.

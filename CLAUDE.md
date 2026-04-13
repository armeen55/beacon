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

## Documentation sync (mandatory)

After **any** task that changes behavior or plans, update if impacted:

1. `docs/HANDOFF_VERIFIED_STATE.md` — current state + next 3 actions  
2. `docs/NEXT_PHASE_EXECUTION_PLAN.md` — mark steps done / reorder if needed  
3. `docs/VERIFICATION_LOG.md` — dated entry: what changed, what verified (`npm run typecheck` / `npm run test` / `npm run build` as applicable)  
4. `docs/master_execution_plan.md` — new ideas or decisions only when relevant  

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

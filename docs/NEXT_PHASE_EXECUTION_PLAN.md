# Next Phase Execution Plan

> **PURPOSE:** the ordered plan. What to do next and in what order. Current state lives in
> `HANDOFF_VERIFIED_STATE.md`; durable product decisions in `master_execution_plan.md`. Ceiling: 150 lines.

## Status: FOUNDATION FROZEN

Beacon is a small, mechanically protected, fully deployed foundation on five kernels (account, evidence,
decision, measurement, runtime) behind four surfaces (Today, Changes, Results, Connections). The bloat
firewall (`npm run guard:foundation`) caps LOC, routes, domains, file sizes, public exports, Markdown, and
dependencies, and enforces the facade boundary and kernel dependency direction. The next phase is the MVP
rebuild, which EXTENDS this foundation — it does not replace it.

## The one next step

Wait for the operator to define tomorrow's first MVP feature. No implementation begins until that feature is
stated with the eight required fields (see `AGENTS.md`): user problem, kernel it extends, public API change,
max net LOC, old code deleted/replaced, behavioral test, success signal, kill condition.

## Remaining foundation debt (do opportunistically, each as one deployed slice)

Ordered by value. Each is a bounded relocation/cleanup, gated (guard + typecheck + test + build), walked on
the real main tree (`beacon-audit`, port 3141), and deployed. None is required before the MVP, but each makes
the foundation cleaner.

1. **Persistence → Supabase-only.** Retire the legacy `.data` JSON mirror and the `dual-write.ts` path so
   Supabase is the sole production repository (tiny in-memory repo for tests). Preserve all production records
   through adapters; drop no schema; delete no customer data. Removes the largest remaining platform machinery
   and cuts combined LOC toward the ≤60k target.
2. **Sever the 6 grandfathered kernel-direction leaks** (`foundation-budget.json` → `kernelDirectionExceptions`):
   Evidence→Measurement (url-watcher, gsc-page-signals) and Measurement→Decision (auto-measure-on-use,
   measure-pass, verdict-schedule, scoreboard). Move the shared helpers (e.g. windowing, lifecycle-counts) to a
   neutral location or invert the dependency; the deep one is measure-pass importing page-surgeon. Remove each
   exception as it is severed.
3. **Reduce the public export surface** toward the 1,200 target (currently capped at 1,936). Make internal-only
   helpers and types non-exported; keep one canonical type per business record; no "future reuse" exports.
   Ratchet `exports.max` down as it shrinks.
4. **Giant-file reduction.** Shrink the grandfathered oversized files (see `foundation-budget.json`
   `files.grandfathered`); split any that mix transport + persistence + validation + domain logic. New files
   stay ≤500 lines; target under 400.

## Working rules

- One customer outcome per task. Ordinary feature ≤750 net new lines; >750 needs operator approval; >2,000
  must decompose or replace equivalent code (replacement deletes the old path in the same phase).
- No new top-level domain, customer route, runtime dependency, or Markdown plan/report without operator
  approval. No parallel old/new pipeline after a cutover.
- At most two implementation agents plus one reviewer. No continuous "build anything useful" windows.
- Verify on the main tree, deploy to `main`, confirm the exact prod SHA. A completed task edits zero or one
  documentation file.

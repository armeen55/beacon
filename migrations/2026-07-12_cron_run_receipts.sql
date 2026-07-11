-- 2026-07-12 - cron_runs invocation receipts (started-row pattern).
--
-- Adds a `phase` discriminator to public.cron_runs (created 2026-07-03) so a
-- row can be written the MOMENT a cron route is invoked (phase='running',
-- before any work) and then UPDATED in place at completion
-- (phase='finished'). Before this, every route wrote its cron_runs row only at
-- the END of the run, so "Vercel never invoked the job" (no row) and "the job
-- was invoked but died mid-run" (a running row that never finished) were
-- indistinguishable in the ledger. A durable started receipt lets the deadman
-- (src/domains/ops/deadman.ts) tell those two apart and say so honestly on
-- Today ("a scheduled update did not finish").
--
-- ADDITIVE + idempotent (ADD COLUMN IF NOT EXISTS + guarded index). NEVER drops
-- or rewrites data. Existing rows (all written at completion) take the default
-- 'finished', which is exactly what they are, so every current reader keeps
-- reading them as completed runs with no backfill.
--
-- Written/read by src/domains/ops/cron-runs-store.ts (beginCronRun /
-- finishCronRun). The store tolerates this column not existing yet (PostgREST
-- PGRST204 / PGRST205 / raw Postgres 42P01) by falling back to the local
-- json-store mirror, so deploy order (code before migration) never breaks the
-- crons this ledger watches.

ALTER TABLE public.cron_runs
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'finished';

-- A partial index on the rare in-flight/abandoned rows keeps the deadman's
-- "is the newest row an unfinished started receipt" lookups cheap without
-- adding any write cost to the common finished-row path.
CREATE INDEX IF NOT EXISTS cron_runs_running_idx
  ON public.cron_runs (job, started_at DESC)
  WHERE phase = 'running';

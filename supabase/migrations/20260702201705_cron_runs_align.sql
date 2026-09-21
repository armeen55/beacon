-- Align cron_runs with migrations/2026-07-03_cron_runs.sql exactly (table is empty).
ALTER TABLE public.cron_runs
  ALTER COLUMN finished_at SET NOT NULL,
  ALTER COLUMN duration_ms SET NOT NULL,
  ALTER COLUMN ok DROP DEFAULT,
  ALTER COLUMN per_source SET DEFAULT '[]'::jsonb,
  ALTER COLUMN notes SET DEFAULT '{}'::jsonb;
UPDATE public.cron_runs SET per_source = '[]'::jsonb WHERE per_source IS NULL;
UPDATE public.cron_runs SET notes = '{}'::jsonb WHERE notes IS NULL;
ALTER TABLE public.cron_runs
  ALTER COLUMN per_source SET NOT NULL,
  ALTER COLUMN notes SET NOT NULL;
CREATE INDEX IF NOT EXISTS cron_runs_tenant_id_idx ON public.cron_runs (tenant_id) WHERE tenant_id IS NOT NULL;;

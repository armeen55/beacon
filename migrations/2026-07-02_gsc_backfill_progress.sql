-- 2026-07-02 - gsc_backfill_progress: resumable checkpoint for the one-time GSC
-- deep-history backfill (BEACON_500 item 63).
--
-- GSC serves up to ~16 months (480 days) of Search Analytics history through the
-- API, but the nightly sync only ever pulls a 90-day cold-start window plus a
-- small trailing re-pull. This table lets an operator-triggered deep backfill
-- walk all the way back to the API's real retention edge WITHOUT losing progress
-- across separate lambda invocations: each chunk (one calendar month at a time)
-- moves `cursor_date` backward and persists it here BEFORE the next chunk starts,
-- so a timeout or a redeploy mid-backfill resumes exactly where it left off
-- instead of restarting or silently stopping partway.
--
-- One row per (tenant_id, property): the backfill is scoped to whichever GSC
-- property the tenant's normal sync already resolved and is writing under.
--
-- Written/read by src/lib/connectors/gsc/deep-backfill.ts. Additive, idempotent
-- (upsert on the PK). RLS mirrors the gsc_daily_rows / gsc_monthly_archive peers.

CREATE TABLE IF NOT EXISTS public.gsc_backfill_progress (
  tenant_id     text NOT NULL,
  property      text NOT NULL,
  -- The oldest day the backfill is aiming for (today minus the requested span).
  target_date   date NOT NULL,
  -- The next day still to be pulled, walking backward from the start of the
  -- normal sync's own history toward target_date. NULL once the backfill has
  -- never run for this tenant/property.
  cursor_date   date,
  status        text NOT NULL DEFAULT 'in_progress',
  days_pulled   integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property)
);

ALTER TABLE public.gsc_backfill_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.gsc_backfill_progress;
CREATE POLICY deny_anon ON public.gsc_backfill_progress AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.gsc_backfill_progress;
CREATE POLICY tenant_authenticated_rw ON public.gsc_backfill_progress AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

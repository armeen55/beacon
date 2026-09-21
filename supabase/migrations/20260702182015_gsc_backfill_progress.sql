CREATE TABLE IF NOT EXISTS public.gsc_backfill_progress (
  tenant_id     text NOT NULL,
  property      text NOT NULL,
  target_date   date NOT NULL,
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
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));;

-- WHY EACH COMPARISON PAGE QUALIFIED, stored beside the change it stands behind.
-- Additive and nullable: every existing row decodes unchanged, and the writer already strips this
-- column on PGRST204 so a deploy that beats this migration still records the change.
-- NOT APPLIED BY THE AGENT. Apply through the Supabase management connection.

alter table public.shipped_change_proof
  add column if not exists controls_receipt jsonb;

comment on column public.shipped_change_proof.controls_receipt is
  'Array of { path, reasons[] }: the checkable facts that qualified each comparison page at selection time (same page type, traffic proximity, baseline completeness, no open or measuring change). Written once at selection; never a similarity score.';

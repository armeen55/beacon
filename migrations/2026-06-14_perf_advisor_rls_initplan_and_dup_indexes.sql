-- wave-4 perf-advisor follow-up (2026-06-14): three safe, semantics-preserving
-- fixes surfaced by Supabase's own performance linter.
--
-- 1. auth_rls_initplan — the tenant_members `members_self_read` policy called
--    auth.uid() PER ROW. Wrapping it in `(select auth.uid())` makes Postgres
--    evaluate it ONCE as an initplan (documented Supabase fix). tenant_members
--    is read during RLS evaluation of 39 dependent policies (is_tenant_member),
--    so this is on a hot path. Predicate is unchanged (user_id = the caller's
--    uid) — purely a planner optimization.
--
-- 2/3. duplicate_index — daily_metric_snapshots and prompt_answer_observations
--    (the two highest-volume tables) each carried TWO identical indexes. Drop
--    the redundant twin to cut write/storage cost; the surviving identical
--    index serves every query unchanged. (idx_dms_scope was also flagged
--    unused; its twin idx_daily_metric_snapshots_scope is kept.)
--
-- All reversible (re-create policy / re-create index); no data touched.

alter policy "members_self_read" on public.tenant_members
  using (user_id = (select auth.uid()));

drop index if exists public.idx_dms_scope;
drop index if exists public.idx_prompt_answer_observations_topic_platform;

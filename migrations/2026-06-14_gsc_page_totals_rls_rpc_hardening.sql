-- 2026-06-14 — Dream-state audit BATCH A: DB-layer isolation/security.
-- Applied to prod via MCP apply_migration (gsc_page_totals_rls_and_rpc_hardening
-- + gsc_rpc_revoke_client_execute). Recorded here for repo/fresh-env parity.
--
-- audit #6 — gsc_daily_page_totals had RLS ENABLED with ZERO policies →
-- default-deny for authenticated, so any future client read silently
-- returns 0 rows (the 2x GSC impression undercount the table was built to
-- fix re-appears). Mirror gsc_daily_rows' single tenant_rw policy; anon
-- stays default-denied (no anon policy, exactly like gsc_daily_rows).
--
-- NOTE on audit #14 (deny_anon on profound/semrush tables): VERIFIED moot —
-- those tables already have tenant_rw policies TO authenticated + RLS on, so
-- anon is default-denied. gsc_daily_rows itself carries no explicit deny_anon.
-- No change needed; recorded so the finding isn't re-opened.

create policy gsc_daily_page_totals_tenant_rw
  on public.gsc_daily_page_totals
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- audit #13 — harden gsc_page_signals_v1. It is SECURITY INVOKER (default),
-- so it already respects the caller's RLS on gsc_daily_rows — deliberately
-- NOT made SECURITY DEFINER (that would BYPASS RLS). Pin search_path
-- (anti unqualified-name hijack, matching the is_tenant_member hardening)
-- and restrict EXECUTE to the server: it is only called via the service-role
-- admin client, never the public PostgREST API.
alter function public.gsc_page_signals_v1(text, date)
  set search_path = pg_catalog, public;
revoke execute on function public.gsc_page_signals_v1(text, date) from public;
revoke execute on function public.gsc_page_signals_v1(text, date) from anon;
revoke execute on function public.gsc_page_signals_v1(text, date) from authenticated;
grant execute on function public.gsc_page_signals_v1(text, date) to service_role;

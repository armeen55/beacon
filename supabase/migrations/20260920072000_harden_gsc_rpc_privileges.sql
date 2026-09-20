-- These maintenance and evidence readers accept an explicit tenant id. They
-- are server-only application seams, never customer-callable RPCs. PostgreSQL
-- grants EXECUTE to PUBLIC on new functions unless it is revoked explicitly.

alter function public.gsc_unit_history(text, date, date, date, integer)
  set search_path = pg_catalog, public;
alter function public.gsc_query_universe_v1(text, date)
  set search_path = pg_catalog, public;
alter function public.refresh_gsc_month(text, date)
  set search_path = pg_catalog, public;

revoke all on function public.gsc_unit_history(text, date, date, date, integer)
  from public, anon, authenticated;
revoke all on function public.gsc_query_universe_v1(text, date)
  from public, anon, authenticated;
revoke all on function public.refresh_gsc_month(text, date)
  from public, anon, authenticated;

grant execute on function public.gsc_unit_history(text, date, date, date, integer)
  to service_role;
grant execute on function public.gsc_query_universe_v1(text, date)
  to service_role;
grant execute on function public.refresh_gsc_month(text, date)
  to service_role;

-- These four ledgers are also server-only. RLS currently fails closed because
-- no customer policies exist, but inherited table grants would become a latent
-- exposure if a policy were ever added. Remove that second door explicitly.
revoke all on table public.ai_case_dispositions from public, anon, authenticated;
revoke all on table public.gsc_monthly_archive from public, anon, authenticated;
revoke all on table public.page_source_facts from public, anon, authenticated;
revoke all on table public.shipped_change_proof from public, anon, authenticated;

do $gsc_rpc_boundary$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.gsc_unit_history(text,date,date,date,integer)',
    'public.gsc_query_universe_v1(text,date)',
    'public.refresh_gsc_month(text,date)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'unsafe GSC RPC grants remain on %', v_signature;
    end if;
  end loop;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('gsc_unit_history', 'gsc_query_universe_v1', 'refresh_gsc_month')
       and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'a GSC RPC still has a mutable search_path';
  end if;
end;
$gsc_rpc_boundary$;

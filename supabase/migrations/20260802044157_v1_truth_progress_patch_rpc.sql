create or replace function public.patch_research_run_progress(
  p_tenant_id     text,
  p_run_id        text,
  p_patch         jsonb,
  p_increment_key text default null,
  p_increment_day text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_progress jsonb;
begin
  update public.research_runs r
     set progress =
           (coalesce(r.progress, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb))
           || (case
                 when p_increment_key is null then '{}'::jsonb
                 else jsonb_build_object(
                        p_increment_key,
                        jsonb_build_object(
                          'day', p_increment_day,
                          'count', case
                                     when coalesce(r.progress -> p_increment_key ->> 'day', '')
                                          = coalesce(p_increment_day, '')
                                     then coalesce((r.progress -> p_increment_key ->> 'count')::int, 0) + 1
                                     else 1
                                   end))
               end)
   where r.tenant_id = p_tenant_id
     and r.id = p_run_id::uuid
  returning r.progress into v_progress;
  return v_progress;                       -- null = no row matched, which the caller must not read as saved
end;
$$;

revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from public;
revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from anon;
revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from authenticated;
grant execute on function public.patch_research_run_progress(text, text, jsonb, text, text) to service_role;;

create or replace function public.publish_customer_release(p_tenant_id text, p_expected_prior text, p_release text, p_ids text[], p_lanes text[], p_scope_key text, p_store_name text, p_content jsonb)
returns text
language plpgsql
set search_path to ''
as $function$
declare v_prior text;
begin
  select content->0->>'releaseId' into v_prior from public.json_store_blobs where scope_key = p_scope_key;
  -- ALWAYS validated, null included: a null expectation means "no release on file", so a caller whose
  -- read of the prior failed cannot publish over a release it never saw. Cold start (null = null) passes.
  if v_prior is distinct from p_expected_prior then
    raise exception 'release conflict: expected prior %, found %', p_expected_prior, v_prior;
  end if;
  update public.change_proposals set queue_lane = null, queue_rank = null
    where tenant_id = p_tenant_id and queue_lane is not null;
  update public.change_proposals c
     set queue_lane = p_release || '::' || t.lane, queue_rank = t.ord
    from unnest(p_ids, p_lanes) with ordinality as t(id, lane, ord)
   where c.tenant_id = p_tenant_id and c.id = t.id;
  insert into public.json_store_blobs(scope_key, store_name, content, updated_at)
    values (p_scope_key, p_store_name, p_content, now())
    on conflict (scope_key) do update
      set content = excluded.content, store_name = excluded.store_name, updated_at = excluded.updated_at;
  return p_release;
end; $function$;;

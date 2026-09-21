create or replace function public.stamp_change_queue_v2(p_tenant_id text, p_release text, p_ids text[], p_lanes text[])
returns void
language plpgsql
as $$
begin
  update public.change_proposals set queue_lane = null, queue_rank = null
    where tenant_id = p_tenant_id and queue_lane is not null;
  update public.change_proposals c
     set queue_lane = p_release || '::' || t.lane, queue_rank = t.ord
    from unnest(p_ids, p_lanes) with ordinality as t(id, lane, ord)
   where c.tenant_id = p_tenant_id and c.id = t.id;
end;
$$;

revoke all on function public.stamp_change_queue_v2(text, text, text[], text[]) from public;
revoke all on function public.stamp_change_queue_v2(text, text, text[], text[]) from anon;
revoke all on function public.stamp_change_queue_v2(text, text, text[], text[]) from authenticated;
grant execute on function public.stamp_change_queue_v2(text, text, text[], text[]) to service_role;;

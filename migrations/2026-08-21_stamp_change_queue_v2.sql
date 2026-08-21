-- ONE GLOBAL RANK FOR EVERY NONTERMINAL OPPORTUNITY. The v1 stamp numbered each lane 1..N separately, so
-- "rank" never meant one order: research rows were not stamped at all (the account's strongest recovery sat
-- unranked), and Today and Changes could only agree lane by lane. v2 takes ONE ordered id list with a
-- parallel lane list: queue_rank is the ordinality over the whole queue, and the lane rides queue_lane as
-- release::lane exactly as before, so counts per lane still read in the database. Additive; v1 remains for
-- the deploy window and nothing calls it after this ships. Service-role-only from birth.
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
grant execute on function public.stamp_change_queue_v2(text, text, text[], text[]) to service_role;

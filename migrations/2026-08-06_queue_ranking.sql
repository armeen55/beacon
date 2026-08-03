-- THE RANKED EXECUTION QUEUE GETS A PERSISTED POSITION. Forward only, additive, nullable.
--
-- WHY THIS COLUMN IS REQUIRED. /changes promises a complete, unlimited, paginated queue. Until now the
-- whole queue was ranked in memory, written into one customer release blob, and "paged" by slicing that
-- blob, so page two cost the whole queue and the canonical read capped itself at 500 current rows. A
-- database CANNOT page an order it does not hold, and the ranking is not a function of any stored column
-- (it discounts pages already under measurement), so the position itself has to be stored.
--
--   queue_rank  1..n INSIDE one lane of one ranking. The keyset cursor rides on it.
--   queue_lane  "<release>::ready" / "<release>::todo": the ranking a rank belongs to AND the lane it was
--               ranked in, together, so a cursor can never carry a position from an order the operator
--               never saw, and a lane can be paged without reading the other one.
--
-- Both are cleared the moment the row itself changes (the store writes them null on every save), so a stamp
-- is only ever the newest ranking's.
alter table public.change_proposals add column if not exists queue_rank int;
alter table public.change_proposals add column if not exists queue_lane text;
create index if not exists ix_change_proposals_queue
  on public.change_proposals (tenant_id, queue_lane, queue_rank);

-- ONE STATEMENT PER RELEASE, not one per row. Stamping an unlimited queue row by row is exactly the
-- unbounded work this migration exists to remove. The clear and both lanes commit together, so a tenant is
-- never left with half a ranking: either the new order is live whole, or the previous one still is.
create or replace function public.stamp_change_queue(
  p_tenant_id text, p_release text, p_ready text[], p_todo text[]
) returns void language plpgsql as $$
begin
  update public.change_proposals set queue_lane = null, queue_rank = null
    where tenant_id = p_tenant_id and queue_lane is not null;
  update public.change_proposals c set queue_lane = p_release || '::ready', queue_rank = t.ordinality
    from unnest(p_ready) with ordinality as t(id, ordinality)
    where c.tenant_id = p_tenant_id and c.id = t.id;
  update public.change_proposals c set queue_lane = p_release || '::todo', queue_rank = t.ordinality
    from unnest(p_todo) with ordinality as t(id, ordinality)
    where c.tenant_id = p_tenant_id and c.id = t.id;
end;
$$;

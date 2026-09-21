-- ONE PAGE IS NOT ONE OPPORTUNITY. The current-row uniqueness was (tenant, case, page, family),
-- and title/meta/h1 all share title-family, so a page could carry a title change OR a description
-- change but never both. Uniqueness now includes the MUTATION a row writes, which is the only thing
-- two rows can genuinely collide over. Additive: no row is deleted and no data is dropped.
alter table public.change_proposals
  add column if not exists mutation_key text not null default '';

-- Existing current rows are already unique per family, so any backfill preserves uniqueness.
-- Backfilling from the stored field keeps the value meaningful rather than blank.
update public.change_proposals
   set mutation_key = coalesce(payload->'proposal'->'recommendedChange'->>'field', '')
 where mutation_key = '';

drop index if exists ux_change_proposals_current;

create unique index ux_change_proposals_current
    on public.change_proposals (tenant_id, case_id, page_key, action_family, mutation_key)
 where (terminal_disposition is null);;

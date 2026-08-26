-- 2026-08-26  ONE PAGE IS NOT ONE OPPORTUNITY.
--
-- Current-row uniqueness was (tenant_id, case_id, page_key, action_family). `title`, `meta` and `h1` all
-- map to `title-family`, so a page could carry a new title OR a new description and never both, and two
-- body sections answering different questions were one hypothesis saved twice. Proven by ingesting
-- nineteen evidenced atomic changes: five were superseded on arrival, including the Asiatic cheetah
-- description the moment its title landed.
--
-- Uniqueness now includes the MUTATION a row writes, which is the only thing two rows on one page can
-- genuinely collide over. `mutationSlot` in src/domains/decision/proposal-store.ts is the one writer of
-- this column: the field for a field edit, and `field::canonicalQueryKey(primaryQuery)` for a body edit,
-- so two sections answering different questions coexist while two attempts at the same one still hand
-- over. Bundles and new pages keep the empty slot they have always had.
--
-- ADDITIVE AND REVERSIBLE. No row is deleted and no data is dropped. Existing current rows are already
-- unique per family, so the backfill cannot collide; it reads the stored field only so the value is
-- meaningful rather than blank. To roll back, drop the index, recreate it without `mutation_key`, and
-- drop the column, in that order.

alter table public.change_proposals
  add column if not exists mutation_key text not null default '';

update public.change_proposals
   set mutation_key = coalesce(payload->'proposal'->'recommendedChange'->>'field', '')
 where mutation_key = '';

drop index if exists ux_change_proposals_current;

create unique index ux_change_proposals_current
    on public.change_proposals (tenant_id, case_id, page_key, action_family, mutation_key)
 where (terminal_disposition is null);

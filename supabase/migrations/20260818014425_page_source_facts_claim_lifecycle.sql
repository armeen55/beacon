alter table public.page_source_facts add column if not exists claim_state text not null default 'checked';
alter table public.page_source_facts add column if not exists superseded_at timestamptz;
create index if not exists page_source_facts_owed_idx on public.page_source_facts (tenant_id, page_key, claim_state);
update public.page_source_facts
   set claim_state = 'superseded', superseded_at = coalesce(superseded_at, now())
 where source_read_at is null and claim_state = 'checked';;

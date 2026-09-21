alter table public.page_source_facts add column if not exists rules_version integer;
create index if not exists page_source_facts_rules_idx on public.page_source_facts (tenant_id, claim_state, rules_version);;

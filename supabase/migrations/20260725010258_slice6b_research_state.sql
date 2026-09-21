-- Slice 6 integrity closure: basis-scoped durable research state (2026-07-25).
-- Full context in migrations/2026-07-25_slice6b_research_state.sql.

create table if not exists public.research_state (
  tenant_id      text not null,
  basis_tag      text not null,
  schema_version int  not null default 1,
  state          jsonb not null default '{}'::jsonb,
  row_version    int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, basis_tag)
);

alter table public.research_state enable row level security;
drop policy if exists deny_all on public.research_state;
create policy deny_all on public.research_state
  as permissive for all to anon, authenticated
  using (false) with check (false);;

-- 2026-06-21 / applied 2026-07-02 - Durable pre-push snapshots (rollback durability).
create table if not exists public.push_snapshots (
  tenant_id          text not null,
  id                 text not null,
  edit_id            text not null,
  target_url         text not null,
  data_collection_id text not null,
  data_item_id       text not null,
  field              text not null,
  previous_text      text not null,
  captured_at        timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists push_snapshots_tenant_edit_captured_idx
  on public.push_snapshots (tenant_id, edit_id, captured_at desc);

alter table public.push_snapshots enable row level security;

create policy push_snapshots_tenant_rw
  on public.push_snapshots
  for all
  to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));;

create table if not exists public.page_surgeon_briefs (
  tenant_id text not null,
  page_url text not null,
  evidence_hash text not null,
  decision jsonb not null,
  decided_by text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, page_url)
);
alter table public.page_surgeon_briefs enable row level security;
create index if not exists page_surgeon_briefs_tenant_idx
  on public.page_surgeon_briefs (tenant_id);;

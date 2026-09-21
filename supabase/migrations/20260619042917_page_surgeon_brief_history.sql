create table if not exists public.page_surgeon_brief_history (
  id            bigint generated always as identity primary key,
  tenant_id     text        not null,
  page_url      text        not null,
  evidence_hash text        not null,
  decision      jsonb       not null,
  decided_by    text        not null,
  headline_action text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, page_url, evidence_hash)
);

alter table public.page_surgeon_brief_history enable row level security;

create index if not exists page_surgeon_brief_history_tenant_page_idx
  on public.page_surgeon_brief_history (tenant_id, page_url, created_at desc);;

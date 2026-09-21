create table if not exists public.page_surgeon_review_decisions (
  id            bigint generated always as identity primary key,
  tenant_id     text        not null,
  page_url      text        not null,
  verdict       text        not null check (verdict in ('approve', 'reject', 'needs_edit')),
  evidence_hash text,
  created_at    timestamptz not null default now()
);

alter table public.page_surgeon_review_decisions enable row level security;

create index if not exists page_surgeon_review_decisions_tenant_page_idx
  on public.page_surgeon_review_decisions (tenant_id, page_url, created_at desc);;

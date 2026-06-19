-- Page Surgeon APPEND-ONLY change history (WL8, 2026-06-18).
-- page_surgeon_briefs holds ONE current row per (tenant, page) for the cache.
-- This table accumulates every DISTINCT evidence state a page passed through —
-- one row per (tenant, page, evidence_hash), first-seen timestamped — so we can
-- show how a page's recommended plan evolved over time. Re-running with the same
-- evidence is a no-op (unique key + insert-ignore), so it never bloats.
-- Operator-substrate only: RLS enabled with NO policies → denies anon/auth; the
-- server reads/writes via the service-role client (bypasses RLS).
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

-- Newest-first history reads per page.
create index if not exists page_surgeon_brief_history_tenant_page_idx
  on public.page_surgeon_brief_history (tenant_id, page_url, created_at desc);

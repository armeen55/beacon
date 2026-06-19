-- Page Surgeon operator REVIEW decisions (WL9, 2026-06-18).
-- Append-only log of the operator's Approve / Needs-edit / Reject verdicts on a
-- page's composed plan, tied to the evidence_hash that was reviewed so we know
-- WHICH version was judged. PUBLISHING IS SEPARATE — recording a verdict here
-- never pushes content live. Operator-substrate only: RLS enabled with NO
-- policies → denies anon/auth; server writes via the service-role client.
create table if not exists public.page_surgeon_review_decisions (
  id            bigint generated always as identity primary key,
  tenant_id     text        not null,
  page_url      text        not null,
  verdict       text        not null check (verdict in ('approve', 'reject', 'needs_edit')),
  evidence_hash text,
  created_at    timestamptz not null default now()
);

alter table public.page_surgeon_review_decisions enable row level security;

-- Newest-first decision lookups per page (and latest-per-page for list badges).
create index if not exists page_surgeon_review_decisions_tenant_page_idx
  on public.page_surgeon_review_decisions (tenant_id, page_url, created_at desc);

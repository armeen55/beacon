-- Page Surgeon diagnostic briefs cache (W1a wiring, 2026-06-18).
-- One row per (tenant, page). Stores the LLM-judge decision keyed by an
-- evidence_hash so reloading / re-running with unchanged evidence never spends
-- OpenAI again. Operator-substrate only: RLS enabled with NO policies → denies
-- anon/authenticated; the server reads/writes via the service-role client
-- (which bypasses RLS), matching the other operator-only tables.
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
  on public.page_surgeon_briefs (tenant_id);

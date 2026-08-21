-- WHERE EVERY SEARCH THE ASSISTANTS RAN ENDED UP, one row per (tenant, case). Additive only.
--
-- The verdict used to live in a whole-account json blob behind a process cache: a read error came back as
-- an empty file, a write failure was swallowed while the pass reported itself durably filed, and two cold
-- instances merged by overwriting each other. A verdict record needs row atomicity and a stale-writer guard
-- the database enforces, so this is a table, and the ONE writer below refuses to let an older pass overwrite
-- a newer conclusion about the same case.
create table if not exists public.ai_case_dispositions (
  tenant_id   text        not null,
  case_key    text        not null,
  state       text        not null check (state in ('already_credited','actionable','no_page','unreported','monitoring','held','covered')),
  query       text        not null,
  page_url    text,
  stage       text,
  proposal_id text,
  reason      text        not null,
  days        integer     not null default 0,
  engines     integer     not null default 0,
  parents     integer     not null default 0,
  executions  integer     not null default 0,
  decided_at  timestamptz not null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, case_key)
);
create index if not exists ai_case_dispositions_tenant_material_idx
  on public.ai_case_dispositions (tenant_id, days desc, engines desc, executions desc);

-- THE ONE WRITER: per-row upsert where a STALE pass cannot overwrite a newer verdict. Atomic per statement;
-- two concurrent passes merge by row and the newer decided_at wins, so nothing is ever erased by an older
-- lambda that woke up late. Returns how many rows actually landed, so a caller can refuse to claim durability
-- it did not get.
create or replace function public.upsert_ai_case_dispositions(p_tenant_id text, p_rows jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with incoming as (
    select p_tenant_id as tenant_id,
           r->>'caseKey' as case_key,
           r->>'state' as state,
           r->>'query' as query,
           nullif(r->>'pageUrl','') as page_url,
           nullif(r->>'stage','') as stage,
           nullif(r->>'proposalId','') as proposal_id,
           r->>'reason' as reason,
           coalesce((r->>'days')::int, 0) as days,
           coalesce((r->>'engines')::int, 0) as engines,
           coalesce((r->>'parents')::int, 0) as parents,
           coalesce((r->>'executions')::int, 0) as executions,
           (r->>'decidedAt')::timestamptz as decided_at
    from jsonb_array_elements(p_rows) as r
    where coalesce(r->>'caseKey','') <> '' and coalesce(r->>'reason','') <> ''
  ), landed as (
    insert into public.ai_case_dispositions as t
      (tenant_id, case_key, state, query, page_url, stage, proposal_id, reason, days, engines, parents, executions, decided_at, updated_at)
    select tenant_id, case_key, state, query, page_url, stage, proposal_id, reason, days, engines, parents, executions, decided_at, now()
    from incoming
    on conflict (tenant_id, case_key) do update
      set state = excluded.state, query = excluded.query, page_url = excluded.page_url,
          stage = excluded.stage, proposal_id = excluded.proposal_id, reason = excluded.reason,
          days = excluded.days, engines = excluded.engines, parents = excluded.parents,
          executions = excluded.executions, decided_at = excluded.decided_at, updated_at = now()
      where excluded.decided_at >= t.decided_at
    returning 1
  )
  select coalesce(count(*), 0)::integer from landed;
$$;

-- AEO PRE-WRITING DIAGNOSIS on the canonical AI case disposition (applied live 2026-08-28; this file is the
-- repository's record of that exact schema so a clean environment and a restore reproduce it).
-- ADDITIVE ONLY: existing rows keep their verdicts and gain a null diagnosis.
alter table public.ai_case_dispositions add column if not exists diagnosis jsonb;

-- The one writer, unchanged except that it now carries the diagnosis and COALESCES it: a pass that did not rule
-- (unfunded, refused, or transport failure) writes its verdict without stripping a reading a paid pass banked.
create or replace function public.upsert_ai_case_dispositions(p_tenant_id text, p_rows jsonb)
 returns integer
 language sql
 set search_path to 'public'
as $function$
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
           (r->>'decidedAt')::timestamptz as decided_at,
           r->'diagnosis' as diagnosis
    from jsonb_array_elements(p_rows) as r
    where coalesce(r->>'caseKey','') <> '' and coalesce(r->>'reason','') <> ''
  ), landed as (
    insert into public.ai_case_dispositions as t
      (tenant_id, case_key, state, query, page_url, stage, proposal_id, reason, days, engines, parents, executions, decided_at, updated_at, diagnosis)
    select tenant_id, case_key, state, query, page_url, stage, proposal_id, reason, days, engines, parents, executions, decided_at, now(),
           case when diagnosis is null or diagnosis = 'null'::jsonb then null else diagnosis end
    from incoming
    on conflict (tenant_id, case_key) do update
      set state = excluded.state, query = excluded.query, page_url = excluded.page_url,
          stage = excluded.stage, proposal_id = excluded.proposal_id, reason = excluded.reason,
          days = excluded.days, engines = excluded.engines, parents = excluded.parents,
          executions = excluded.executions, decided_at = excluded.decided_at, updated_at = now(),
          diagnosis = coalesce(excluded.diagnosis, t.diagnosis)
      where excluded.decided_at >= t.decided_at
    returning 1
  )
  select coalesce(count(*), 0)::integer from landed;
$function$;

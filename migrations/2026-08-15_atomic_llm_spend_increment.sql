-- ─────────────────────────────────────────────────────────────────────────────
-- ATOMIC OpenAI spend accounting. APPLIED to production 2026-08-15.
--
-- Every OpenAI charge was recorded by a client-side read-modify-write: SELECT
-- today's row, add the cost in JavaScript, UPDATE the absolute value back. Two
-- concurrent charges both read X and both write X + cost, so one of them
-- vanishes, and the cap that is supposed to fail closed then reads a total
-- lower than what was actually spent. The INSERT-vs-INSERT race was already
-- handled in the writer; the UPDATE-vs-UPDATE lost update was not.
--
-- This is the increment the DataForSEO path has always used
-- (reserve_provider_spend, 2026-07-25), generalized to the counters the LLM
-- ledger keeps. The advisory lock serializes writers for one (tenant,
-- platform); the ON CONFLICT clause adds a delta rather than writing a total,
-- so nothing depends on what the caller last read. `p_delta` may be negative
-- (the reconcile/refund path) and the row is clamped at zero.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.increment_llm_spend(
  p_tenant_id text,
  p_platform  text,
  p_delta     numeric,
  p_prompts   integer default 0,
  p_chunks    integer default 0,
  p_run_id    text default null,
  p_metadata  jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or p_platform is null or p_delta is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('provider_spend:' || p_tenant_id || ':' || p_platform, 0));

  insert into public.llm_budget_ledger (tenant_id, date_utc, platform, spent_usd, call_count,
                                        prompt_count, chunk_count, last_run_id, metadata)
  values (p_tenant_id, (now() at time zone 'utc')::date, p_platform, greatest(0, p_delta), 1,
          coalesce(p_prompts, 0), coalesce(p_chunks, 0), p_run_id, p_metadata)
  on conflict (tenant_id, date_utc, platform)
  do update set spent_usd    = greatest(0, public.llm_budget_ledger.spent_usd + p_delta),
                call_count   = public.llm_budget_ledger.call_count + 1,
                prompt_count = public.llm_budget_ledger.prompt_count + coalesce(p_prompts, 0),
                chunk_count  = public.llm_budget_ledger.chunk_count + coalesce(p_chunks, 0),
                last_run_id  = p_run_id,
                metadata     = coalesce(p_metadata, public.llm_budget_ledger.metadata),
                updated_at   = now();
  return true;
end;
$$;

revoke all on function public.increment_llm_spend(text, text, numeric, integer, integer, text, jsonb) from public;
revoke all on function public.increment_llm_spend(text, text, numeric, integer, integer, text, jsonb) from anon;
revoke all on function public.increment_llm_spend(text, text, numeric, integer, integer, text, jsonb) from authenticated;
grant execute on function public.increment_llm_spend(text, text, numeric, integer, integer, text, jsonb) to service_role;

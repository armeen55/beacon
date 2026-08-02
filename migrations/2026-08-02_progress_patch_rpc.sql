-- 2026-08-02  V1 Final Truth Repair: ONE atomic patch for research_runs.progress.
--
-- WHY IT EXISTS. Two paths did a read-modify-write on the same JSON column:
--   * research-run.countContinuation read progress, computed count + 1, and wrote the whole object;
--   * daily-observations.writeDayMarkers wrote { ...row.progress, ...patch } from its own stale read.
-- Two open tabs both read continuations 0 and both wrote 1, so three hops counted as one and the
-- six-hop bound that stops a live tab looping all day bounded nothing. Worse, either write clobbered
-- whatever a concurrent writer had just put on the same row: the retry ledger, the frozen focus, the
-- decide watermark, the operator's extra-reading grant, the persisted daily counts. Every one of those
-- is durable state a later pass reasons from, so a lost key is not a lost render, it is re-spending.
--
-- WHAT THIS DOES. One UPDATE merges the caller's patch into progress with top-level jsonb
-- concatenation and, when an increment key is supplied, computes that counter's new value FROM THE
-- ROW under the update's own lock, in the {day, count} shape the day-scoped counters use: the same
-- day increments, a new day resets to 1. The new progress is returned, so the caller reads the count
-- it actually landed rather than the count it hoped for.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It never touches updated_at. That column is how run-status tells
-- a live pass from a dead process (ten minutes untouched reads as interrupted), and a marker write is
-- not work: stamping it here would have hidden every crashed run behind a housekeeping write.
--
-- Forward-only, idempotent, additive. No data is read, rewritten or dropped by applying it.

create or replace function public.patch_research_run_progress(
  p_tenant_id     text,
  p_run_id        text,
  p_patch         jsonb,
  p_increment_key text default null,
  p_increment_day text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_progress jsonb;
begin
  update public.research_runs r
     set progress =
           (coalesce(r.progress, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb))
           || (case
                 when p_increment_key is null then '{}'::jsonb
                 else jsonb_build_object(
                        p_increment_key,
                        jsonb_build_object(
                          'day', p_increment_day,
                          'count', case
                                     when coalesce(r.progress -> p_increment_key ->> 'day', '')
                                          = coalesce(p_increment_day, '')
                                     then coalesce((r.progress -> p_increment_key ->> 'count')::int, 0) + 1
                                     else 1
                                   end))
               end)
   where r.tenant_id = p_tenant_id
     and r.id = p_run_id::uuid
  returning r.progress into v_progress;
  return v_progress;                       -- null = no row matched, which the caller must not read as saved
end;
$$;

-- SECURITY DEFINER + tenant-scoped by the explicit p_tenant_id argument, so the browser-shipped anon
-- key can never reach it. Explicit service_role grant, not default privileges: without it the write
-- would fail closed forever with no crash to notice.
revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from public;
revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from anon;
revoke all on function public.patch_research_run_progress(text, text, jsonb, text, text) from authenticated;
grant execute on function public.patch_research_run_progress(text, text, jsonb, text, text) to service_role;

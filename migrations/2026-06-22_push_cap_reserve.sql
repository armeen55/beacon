-- 2026-06-22 — Atomic reserve-before-write for the daily push cap (one-click
-- hardening). #5 of the build batch.
--
-- WHY: the durable push_ledger (2026-06-21) made the per-tenant daily cap
-- survive lambda recycles, but the check + the write were still two steps:
--   1. checkDailyPushCap reads "today's pushed count < 10"
--   2. executePush writes to Wix
--   3. appendPushLedger records the push
-- Between (1) and (3) a SECOND concurrent push (e.g. a double-click on the
-- one-click "Accept & publish" button) can read the same count and also pass —
-- both write, exceeding the cap. Low-probability for a single operator, but
-- exactly the kind of race that surfaces once one-click publishing is armed.
--
-- FIX: push_cap_reserve() does the count-and-claim ATOMICALLY under a
-- per-(tenant, day) advisory lock and INSERTS a `reserved` ledger row only if
-- still under the cap. executePush reserves a slot BEFORE the Wix write, then
-- finalizes the same row to `pushed` / `push_failed` after. A reservation that
-- is never finalized (a structural refusal that returns before the write, or a
-- crash) self-frees: the count only includes `reserved` rows newer than 10
-- minutes. src/domains/push/caps.ts falls back to the file store (non-atomic,
-- today's behavior) when Supabase or this function is unavailable, so local dev
-- + the pre-apply deploy window behave exactly as before.
--
-- NOT YET APPLIED TO PROD — apply via MCP apply_migration (operator-approved).
-- Idempotent: safe to re-run. Depends on the push_ledger table (2026-06-21).

-- 1. Allow the `reserved` interim state in the result check.
alter table public.push_ledger
  drop constraint if exists push_ledger_result_check;
alter table public.push_ledger
  add constraint push_ledger_result_check
  check (result in ('pushed', 'push_failed', 'reserved'));

-- 2. Atomic reserve. Returns true if a slot was claimed (a `reserved` row was
--    inserted), false if the tenant is already at the daily cap.
create or replace function public.push_cap_reserve(
  p_tenant      text,
  p_day         date,
  p_max         int,
  p_id          text,
  p_edit_id     text,
  p_target_url  text,
  p_adapter     text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
begin
  -- Serialize concurrent reservers for the same tenant + day. The lock is
  -- transaction-scoped: it releases at COMMIT/ROLLBACK of this implicit txn.
  perform pg_advisory_xact_lock(hashtext(p_tenant || ':' || p_day::text));

  select count(*) into used
  from public.push_ledger
  where tenant_id = p_tenant
    and day = p_day
    and (
      result = 'pushed'
      -- An in-flight reservation holds a slot, but only for 10 minutes — a
      -- reservation that never finalized (refusal/crash) auto-frees so it can
      -- never permanently consume the cap.
      or (result = 'reserved' and pushed_at > now() - interval '10 minutes')
    );

  if used >= p_max then
    return false;
  end if;

  insert into public.push_ledger
    (tenant_id, id, edit_id, target_url, adapter, pushed_at, day, result, detail)
  values
    (p_tenant, p_id, p_edit_id, p_target_url, p_adapter, now(), p_day, 'reserved', null);

  return true;
end;
$$;

-- SECURITY DEFINER + tenant-scoped by the explicit p_tenant arg (the app calls
-- it with the service-role admin client, which bypasses RLS). Deny direct
-- anon/authenticated execution — only the server may reserve a push slot.
revoke all on function public.push_cap_reserve(text, date, int, text, text, text, text) from public;
revoke all on function public.push_cap_reserve(text, date, int, text, text, text, text) from anon;
revoke all on function public.push_cap_reserve(text, date, int, text, text, text, text) from authenticated;

-- ONE RELEASE, ONE TRANSACTION, OR NEITHER HALF. The old shape stamped the ranking during the build and then
-- wrote the customer-surface blob separately, with a rollback that could never fire because the blob writer
-- swallowed its own hosted failures: a build that failed after stamping had already replaced the live order
-- while the previous surface went on serving it, so the list paged one release and the page named another.
-- This function does both halves at once. It validates the expected prior release FIRST, and a null
-- expectation means STRICTLY "no release is on file", so a caller whose read of the prior failed cannot
-- publish over a release it never saw; a mismatch raises before any write. Then it clears this account's
-- stamps, writes ONE global ordinality (research rows included, the lane riding queue_lane as release::lane
-- exactly as before), and upserts the surface blob. Postgres gives the whole function one transaction, so a
-- failure anywhere leaves the previous release and the previous ranking untouched together.
--
-- Idempotent and safe to re-apply: create or replace, then drop the superseded v2 stamp if it is still there.
-- Applied to production 2026-08-23; this file is that same definition, so the database is reproducible from
-- source (the definition was created live first, which is the defect this migration closes).
create or replace function public.publish_customer_release(
  p_tenant_id text,
  p_expected_prior text,
  p_release text,
  p_ids text[],
  p_lanes text[],
  p_scope_key text,
  p_store_name text,
  p_content jsonb
)
returns text
language plpgsql
set search_path to ''
as $$
declare v_prior text;
begin
  select content->0->>'releaseId' into v_prior from public.json_store_blobs where scope_key = p_scope_key;
  -- ALWAYS validated, null included: null expected means "no release on file", so a failed prior read cannot
  -- publish over a live release. A cold start (null = null) passes.
  if v_prior is distinct from p_expected_prior then
    raise exception 'release conflict: expected prior %, found %', p_expected_prior, v_prior;
  end if;
  update public.change_proposals set queue_lane = null, queue_rank = null
    where tenant_id = p_tenant_id and queue_lane is not null;
  update public.change_proposals c
     set queue_lane = p_release || '::' || t.lane, queue_rank = t.ord
    from unnest(p_ids, p_lanes) with ordinality as t(id, lane, ord)
   where c.tenant_id = p_tenant_id and c.id = t.id;
  insert into public.json_store_blobs(scope_key, store_name, content, updated_at)
    values (p_scope_key, p_store_name, p_content, now())
    on conflict (scope_key) do update
      set content = excluded.content, store_name = excluded.store_name, updated_at = excluded.updated_at;
  return p_release;
end;
$$;

revoke all on function public.publish_customer_release(text, text, text, text[], text[], text, text, jsonb) from public;
revoke all on function public.publish_customer_release(text, text, text, text[], text[], text, text, jsonb) from anon;
revoke all on function public.publish_customer_release(text, text, text, text[], text[], text, text, jsonb) from authenticated;
grant execute on function public.publish_customer_release(text, text, text, text[], text[], text, text, jsonb) to service_role;

-- THE SUPERSEDED STAMP IS GONE, not left as a second door onto the same columns: a stamp that can run outside
-- the release transaction is exactly how the ranking and the surface came apart. Nothing in the repository
-- calls it (2026-08-23); dropped live the same day.
drop function if exists public.stamp_change_queue_v2(text, text, text[], text[]);

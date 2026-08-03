-- 2026-08-05  Dream V1: STEP 2 OF 3, the rows move onto the operator's words.
--
-- ORDER IS THE WHOLE POINT. Apply this ONLY after migrations/2026-08-04_lifecycle_expand.sql is in and
-- the bridge release is verified healthy in production (the app is serving Changes, and a saved change
-- comes back). The constraint already accepts both vocabularies, so this rewrite cannot break a read
-- and cannot break a write from either release. Step 3 (2026-08-05_lifecycle_contract.sql) narrows the
-- union afterwards, and only after the counts below verify.
--
-- WHAT MOVES.
--   'proposed'  -> 'ready'                              (a change I checked and would make)
--   'applied'   -> 'implemented_pending_verification'   (the operator says they made it; I have not
--                                                        seen it live yet, which the old word claimed)
--   'rejected'  -> the terminal disposition 'withdrawn' (a draft the safety gates refused never entered
--                                                        the lifecycle, so it was never a stage)
--
-- BOTH THE COLUMN AND THE PAYLOAD. The payload is the record the application re-validates on every load,
-- so a column renamed without its payload would serve nothing at all.
--
-- A WITHDRAWN ROW'S STATUS IS INERT. Nothing reads the status of a row carrying a terminal disposition:
-- the queue reads current rows only. Those rows are set to 'ready' purely so step 3's constraint holds;
-- it asserts nothing, because the disposition beside it is what decides the row is history.
--
-- THE COUNTS ARE THE VERIFICATION. Every state is printed before and after. The AFTER block must show
-- zero rows on 'proposed', 'applied' and 'rejected'. If it does not, DO NOT apply step 3.
--
-- Reversible in principle, forward-only in practice: the previous words are recoverable from this file
-- and no row is deleted.

begin;

do $$
declare
  r record;
begin
  for r in
    select status, count(*) as n from public.change_proposals group by status order by status
  loop
    raise notice 'lifecycle BEFORE: status % holds % rows', r.status, r.n;
  end loop;
  for r in
    select coalesce(terminal_disposition, '(none)') as d, count(*) as n
      from public.change_proposals group by 1 order by 1
  loop
    raise notice 'lifecycle BEFORE: disposition % holds % rows', r.d, r.n;
  end loop;

  -- 1. A draft the safety gates refused becomes history, with the disposition that says Beacon withdrew
  --    it. Rows already carrying a disposition are untouched.
  update public.change_proposals
     set terminal_disposition = 'withdrawn', updated_at = now()
   where status = 'rejected' and terminal_disposition is null;

  -- 2. The rename, on the column.
  update public.change_proposals set status = 'ready'
   where status in ('proposed', 'rejected');
  update public.change_proposals set status = 'implemented_pending_verification'
   where status = 'applied';

  -- 3. The rename, inside the stored payload. Same words, same rows.
  update public.change_proposals
     set payload = jsonb_set(payload, '{proposal,status}', '"ready"'::jsonb)
   where payload -> 'proposal' ->> 'status' in ('proposed', 'rejected');
  update public.change_proposals
     set payload = jsonb_set(payload, '{proposal,status}', '"implemented_pending_verification"'::jsonb)
   where payload -> 'proposal' ->> 'status' = 'applied';

  for r in
    select status, count(*) as n from public.change_proposals group by status order by status
  loop
    raise notice 'lifecycle AFTER: status % holds % rows', r.status, r.n;
  end loop;
  for r in
    select coalesce(terminal_disposition, '(none)') as d, count(*) as n
      from public.change_proposals group by 1 order by 1
  loop
    raise notice 'lifecycle AFTER: disposition % holds % rows', r.d, r.n;
  end loop;
  for r in
    select count(*) as n from public.change_proposals
     where payload -> 'proposal' ->> 'status' in ('proposed', 'applied', 'rejected')
  loop
    raise notice 'lifecycle AFTER: % payloads still carry an old word (must be 0)', r.n;
  end loop;
end $$;

commit;

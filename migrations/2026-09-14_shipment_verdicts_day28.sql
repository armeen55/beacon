-- Stage 5, measurement honesty (2026-09-14). Data only, no schema change. Idempotent: every statement is a no-op on a row it already fixed.
--
-- (a) Only the day 28 read settles a verdict (Product Truth). A day 7 or day 14 directional read was persisted as verdict = 'won', 'lost'
--     or 'inconclusive' with no maturity test; every consumer of the column trusted it (the proposal retired as "this change won", winner
--     memory harvested it, contamination stopped treating the page as under treatment, a no-movement lean read as settled). A row whose
--     verdict is any of those three and whose windows hold no ran reading at day 28 or later goes back to 'measuring'; the pass re-evaluates
--     it at its own day 28 (measure-pass storedVerdictFor) and the read seam (shipped-change-store rowToRecord, measure-lifecycle
--     settledVerdictOf) refuses all three words until then whatever the column says.
update shipped_change_proof
   set verdict = 'measuring', updated_at = now()
 where verdict in ('won', 'lost', 'inconclusive')
   and not exists (
     select 1 from jsonb_array_elements(coalesce(windows, '[]'::jsonb)) w
      where (w->>'ran')::boolean is true and (w->>'day')::int >= 28);

-- (b) verified_live means what it says. It was only ever written by the manual form; recordVerification now sets it from the status on
--     every write, and keeps an operator's own true where no confirming read stands behind it. Backfill only upward: true where the live
--     check confirmed the change or part of it. A true the operator wrote on a row the check could not confirm is the operator's call and
--     stays; rows never checked (verification is null) keep the value the manual form wrote.
update shipped_change_proof
   set verified_live = true, updated_at = now()
 where verification is not null
   and (verification->>'status') in ('verified', 'partially_verified')
   and verified_live is distinct from true;

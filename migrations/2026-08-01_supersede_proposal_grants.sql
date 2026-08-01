-- 2026-08-01  V1 Closure: the supersession function answers to the service role only.
--
-- supersede_change_proposal is SECURITY DEFINER and was created without the revoke block every
-- sibling RPC carries, which left EXECUTE granted to PUBLIC: the browser-shipped anon key could
-- call it directly, and a definer function bypasses the table's RLS. Proposal ids are derivable,
-- so once the table holds rows, that call could retire any account's current proposal and land an
-- attacker-shaped successor. Sealed here. Forward-only, idempotent, no data touched.

revoke all on function public.supersede_change_proposal(text, text, jsonb) from public;
revoke all on function public.supersede_change_proposal(text, text, jsonb) from anon;
revoke all on function public.supersede_change_proposal(text, text, jsonb) from authenticated;
grant execute on function public.supersede_change_proposal(text, text, jsonb) to service_role;

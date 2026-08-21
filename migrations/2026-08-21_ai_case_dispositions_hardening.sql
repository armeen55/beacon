-- HARDENING for ai_case_dispositions and its writer. Additive; the prior migration is applied and immutable.
--
-- The writer was created SECURITY DEFINER with default function grants, which in Postgres means PUBLIC may
-- execute a function that accepts ANY tenant id: a customer-facing role could write another account's
-- verdicts through the exposed RPC. The table itself carried default privileges and no RLS. This migration
-- closes the boundary three ways: the function becomes SECURITY INVOKER so it holds no borrowed authority at
-- all, execution is revoked from every customer-facing role and granted only to the server role, and the
-- table gets service-role-only privileges with RLS enabled behind them as defense in depth (the server role
-- bypasses RLS by design; no other role holds a grant, and with no policies RLS denies whatever slips past).
alter function public.upsert_ai_case_dispositions(text, jsonb) security invoker;

revoke all on function public.upsert_ai_case_dispositions(text, jsonb) from public;
revoke all on function public.upsert_ai_case_dispositions(text, jsonb) from anon;
revoke all on function public.upsert_ai_case_dispositions(text, jsonb) from authenticated;
grant execute on function public.upsert_ai_case_dispositions(text, jsonb) to service_role;

revoke all on table public.ai_case_dispositions from public;
revoke all on table public.ai_case_dispositions from anon;
revoke all on table public.ai_case_dispositions from authenticated;
grant select, insert, update on table public.ai_case_dispositions to service_role;

alter table public.ai_case_dispositions enable row level security;

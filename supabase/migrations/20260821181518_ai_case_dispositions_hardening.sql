alter function public.upsert_ai_case_dispositions(text, jsonb) security invoker;

revoke all on function public.upsert_ai_case_dispositions(text, jsonb) from public;
revoke all on function public.upsert_ai_case_dispositions(text, jsonb) from anon;
revoke all on function public.upsert_ai_case_dispositions(text, jsonb) from authenticated;
grant execute on function public.upsert_ai_case_dispositions(text, jsonb) to service_role;

revoke all on table public.ai_case_dispositions from public;
revoke all on table public.ai_case_dispositions from anon;
revoke all on table public.ai_case_dispositions from authenticated;
grant select, insert, update on table public.ai_case_dispositions to service_role;

alter table public.ai_case_dispositions enable row level security;;

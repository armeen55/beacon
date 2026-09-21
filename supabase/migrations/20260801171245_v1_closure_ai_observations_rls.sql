alter table public.ai_observations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_observations'
      and policyname = 'deny_anon_ai_observations'
  ) then
    create policy deny_anon_ai_observations
      on public.ai_observations
      for all to anon using (false) with check (false);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_observations'
      and policyname = 'deny_authenticated_ai_observations'
  ) then
    create policy deny_authenticated_ai_observations
      on public.ai_observations
      for all to authenticated using (false) with check (false);
  end if;
end $$;;

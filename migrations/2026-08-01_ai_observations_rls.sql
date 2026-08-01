-- 2026-08-01  V1 Closure: row-level security on ai_observations.
--
-- The 2026-07-31 migration created the table that holds tenant ids, prompt text, full AI answers,
-- citations and analyses, but never enabled RLS. Application access is service-role only, which
-- bypasses RLS either way; this closes the direct-client path so an anon or authenticated browser
-- key can never read another account's answers. Matches the deny-anon policy on change_proposals.
--
-- Forward-only, additive, idempotent. Nothing is dropped and no row is touched.

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
end $$;

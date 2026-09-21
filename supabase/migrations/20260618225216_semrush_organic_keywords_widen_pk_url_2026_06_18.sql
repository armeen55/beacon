do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'semrush_organic_keywords'
      and c.conname = 'semrush_organic_keywords_pkey'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (tenant_id, domain, keyword)'
  ) then
    alter table public.semrush_organic_keywords drop constraint semrush_organic_keywords_pkey;
    alter table public.semrush_organic_keywords add primary key (tenant_id, domain, keyword, url);
  end if;
end $$;
SELECT pg_get_constraintdef(c.oid) AS pk
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname='semrush_organic_keywords' AND c.contype='p';;

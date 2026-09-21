create table if not exists public.page_understanding (
  tenant_id           text        not null,
  page_key            text        not null,
  url                 text        not null,
  content_fingerprint text        not null,
  job                 text        not null,
  page_type           text        not null,
  audience            text        not null,
  topics              text[]      not null default '{}',
  commercial          boolean     not null default false,
  read_at             timestamptz not null default now(),
  source_extract_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint page_understanding_pkey primary key (tenant_id, page_key),
  constraint page_understanding_page_type_check check (page_type in (
    'guide', 'list', 'product', 'category', 'city', 'entity', 'translation', 'hub', 'home', 'other'))
);

alter table public.page_understanding enable row level security;

create table if not exists public.page_job_cursor (
  tenant_id  text        not null,
  page_key   text,
  updated_at timestamptz not null default now(),
  constraint page_job_cursor_pkey primary key (tenant_id)
);

alter table public.page_job_cursor enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'page_understanding' and policyname = 'deny_anon_page_understanding') then
    create policy deny_anon_page_understanding
      on public.page_understanding for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'page_understanding' and policyname = 'deny_authenticated_page_understanding') then
    create policy deny_authenticated_page_understanding
      on public.page_understanding for all to authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'page_job_cursor' and policyname = 'deny_anon_page_job_cursor') then
    create policy deny_anon_page_job_cursor
      on public.page_job_cursor for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
    and tablename = 'page_job_cursor' and policyname = 'deny_authenticated_page_job_cursor') then
    create policy deny_authenticated_page_job_cursor
      on public.page_job_cursor for all to authenticated using (false) with check (false);
  end if;
end $$;

revoke all on table public.page_understanding from anon;
revoke all on table public.page_understanding from authenticated;
revoke all on table public.page_job_cursor from anon;
revoke all on table public.page_job_cursor from authenticated;
grant select, insert, update, delete on table public.page_understanding to service_role;
grant select, insert, update, delete on table public.page_job_cursor to service_role;;

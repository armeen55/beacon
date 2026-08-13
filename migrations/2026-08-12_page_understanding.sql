-- 2026-08-12  What each owned page is FOR, held durably instead of in a cache.
--
-- WHY. The one sentence saying what a page is for lived in the shared llm-call-cache: 300 rows for a
-- whole account, shared with the nightly answer analyses, pruned by last use. Every night the analyses
-- evicted the page readings, so a site whose pages had all been read woke up knowing nothing about
-- itself and paid again. Worse, the cache is one JSON blob: four concurrent readings each read the
-- blob, added their row and wrote the whole thing back, so three of every four readings were lost the
-- moment they landed. A page reading is not a cached answer to a repeated question, it is a durable
-- fact about the site, and it belongs in a table with one row per page.
--
-- IDENTITY. One CURRENT row per (tenant, canonical page). page_key is the canonical address (host plus
-- path, no scheme, no query, no trailing slash), which is the join key every producer already uses;
-- url is the address the reading was actually taken for. content_fingerprint is the hash of the exact
-- extract the reading was taken from, so a re-crawled page is told apart from an unchanged one without
-- reading anything: fingerprint equal means the row still describes the page, fingerprint different
-- means the row is stale and still usable while a fresh reading is bought.
--
-- NO READ-MODIFY-WRITE. Every save is a single upsert on the primary key, so concurrent readings of
-- different pages cannot overwrite each other and two readings of the same page settle on the later.
--
-- page_job_cursor is where rotating coverage left off. Static top-60-by-impressions meant the same
-- sixty pages were read every pass and the rest of the site was never read at all. The cursor is one
-- row per account holding the page the next pass resumes the rotation at, so the whole eligible site
-- converges over passes.
--
-- Forward-only, additive, idempotent. No table is dropped and no existing row is touched.

create table if not exists public.page_understanding (
  tenant_id           text        not null,
  -- Canonical address: host + path, no scheme, no query, no trailing slash.
  page_key            text        not null,
  -- The address this reading was taken for, as it was read.
  url                 text        not null,
  -- Hash of the exact extract the reading was taken from. Equal means the row still describes the page.
  content_fingerprint text        not null,
  -- One plain sentence: what this page is for.
  job                 text        not null,
  page_type           text        not null,
  audience            text        not null,
  -- The plain subject words the page is actually about, lowercased.
  topics              text[]      not null default '{}',
  commercial          boolean     not null default false,
  -- When the reading was taken.
  read_at             timestamptz not null default now(),
  -- When the extract behind the reading was captured, when the caller knows it.
  source_extract_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint page_understanding_pkey primary key (tenant_id, page_key),
  constraint page_understanding_page_type_check check (page_type in (
    'guide', 'list', 'product', 'category', 'city', 'entity', 'translation', 'hub', 'home', 'other'))
);

-- The primary key IS the (tenant_id, page_key) index the batch read uses. The rotation reads this
-- account's rows in page order, which that same index already serves, so no second index exists.

alter table public.page_understanding enable row level security;

create table if not exists public.page_job_cursor (
  tenant_id  text        not null,
  -- The canonical page the next pass resumes the rotation at. Null means start at the beginning.
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

-- Application access is service_role only, granted explicitly so the browser keys stay off these
-- tables whatever the project defaults become.
revoke all on table public.page_understanding from anon;
revoke all on table public.page_understanding from authenticated;
revoke all on table public.page_job_cursor from anon;
revoke all on table public.page_job_cursor from authenticated;
grant select, insert, update, delete on table public.page_understanding to service_role;
grant select, insert, update, delete on table public.page_job_cursor to service_role;

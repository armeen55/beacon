-- 2026-08-03  The owned-page inventory, and the full page text behind it.
--
-- WHY. Beacon promised to know an account's website. What it actually held was a queue: discovery
-- tried exactly two guessed sitemap paths, recursed one level, and parked at most 150 URLs in a
-- global JSON blob. Nothing durable ever recorded that a URL EXISTS, so a page nobody reached in
-- that window did not exist as far as the product was concerned, and there was no way to tell
-- "we looked and it was blocked" from "we never looked". This table is the inventory: one row per
-- DISCOVERABLE owned URL, with the state of our read of it. Inventory does not mean recrawling
-- everything every day; it means every discoverable URL is known and eligible.
--
-- The second change is what makes a read worth trusting. page_snapshots kept at most 20 body
-- paragraphs cut at 300 characters, so no consumer could ever say a phrase was ABSENT from a page,
-- only that it was not in the sample. body_text holds the whole de-chromed main content under an
-- explicit 100,000 character ceiling (truncation is recorded in structural_warnings), and
-- owned_pages.content_hash is the hash OF THAT HELD TEXT, so "unchanged" means the text we hold
-- is the text we held.
--
-- Forward-only, additive, idempotent. No table is dropped, no row is touched, and every existing
-- page_snapshots row keeps decoding exactly as before (body_text is simply null on old rows, which
-- is what makes them read as sample-era rows rather than as empty pages).

create table if not exists public.owned_pages (
  tenant_id                text        not null,
  -- Canonical form: scheme + host + path, no query, no fragment, no trailing slash.
  url                      text        not null,
  -- How this URL first became known. robots_sitemap is the site's own answer; implementation means
  -- a page we know exists because the operator shipped it.
  discovered_via           text        not null default 'sitemap',
  first_seen               timestamptz not null default now(),
  last_seen_in_discovery   timestamptz not null default now(),
  -- uncrawled = known, never read. crawled = read, snapshot on file. blocked = the site refused
  -- (401/403/429) and blocked_until says when to try again. unsupported = not a readable HTML page.
  -- gone = 404/410, so it is inventory history, never a crawl candidate.
  crawl_state              text        not null default 'uncrawled',
  http_status              integer,
  last_crawled_at          timestamptz,
  -- When the SAME failing answer came back on a SECOND, later reporting day (America/Los_Angeles, the
  -- one day Beacon counts). A server error on one day is a bad minute and says nothing; only a second
  -- look on a second day makes it a fault worth telling the operator about. Null means nobody has
  -- looked twice yet, which is the honest reading of a single 500.
  status_reconfirmed_at    timestamptz,
  -- Hash of the FULL extracted main content held for this page (page_snapshots.body_text).
  content_hash             text,
  -- How much of the page the last read actually holds. missing = never read.
  completeness             text        not null default 'missing',
  -- Bounded retry date for a blocked page: 1 day, then 7, then 30 as the ceiling.
  blocked_until            timestamptz,
  redirects_to             text,
  -- False when this URL redirects elsewhere or its canonical points at another page.
  is_canonical_target      boolean     not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint owned_pages_pkey primary key (tenant_id, url),
  constraint owned_pages_discovered_via_check check (
    discovered_via in ('sitemap', 'robots_sitemap', 'homepage', 'nav', 'implementation')),
  constraint owned_pages_crawl_state_check check (
    crawl_state in ('uncrawled', 'crawled', 'blocked', 'unsupported', 'gone')),
  constraint owned_pages_completeness_check check (
    completeness in ('complete', 'partial', 'blocked', 'unsupported', 'missing', 'stale'))
);

-- The primary key above IS the (tenant_id, url) index: it enforces the identity and serves the
-- paged inventory read in that same order, so no second index on those two columns exists.

-- The crawl-selection read: what is eligible next, uncrawled before stale.
create index if not exists ix_owned_pages_next_candidate
  on public.owned_pages (tenant_id, crawl_state, last_crawled_at nulls first);

alter table public.owned_pages enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owned_pages' and policyname = 'deny_anon_owned_pages'
  ) then
    create policy deny_anon_owned_pages
      on public.owned_pages for all to anon using (false) with check (false);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'owned_pages' and policyname = 'deny_authenticated_owned_pages'
  ) then
    create policy deny_authenticated_owned_pages
      on public.owned_pages for all to authenticated using (false) with check (false);
  end if;
end $$;

-- Application access is service_role only. Granting explicitly rather than leaning on default
-- privileges keeps the browser keys off this table whatever the project defaults become.
revoke all on table public.owned_pages from anon;
revoke all on table public.owned_pages from authenticated;
grant select, insert, update, delete on table public.owned_pages to service_role;

-- The full de-chromed main content of the page, capped at 100,000 characters by the extractor.
-- Null on every pre-2026-08-03 row, which is exactly how a sample-era capture is told apart from a
-- page that genuinely has nothing to say.
alter table public.page_snapshots add column if not exists body_text text;

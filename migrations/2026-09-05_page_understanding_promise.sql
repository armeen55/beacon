-- WHAT A PAGE PROMISES, WHAT IT IS MISSING, AND WHAT IT SELLS, on the durable page reading (applied live
-- 2026-09-05 through the management connection; this file is the repository's record of that exact schema so a
-- clean environment and a restore reproduce it).
-- ADDITIVE ONLY, and every column is nullable: a row written before these fields existed keeps its reading and
-- reads them back empty, which page-job.ts treats as STALE (served now, refreshed when the ordinary rotation can
-- afford one) rather than as a page that promises nothing and is missing nothing. No site-wide reread.
alter table public.page_understanding add column if not exists promise text;
alter table public.page_understanding add column if not exists missing text;
alter table public.page_understanding add column if not exists sells text[];

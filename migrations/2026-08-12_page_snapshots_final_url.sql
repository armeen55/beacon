-- Additive: record where a page fetch actually landed. Null on every row written before this, which is
-- exactly what marks a capture that cannot say whether the address it names is the address it read.
alter table public.page_snapshots add column if not exists final_url text;

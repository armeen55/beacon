alter table public.shipped_change_proof add column if not exists notes           text;
alter table public.shipped_change_proof add column if not exists verified_live   boolean not null default false;
alter table public.shipped_change_proof add column if not exists live_source_url text;;

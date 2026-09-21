alter table public.shipped_change_proof
  add column if not exists control_match_notes jsonb;
alter table public.shipped_change_proof
  add column if not exists control_match_weak boolean not null default false;;

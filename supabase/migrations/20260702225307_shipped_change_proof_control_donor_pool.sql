alter table public.shipped_change_proof
  add column if not exists control_donor_pool jsonb;;

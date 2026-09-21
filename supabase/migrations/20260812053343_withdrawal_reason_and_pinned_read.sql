alter table public.change_proposals add column if not exists withdrawn_reason text;
alter table public.shipped_change_proof add column if not exists pinned_read jsonb;;

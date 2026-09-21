create table if not exists public.global_patterns (
  id                   text        not null,
  site_category        text        not null,
  canonical_move_type  text        not null,
  intent_bucket        text        not null,
  position_band        text        not null,
  n                    integer     not null default 0,
  distinct_tenants     integer     not null default 0,
  win_rate             numeric     not null default 0,
  lift_p25             numeric,
  lift_p75             numeric,
  updated_at           timestamptz not null default now(),
  primary key (id)
);

comment on table public.global_patterns is
  'Cross-tenant aggregate cells (BEACON_500 item 66). No tenant_id column by design, the privacy boundary is structural (no identifying column exists), not an RLS filter. Rows carry only closed-vocabulary dimension values + counts/rates.';

alter table public.global_patterns enable row level security;

drop policy if exists deny_anon on public.global_patterns;
create policy deny_anon on public.global_patterns
  as permissive for all to anon
  using (false) with check (false);

drop policy if exists authenticated_read_only on public.global_patterns;
create policy authenticated_read_only on public.global_patterns
  as permissive for select to authenticated
  using (true);

create index if not exists global_patterns_lookup_idx
  on public.global_patterns (site_category, canonical_move_type, intent_bucket, position_band);
;

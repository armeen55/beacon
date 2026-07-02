-- BEACON_500 item 66 (2026-07-02): cross-tenant pattern brain, rebuilt on the GSC
-- proof ledger. One row per aggregated cell keyed by {site_category, canonical_move_type,
-- intent_bucket, position_band} - the closed-vocabulary dimensions computed in
-- src/domains/global-patterns/rr-pattern.ts. A nightly pass (nightly-aggregate.ts) reads
-- every tenant's MATURE, decided (won/lost) ShippedChangeRecord outcomes (the same
-- maturity/weather/parallel-trends eligibility gate loadExperimentOutcomes already
-- applies), buckets them, and upserts one row per cell.
--
-- WHY THIS TABLE IS DIFFERENT FROM EVERY OTHER TABLE IN THIS DIRECTORY: every other
-- table here is per-tenant (RLS scopes reads/writes to tenant_id via is_tenant_member).
-- This table is INTENTIONALLY the opposite - a single cross-tenant AGGREGATE with no
-- tenant_id column at all. That is the privacy boundary, not an RLS policy: no row here
-- can name a tenant, page, domain, or query, because no such column exists. What crosses
-- the tenant boundary is four closed-vocabulary dimension values plus counts/rates -
-- never raw text, never an identifier. Distinct-tenant counting happens in application
-- code during aggregation (a Set of tenant ids, summed to a count) and only the COUNT is
-- persisted; the set itself is discarded before the row is written.
--
-- RLS: enabled, with authenticated granted READ ONLY (an aggregate aid to any signed-in
-- surface - there is nothing tenant-specific to leak) and every write path denied except
-- the service-role admin client (which bypasses RLS entirely, same as every other table's
-- nightly/backend job). anon is denied outright, matching every other table's posture.
--
-- Additive + idempotent (create-if-not-exists). The app degrades to "no global cell"
-- (resolvePrior's global backoff simply finds nothing) until this is applied, so a
-- deploy window stays functional and byte-identical to pre-item-66 behavior.
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

-- Authenticated read-only: there is no tenant-specific data in this table to scope, so
-- any signed-in caller may read every row. No authenticated write policy exists at all,
-- which (combined with RLS being enabled) denies authenticated INSERT/UPDATE/DELETE by
-- default - only the service-role admin client (RLS-exempt) writes this table, from the
-- nightly aggregation job.
drop policy if exists authenticated_read_only on public.global_patterns;
create policy authenticated_read_only on public.global_patterns
  as permissive for select to authenticated
  using (true);

create index if not exists global_patterns_lookup_idx
  on public.global_patterns (site_category, canonical_move_type, intent_bucket, position_band);

-- 002_remaining_core.sql
-- Phase 1C: Remaining route-critical tables from the Phase 0.5 audit.
-- Stores #6-15. Single-tenant, no RLS.
--
-- Naming: all columns use snake_case to match PostgreSQL conventions.
-- TS types with camelCase (PersistedIssue, ChangeContract) require
-- key mapping in the repository layer.

-- ---------------------------------------------------------------------------
-- 6. attribution_decisions — operator review decisions (event-decisions store)
-- ---------------------------------------------------------------------------
create table if not exists attribution_decisions (
  id                  text primary key,
  event_id            text    not null,
  result_id           text    not null,
  cause_type          text    not null,
  primary_change_id   text,
  operator_confidence text    not null,
  operator_note       text,
  rejected_change_ids text[]  not null default '{}',
  decided_at          timestamptz not null
);

create index if not exists idx_attribution_decisions_result
  on attribution_decisions (result_id);

-- ---------------------------------------------------------------------------
-- 7. candidate_links — attribution candidates
-- ---------------------------------------------------------------------------
create table if not exists candidate_links (
  id          text primary key,
  result_id   text        not null,
  change_id   text        not null,
  status      text        not null default 'suggested',
  attribution jsonb,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_candidate_links_result
  on candidate_links (result_id);

-- ---------------------------------------------------------------------------
-- 8. page_issues — scanner-detected issues (camelCase TS → snake_case DB)
-- ---------------------------------------------------------------------------
create table if not exists page_issues (
  issue_id                                text primary key,
  page_url                                text not null,
  page_path                               text not null,
  category                                text not null,
  status                                  text not null default 'new',
  handed_off_at                           timestamptz,
  shipped_at                              timestamptz,
  verified_at                             timestamptz,
  updated_at                              timestamptz not null default now(),
  verify_result                           jsonb,
  verification_observation_run_id         text,
  verification_baseline_observation_run_id text
);

-- ---------------------------------------------------------------------------
-- 9. change_contracts — attribution-ready changelog contracts (camelCase → snake)
-- ---------------------------------------------------------------------------
create table if not exists change_contracts (
  contract_id                  text primary key,
  account_id                   text not null,
  date_requested               timestamptz not null,
  date_live                    timestamptz,
  source_document              text,
  source_input_type            text not null,
  page_url                     text not null,
  page_type                    text not null,
  city                         text,
  service                      text,
  topic                        text,
  change_type                  text not null,
  change_summary               text not null,
  business_goal                text not null,
  intended_hypothesis          text not null,
  faq_count_expected           integer,
  schema_types_expected        text[] not null default '{}',
  h1_expected                  text,
  title_expected               text,
  meta_expected                text,
  internal_links_expected      text[] not null default '{}',
  expected_verification        text[] not null default '{}',
  expected_outcome_window_days integer not null default 21,
  attribution_readiness        text not null default 'weak',
  linked_issue_id              text,
  linked_plan_id               text,
  linked_wave_id               text,
  linked_frontier_id           text,
  linked_changelog_entry_id    text,
  verification_status          text not null default 'pending',
  verification_result          text,
  verified_at                  timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  notes                        text
);

-- ---------------------------------------------------------------------------
-- 10. pages — page registry
-- ---------------------------------------------------------------------------
create table if not exists pages (
  id                text primary key,
  url               text    not null,
  canonical_url     text    not null,
  domain            text    not null,
  path              text    not null,
  page_type         text    not null,
  city              text,
  service           text,
  topics            text[]  not null default '{}',
  ownership_tier    text    not null,
  tracked_entity_id text,
  is_owned          boolean not null default false,
  first_seen_at     timestamptz not null,
  last_observed_at  timestamptz not null,
  discovery_sources text[]  not null default '{}',
  title_last_seen   text,
  changelog_ids     text[]  not null default '{}',
  metadata          jsonb   not null default '{}'
);

create index if not exists idx_pages_domain on pages (domain);

-- ---------------------------------------------------------------------------
-- 11. page_snapshots — per-crawl extraction
-- ---------------------------------------------------------------------------
create table if not exists page_snapshots (
  id                     text primary key,
  page_id                text        not null,
  observation_run_id     text,
  url                    text        not null,
  canonical_url          text,
  fetched_at             timestamptz not null,
  http_status            integer     not null,
  title                  text,
  meta_description       text,
  h1                     text,
  h2_list                text[]      not null default '{}',
  h3_count               integer     not null default 0,
  faqs                   jsonb       not null default '[]',
  schema_types           text[]      not null default '{}',
  location_terms         text[]      not null default '{}',
  service_terms          text[]      not null default '{}',
  internal_link_count    integer     not null default 0,
  external_link_count    integer     not null default 0,
  word_count             integer     not null default 0,
  robots_meta            text,
  has_canonical_mismatch boolean     not null default false,
  content_hash           text        not null,
  headings_hash          text        not null,
  faq_hash               text        not null,
  schema_hash            text        not null
);

create index if not exists idx_page_snapshots_page
  on page_snapshots (page_id);

-- ---------------------------------------------------------------------------
-- 12. guardrail_alerts — per-crawl guardrails
-- ---------------------------------------------------------------------------
create table if not exists guardrail_alerts (
  id                 serial primary key,
  page_id            text   not null,
  url                text   not null,
  severity           text   not null,
  category           text   not null,
  message            text   not null,
  detail             text   not null,
  observation_run_id text
);

create index if not exists idx_guardrail_alerts_severity
  on guardrail_alerts (severity);

-- ---------------------------------------------------------------------------
-- 13. citation_evidence_index — citation rollup (document-style)
-- ---------------------------------------------------------------------------
create table if not exists citation_evidence_index (
  id                        text primary key default 'current',
  built_at                  timestamptz not null,
  total_citations_processed integer     not null default 0,
  by_page_and_topic         jsonb       not null default '[]',
  by_topic                  jsonb       not null default '[]',
  page_to_topics            jsonb       not null default '{}'
);

-- ---------------------------------------------------------------------------
-- 14. observation_runs — unified: website crawl, verify, visibility import
-- ---------------------------------------------------------------------------
create table if not exists observation_runs (
  run_id         text primary key,
  run_type       text        not null,
  source         text        not null,
  status         text        not null,
  started_at     timestamptz not null,
  completed_at   timestamptz not null,
  scope_label    text        not null,
  parser_version text,
  -- Website crawl artifact counts (nullable for non-crawl types)
  pages_scanned      integer,
  pages_changed      integer,
  pages_with_errors  integer,
  guardrail_alerts   integer,
  critical_count     integer,
  regression_count   integer,
  improvement_count  integer,
  baseline_run_id    text,
  -- Visibility import fields (nullable for non-visibility types)
  is_synthetic_wrapper           boolean,
  counts                         jsonb,
  prompt_set_version             text,
  engine_platform_note           text,
  citation_index_built_at        timestamptz,
  sample_result_row_count        integer,
  linked_citation_index_run_id   text,
  baseline_visibility_run_id     text,
  -- Shared competitor universe fields
  competitor_universe_version     integer,
  competitor_universe_fingerprint text,
  competitor_universe_scope       text,
  competitor_universe_pin_status  text
);

-- ---------------------------------------------------------------------------
-- 15. competitor_config — workspace-configured competitor universe
-- ---------------------------------------------------------------------------
create table if not exists competitor_config (
  id           text primary key,
  display_name text   not null,
  domain       text   not null,
  status       text   not null default 'active',
  notes        text,
  tags         text[] not null default '{}'
);

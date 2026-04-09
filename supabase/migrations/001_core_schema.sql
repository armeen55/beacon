-- 001_core_schema.sql
-- Phase 1A: Core entity tables for seed-data entities.
-- Single-tenant, no RLS, no workspaces.
-- Maps to stores #1-5 from the Phase 0.5 audit (all route-critical).
--
-- Apply via Supabase dashboard SQL Editor or `supabase db push`.

-- ---------------------------------------------------------------------------
-- 1. import_runs — tracks import batches; gates hasActiveExperiment()
-- ---------------------------------------------------------------------------
create table if not exists import_runs (
  id              text primary key,
  source_system   text    not null,
  entity_type     text    not null
                    check (entity_type in ('results','changes','opportunities','competitors')),
  format          text    not null
                    check (format in ('csv','json')),
  started_at      timestamptz not null,
  completed_at    timestamptz not null,
  total_rows      integer not null default 0,
  imported_count  integer not null default 0,
  skipped_count   integer not null default 0,
  errors          text[]  not null default '{}',
  warnings        text[]  not null default '{}'
);

-- ---------------------------------------------------------------------------
-- 2. results — visibility measurement rows
-- ---------------------------------------------------------------------------
create table if not exists results (
  id                            text primary key,
  snapshot_date                 date        not null,
  platform                     text        not null,
  metric_type                  text        not null,
  metric_value                 numeric     not null,
  previous_value               numeric,
  delta                        numeric,
  delta_percentage             numeric,
  topic                        text,
  city                         text,
  url_measured                 text,
  attributed_changelog_ids     text[]      not null default '{}',
  notes                        text,
  mention_count                integer     not null default 0,
  citation_count               integer     not null default 0,
  total_possible               integer,
  position                     numeric,
  created_at                   timestamptz not null default now(),
  source_system                text,
  import_batch_id              text,
  visibility_observation_run_id text
);

create index if not exists idx_results_platform_date
  on results (platform, snapshot_date);

-- ---------------------------------------------------------------------------
-- 3. changelog_entries — logged changes
-- ---------------------------------------------------------------------------
create table if not exists changelog_entries (
  id                      text primary key,
  "timestamp"             timestamptz not null,
  signal_type             text        not null,
  asset_type              text        not null,
  url                     text,
  asset_name              text        not null,
  change_description      text        not null,
  topic_targeted          text        not null,
  city_targeted           text,
  hypothesis              text,
  expected_impact_window  text,
  brief_id                text,
  opportunity_id          text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  source_system           text,
  import_batch_id         text
);

create index if not exists idx_changelog_entries_timestamp
  on changelog_entries ("timestamp" desc);

-- ---------------------------------------------------------------------------
-- 4. opportunities — tracked opportunities
-- ---------------------------------------------------------------------------
create table if not exists opportunities (
  id                      text primary key,
  title                   text    not null,
  description             text,
  query_text              text    not null,
  platforms               text[]  not null default '{}',
  intent_type             text    not null,
  city                    text,
  topic                   text    not null,
  tags                    text[]  not null default '{}',
  current_status          text    not null default 'new',
  priority                text    not null default 'medium',
  estimated_impact        text    not null default 'medium',
  effort                  text    not null default 'medium',
  confidence              text    not null default 'medium',
  source                  text    not null,
  baseline_position       numeric,
  target_position         numeric,
  target_url              text,
  competitor_ids          text[]  not null default '{}',
  primary_competitor_id   text,
  linked_brief_ids        text[]  not null default '{}',
  linked_changelog_ids    text[]  not null default '{}',
  related_opportunity_ids text[]  not null default '{}',
  identified_at           timestamptz not null,
  activated_at            timestamptz,
  captured_at             timestamptz,
  lost_at                 timestamptz,
  last_verified_at        timestamptz,
  assessed_at             timestamptz,
  deferred_at             timestamptz,
  deferred_until          timestamptz,
  closed_at               timestamptz,
  close_reason            text,
  regressed_at            timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  source_system           text,
  import_batch_id         text
);

create index if not exists idx_opportunities_status
  on opportunities (current_status);

-- ---------------------------------------------------------------------------
-- 5. competitors — competitor entities
-- ---------------------------------------------------------------------------
create table if not exists competitors (
  id              text primary key,
  name            text    not null,
  domain          text    not null,
  description     text,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  source_system   text,
  import_batch_id text,
  source_of_truth text
);

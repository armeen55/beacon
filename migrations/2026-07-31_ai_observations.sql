-- 2026-07-31  V1 Truth Convergence, Phase 1: full-fidelity AI observation capture.
--
-- Until now one AI answer was collapsed at capture: the text was hashed and discarded, the pages the
-- engine retrieved but did not cite were never stored at all, and re-reading an answer meant buying it
-- again. This table keeps ONE row per canonical observation with the whole answer, the whole retrieval
-- journey, the money receipt and the evidence_cache identity of the raw envelope, so every later pass
-- reads what was already paid for.
--
-- IDENTITY is (tenant_id, prompt_id, prompt_version, engine, reporting_day, sample_slot). A retry of the
-- same intent reuses that identity and upserts the SAME row; a deliberate second sample of the same pair
-- on the same day is a different sample_slot and therefore a different row.
--
-- Forward-only and additive: nothing is dropped and no existing table is altered.
-- prompt_answer_observations stays exactly as it is and is now written as a PROJECTION of these rows.

create table if not exists public.ai_observations (
  id                 text primary key,
  tenant_id          text        not null,
  site               text        not null default '',
  prompt_id          text        not null,
  prompt_version     integer     not null default 1,
  prompt_text        text        not null default '',
  engine             text        not null,
  model_requested    text,
  model_served       text,
  observation_mode   text        not null,
  reporting_day      date        not null,
  sample_slot        smallint    not null default 0,
  language           text        not null default 'en',
  location           integer     not null default 2840,
  requested_at       timestamptz not null,
  completed_at       timestamptz,
  capability_version text        not null default '',
  -- The evidence_cache identity of the raw provider envelope this row was read from.
  cache_key          text,
  cost_usd           numeric(12, 6) not null default 0,
  -- observed = a real answer in hand. unavailable = the engine had nothing readable to give.
  -- unsupported = the engine cannot be asked at all, so no money moved. failed = the provider
  -- refused or broke, with the reason. pending = accepted and in flight.
  status             text        not null default 'pending',
  failure_reason     text,
  answer_text        text,
  answer_hash        text,
  -- fan_outs[], retrieved_results[], cited_sources[], brand_mentions[], web_search_reported.
  -- Each list keeps its tri-state: absent key / null = the provider does not report it on this
  -- path, [] = it reported none. Retrieved is kept strictly apart from cited.
  journey            jsonb       not null default '{}'::jsonb,
  -- Null until a later strict-schema pass analyzes the stored text. Filling it costs no provider call.
  analysis           jsonb,
  analysis_hash      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ai_observations_status_check
    check (status in ('observed', 'unavailable', 'unsupported', 'failed', 'pending')),
  constraint ai_observations_slot_check check (sample_slot >= 0 and sample_slot <= 2)
);

-- THE identity. Two rows can never describe the same intended observation.
create unique index if not exists ux_ai_observations_identity
  on public.ai_observations (tenant_id, prompt_id, prompt_version, engine, reporting_day, sample_slot);

-- The daily read: one tenant's observations for one reporting day, newest ask first.
create index if not exists ix_ai_observations_tenant_day
  on public.ai_observations (tenant_id, reporting_day desc, requested_at desc);

-- The per-question history read.
create index if not exists ix_ai_observations_tenant_prompt
  on public.ai_observations (tenant_id, prompt_id, reporting_day desc);

-- The re-analysis worklist: stored answers that no analysis pass has judged yet.
create index if not exists ix_ai_observations_unanalyzed
  on public.ai_observations (tenant_id, reporting_day desc)
  where analysis is null and status = 'observed';

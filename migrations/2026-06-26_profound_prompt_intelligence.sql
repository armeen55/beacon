-- Migration: 2026-06-26_profound_prompt_intelligence.sql
-- Author:    Claude (Profound Iranopedia Prompt Intelligence build) — operator-spec.
-- Status:    NOT APPLIED. Additive only. Apply via the Supabase apply_migration tool
--            AFTER operator approval (hard rule: no migration APPLY without sign-off).
-- Project:   vlxwevsdvwxvopkjsewo (beacon-main — current prod).
--
-- Why this migration exists:
--   The Profound Question Intelligence layer currently reads LIVE on every render
--   (pullProfoundAnswers + query-fanouts, topic-scoped). That works, but to (a)
--   refresh nightly without a render, (b) let the Rank-&-Revenue EvidencePacket /
--   New-Pages / Today-Moves fusion read prompt-level signals without a live API
--   call, and (c) keep history, we persist the raw prompt/answer/fanout rows the
--   sync pulls. These are NET-NEW tables — the existing profound_citation_rows /
--   profound_visibility_rows are topic-aggregates with NO prompt/prompt_id grain,
--   so they cannot store this cleanly. NOTHING existing is dropped or altered.
--
-- Borrowed-account note: these store the tenant's OWN topic's prompts only; bots/
-- referrals/Agent-Analytics tables are NOT touched (no access on this key).
--
-- Constraints (operator-locked): ADDITIVE ONLY (CREATE TABLE IF NOT EXISTS); no
-- ALTER/DROP of existing schema; RLS deny-all-authenticated (service_role bypass),
-- mirroring the other profound_* tables; composite PKs are tenant-scoped; fully
-- reversible (DROP TABLE rollback at the bottom).

-- ── Tracked prompts (one row per AI question in the tenant's topic) ──────────
CREATE TABLE IF NOT EXISTS public.profound_prompt_rows (
  tenant_id      text        NOT NULL,
  prompt_id      text        NOT NULL,           -- Profound prompt UUID
  prompt         text        NOT NULL,           -- verbatim AI question
  topic_id       text,
  topic          text,
  tags           text[]      NOT NULL DEFAULT '{}',
  status         text,                            -- active | paused (from the API)
  pulled_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, prompt_id)
);

-- ── Raw answers (one row per observed AI answer; the per-prompt gold) ────────
CREATE TABLE IF NOT EXISTS public.profound_answer_rows (
  tenant_id        text        NOT NULL,
  -- Answers carry no stable id; hash(prompt|model|date) keeps upserts idempotent.
  answer_key       text        NOT NULL,
  prompt           text        NOT NULL,
  topic            text,
  model            text,
  date             date        NOT NULL,
  mentions         text[]      NOT NULL DEFAULT '{}',   -- entities/brands named
  citation_urls    text[]      NOT NULL DEFAULT '{}',   -- full URLs cited (the pages)
  citation_hosts   text[]      NOT NULL DEFAULT '{}',   -- www-stripped hostnames
  themes           text[]      NOT NULL DEFAULT '{}',
  own_cited        boolean     NOT NULL DEFAULT false,  -- iranopedia.com in citation_hosts
  own_mentioned    boolean     NOT NULL DEFAULT false,  -- brand in mentions
  response_excerpt text,                                 -- first ~500 chars (context)
  pulled_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, answer_key)
);

-- ── Query fan-outs (downstream searches a prompt expands into) ──────────────
CREATE TABLE IF NOT EXISTS public.profound_query_fanout_rows (
  tenant_id     text        NOT NULL,
  fanout_key    text        NOT NULL,            -- hash(prompt|query|model|date)
  prompt        text        NOT NULL,
  query         text        NOT NULL,            -- the expanded search query
  model         text,
  date          date        NOT NULL,
  total_fanouts double precision,
  share         double precision,
  pulled_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fanout_key)
);

-- ── RLS: deny-all to anon/authenticated; service_role (the sync) bypasses ────
ALTER TABLE public.profound_prompt_rows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profound_answer_rows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profound_query_fanout_rows  ENABLE ROW LEVEL SECURITY;
-- (No policies created → no access for anon/authenticated; service_role bypasses
--  RLS, matching the existing profound_citation_rows / profound_visibility_rows.)

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (reversible — these are net-new; nothing else depends on them):
--   DROP TABLE IF EXISTS public.profound_query_fanout_rows;
--   DROP TABLE IF EXISTS public.profound_answer_rows;
--   DROP TABLE IF EXISTS public.profound_prompt_rows;
-- After rollback, the sync's writes no-op (PostgREST PGRST205 / 42P01 → the
-- persist layer's existing file-fallback / fail-soft treats the table as missing;
-- the live on-demand loader is unaffected).
-- ───────────────────────────────────────────────────────────────────────────

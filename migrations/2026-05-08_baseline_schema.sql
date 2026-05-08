-- ============================================================================
-- Migration: 2026-05-08_baseline_schema.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — baseline-only file capturing production state.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 0.5 — schema dump for source-control parity
-- ============================================================================
--
-- Purpose
-- -------
-- Capture the current Supabase production schema as source-of-truth before
-- refining RLS in Phase 1. Pre-2026-05-08, schema migrations existed in
-- `migrations/` but RLS posture, several CHECK constraints, and a number of
-- tables were provisioned via the Supabase dashboard and never round-tripped
-- back to source control. This file fixes that gap.
--
-- This file is BASELINE-ONLY. It is NOT applied with the rest of the
-- migrations during deploys (the operator confirmed production already
-- contains this exact state on 2026-05-08). It exists so future migrations
-- can be diffed against a known-good starting point.
--
-- Production posture today (locked-down, service-role-only)
-- ---------------------------------------------------------
--   • Every public table has ENABLE ROW LEVEL SECURITY.
--   • Every public table has a `deny_anon` policy:
--       USING (false) WITH CHECK (false)
--   • 35 of 36 tables have a parallel `deny_authenticated` policy
--     (also USING (false) WITH CHECK (false)).
--   • The single exception, `tenant_members`, has `members_self_read`:
--       FOR SELECT TO authenticated USING (user_id = auth.uid())
--   • App reads/writes use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS
--     entirely. The deny policies are defense-in-depth: if a JWT leaks or
--     a client-side query mistakenly uses the anon key, it gets nothing.
--
-- What RLS does protect today:    accidental anon-key reads from the browser.
-- What RLS does NOT protect today: tenant isolation in app code paths.
--                                  Isolation is enforced application-side by
--                                  the `.eq("tenant_id", x)` discipline
--                                  layered on top of `currentTenantId()`.
--
-- Foreign keys
-- ------------
-- Only 2 FKs in the entire schema, both on `tenant_members`:
--   • tenant_members.tenant_id -> tenants(id)            ON DELETE CASCADE
--   • tenant_members.user_id   -> auth.users(id)         ON DELETE CASCADE
-- The rest of the schema does not enforce referential integrity at the DB
-- layer. This is deliberate: the dual-write architecture writes to .data/
-- JSON files first and Supabase second, so FKs would block file-first rows
-- that haven't yet flushed to Supabase. Trade-off; future Phase 1+ work may
-- selectively re-add FKs where dual-write ordering guarantees it's safe.
--
-- CHECK constraints
-- -----------------
-- 5 tables carry a `tenant_id_nonempty_chk` constraint blocking empty-string
-- tenant_id writes (Sprint 7 Phase 7.2):
--   changelog_entries, import_runs, recommendation_responses,
--   results, scan_findings.
-- 13 other tenant-scoped tables (those carrying a tenant_id column) do NOT
-- yet have this CHECK. Tracked as a Phase 1 Stage C task.
--
-- Extensions
-- ----------
-- pgcrypto, uuid-ossp and other typical Supabase extensions are managed by
-- Supabase at the project level, not the public schema, so they do not
-- appear in this dump. A fresh-clone bootstrap relies on Supabase's
-- default-on extensions; this file should NOT be replayed on a non-Supabase
-- Postgres without first provisioning those extensions.
--
-- Replay safety
-- -------------
-- This file is a SCHEMA SNAPSHOT, not a replayable migration. It contains:
--   • OWNER TO postgres / pg_database_owner statements
--   • GRANT ALL TO anon/authenticated/service_role statements
--   • References to auth.users (the Supabase auth schema)
--   • References to auth.uid() (the Supabase JWT claim helper)
-- A bare Postgres install will reject all of those. To re-create from
-- scratch:
--   1. provision a Supabase project (auth schema + roles appear automatically)
--   2. apply this baseline
--   3. apply the prior migrations in `migrations/` if they were not yet
--      applied (note: per project history they have been applied to prod)
--
-- Phase 1 follow-up (NOT in this commit)
-- --------------------------------------
-- The work after this baseline:
--   Stage A: this file committed (this commit).
--   Stage B: tenant_id column gap repair (18 tables currently lack the column).
--   Stage C: tenant_id_nonempty CHECK constraints across all tenant-scoped
--            tables (currently 5 of 18 covered).
--   Stage D: cross-tenant read/poll guard fixes (the audit-flagged
--            `tenant_id: ""` placeholders in 4+ source files).
--   Stage E: a `tenant_member(uid, tid)` SQL helper + tenant-scoped policies
--            replacing `deny_authenticated` per category.
--   Stage F: optional — move browser-side reads off service-role onto
--            authenticated JWT, lighting up the new policies.
--   Stage G: only then is broader multi-tenant customer rollout safe.
-- See docs/RLS_PHASE_1_PLAN_2026_05_08.md for full sequencing.
--
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."answer_intelligence_index" (
    "id" "text" DEFAULT 'current'::"text" NOT NULL,
    "built_at" timestamp with time zone,
    "data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."answer_intelligence_index" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."answer_texts" (
    "observation_id" "text" NOT NULL,
    "body" "text" NOT NULL
);


ALTER TABLE "public"."answer_texts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attribution_decisions" (
    "id" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "result_id" "text" NOT NULL,
    "cause_type" "text" NOT NULL,
    "primary_change_id" "text",
    "operator_confidence" "text" NOT NULL,
    "operator_note" "text",
    "rejected_change_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "decided_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."attribution_decisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_config" (
    "id" "text" DEFAULT 'current'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."business_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."candidate_links" (
    "id" "text" NOT NULL,
    "result_id" "text" NOT NULL,
    "change_id" "text" NOT NULL,
    "status" "text" DEFAULT 'suggested'::"text" NOT NULL,
    "attribution" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_at" timestamp with time zone
);


ALTER TABLE "public"."candidate_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_contracts" (
    "contract_id" "text" NOT NULL,
    "account_id" "text" NOT NULL,
    "date_requested" timestamp with time zone NOT NULL,
    "date_live" timestamp with time zone,
    "source_document" "text",
    "source_input_type" "text" NOT NULL,
    "page_url" "text" NOT NULL,
    "page_type" "text" NOT NULL,
    "city" "text",
    "service" "text",
    "topic" "text",
    "change_type" "text" NOT NULL,
    "change_summary" "text" NOT NULL,
    "business_goal" "text" NOT NULL,
    "intended_hypothesis" "text" NOT NULL,
    "faq_count_expected" integer,
    "schema_types_expected" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "h1_expected" "text",
    "title_expected" "text",
    "meta_expected" "text",
    "internal_links_expected" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "expected_verification" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "expected_outcome_window_days" integer DEFAULT 21 NOT NULL,
    "attribution_readiness" "text" DEFAULT 'weak'::"text" NOT NULL,
    "linked_issue_id" "text",
    "linked_plan_id" "text",
    "linked_wave_id" "text",
    "linked_frontier_id" "text",
    "linked_changelog_entry_id" "text",
    "verification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "verification_result" "text",
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."change_contracts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_outcomes" (
    "id" "text" NOT NULL,
    "change_id" "text" NOT NULL,
    "topic_targeted" "text",
    "changed_at" timestamp with time zone,
    "direction" "text",
    "mention_delta_pct" numeric,
    "citation_delta_pct" numeric,
    "visibility_delta_pct" numeric,
    "mentions_before" numeric,
    "mentions_after" numeric,
    "citations_before" numeric,
    "citations_after" numeric,
    "visibility_before" numeric,
    "visibility_after" numeric,
    "days_before" integer,
    "days_after" integer,
    "observations_before" integer,
    "observations_after" integer,
    "platform_deltas" "jsonb" DEFAULT '{}'::"jsonb",
    "computed_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "text" NOT NULL
);


ALTER TABLE "public"."change_outcomes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."change_outcomes"."tenant_id" IS 'Sprint 7 Phase 1 — multi-tenant scoping (Phase 7.0 triage discovered missing column). Backfilled from single-tenant founder.';



CREATE TABLE IF NOT EXISTS "public"."change_patterns" (
    "id" "text" NOT NULL,
    "signal_type" "text",
    "asset_type" "text",
    "sample_count" integer,
    "success_count" integer,
    "success_rate" numeric,
    "avg_citation_delta" numeric,
    "avg_mention_delta" numeric,
    "avg_days_to_signal" integer,
    "platform_response" "jsonb" DEFAULT '{}'::"jsonb",
    "confidence" "text",
    "computed_at" timestamp with time zone
);


ALTER TABLE "public"."change_patterns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."changelog_entries" (
    "id" "text" NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    "signal_type" "text" NOT NULL,
    "asset_type" "text" NOT NULL,
    "url" "text",
    "asset_name" "text" NOT NULL,
    "change_description" "text" NOT NULL,
    "topic_targeted" "text" NOT NULL,
    "city_targeted" "text",
    "hypothesis" "text",
    "expected_impact_window" "text",
    "brief_id" "text",
    "opportunity_id" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_system" "text",
    "import_batch_id" "text",
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    "change_family" "text",
    "change_type" "text",
    "schema_types_before" "text"[],
    "schema_types_after" "text"[],
    "schema_types_added" "text"[],
    "schema_types_removed" "text"[],
    "schema_hash_before" "text",
    "schema_hash_after" "text",
    "visible_copy_changed" boolean,
    "page_scope" "text",
    "archived" boolean DEFAULT false,
    "archived_reason" "text",
    "archived_at" timestamp with time zone,
    "dedupe_reviewed" boolean DEFAULT false,
    "dedupe_reviewed_at" timestamp with time zone,
    "hypothesis_source" "text",
    "source_rec_id" "text",
    "source_pattern_id" "text",
    "action_type" "text",
    "target_element_key" "text",
    "live_at" timestamp with time zone,
    CONSTRAINT "changelog_entries_tenant_id_nonempty_chk" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."changelog_entries" OWNER TO "postgres";


COMMENT ON CONSTRAINT "changelog_entries_tenant_id_nonempty_chk" ON "public"."changelog_entries" IS 'Sprint 7 Phase 7.2 — prevents future empty/null tenant_id writes.';



CREATE TABLE IF NOT EXISTS "public"."citation_evidence_index" (
    "id" "text" DEFAULT 'current'::"text" NOT NULL,
    "built_at" timestamp with time zone NOT NULL,
    "total_citations_processed" integer DEFAULT 0 NOT NULL,
    "by_page_and_topic" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "by_topic" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "page_to_topics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."citation_evidence_index" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitor_config" (
    "id" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."competitor_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitors" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_system" "text",
    "import_batch_id" "text",
    "source_of_truth" "text"
);


ALTER TABLE "public"."competitors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."confidence_calibration" (
    "id" "text" DEFAULT 'current'::"text" NOT NULL,
    "total_compared" integer,
    "agreement_count" integer,
    "agreement_rate" numeric,
    "false_positive_count" integer,
    "false_negative_count" integer,
    "recommended_threshold_adjustment" numeric,
    "current_improving_threshold" numeric,
    "calibrated_at" timestamp with time zone
);


ALTER TABLE "public"."confidence_calibration" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_metric_snapshots" (
    "id" "text" NOT NULL,
    "date" "date" NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "visibility_score" numeric,
    "mention_count" integer DEFAULT 0 NOT NULL,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "share_of_voice" numeric,
    "avg_position" numeric,
    "total_possible" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "daily_metric_snapshots_tenant_id_nonempty" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."daily_metric_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."guardrail_alerts" (
    "id" integer NOT NULL,
    "page_id" "text" NOT NULL,
    "url" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "category" "text" NOT NULL,
    "message" "text" NOT NULL,
    "detail" "text" NOT NULL,
    "observation_run_id" "text",
    "tenant_id" "text" NOT NULL
);


ALTER TABLE "public"."guardrail_alerts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."guardrail_alerts"."tenant_id" IS 'Sprint 7 Phase 1 — multi-tenant scoping. Backfilled from single-tenant founder.';



CREATE SEQUENCE IF NOT EXISTS "public"."guardrail_alerts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."guardrail_alerts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."guardrail_alerts_id_seq" OWNED BY "public"."guardrail_alerts"."id";



CREATE TABLE IF NOT EXISTS "public"."import_runs" (
    "id" "text" NOT NULL,
    "source_system" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "format" "text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone NOT NULL,
    "total_rows" integer DEFAULT 0 NOT NULL,
    "imported_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "errors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "warnings" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "import_runs_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['results'::"text", 'changes'::"text", 'opportunities'::"text", 'competitors'::"text"]))),
    CONSTRAINT "import_runs_format_check" CHECK (("format" = ANY (ARRAY['csv'::"text", 'json'::"text"]))),
    CONSTRAINT "import_runs_tenant_id_nonempty_chk" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."import_runs" OWNER TO "postgres";


COMMENT ON CONSTRAINT "import_runs_tenant_id_nonempty_chk" ON "public"."import_runs" IS 'Sprint 7 Phase 7.2 — prevents future empty/null tenant_id writes.';



CREATE TABLE IF NOT EXISTS "public"."llm_rejections" (
    "id" "text" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "rec_id" "text",
    "provider_name" "text",
    "model" "text",
    "evidence_hash" "text",
    "raw_output" "jsonb",
    "validation_error" "text",
    "cost_usd" numeric,
    "rejected_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."llm_rejections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."observation_runs" (
    "run_id" "text" NOT NULL,
    "run_type" "text" NOT NULL,
    "source" "text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone NOT NULL,
    "scope_label" "text" NOT NULL,
    "parser_version" "text",
    "pages_scanned" integer,
    "pages_changed" integer,
    "pages_with_errors" integer,
    "guardrail_alerts" integer,
    "critical_count" integer,
    "regression_count" integer,
    "improvement_count" integer,
    "baseline_run_id" "text",
    "is_synthetic_wrapper" boolean,
    "counts" "jsonb",
    "prompt_set_version" "text",
    "engine_platform_note" "text",
    "citation_index_built_at" timestamp with time zone,
    "sample_result_row_count" integer,
    "linked_citation_index_run_id" "text",
    "baseline_visibility_run_id" "text",
    "competitor_universe_version" integer,
    "competitor_universe_fingerprint" "text",
    "competitor_universe_scope" "text",
    "competitor_universe_pin_status" "text",
    "tenant_id" "text" NOT NULL
);


ALTER TABLE "public"."observation_runs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."observation_runs"."tenant_id" IS 'Sprint 7 Phase 1 — multi-tenant scoping. Backfilled from single-tenant founder.';



CREATE TABLE IF NOT EXISTS "public"."opportunities" (
    "id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "query_text" "text" NOT NULL,
    "platforms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "intent_type" "text" NOT NULL,
    "city" "text",
    "topic" "text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "current_status" "text" DEFAULT 'new'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "estimated_impact" "text" DEFAULT 'medium'::"text" NOT NULL,
    "effort" "text" DEFAULT 'medium'::"text" NOT NULL,
    "confidence" "text" DEFAULT 'medium'::"text" NOT NULL,
    "source" "text" NOT NULL,
    "baseline_position" numeric,
    "target_position" numeric,
    "target_url" "text",
    "competitor_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_competitor_id" "text",
    "linked_brief_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "linked_changelog_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "related_opportunity_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "identified_at" timestamp with time zone NOT NULL,
    "activated_at" timestamp with time zone,
    "captured_at" timestamp with time zone,
    "lost_at" timestamp with time zone,
    "last_verified_at" timestamp with time zone,
    "assessed_at" timestamp with time zone,
    "deferred_at" timestamp with time zone,
    "deferred_until" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "close_reason" "text",
    "regressed_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_system" "text",
    "import_batch_id" "text"
);


ALTER TABLE "public"."opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_element_inventory" (
    "id" "text" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "page_id" "text" NOT NULL,
    "url" "text" NOT NULL,
    "element_type" "text" NOT NULL,
    "element_key" "text" NOT NULL,
    "display_label" "text" NOT NULL,
    "element_text" "text",
    "element_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "extractor_version" integer NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "source_snapshot_id" "text" NOT NULL
);


ALTER TABLE "public"."page_element_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_issues" (
    "issue_id" "text" NOT NULL,
    "page_url" "text" NOT NULL,
    "page_path" "text" NOT NULL,
    "category" "text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "handed_off_at" timestamp with time zone,
    "shipped_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verify_result" "jsonb",
    "verification_observation_run_id" "text",
    "verification_baseline_observation_run_id" "text"
);


ALTER TABLE "public"."page_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_snapshots" (
    "id" "text" NOT NULL,
    "page_id" "text" NOT NULL,
    "observation_run_id" "text",
    "url" "text" NOT NULL,
    "canonical_url" "text",
    "fetched_at" timestamp with time zone NOT NULL,
    "http_status" integer NOT NULL,
    "title" "text",
    "meta_description" "text",
    "h1" "text",
    "h2_list" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "h3_count" integer DEFAULT 0 NOT NULL,
    "faqs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "schema_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "location_terms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "service_terms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "internal_link_count" integer DEFAULT 0 NOT NULL,
    "external_link_count" integer DEFAULT 0 NOT NULL,
    "word_count" integer DEFAULT 0 NOT NULL,
    "robots_meta" "text",
    "has_canonical_mismatch" boolean DEFAULT false NOT NULL,
    "content_hash" "text" NOT NULL,
    "headings_hash" "text" NOT NULL,
    "faq_hash" "text" NOT NULL,
    "schema_hash" "text" NOT NULL,
    "extraction_certainty" "text",
    "faq_schema_block_count" integer,
    "structural_warnings" "text"[] DEFAULT '{}'::"text"[],
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    "body_paragraph_sample" "text"[],
    "h3_list" "text"[],
    "card_texts" "text"[],
    "schema_entity_names" "text"[],
    "schema_validation_warnings" "text"[],
    "table_count" integer,
    "internal_links" "jsonb"
);


ALTER TABLE "public"."page_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_visibility" (
    "id" "text" NOT NULL,
    "page_url" "text" NOT NULL,
    "total_citations" integer DEFAULT 0,
    "mention_count" integer DEFAULT 0,
    "top_topics" "jsonb" DEFAULT '[]'::"jsonb",
    "platform_breakdown" "jsonb" DEFAULT '{}'::"jsonb",
    "trend_direction" "text" DEFAULT 'insufficient_data'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "response_profile" "jsonb"
);


ALTER TABLE "public"."page_visibility" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "text" NOT NULL,
    "url" "text" NOT NULL,
    "canonical_url" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "path" "text" NOT NULL,
    "page_type" "text" NOT NULL,
    "city" "text",
    "service" "text",
    "topics" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "ownership_tier" "text" NOT NULL,
    "tracked_entity_id" "text",
    "is_owned" boolean DEFAULT false NOT NULL,
    "first_seen_at" timestamp with time zone NOT NULL,
    "last_observed_at" timestamp with time zone NOT NULL,
    "discovery_sources" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "title_last_seen" "text",
    "changelog_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tenant_id" "text" NOT NULL
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pages"."tenant_id" IS 'Sprint 7 Phase 1 — multi-tenant scoping. Backfilled from single-tenant founder.';



CREATE TABLE IF NOT EXISTS "public"."prompt_answer_observations" (
    "id" "text" NOT NULL,
    "prompt_id" "text" NOT NULL,
    "run_id" "text" NOT NULL,
    "answer_hash" "text",
    "position" numeric,
    "tracked_brand_mentioned" boolean,
    "tracked_brand_cited" boolean,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "owned_citation_count" integer DEFAULT 0 NOT NULL,
    "citation_domains" "text"[] DEFAULT '{}'::"text"[],
    "citation_categories" "jsonb" DEFAULT '{}'::"jsonb",
    "mentions" "text"[] DEFAULT '{}'::"text"[],
    "observed_at" timestamp with time zone NOT NULL,
    "platform" "text" NOT NULL,
    "topic" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "raw_search_queries" "text",
    "search_queries" "text"[],
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    "mention_position" integer,
    "citation_rank" integer,
    "primary_recommendation" boolean,
    "descriptor_window" "text"[],
    "competitor_co_mentions" "text"[],
    "citation_domain_classes" "text"[],
    "answer_structure" "text",
    "citation_urls" "text"[],
    "competitor_descriptor_windows" "jsonb",
    CONSTRAINT "prompt_answer_observations_tenant_id_nonempty" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."prompt_answer_observations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."prompt_answer_observations"."mention_position" IS 'Char offset of first brand mention in answer_text. Null when brand not mentioned. Commit 3 (2026-04-24) schema v2.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."citation_rank" IS '1-indexed position of owned domain in citations list. Null when brand not cited. Commit 3 (2026-04-24) schema v2.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."primary_recommendation" IS 'Heuristic: brand mentioned AND in first 20% of answer AND top-2 by order. Commit 3 (2026-04-24) schema v2.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."descriptor_window" IS 'Adjectives/nouns in ±5-word window around first brand mention (up to 10). Positioning intel. Commit 6 (2026-04-24) schema v2.1.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."competitor_co_mentions" IS 'Canonical names of tracked non-owned entities mentioned in this answer, in order of first appearance. Commit 6 (2026-04-24) schema v2.1.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."citation_domain_classes" IS 'Per-citation domain class, parallel to citation_domains. Values: owned|competitor|directory|news|review|social|other. Commit 6 (2026-04-24) schema v2.1.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."answer_structure" IS 'Answer shape: ranked_list|bullet_list|narrative|comparison|mixed. Commit 6 (2026-04-24) schema v2.1.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."citation_urls" IS 'Full URLs of citations in order from the LLM response. Populated by Commit 7 adapter update (2026-04-24). Null on pre-Commit-7 rows — domain-level citation_domains is the only signal there.';



COMMENT ON COLUMN "public"."prompt_answer_observations"."competitor_descriptor_windows" IS 'W4 Stage 7 (2026-05-04): Schema v2.1 enrichment — descriptor windows extracted around competitor name mentions in the answer text. Map of competitor_canonical_name -> array of descriptor strings. Nullable because pre-W4 native rows do not carry this field. Populated by deterministic extractor in scripts/customer-one-backfill.ts and (going forward) in src/domains/prompt-answer-observations/extraction.ts when W2 day 2 backfill lands.';



CREATE TABLE IF NOT EXISTS "public"."raw_poll_chunks" (
    "run_id" "text" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "source" "text" NOT NULL,
    "chunk_offset" integer DEFAULT 0 NOT NULL,
    "chunk_limit" integer,
    "prompt_count" integer DEFAULT 0 NOT NULL,
    "prompt_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "raw_response" "jsonb",
    "cost_usd" numeric,
    "observations_persisted_count" integer,
    "reconciliation_status" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."raw_poll_chunks" OWNER TO "postgres";


COMMENT ON TABLE "public"."raw_poll_chunks" IS 'Poll Integrity Hardening (2026-05-04): raw provider responses written BEFORE observation upsert. Preserves data even if observation persistence fails. Schema deliberately minimal so it cannot suffer the same column-drift failure that caused the May 2-4 incident.';



COMMENT ON COLUMN "public"."raw_poll_chunks"."observations_persisted_count" IS 'Filled by the reconciliation step after syncObs. Null until reconciled. Compare to prompt_count for verified-persistence verdict.';



COMMENT ON COLUMN "public"."raw_poll_chunks"."reconciliation_status" IS 'One of: pending | verified_complete | persistence_mismatch | observation_upsert_threw | snapshot_derivation_failed. Stamped post-pipeline.';



CREATE TABLE IF NOT EXISTS "public"."recommendation_responses" (
    "rec_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "responded_at" timestamp with time zone NOT NULL,
    "defer_until" timestamp with time zone,
    "target_page_url" "text",
    "pattern_id" "text",
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recommendation_responses_tenant_id_nonempty_chk" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."recommendation_responses" OWNER TO "postgres";


COMMENT ON CONSTRAINT "recommendation_responses_tenant_id_nonempty_chk" ON "public"."recommendation_responses" IS 'Sprint 7 Phase 7.2 — prevents future empty/null tenant_id writes.';



CREATE TABLE IF NOT EXISTS "public"."recommended_edits" (
    "id" "text" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "rec_id" "text" NOT NULL,
    "action_type" "text" NOT NULL,
    "target_url" "text" NOT NULL,
    "target_element_key" "text",
    "display_label" "text",
    "current_text" "text",
    "proposed_text" "text",
    "why" "text" NOT NULL,
    "evidence" "jsonb" NOT NULL,
    "expected_impact" "text",
    "difficulty" "text" NOT NULL,
    "confidence" "text" NOT NULL,
    "measurement_plan" "text",
    "risks" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source" "text" NOT NULL,
    "provider_name" "text",
    "evidence_hash" "text",
    "model" "text",
    "cost_usd" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "implementation_status" "text" DEFAULT 'recommended'::"text",
    "live_at" timestamp with time zone,
    "live_snapshot_id" "text",
    "live_match_confidence" "text",
    "live_match_kind" "text",
    "live_element_key" "text",
    "not_found_reason" "text",
    CONSTRAINT "recommended_edits_tenant_id_nonempty" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."recommended_edits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."results" (
    "id" "text" NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "platform" "text" NOT NULL,
    "metric_type" "text" NOT NULL,
    "metric_value" numeric NOT NULL,
    "previous_value" numeric,
    "delta" numeric,
    "delta_percentage" numeric,
    "topic" "text",
    "city" "text",
    "url_measured" "text",
    "attributed_changelog_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "mention_count" integer DEFAULT 0 NOT NULL,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "total_possible" integer,
    "position" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_system" "text",
    "import_batch_id" "text",
    "visibility_observation_run_id" "text",
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "results_tenant_id_nonempty_chk" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."results" OWNER TO "postgres";


COMMENT ON CONSTRAINT "results_tenant_id_nonempty_chk" ON "public"."results" IS 'Sprint 7 Phase 7.2 — prevents future empty/null tenant_id writes.';



CREATE TABLE IF NOT EXISTS "public"."scan_findings" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "url" "text" NOT NULL,
    "page_path" "text",
    "detected_at" timestamp with time zone,
    "scan_run_id" "text",
    "previous_state" "text",
    "current_state" "text",
    "severity" "text",
    "priority" "text",
    "priority_score" integer DEFAULT 0,
    "summary" "text",
    "suggested_action" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "resolved_at" timestamp with time zone,
    "linked_change_id" "text",
    "promotion_status" "text" DEFAULT 'none'::"text",
    "resolution_note" "text",
    "suppress_until" timestamp with time zone,
    "citation_count" integer DEFAULT 0,
    "is_homepage" boolean DEFAULT false,
    "contradicts_changelog" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metric_movement_detected" boolean,
    "signal_strength" numeric,
    "source_rec_id" "text",
    "source_pattern_id" "text",
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "scan_findings_tenant_id_nonempty_chk" CHECK ((("tenant_id" IS NOT NULL) AND ("tenant_id" <> ''::"text")))
);


ALTER TABLE "public"."scan_findings" OWNER TO "postgres";


COMMENT ON CONSTRAINT "scan_findings_tenant_id_nonempty_chk" ON "public"."scan_findings" IS 'Sprint 7 Phase 7.2 — prevents future empty/null tenant_id writes.';



CREATE TABLE IF NOT EXISTS "public"."tenant_members" (
    "user_id" "uuid" NOT NULL,
    "tenant_id" "text" NOT NULL,
    "role" "text" DEFAULT 'owner'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."tenant_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenant_members" IS 'Sprint 7 Phase 1 — auth.users to tenants mapping. Read by middleware (Phase 7.4) to inject x-beacon-tenant header. Today: one row (operator -> ritz).';



CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "business_name" "text" NOT NULL,
    "domain" "text" NOT NULL,
    "segment" "text" DEFAULT 'local_residential_builder'::"text" NOT NULL,
    "project_mix" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cities_served" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "budget_range" "text" DEFAULT 'mixed'::"text" NOT NULL,
    "signup_date" timestamp with time zone NOT NULL,
    "role" "text" DEFAULT 'beta_customer'::"text" NOT NULL,
    "tos_accepted_at" timestamp with time zone,
    "discovered_competitors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "daily_budget_usd" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "email_frequency" "text" DEFAULT 'weekly'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenants_budget_range_check" CHECK (("budget_range" = ANY (ARRAY['under_1m'::"text", '1m_5m'::"text", '5m_plus'::"text", 'mixed'::"text"]))),
    CONSTRAINT "tenants_email_frequency_check" CHECK (("email_frequency" = ANY (ARRAY['weekly'::"text", 'immediate_only'::"text", 'off'::"text"]))),
    CONSTRAINT "tenants_id_check" CHECK ((("id" ~~ 'tenant-%'::"text") AND ("id" <> ''::"text"))),
    CONSTRAINT "tenants_role_check" CHECK (("role" = ANY (ARRAY['founder'::"text", 'beta_customer'::"text", 'paid_customer'::"text"]))),
    CONSTRAINT "tenants_segment_check" CHECK (("segment" = 'local_residential_builder'::"text")),
    CONSTRAINT "tenants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'cancelled'::"text", 'pending_onboarding'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


COMMENT ON TABLE "public"."tenants" IS 'Sprint 7 Phase 1 — multi-tenant registry. Mirrors BeaconTenant in src/domains/tenants/types.ts. Single row today (Ritz Builders); beta testers added in Phase 7.12 via scripts/onboard-tenant.ts.';



CREATE TABLE IF NOT EXISTS "public"."tracked_entities" (
    "id" "text" NOT NULL,
    "account_id" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "domain" "text",
    "url" "text",
    "location_scope" "text",
    "service_scope" "text",
    "is_owned" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."tracked_entities" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tracked_entities"."aliases" IS 'Known name variants for alias-aware matching in poll adapters. E.g., owned brand "Ritz Builders" may have aliases {Ritzbuilders, Ritz}. Used additively with name — adapters check name + aliases against answer text.';



CREATE TABLE IF NOT EXISTS "public"."tracked_prompts" (
    "id" "text" NOT NULL,
    "account_id" "text" NOT NULL,
    "text" "text" NOT NULL,
    "topic_id" "text",
    "location_scope" "text",
    "service_scope" "text",
    "intent_type" "text",
    "platforms" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tracked_prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."triage_rules" (
    "id" "text" NOT NULL,
    "finding_type" "text",
    "citation_bucket" "text",
    "total_resolved" integer,
    "accepted_count" integer,
    "rejected_count" integer,
    "ignored_count" integer,
    "acceptance_rate" numeric,
    "rejection_rate" numeric,
    "recommendation" "text",
    "confidence" "text",
    "computed_at" timestamp with time zone
);


ALTER TABLE "public"."triage_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."url_change_outcomes" (
    "change_id" "text" NOT NULL,
    "url" "text" NOT NULL,
    "edit_type_tokens" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "asset_type" "text" NOT NULL,
    "verdict" "text" NOT NULL,
    "landing_day_n" integer,
    "landing_z" numeric,
    "delta_pct" numeric,
    "delta_abs" numeric,
    "baseline_days_used" integer DEFAULT 0 NOT NULL,
    "post_days_used" integer DEFAULT 0 NOT NULL,
    "sustain_up" integer DEFAULT 0 NOT NULL,
    "sustain_down" integer DEFAULT 0 NOT NULL,
    "confidence" "text" NOT NULL,
    "recorded_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "transitions" integer DEFAULT 0 NOT NULL,
    "tenant_id" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."url_change_outcomes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."guardrail_alerts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."guardrail_alerts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."answer_intelligence_index"
    ADD CONSTRAINT "answer_intelligence_index_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."answer_texts"
    ADD CONSTRAINT "answer_texts_pkey" PRIMARY KEY ("observation_id");



ALTER TABLE ONLY "public"."attribution_decisions"
    ADD CONSTRAINT "attribution_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_config"
    ADD CONSTRAINT "business_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."candidate_links"
    ADD CONSTRAINT "candidate_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_contracts"
    ADD CONSTRAINT "change_contracts_pkey" PRIMARY KEY ("contract_id");



ALTER TABLE ONLY "public"."change_outcomes"
    ADD CONSTRAINT "change_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_patterns"
    ADD CONSTRAINT "change_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."changelog_entries"
    ADD CONSTRAINT "changelog_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."citation_evidence_index"
    ADD CONSTRAINT "citation_evidence_index_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitor_config"
    ADD CONSTRAINT "competitor_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."confidence_calibration"
    ADD CONSTRAINT "confidence_calibration_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_metric_snapshots"
    ADD CONSTRAINT "daily_metric_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."guardrail_alerts"
    ADD CONSTRAINT "guardrail_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."llm_rejections"
    ADD CONSTRAINT "llm_rejections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."observation_runs"
    ADD CONSTRAINT "observation_runs_pkey" PRIMARY KEY ("run_id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_element_inventory"
    ADD CONSTRAINT "page_element_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_issues"
    ADD CONSTRAINT "page_issues_pkey" PRIMARY KEY ("issue_id");



ALTER TABLE ONLY "public"."page_snapshots"
    ADD CONSTRAINT "page_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_visibility"
    ADD CONSTRAINT "page_visibility_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompt_answer_observations"
    ADD CONSTRAINT "prompt_answer_observations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."raw_poll_chunks"
    ADD CONSTRAINT "raw_poll_chunks_pkey" PRIMARY KEY ("run_id");



ALTER TABLE ONLY "public"."recommendation_responses"
    ADD CONSTRAINT "recommendation_responses_pkey" PRIMARY KEY ("tenant_id", "rec_id");



COMMENT ON CONSTRAINT "recommendation_responses_pkey" ON "public"."recommendation_responses" IS 'Sprint 7 Phase 7.5b Commit 1B (2026-04-25) — widened from (rec_id) to (tenant_id, rec_id) for multi-tenant rec_id collision safety.';



ALTER TABLE ONLY "public"."recommended_edits"
    ADD CONSTRAINT "recommended_edits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scan_findings"
    ADD CONSTRAINT "scan_findings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_members"
    ADD CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("user_id", "tenant_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."tracked_entities"
    ADD CONSTRAINT "tracked_entities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tracked_prompts"
    ADD CONSTRAINT "tracked_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."triage_rules"
    ADD CONSTRAINT "triage_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."url_change_outcomes"
    ADD CONSTRAINT "url_change_outcomes_pkey" PRIMARY KEY ("change_id", "url");



CREATE INDEX "change_outcomes_tenant_id_idx" ON "public"."change_outcomes" USING "btree" ("tenant_id");



CREATE INDEX "guardrail_alerts_tenant_id_idx" ON "public"."guardrail_alerts" USING "btree" ("tenant_id");



CREATE INDEX "idx_attribution_decisions_result" ON "public"."attribution_decisions" USING "btree" ("result_id");



CREATE INDEX "idx_candidate_links_result" ON "public"."candidate_links" USING "btree" ("result_id");



CREATE INDEX "idx_changelog_entries_timestamp" ON "public"."changelog_entries" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_cl_action_type" ON "public"."changelog_entries" USING "btree" ("action_type") WHERE ("action_type" IS NOT NULL);



CREATE INDEX "idx_cl_target_element_key" ON "public"."changelog_entries" USING "btree" ("target_element_key") WHERE ("target_element_key" IS NOT NULL);



CREATE INDEX "idx_daily_metric_snapshots_scope" ON "public"."daily_metric_snapshots" USING "btree" ("scope_type", "scope_id");



CREATE INDEX "idx_dms_date" ON "public"."daily_metric_snapshots" USING "btree" ("date");



CREATE INDEX "idx_dms_scope" ON "public"."daily_metric_snapshots" USING "btree" ("scope_type", "scope_id");



CREATE INDEX "idx_guardrail_alerts_severity" ON "public"."guardrail_alerts" USING "btree" ("severity");



CREATE INDEX "idx_llm_rej_tenant_rejected_at" ON "public"."llm_rejections" USING "btree" ("tenant_id", "rejected_at" DESC);



CREATE INDEX "idx_observation_runs_type_started" ON "public"."observation_runs" USING "btree" ("run_type", "started_at" DESC);



CREATE INDEX "idx_opportunities_status" ON "public"."opportunities" USING "btree" ("current_status");



CREATE INDEX "idx_page_snapshots_page" ON "public"."page_snapshots" USING "btree" ("page_id");



CREATE INDEX "idx_page_snapshots_page_fetched" ON "public"."page_snapshots" USING "btree" ("page_id", "fetched_at" DESC);



CREATE INDEX "idx_pages_domain" ON "public"."pages" USING "btree" ("domain");



CREATE INDEX "idx_pao_topic_platform" ON "public"."prompt_answer_observations" USING "btree" ("topic", "platform");



CREATE INDEX "idx_pei_tenant_element_key" ON "public"."page_element_inventory" USING "btree" ("tenant_id", "element_key");



CREATE INDEX "idx_pei_tenant_page" ON "public"."page_element_inventory" USING "btree" ("tenant_id", "page_id");



CREATE INDEX "idx_prompt_answer_observations_topic_platform" ON "public"."prompt_answer_observations" USING "btree" ("topic", "platform");



CREATE INDEX "idx_raw_poll_chunks_tenant_created" ON "public"."raw_poll_chunks" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_re_tenant_rec" ON "public"."recommended_edits" USING "btree" ("tenant_id", "rec_id");



CREATE INDEX "idx_recommendation_responses_status" ON "public"."recommendation_responses" USING "btree" ("status");



CREATE INDEX "idx_recommendation_responses_tenant" ON "public"."recommendation_responses" USING "btree" ("tenant_id");



CREATE INDEX "idx_recommended_edits_impl_status_accepted" ON "public"."recommended_edits" USING "btree" ("tenant_id", "implementation_status") WHERE ("implementation_status" = 'accepted'::"text");



CREATE INDEX "idx_results_platform_date" ON "public"."results" USING "btree" ("platform", "snapshot_date");



CREATE INDEX "idx_scan_findings_status" ON "public"."scan_findings" USING "btree" ("status");



CREATE INDEX "idx_scan_findings_tenant" ON "public"."scan_findings" USING "btree" ("tenant_id");



CREATE INDEX "idx_url_change_outcomes_tenant" ON "public"."url_change_outcomes" USING "btree" ("tenant_id");



CREATE INDEX "idx_url_change_outcomes_url" ON "public"."url_change_outcomes" USING "btree" ("url");



CREATE INDEX "idx_url_change_outcomes_verdict" ON "public"."url_change_outcomes" USING "btree" ("verdict");



CREATE INDEX "observation_runs_tenant_started_idx" ON "public"."observation_runs" USING "btree" ("tenant_id", "started_at" DESC);



CREATE INDEX "pages_tenant_id_idx" ON "public"."pages" USING "btree" ("tenant_id");



CREATE INDEX "pages_tenant_url_idx" ON "public"."pages" USING "btree" ("tenant_id", "url");



CREATE INDEX "tenant_members_tenant_idx" ON "public"."tenant_members" USING "btree" ("tenant_id");



CREATE INDEX "tenant_members_user_idx" ON "public"."tenant_members" USING "btree" ("user_id");



CREATE UNIQUE INDEX "ux_pao_tenant_prompt_platform_day" ON "public"."prompt_answer_observations" USING "btree" ("tenant_id", "prompt_id", "platform", ((("observed_at" AT TIME ZONE 'UTC'::"text"))::"date"));



COMMENT ON INDEX "public"."ux_pao_tenant_prompt_platform_day" IS 'T2.3 (2026-05-06): prevents future duplicate observations on the same logical key. Day boundary computed in UTC. Created post-dedupe.';



CREATE UNIQUE INDEX "ux_pei_tenant_snapshot_element_key" ON "public"."page_element_inventory" USING "btree" ("tenant_id", "source_snapshot_id", "element_key");



COMMENT ON INDEX "public"."ux_pei_tenant_snapshot_element_key" IS 'Sprint 7 Phase 7.5a — multi-tenant safety. Widened from (source_snapshot_id, element_key).';



CREATE UNIQUE INDEX "ux_re_tenant_rec_action_element" ON "public"."recommended_edits" USING "btree" ("tenant_id", "rec_id", "action_type", "target_element_key") NULLS NOT DISTINCT;



COMMENT ON INDEX "public"."ux_re_tenant_rec_action_element" IS 'Sprint 7 Phase 7.5a — multi-tenant rec_id collision safety. Widened from (rec_id, action_type, target_element_key) NULLS NOT DISTINCT.';



ALTER TABLE ONLY "public"."tenant_members"
    ADD CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_members"
    ADD CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."answer_intelligence_index" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."answer_texts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attribution_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."candidate_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."change_contracts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."change_outcomes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."change_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."changelog_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."citation_evidence_index" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitor_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competitors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confidence_calibration" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_metric_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deny_anon" ON "public"."answer_intelligence_index" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."answer_texts" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."attribution_decisions" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."business_config" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."candidate_links" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."change_contracts" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."change_outcomes" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."change_patterns" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."changelog_entries" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."citation_evidence_index" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."competitor_config" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."competitors" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."confidence_calibration" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."daily_metric_snapshots" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."guardrail_alerts" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."import_runs" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."llm_rejections" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."observation_runs" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."opportunities" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."page_element_inventory" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."page_issues" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."page_snapshots" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."page_visibility" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."pages" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."prompt_answer_observations" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."raw_poll_chunks" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."recommendation_responses" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."recommended_edits" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."results" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."scan_findings" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."tenant_members" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."tenants" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."tracked_entities" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."tracked_prompts" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."triage_rules" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_anon" ON "public"."url_change_outcomes" TO "anon" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."answer_intelligence_index" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."answer_texts" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."attribution_decisions" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."business_config" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."candidate_links" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."change_contracts" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."change_outcomes" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."change_patterns" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."changelog_entries" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."citation_evidence_index" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."competitor_config" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."competitors" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."confidence_calibration" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."daily_metric_snapshots" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."guardrail_alerts" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."import_runs" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."llm_rejections" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."observation_runs" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."opportunities" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."page_element_inventory" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."page_issues" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."page_snapshots" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."page_visibility" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."pages" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."prompt_answer_observations" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."raw_poll_chunks" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."recommendation_responses" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."recommended_edits" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."results" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."scan_findings" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."tenants" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."tracked_entities" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."tracked_prompts" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."triage_rules" TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "deny_authenticated" ON "public"."url_change_outcomes" TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."guardrail_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."llm_rejections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_self_read" ON "public"."tenant_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."observation_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_element_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_visibility" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prompt_answer_observations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."raw_poll_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recommendation_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recommended_edits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scan_findings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracked_entities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracked_prompts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."triage_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."url_change_outcomes" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."answer_intelligence_index" TO "anon";
GRANT ALL ON TABLE "public"."answer_intelligence_index" TO "authenticated";
GRANT ALL ON TABLE "public"."answer_intelligence_index" TO "service_role";



GRANT ALL ON TABLE "public"."answer_texts" TO "anon";
GRANT ALL ON TABLE "public"."answer_texts" TO "authenticated";
GRANT ALL ON TABLE "public"."answer_texts" TO "service_role";



GRANT ALL ON TABLE "public"."attribution_decisions" TO "anon";
GRANT ALL ON TABLE "public"."attribution_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."attribution_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."business_config" TO "anon";
GRANT ALL ON TABLE "public"."business_config" TO "authenticated";
GRANT ALL ON TABLE "public"."business_config" TO "service_role";



GRANT ALL ON TABLE "public"."candidate_links" TO "anon";
GRANT ALL ON TABLE "public"."candidate_links" TO "authenticated";
GRANT ALL ON TABLE "public"."candidate_links" TO "service_role";



GRANT ALL ON TABLE "public"."change_contracts" TO "anon";
GRANT ALL ON TABLE "public"."change_contracts" TO "authenticated";
GRANT ALL ON TABLE "public"."change_contracts" TO "service_role";



GRANT ALL ON TABLE "public"."change_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."change_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."change_outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."change_patterns" TO "anon";
GRANT ALL ON TABLE "public"."change_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."change_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."changelog_entries" TO "anon";
GRANT ALL ON TABLE "public"."changelog_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."changelog_entries" TO "service_role";



GRANT ALL ON TABLE "public"."citation_evidence_index" TO "anon";
GRANT ALL ON TABLE "public"."citation_evidence_index" TO "authenticated";
GRANT ALL ON TABLE "public"."citation_evidence_index" TO "service_role";



GRANT ALL ON TABLE "public"."competitor_config" TO "anon";
GRANT ALL ON TABLE "public"."competitor_config" TO "authenticated";
GRANT ALL ON TABLE "public"."competitor_config" TO "service_role";



GRANT ALL ON TABLE "public"."competitors" TO "anon";
GRANT ALL ON TABLE "public"."competitors" TO "authenticated";
GRANT ALL ON TABLE "public"."competitors" TO "service_role";



GRANT ALL ON TABLE "public"."confidence_calibration" TO "anon";
GRANT ALL ON TABLE "public"."confidence_calibration" TO "authenticated";
GRANT ALL ON TABLE "public"."confidence_calibration" TO "service_role";



GRANT ALL ON TABLE "public"."daily_metric_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."daily_metric_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_metric_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."guardrail_alerts" TO "anon";
GRANT ALL ON TABLE "public"."guardrail_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."guardrail_alerts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."guardrail_alerts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."guardrail_alerts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."guardrail_alerts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."import_runs" TO "anon";
GRANT ALL ON TABLE "public"."import_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_runs" TO "service_role";



GRANT ALL ON TABLE "public"."llm_rejections" TO "anon";
GRANT ALL ON TABLE "public"."llm_rejections" TO "authenticated";
GRANT ALL ON TABLE "public"."llm_rejections" TO "service_role";



GRANT ALL ON TABLE "public"."observation_runs" TO "anon";
GRANT ALL ON TABLE "public"."observation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."observation_runs" TO "service_role";



GRANT ALL ON TABLE "public"."opportunities" TO "anon";
GRANT ALL ON TABLE "public"."opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."page_element_inventory" TO "anon";
GRANT ALL ON TABLE "public"."page_element_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."page_element_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."page_issues" TO "anon";
GRANT ALL ON TABLE "public"."page_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."page_issues" TO "service_role";



GRANT ALL ON TABLE "public"."page_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."page_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."page_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."page_visibility" TO "anon";
GRANT ALL ON TABLE "public"."page_visibility" TO "authenticated";
GRANT ALL ON TABLE "public"."page_visibility" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON TABLE "public"."prompt_answer_observations" TO "anon";
GRANT ALL ON TABLE "public"."prompt_answer_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_answer_observations" TO "service_role";



GRANT ALL ON TABLE "public"."raw_poll_chunks" TO "anon";
GRANT ALL ON TABLE "public"."raw_poll_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."raw_poll_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."recommendation_responses" TO "anon";
GRANT ALL ON TABLE "public"."recommendation_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."recommendation_responses" TO "service_role";



GRANT ALL ON TABLE "public"."recommended_edits" TO "anon";
GRANT ALL ON TABLE "public"."recommended_edits" TO "authenticated";
GRANT ALL ON TABLE "public"."recommended_edits" TO "service_role";



GRANT ALL ON TABLE "public"."results" TO "anon";
GRANT ALL ON TABLE "public"."results" TO "authenticated";
GRANT ALL ON TABLE "public"."results" TO "service_role";



GRANT ALL ON TABLE "public"."scan_findings" TO "anon";
GRANT ALL ON TABLE "public"."scan_findings" TO "authenticated";
GRANT ALL ON TABLE "public"."scan_findings" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_members" TO "anon";
GRANT ALL ON TABLE "public"."tenant_members" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_members" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."tracked_entities" TO "anon";
GRANT ALL ON TABLE "public"."tracked_entities" TO "authenticated";
GRANT ALL ON TABLE "public"."tracked_entities" TO "service_role";



GRANT ALL ON TABLE "public"."tracked_prompts" TO "anon";
GRANT ALL ON TABLE "public"."tracked_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."tracked_prompts" TO "service_role";



GRANT ALL ON TABLE "public"."triage_rules" TO "anon";
GRANT ALL ON TABLE "public"."triage_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."triage_rules" TO "service_role";



GRANT ALL ON TABLE "public"."url_change_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."url_change_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."url_change_outcomes" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








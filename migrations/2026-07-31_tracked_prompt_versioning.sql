-- Tracked prompt versioning + core segregation (2026-07-31, V1 Truth Convergence Phase 1).
--
-- ADDITIVE and FORWARD ONLY. Nothing is dropped and no row is deleted. Idempotent:
-- safe to re-run. Apply via the Supabase management connection (orchestrator only).
--
-- WHY VERSION EXISTS. A tracked question is a measurement series: "how often did the
-- engines name me when someone asked THIS". The moment the wording, the engine set, or
-- the question's active life changes, the series before and the series after are not
-- the same measurement, and averaging across the seam produces a trend that never
-- happened. `version` makes that seam visible: an observation is stamped with the
-- (prompt id, version) it was taken under, so a chart can break the line instead of
-- quietly bending it. The writer that bumps it is src/domains/runtime/prompt-set.ts.
--
-- WHY CORE EXISTS. `core = true` is the operator's own approved question set (the 35
-- on the live account, tagged core_v1). Everything else on the table is somebody
-- else's history: legacy seeds imported from the old Profound-era account, plus the
-- candidate rows the onboarding drafter mints. The planner and the research funnel
-- must never spend a provider call on a question the operator never approved.
--
-- WHY THE SEED DEACTIVATION IS REVERSIBLE. The legacy seeds are turned off, not
-- removed: is_active goes false, every tag and every word of text stays exactly as it
-- was, and no observation that ever referenced those ids is touched. To restore them:
--   update public.tracked_prompts set is_active = true
--    where tags @> '["seed_profound"]'::jsonb and core = false;

-- ── 1. The two columns ───────────────────────────────────────────────────────
-- Defaults are deliberately conservative: version starts every existing row at 1
-- (its history so far IS series 1), and core starts false so nothing is treated as
-- approved until the backfill below proves it from the operator's own tag.
alter table "public"."tracked_prompts" add column if not exists "version" integer not null default 1;
alter table "public"."tracked_prompts" add column if not exists "core" boolean not null default false;

alter table "public"."tracked_prompts" drop constraint if exists "tracked_prompts_version_positive_chk";
alter table "public"."tracked_prompts"
  add constraint "tracked_prompts_version_positive_chk" check ("version" >= 1);

-- ── 2. Deterministic backfill: core is exactly the core_v1 tag ───────────────
-- One predicate, no heuristics, no id list. Re-running it changes nothing.
update "public"."tracked_prompts"
   set "core" = true
 where "core" = false
   and "tags" @> '["core_v1"]'::"jsonb";

-- ── 3. Reversible deactivation of the legacy Profound-era seeds ──────────────
-- Only rows that are NOT core: an approved question that happens to carry the old
-- seed tag as ancestry keeps running. updated_at moves so the change is auditable.
update "public"."tracked_prompts"
   set "is_active" = false,
       "updated_at" = now()
 where "is_active" = true
   and "core" = false
   and "tags" @> '["seed_profound"]'::"jsonb";

-- ── 4. The predicate the planner and the funnel both read ────────────────────
create index if not exists "tracked_prompts_tenant_core_active_idx"
  on "public"."tracked_prompts" ("tenant_id", "core", "is_active");

comment on column "public"."tracked_prompts"."version" is
  'Measurement series number. Bumped by prompt-set.ts on any wording edit, engine-set change, add, or revival, so an observation stamped with (prompt id, version) never averages across a discontinuity.';
comment on column "public"."tracked_prompts"."core" is
  'True only for the operator approved question set (tag core_v1). The planner spends provider calls on core rows only; legacy seeds and onboarding candidates stay off.';

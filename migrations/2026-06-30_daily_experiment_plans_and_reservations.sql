-- 2026-06-30 — Daily Experiment Cycle: durable plans + ATOMIC control reservations.
--
-- WHY A MIGRATION (the persistence/atomicity gate): accepting a daily plan must reserve EVERY
-- control or NONE (never partial), be idempotent on re-click, and guarantee "one active reservation
-- per (tenant, control)" across concurrent requests + multiple Vercel lambdas. The tenant-scoped
-- json-store is read-modify-write with no cross-instance locking → it cannot provide this. Postgres
-- can: a plpgsql function body is one transaction (all-or-none), a PARTIAL UNIQUE index enforces
-- control exclusivity, and a deterministic reservation id (tenant::plan::experiment::control) makes
-- re-acceptance idempotent. Preview plans have NO reservation side-effects, so previews persist via
-- the plans table directly (status='preview'); only ACCEPT goes through the RPC.
--
-- Additive + idempotent (IF NOT EXISTS). RLS mirrors the peer tables (deny anon; authenticated via
-- is_tenant_member; service-role bypasses). The app calls accept_daily_experiment_plan via the
-- service-role client with an explicit p_tenant, exactly like the gsc_* RPCs.
--
-- NOT YET APPLIED — awaiting operator approval (see HANDOFF). Reversible: DROP FUNCTION + DROP TABLE.

-- ── plans ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_experiment_plans (
  id              text PRIMARY KEY,           -- content-addressed: `${tenant}::${date}::${inputHash12}`
  tenant_id       text NOT NULL,
  date            text NOT NULL,              -- YYYY-MM-DD (Pacific operating day)
  status          text NOT NULL DEFAULT 'preview',  -- preview|accepted|expired|abandoned|completed
  input_hash      text NOT NULL,
  planner_version text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  abandoned_at    timestamptz,
  completed_at    timestamptz,
  acceptance_idempotency_key text,
  plan            jsonb NOT NULL,             -- the full DailyExperimentPlanRecord snapshot
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS daily_experiment_plans_tenant_idx ON public.daily_experiment_plans (tenant_id);
CREATE INDEX IF NOT EXISTS daily_experiment_plans_tenant_status_idx ON public.daily_experiment_plans (tenant_id, status);

ALTER TABLE public.daily_experiment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.daily_experiment_plans;
CREATE POLICY deny_anon ON public.daily_experiment_plans AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.daily_experiment_plans;
CREATE POLICY tenant_authenticated_rw ON public.daily_experiment_plans AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- ── reservations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_reservations (
  id                    text PRIMARY KEY,     -- deterministic: `${tenant}::${plan}::${experiment}::${controlPath}`
  tenant_id             text NOT NULL,
  plan_id               text NOT NULL,
  planned_experiment_id text NOT NULL,
  treated_url           text NOT NULL,
  control_url           text NOT NULL,
  control_path          text NOT NULL,        -- normalized
  status                text NOT NULL DEFAULT 'reserved',  -- reserved|active|released|expired|invalidated
  reserved_at           timestamptz NOT NULL DEFAULT now(),
  reserved_until        timestamptz NOT NULL,
  activated_at          timestamptz,
  activated_proof_id    text,
  released_at           timestamptz,
  release_reason        text,
  invalidated_at        timestamptz,
  invalidation_reason   text,
  similarity            jsonb NOT NULL DEFAULT '{}'::jsonb,
  version               int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS control_reservations_tenant_idx ON public.control_reservations (tenant_id);
CREATE INDEX IF NOT EXISTS control_reservations_plan_idx ON public.control_reservations (plan_id);
CREATE INDEX IF NOT EXISTS control_reservations_control_active_idx
  ON public.control_reservations (tenant_id, control_path) WHERE status IN ('reserved', 'active');
-- NOTE: controls are diff-in-diff BASELINES, so a page may be reserved as a control by more than one
-- experiment (shared baselines are compatible — none treats it). The reservation id is keyed by
-- experiment, so those are distinct rows; the PK gives idempotency. The invariant the app enforces
-- (here + in plan validation + when building future plans) is "a reserved control is never TREATED",
-- not single-reservation exclusivity. The partial index above is for fast "is this page reserved?"
-- lookups when building the next plan's protected set — NOT a uniqueness constraint.

ALTER TABLE public.control_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.control_reservations;
CREATE POLICY deny_anon ON public.control_reservations AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.control_reservations;
CREATE POLICY tenant_authenticated_rw ON public.control_reservations AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- ── atomic acceptance RPC ────────────────────────────────────────────────────
-- All-or-none: locks the plan, re-asserts every invariant, inserts ALL reservations (or aborts on
-- the first conflict via the partial unique index), flips the plan to accepted + writes the receipt
-- into both the columns and the jsonb — all in one transaction. Idempotent: re-accepting an
-- already-accepted plan returns the existing reservation ids without duplicating.
CREATE OR REPLACE FUNCTION public.accept_daily_experiment_plan(
    p_tenant          text,
    p_plan_id         text,
    p_input_hash      text,
    p_idempotency_key text,
    p_reservations    jsonb,   -- [{id, planned_experiment_id, treated_url, control_url, control_path, reserved_until, similarity}]
    p_now             timestamptz DEFAULT now()
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_plan public.daily_experiment_plans%ROWTYPE;
  v_res  jsonb;
  v_ids  text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_plan FROM public.daily_experiment_plans
    WHERE id = p_plan_id AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  END IF;

  -- Idempotent re-accept: already accepted → return the existing reservations, never duplicate.
  IF v_plan.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'plan_id', v_plan.id,
      'reservation_ids', (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM public.control_reservations WHERE plan_id = v_plan.id));
  END IF;
  IF v_plan.status <> 'preview' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_' || v_plan.status);
  END IF;
  IF v_plan.input_hash <> p_input_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'input_hash_changed');
  END IF;
  IF p_now > v_plan.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_expired');
  END IF;

  BEGIN
    FOR v_res IN SELECT * FROM jsonb_array_elements(p_reservations) LOOP
      INSERT INTO public.control_reservations(
        id, tenant_id, plan_id, planned_experiment_id, treated_url, control_url, control_path,
        status, reserved_at, reserved_until, similarity, version)
      VALUES (
        v_res->>'id', p_tenant, p_plan_id, v_res->>'planned_experiment_id',
        v_res->>'treated_url', v_res->>'control_url', v_res->>'control_path',
        'reserved', p_now, (v_res->>'reserved_until')::timestamptz,
        COALESCE(v_res->'similarity', '{}'::jsonb), 1)
      ON CONFLICT (id) DO NOTHING;  -- same plan re-accept = same ids, no-op (idempotent)
      v_ids := array_append(v_ids, v_res->>'id');
    END LOOP;
  EXCEPTION WHEN unique_violation THEN
    -- defensive: any future uniqueness constraint conflict aborts the whole acceptance (all-or-none).
    -- (Shared baselines do NOT collide — controls are keyed by experiment; the PK is idempotent.)
    RETURN jsonb_build_object('ok', false, 'reason', 'reservation_conflict');
  END;

  UPDATE public.daily_experiment_plans
    SET status = 'accepted',
        accepted_at = p_now,
        acceptance_idempotency_key = p_idempotency_key,
        plan = jsonb_set(
                 jsonb_set(
                   jsonb_set(plan, '{status}', '"accepted"'),
                   '{acceptedAt}', to_jsonb(p_now)),
                 '{acceptanceReceipt}',
                 jsonb_build_object('idempotencyKey', p_idempotency_key, 'reservationIds', to_jsonb(v_ids),
                                    'acceptedBy', 'operator', 'validatedAt', to_jsonb(p_now)))
    WHERE id = p_plan_id AND tenant_id = p_tenant;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'plan_id', p_plan_id, 'reservation_ids', to_jsonb(v_ids));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.accept_daily_experiment_plan(text, text, text, text, jsonb, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_daily_experiment_plan(text, text, text, text, jsonb, timestamptz) TO service_role;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.accept_daily_experiment_plan(text, text, text, text, jsonb, timestamptz);
--   DROP TABLE IF EXISTS public.control_reservations;
--   DROP TABLE IF EXISTS public.daily_experiment_plans;

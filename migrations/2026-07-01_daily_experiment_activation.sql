-- 2026-07-01 — Daily Experiment Cycle: ATOMIC item activation + item skip.
--
-- WHY A MIGRATION (the atomicity gate): when the operator applies one accepted change in Wix and
-- Beacon verifies it LIVE, three writes must happen ALL-OR-NONE: (1) create the shipped_change_proof
-- row (proof starts measuring), (2) flip THIS experiment's control reservations reserved→active +
-- stamp the proof id, (3) mark the plan item active in the plan jsonb. A read-modify-write across the
-- json-store + REST cannot guarantee that. A plpgsql body is one transaction → all-or-none.
-- Idempotent: re-activating an already-active item returns the existing proof + reservation ids and
-- writes nothing. Proof insert is ON CONFLICT (tenant_id,id) DO NOTHING → never duplicates a proof
-- row and never mutates an existing one (the 19 historical animal/other proof rows are untouched).
--
-- skip_daily_experiment_item atomically RELEASES one item's reserved controls (reserved→released) and
-- marks the item skipped — only before activation (an active item cannot be skipped). The proof row is
-- BUILT in the app (recordShippedChange reads GSC + measures, which plpgsql cannot do) and passed in
-- as a row-shaped jsonb (snake_case columns from recordToRow); tenant_id is forced to p_tenant.
--
-- Additive + idempotent. SECURITY INVOKER + service-role-only EXECUTE (mirrors accept RPC). Reversible.

-- ── atomic item activation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_daily_experiment_item(
    p_tenant               text,
    p_plan_id              text,
    p_experiment_id        text,
    p_verification_receipt jsonb,   -- { verifiedAt, method, observedValue, source }
    p_proof_row            jsonb,   -- shipped_change_proof row (snake_case columns; id required)
    p_idempotency_key      text,
    p_now                  timestamptz DEFAULT now()
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_plan         public.daily_experiment_plans%ROWTYPE;
  v_plan_json    jsonb;
  v_proof_id     text;
  v_active_ids   jsonb;
  v_existing_proof text;
  v_distinct_proofs int;
  v_reserved_count int;
  v_inserted     int;
  v_ids          text[] := ARRAY[]::text[];
  v_rid          text;
  v_existing_item jsonb;
  v_receipts     jsonb;
  v_item         jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.daily_experiment_plans
    WHERE id = p_plan_id AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  END IF;
  IF v_plan.status <> 'accepted' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_' || v_plan.status);
  END IF;

  -- Idempotent re-activation: this item already has active reservations → return them, write nothing.
  -- All active reservations for an item must share ONE non-null proof id; divergence = corrupt state.
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb), COUNT(DISTINCT activated_proof_id), MIN(activated_proof_id)
    INTO v_active_ids, v_distinct_proofs, v_existing_proof
    FROM public.control_reservations
    WHERE tenant_id = p_tenant AND plan_id = p_plan_id
      AND planned_experiment_id = p_experiment_id AND status = 'active';
  IF jsonb_array_length(v_active_ids) > 0 THEN
    IF v_distinct_proofs <> 1 OR v_existing_proof IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reservation_state_inconsistent');
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'proof_id', v_existing_proof, 'reservation_ids', v_active_ids);
  END IF;

  -- Verification receipt is mandatory (no proof without proven-live).
  IF p_verification_receipt IS NULL OR p_verification_receipt->>'verifiedAt' IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'verification_required');
  END IF;
  IF p_proof_row IS NULL OR p_proof_row->>'id' IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'proof_invalid');
  END IF;
  v_proof_id := p_proof_row->>'id';

  -- Must still have unexpired reserved controls to activate.
  SELECT count(*) INTO v_reserved_count FROM public.control_reservations
    WHERE tenant_id = p_tenant AND plan_id = p_plan_id
      AND planned_experiment_id = p_experiment_id AND status = 'reserved' AND reserved_until > p_now;
  IF v_reserved_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_controls');
  END IF;

  -- (1) Create the proof row. The legit idempotent replay already returned above (this item has no
  -- active reservations), so reaching here means a FIRST activation: the row must NOT already exist.
  -- verified_live is forced TRUE — this RPC only runs after deterministic live verification.
  INSERT INTO public.shipped_change_proof (
      tenant_id, id, page, path, action_type, before_text, after_text, shipped_at,
      baseline, target_queries, control_pages, windows, verdict, confidence, measured_at,
      notes, verified_live, live_source_url, recrawl_requested_at, operator_verdict_override,
      created_at, updated_at)
    VALUES (
      p_tenant,
      v_proof_id,
      p_proof_row->>'page',
      p_proof_row->>'path',
      p_proof_row->>'action_type',
      p_proof_row->>'before_text',
      p_proof_row->>'after_text',
      (p_proof_row->>'shipped_at')::timestamptz,
      COALESCE(p_proof_row->'baseline', '{}'::jsonb),
      COALESCE(p_proof_row->'target_queries', '[]'::jsonb),
      COALESCE(p_proof_row->'control_pages', '[]'::jsonb),
      COALESCE(p_proof_row->'windows', '[]'::jsonb),
      COALESCE(p_proof_row->>'verdict', 'measuring'),
      COALESCE(p_proof_row->>'confidence', 'low'),
      NULLIF(p_proof_row->>'measured_at', '')::timestamptz,
      p_proof_row->>'notes',
      true,
      p_proof_row->>'live_source_url',
      NULLIF(p_proof_row->>'recrawl_requested_at', '')::timestamptz,
      p_proof_row->>'operator_verdict_override',
      COALESCE(NULLIF(p_proof_row->>'created_at', '')::timestamptz, p_now),
      COALESCE(NULLIF(p_proof_row->>'updated_at', '')::timestamptz, p_now))
    ON CONFLICT (tenant_id, id) DO NOTHING;
  -- A pre-existing row at this id is a FOREIGN proof (different change, same path/date) — fail closed
  -- rather than hijack it as this experiment's proof-of-record. The whole tx rolls back (no reservation
  -- flip, no plan mutation, no row created).
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'proof_id_collision');
  END IF;

  -- (2) Activate this item's reserved controls, stamp the proof id.
  FOR v_rid IN
    UPDATE public.control_reservations
      SET status = 'active', activated_at = p_now, activated_proof_id = v_proof_id
      WHERE tenant_id = p_tenant AND plan_id = p_plan_id
        AND planned_experiment_id = p_experiment_id AND status = 'reserved'
      RETURNING id
  LOOP
    v_ids := array_append(v_ids, v_rid);
  END LOOP;

  -- (3) Mark the plan item active in the plan jsonb (creating execution scaffolding if absent).
  v_plan_json := v_plan.plan;
  IF v_plan_json -> 'execution' IS NULL THEN
    v_plan_json := jsonb_set(v_plan_json, '{execution}', jsonb_build_object('items', '{}'::jsonb, 'updatedAt', to_jsonb(p_now)), true);
  END IF;
  IF v_plan_json #> '{execution,items}' IS NULL THEN
    v_plan_json := jsonb_set(v_plan_json, '{execution,items}', '{}'::jsonb, true);
  END IF;
  v_existing_item := v_plan_json #> ARRAY['execution', 'items', p_experiment_id];
  v_receipts := COALESCE(v_existing_item->'receipts', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('from', COALESCE(v_existing_item->>'status', 'verified_live'), 'to', 'active',
                       'at', to_jsonb(p_now), 'actor', 'beacon', 'idempotencyKey', p_idempotency_key));
  v_item := jsonb_build_object(
    'experimentId', p_experiment_id, 'status', 'active', 'receipts', v_receipts,
    'verifiedAt', COALESCE(p_verification_receipt->'verifiedAt', to_jsonb(p_now)),
    'verification', jsonb_build_object('verified', true, 'receipt', p_verification_receipt),
    'activatedAt', to_jsonb(p_now), 'proofId', v_proof_id);
  v_plan_json := jsonb_set(v_plan_json, ARRAY['execution', 'items', p_experiment_id], v_item, true);
  v_plan_json := jsonb_set(v_plan_json, '{execution,updatedAt}', to_jsonb(p_now), true);

  UPDATE public.daily_experiment_plans SET plan = v_plan_json
    WHERE id = p_plan_id AND tenant_id = p_tenant;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'proof_id', v_proof_id, 'reservation_ids', to_jsonb(v_ids));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.activate_daily_experiment_item(text, text, text, jsonb, jsonb, text, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_daily_experiment_item(text, text, text, jsonb, jsonb, text, timestamptz) TO service_role;

-- ── atomic item skip (release this item's reserved controls) ──────────────────
CREATE OR REPLACE FUNCTION public.skip_daily_experiment_item(
    p_tenant          text,
    p_plan_id         text,
    p_experiment_id   text,
    p_reason          text,
    p_idempotency_key text,
    p_now             timestamptz DEFAULT now()
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_plan        public.daily_experiment_plans%ROWTYPE;
  v_plan_json   jsonb;
  v_active_count int;
  v_ids         text[] := ARRAY[]::text[];
  v_rid         text;
  v_existing_item jsonb;
  v_receipts    jsonb;
  v_item        jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.daily_experiment_plans
    WHERE id = p_plan_id AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  END IF;
  IF v_plan.status <> 'accepted' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_' || v_plan.status);
  END IF;

  -- Idempotent: already skipped → return.
  IF v_plan.plan #>> ARRAY['execution', 'items', p_experiment_id, 'status'] = 'skipped' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'released_ids', '[]'::jsonb);
  END IF;

  -- An active item cannot be skipped.
  SELECT count(*) INTO v_active_count FROM public.control_reservations
    WHERE tenant_id = p_tenant AND plan_id = p_plan_id
      AND planned_experiment_id = p_experiment_id AND status = 'active';
  IF v_active_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'item_already_active');
  END IF;

  -- Release reserved controls for this item only.
  FOR v_rid IN
    UPDATE public.control_reservations
      SET status = 'released', released_at = p_now, release_reason = COALESCE(p_reason, 'operator_skip')
      WHERE tenant_id = p_tenant AND plan_id = p_plan_id
        AND planned_experiment_id = p_experiment_id AND status = 'reserved'
      RETURNING id
  LOOP
    v_ids := array_append(v_ids, v_rid);
  END LOOP;

  -- Mark the item skipped in the plan jsonb.
  v_plan_json := v_plan.plan;
  IF v_plan_json -> 'execution' IS NULL THEN
    v_plan_json := jsonb_set(v_plan_json, '{execution}', jsonb_build_object('items', '{}'::jsonb, 'updatedAt', to_jsonb(p_now)), true);
  END IF;
  IF v_plan_json #> '{execution,items}' IS NULL THEN
    v_plan_json := jsonb_set(v_plan_json, '{execution,items}', '{}'::jsonb, true);
  END IF;
  v_existing_item := v_plan_json #> ARRAY['execution', 'items', p_experiment_id];
  v_receipts := COALESCE(v_existing_item->'receipts', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('from', COALESCE(v_existing_item->>'status', 'ready_to_apply'), 'to', 'skipped',
                       'at', to_jsonb(p_now), 'actor', 'operator', 'reason', COALESCE(p_reason, 'operator_skip'),
                       'idempotencyKey', p_idempotency_key));
  v_item := jsonb_build_object(
    'experimentId', p_experiment_id, 'status', 'skipped', 'receipts', v_receipts,
    'skippedAt', to_jsonb(p_now), 'skipReason', COALESCE(p_reason, 'operator_skip'));
  v_plan_json := jsonb_set(v_plan_json, ARRAY['execution', 'items', p_experiment_id], v_item, true);
  v_plan_json := jsonb_set(v_plan_json, '{execution,updatedAt}', to_jsonb(p_now), true);

  UPDATE public.daily_experiment_plans SET plan = v_plan_json
    WHERE id = p_plan_id AND tenant_id = p_tenant;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'released_ids', to_jsonb(v_ids));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.skip_daily_experiment_item(text, text, text, text, text, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_daily_experiment_item(text, text, text, text, text, timestamptz) TO service_role;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.activate_daily_experiment_item(text, text, text, jsonb, jsonb, text, timestamptz);
--   DROP FUNCTION IF EXISTS public.skip_daily_experiment_item(text, text, text, text, text, timestamptz);

-- GSC Proof ledger, predeclaration contract columns (Lane P2, protocol Section 4.1).
-- ADDITIVE + idempotent. Adds the fields a change is judged BY, stamped ONCE at
-- ship time and immutable after write, so no code path may select or switch the
-- verdict metric after post-ship results are visible (the entire point of the
-- contract). Every column is NULLABLE with NO default and NO backfill:
--
--   judged_metric                    - "clicks" / "ctr" (position only once that
--                                      lane passes validation). Computed once from
--                                      action_type at ship; measureRecord READS it
--                                      and never recomputes via pickProofMetric.
--   expected_direction               - +1 or -1 (a title rewrite expects +, a
--                                      consolidation may expect - on the donor page).
--                                      smallint.
--   primary_window_days              - the single window whose close decides the
--                                      verdict (28). int.
--   window_plan                      - full ordered list of windows that will be
--                                      read, each labeled primary / context /
--                                      demote_only. jsonb.
--   control_set_ids                  - ordered control URLs plus a hash over
--                                      (urls, matching inputs). jsonb. May be NULL
--                                      at ship for now (C4 matched-control selection
--                                      lands in Lane P3); the round-trip is ready.
--   control_alternates               - predeclared backup controls for contamination
--                                      replacement (protocol L4b). jsonb. May be NULL
--                                      at ship for now (see control_set_ids).
--   classifier_version_predeclared   - hash of the frozen thresholds artifact
--                                      (protocol Section 5 step 2). text. Distinct
--                                      from calibration_version (which the corrected
--                                      classifier stamps at measure time); this one
--                                      records which frozen ruleset was predeclared.
--   baseline_snapshot                - pre-window clicks, impressions, ctr, position,
--                                      traffic tier, page family, daily variance,
--                                      trend slope. jsonb.
--   predeclared_at                   - timestamp the block was stamped. A record
--                                      MISSING this is judged by legacy rules and
--                                      every surface labels it so.
--
-- WHY nullable / no backfill: a record without predeclared_at pre-dates the
-- contract and must keep the legacy pickProofMetric path unchanged. NULL is the
-- signal, exactly like calibration_version quarantines pre-self-test rows.
--
-- The store tolerates any of these columns being absent (PGRST204/42P01 -> file
-- fallback), so applying this is deploy-order-independent, same posture as every
-- other additive column on this table (calibration_version, verify_state,
-- edit_diff, verdict_revisions, control_donor_pool, operator_verdict_override).
alter table public.shipped_change_proof
  add column if not exists judged_metric text,
  add column if not exists expected_direction smallint,
  add column if not exists primary_window_days integer,
  add column if not exists window_plan jsonb,
  add column if not exists control_set_ids jsonb,
  add column if not exists control_alternates jsonb,
  add column if not exists classifier_version_predeclared text,
  add column if not exists baseline_snapshot jsonb,
  add column if not exists predeclared_at timestamptz;

-- 2026-08-12  IMPLEMENTATION TRUTH IS DECOUPLED FROM MEASUREMENT AVAILABILITY.
--
-- The recording path used to refuse a true implementation when it could not find enough
-- comparison pages, so a change the operator really made left no record at all. Two different
-- facts were fused into one decision: WHAT WAS APPLIED (the operator's work, always true) and
-- WHETHER IT CAN BE FAIRLY COMPARED (a fact about Search data, which arrives late, arrives
-- partly, or never arrives). The second one now lives beside the first instead of gating it.
--
-- Forward-only, additive, idempotent. Nothing is dropped, renamed, or backfilled. Both columns
-- are nullable, so every existing row decodes exactly as it always did: a null measurement_state
-- is a row written before this existed, not a claim about it.
--
-- SAFE TO APPLY AFTER THE CODE DEPLOYS. Unlike the Phase 6 Shipment columns, the store retries
-- the upsert without these two when the schema cache does not hold them yet, because losing the
-- note about whether a change can be compared is not losing the change. Applying it sooner is
-- still better: until it runs, Results cannot say why a shipment has no reading.

alter table public.shipped_change_proof
  -- 'measuring' | 'measurement_unavailable' | 'insufficient_comparison' | 'verification_needed'.
  -- Free text on purpose (the store validates against its own closed set and reads anything else
  -- as null), so a later state needs code, not a second migration on a live table.
  add column if not exists measurement_state           text,
  -- TRUE = NO BEFORE-STATE IS HELD FOR THIS ROW. Set by the repair door, which records a change
  -- that was already live before anything wrote it down: no snapshot of the page as it stood
  -- beforehand exists and none ever will, so the live check compares FORWARD only, against the
  -- wording the operator says is there, and no before-state is claimed for it.
  add column if not exists pre_change_hash_unavailable boolean;

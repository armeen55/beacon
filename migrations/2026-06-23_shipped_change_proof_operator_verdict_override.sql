-- GSC Proof ledger — operator verdict override for learning (2026-06-23).
-- Additive + idempotent. Lets the operator PIN a shipped change's learning
-- verdict to 'inconclusive' so a mis-attributed 'won'/'lost' (control
-- contamination / seasonal co-movement) is excluded from the per-action_type
-- outcome prior that steers recommendation ranking. NULL = the measured
-- verdict stands. The GSC numbers/windows still compute + display; only the
-- learning verdict is pinned (applied in measureRecord, survives re-measure).
-- The store tolerates this column being absent (PGRST204 → file fallback), so
-- applying this migration is deploy-order-independent.
alter table public.shipped_change_proof
  add column if not exists operator_verdict_override text;

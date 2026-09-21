-- GSC Proof ledger — operator verdict override for learning (2026-06-23).
-- Additive + idempotent. Lets the operator PIN a shipped change's learning
-- verdict to 'inconclusive' so a mis-attributed 'won'/'lost' is excluded from
-- the per-action_type outcome prior. NULL = the measured verdict stands.
alter table public.shipped_change_proof
  add column if not exists operator_verdict_override text;;

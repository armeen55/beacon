-- GSC Proof ledger, append-only verdict revision trail (BEACON_500 R14a, 2026-07-03).
-- Additive + idempotent. Stores the tiny {at, from, to, reason} entries the
-- measureRecord seam appends when a RE-measurement actually changes a stored
-- verdict. NULL = this row's verdict never flipped, or the row predates R14a.
alter table public.shipped_change_proof
  add column if not exists verdict_revisions jsonb;;

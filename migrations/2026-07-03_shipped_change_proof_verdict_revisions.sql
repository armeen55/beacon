-- GSC Proof ledger, append-only verdict revision trail (BEACON_500 R14a, 2026-07-03).
-- Additive + idempotent. Stores the tiny {at, from, to, reason} entries the
-- measureRecord seam appends when a RE-measurement actually changes a stored
-- verdict (won -> inconclusive, measuring -> won). The first measurement is an
-- announcement, not a revision, and past entries are NEVER rewritten - this
-- column is what makes a silently-rewritten verdict honest on /results (the
-- card expand renders the trail; the "We got this wrong" recap reads it).
-- NULL = this row's verdict never flipped, or the row predates R14a.
--
-- The store tolerates this column being absent (PGRST204 -> file fallback), so
-- applying this migration is deploy-order-independent, same posture as the
-- 2026-07-03 control_donor_pool migration it sits beside.
alter table public.shipped_change_proof
  add column if not exists verdict_revisions jsonb;

-- GSC Proof ledger — comparison-page matching receipt (BEACON_500 items 33 + 36, 2026-07-02).
-- Additive + idempotent. Stores the plain-language reasons any raw comparison-page
-- candidate was left out of a NEW ship's controlPages at selection time (scale
-- mismatch, diverging pre-ship trend, or too much shared search demand with the
-- treated page). NULL = no candidates were excluded, or this row predates item 33.
-- Written ONCE at selection time in auto-record-on-ship.ts; never rewritten by
-- re-measurement. The store tolerates this column being absent (PGRST204 → file
-- fallback), so applying this migration is deploy-order-independent.
alter table public.shipped_change_proof
  add column if not exists control_match_notes jsonb;

-- Companion flag: true when the matcher had to fall back to its best-available
-- comparison pages (too few candidates passed the baseline-scale + pre-ship
-- trend bands). Feeds the parallel-trends veto in measurement-maturity.ts at
-- read time (item 33). Defaults false so existing rows read as "not flagged".
alter table public.shipped_change_proof
  add column if not exists control_match_weak boolean not null default false;

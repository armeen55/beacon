-- GSC Proof ledger, crawl-verify columns (J-73/C-25, 2026-07-09).
-- Additive + idempotent. Adds the two columns the crawl-based auto-verify
-- pass (verify-shipped-change.ts) writes when a manually-shipped change is
-- marked applied:
--   verify_state  - the six-state crawl verdict (verified_live / exact or
--                    modified kind, verified_live_modified, not_found,
--                    needs_review, crawl_failed). NULL = no verify pass has
--                    run yet, or this row predates J-73/C-25.
--   edit_diff     - the structured proposal-vs-live diff {field,
--                    proposedAfter, liveText, similarity, verdict,
--                    capturedAt}. NULL when the crawl failed (nothing to
--                    diff) or before the first verify pass.
--
-- This REPLACES the honor-system `verified_live` boolean as the source of
-- truth for "did the operator's edit actually ship": only a verify pass whose
-- outcome is "verified_live" is allowed to set that column true (see
-- markVerifyResultById in shipped-change-store.ts). The original proposal
-- (`after_text`) is NEVER overwritten by this - `edit_diff.liveText` is a
-- separate field holding whatever the crawl found.
--
-- The store tolerates both columns being absent (PGRST204 -> file fallback),
-- so applying this migration is deploy-order-independent, same posture as
-- every other additive column on this table.
alter table public.shipped_change_proof
  add column if not exists verify_state jsonb,
  add column if not exists edit_diff jsonb;

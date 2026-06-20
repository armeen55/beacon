-- GSC Proof ledger — operator notes + manual-live verification (Phase 5, Path B, 2026-06-20).
-- Additive + idempotent (add-column-if-not-exists). No drops, no destructive change.
--   notes           operator free-text on the shipped change (e.g. "Manual Wix edit by Armeen").
--   verified_live   operator confirmed the change is live on the site (manual ship).
--   live_source_url optional URL the operator verified it live at.
alter table public.shipped_change_proof add column if not exists notes           text;
alter table public.shipped_change_proof add column if not exists verified_live   boolean not null default false;
alter table public.shipped_change_proof add column if not exists live_source_url text;

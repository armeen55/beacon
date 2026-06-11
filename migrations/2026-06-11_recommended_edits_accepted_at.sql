-- 2026-06-11 (night shift, #127 substrate) — explicit accepted_at.
-- APPLIED to production via MCP ~09:10 UTC. The match runner DERIVED
-- accept time from changelog/responses/created_at and skipped the
-- 7-day not_found promotion when no stable source existed. Stamp it at
-- accept time instead. Additive.
ALTER TABLE public.recommended_edits ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

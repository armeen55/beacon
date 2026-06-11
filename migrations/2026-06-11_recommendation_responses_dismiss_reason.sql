-- 2026-06-11 (night shift, #54) — capture WHY on dismiss.
-- APPLIED to production via MCP ~10:05 UTC. Dismissals recorded a
-- status only; the reason (the dream's "learns your taste" signal)
-- was discarded. Additive nullable column.
ALTER TABLE public.recommendation_responses ADD COLUMN IF NOT EXISTS dismiss_reason text;

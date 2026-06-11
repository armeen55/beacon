-- 2026-06-11 (night shift, inventory #100 substrate) — capture the
-- LIVE TEXT at verify time. APPLIED to production via MCP ~08:40 UTC.
-- verified_live_modified previously stored only a status; the
-- proposed→final delta (what the operator actually changed) was thrown
-- away, starving the inner learning loop. Additive.
ALTER TABLE public.recommended_edits ADD COLUMN IF NOT EXISTS live_text text;

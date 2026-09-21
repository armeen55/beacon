-- Superseded by publish_customer_release (Codex, 2026-08-23): ranking and surface commit in ONE transaction now, and no repo path calls this.
drop function if exists public.stamp_change_queue_v2(text, text, text[], text[]);;

-- PS5 (2026-06-19) — optional free-text note on a review decision, so a
-- "Needs edit" verdict can carry the operator's specific feedback (and a reject
-- can carry its reason). Additive + nullable. Still NEVER publishes.
alter table public.page_surgeon_review_decisions
  add column if not exists note text;

-- GSC Proof ledger — operator "recrawl requested" marker (Phase 5, Path B, 2026-06-20).
-- Additive + idempotent. Lets the operator stamp when they manually requested a
-- Google recrawl / indexing in Search Console for a shipped change. NULL = not requested.
alter table public.shipped_change_proof add column if not exists recrawl_requested_at timestamptz;

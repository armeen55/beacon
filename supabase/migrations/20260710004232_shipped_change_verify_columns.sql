-- W5 Package B (J-73 structured proposal-vs-live diff + C-25 crawl verification).
-- Additive, nullable, reversible; pre-apply code degrades to file-fallback on PGRST204.
alter table shipped_change_proof
  add column if not exists verify_state jsonb,
  add column if not exists edit_diff jsonb;;

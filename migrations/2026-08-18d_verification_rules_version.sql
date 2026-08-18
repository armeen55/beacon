-- 2026-08-18d WHICH RULES CHECKED THIS CLAIM.
--
-- A stored verdict is only as good as the logic that produced it. The one live `checked` row was researched
-- with a query built from the SUBJECT alone ("Ahvaz, Iran definition reference" for a claim about a 54 degree
-- heat record), and because it read as current the repaired engine would have skipped for ever the exact
-- counterexample it was built to fix (Codex, 2026-08-18).
--
-- Every row now carries the version of the verification rules that produced it. A check from an older version
-- is NOT current: Decision may not act on it and the engine owes the claim again. Rows written before this
-- column existed are null, which reads as version 1 and is therefore obsolete by construction. Their evidence
-- is preserved: the engine archives the old row under its own key before re-opening the live claim.
alter table public.page_source_facts add column if not exists rules_version integer;

-- The re-open read: which of a page's checked rows were produced under obsolete rules.
create index if not exists page_source_facts_rules_idx on public.page_source_facts (tenant_id, claim_state, rules_version);

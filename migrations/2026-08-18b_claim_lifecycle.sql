-- 2026-08-18b THE CLAIM'S OWN LIFECYCLE, split out of the 2026-08-18 migration.
--
-- WHY A SECOND FILE: these statements were appended to the already-applied 2026-08-18 migration, which broke
-- migration immutability (Codex, 2026-08-18). An applied migration is history; later schema moves get their
-- own date-prefixed idempotent file. Production already satisfies this file; a clean environment reaches the
-- identical schema by running the immutable sequence.
--
-- The lifecycle is also the resume cursor:
--   owed       - this page version makes this claim and nobody has checked it yet. Never authorizes anything.
--   checked    - researched at this page version. The only state that may become customer work.
--   superseded - the page moved on, or the wording this objected to is gone. KEPT, never deleted: the history
--                of what a page used to say wrong is the evidence that fixing it was worth doing.
alter table public.page_source_facts add column if not exists claim_state text not null default 'checked';
alter table public.page_source_facts add column if not exists superseded_at timestamptz;

-- The resume read: the next owed claim for a page version, and whether any are left.
create index if not exists page_source_facts_owed_idx on public.page_source_facts (tenant_id, page_key, claim_state);

-- THE 192 ROWS RESEARCHED BEFORE THE ENGINE EXISTED are real work and stay exactly where they are, as
-- history. They carry no record of the runtime reading their sources, so they are not `checked` evidence
-- this engine may act on: they are marked superseded, and the engine re-earns each one by reading the source
-- itself. Nothing is deleted and no wording is edited.
update public.page_source_facts
   set claim_state = 'superseded', superseded_at = coalesce(superseded_at, now())
 where source_read_at is null and claim_state = 'checked';

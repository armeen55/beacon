-- SOURCE-BACKED FACTS ABOUT ONE PAGE, ONE ROW PER STATEMENT. A whole-array JSON blob was the wrong shape:
-- a failed read degrades to [] and a write then erases every other page's facts, and two pages checked at
-- once lose each other. Row-wise with a natural key makes every write idempotent and independent.
create table if not exists public.page_source_facts (
  tenant_id text not null,
  page_key text not null,               -- canonical path, the page identity
  statement_key text not null,          -- the subject this statement is about, canonicalized
  page_content_hash text,               -- the page as it read when checked; a changed page owes a recheck
  subject text not null,                -- the subject exactly as the page writes it
  current_wording text not null,        -- the page's exact words for that subject
  proposed text,                        -- the supported replacement, or null when nothing is supported
  literal text,                         -- literal etymology
  usage text,                           -- modern usage, kept apart from the literal sense
  source_url text,
  source_quote text,                    -- the passage from the source that supports this
  source_class text,                    -- scholarly | dictionary | encyclopedia | reference | community | babyname
  sources jsonb not null default '[]',  -- every source consulted, with class and what it says
  agreement text not null,              -- multiple_agree | single_source | sources_conflict | none_found
  confidence text not null,             -- confirmed | likely | disputed | unsupported
  verdict text not null,                -- page_correct | page_wrong | page_imprecise | undecidable
  also_at jsonb not null default '[]',  -- other locations on the page repeating or contradicting it
  note text,
  evidence_basis text,                  -- the research basis/version this was checked under
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, page_key, statement_key)
);

create index if not exists page_source_facts_tenant_page_idx on public.page_source_facts (tenant_id, page_key);
create index if not exists page_source_facts_actionable_idx on public.page_source_facts (tenant_id, confidence, verdict);

alter table public.page_source_facts enable row level security;;

-- 2026-07-31  V1 Truth Convergence, Phase 5: canonical proposal persistence.
--
-- Until now a ChangeProposal lived as an APPEND into move_drafts: every pass that drafted wrote
-- another row and the newest row per id won on read. Duplicate historical rows for one hypothesis
-- are the documented problem, and nothing in the schema said what a proposal IS.
--
-- IDENTITY is (tenant_id, case_id, page_key, action_family). Exactly ONE row for that identity is
-- current (terminal_disposition is null), enforced by the partial unique index below. A new draft
-- for the same hypothesis supersedes the row that held it: the predecessor keeps its words and gets
-- terminal_disposition = 'superseded' plus a pointer to its successor, and the successor lands with
-- the next proposal_version.
--
-- STATUS is unchanged and unrenamed (proposed / needs_review / rejected / applied): what Beacon
-- thinks of the change. DISPOSITION is the different question of whether this row is the current
-- answer at all: dismissed (the operator put it away), withdrawn (Beacon took it back), superseded.
--
-- Forward-only, additive, idempotent. move_drafts is NOT touched: its historical rows stay exactly
-- where they are and stay readable, so nothing measured or shipped loses its record.
--
-- NOT APPLIED AUTOMATICALLY. Apply this BEFORE the Phase 5 code deploys: the store fails closed and
-- loudly on a missing table (writes fail, reads fall back to history), it does not invent a table.

create table if not exists public.change_proposals (
  id                   text        primary key,
  tenant_id            text        not null,
  -- The site the change lands on, from the proposal's own page URL. Informational.
  site                 text        not null default '',
  -- The research case a NEW page answers. Empty for an edit: an edit's subject is its page.
  case_id              text        not null default '',
  -- The page an edit lands on, normalized exactly as the proposal id encodes it. Empty for a new page.
  page_key             text        not null default '',
  -- title-family | section-family | links-family | technical-family | consolidation | new_page.
  action_family        text        not null,
  proposal_version     integer     not null default 1,
  -- The research basis this version was generated under. Null on a row generated without one.
  basis                text,
  status               text        not null,
  terminal_disposition text,
  -- The full ChangeProposal in its versioned envelope ({ v, proposal }), re-validated on every load.
  payload              jsonb       not null,
  -- WHY this change exists (cause, receipt items, what is missing) and WHY it sits where it sits.
  -- Both are copies of what the payload already carries, lifted out so they can be read directly.
  decision_receipt     jsonb,
  ranking_receipt      jsonb,
  superseded_by        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint change_proposals_status_check
    check (status in ('proposed', 'needs_review', 'rejected', 'applied')),
  constraint change_proposals_disposition_check
    check (terminal_disposition is null or terminal_disposition in ('dismissed', 'withdrawn', 'superseded')),
  constraint change_proposals_version_check check (proposal_version >= 1)
);

-- THE canonical rule: one account, one case, one page, one action family, ONE current proposal.
-- Terminal rows are exempt, so every superseded version of that hypothesis stays on file.
create unique index if not exists ux_change_proposals_current
  on public.change_proposals (tenant_id, case_id, page_key, action_family)
  where terminal_disposition is null;

-- The queue read: one account's proposals, most recently touched first.
create index if not exists ix_change_proposals_tenant_updated
  on public.change_proposals (tenant_id, updated_at desc);

-- The history read: the chain of versions behind one current row.
create index if not exists ix_change_proposals_superseded_by
  on public.change_proposals (tenant_id, superseded_by)
  where superseded_by is not null;

-- Tenant isolation: deny anon; service-role only (matches every sibling table).
alter table public.change_proposals enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'change_proposals'
      and policyname = 'deny_anon_change_proposals'
  ) then
    create policy deny_anon_change_proposals
      on public.change_proposals
      for all to anon using (false) with check (false);
  end if;
end $$;

-- 2026-07-31  V1 Truth Convergence, Phase 6: THE CANONICAL SHIPMENT.
--
-- A Shipment is the operator-confirmed implementation of one ChangeProposal and its verified
-- live state. Until now, pressing "Mark implemented" flipped a status and nothing else: the
-- change the operator really made left no record of WHAT was applied, WHEN, or where the page
-- stood beforehand, so nothing downstream could verify it or measure it honestly.
--
-- EVOLVE, DO NOT DUPLICATE. shipped_change_proof already IS the record of a change that shipped
-- and what happened after it. A parallel shipments table would mean two answers to one question,
-- so the Shipment is added to this table as columns. Every column below is NULLABLE: the manual
-- "Record shipped change" rows written before today decode exactly as they always did.
--
-- WRITTEN ONCE. implemented_at is THE STAMP the 28-day measurement window is read from, and
-- shipment_baseline is where the page stood at mark time (search AND AI). The store excludes
-- both from every later update and refuses a second write; this migration only makes room.
--
-- THE DUE MARKER. verification IS NULL on a row that has a stamp means the live check is owed.
-- There is no queue table and no scheduler: the runtime reads the partial index below.
--
-- Forward-only, additive, idempotent. Nothing is dropped, renamed, or backfilled.
--
-- NOT APPLIED AUTOMATICALLY. Apply this BEFORE the Phase 6 code deploys. The store already
-- treats a missing column as a missing table (PGRST204) and falls back to the per-tenant file,
-- so a deploy window degrades rather than failing, but a Shipment is only durable once this runs.

alter table public.shipped_change_proof
  -- The proposal this implements, and the exact version of its copy the operator applied.
  -- proposal_version is a CONTENT version (the change, its components, its basis), not a
  -- counter: it is what makes the shipment id deterministic, so a retried press upserts
  -- itself instead of creating a second record of one change.
  add column if not exists proposal_id             text,
  add column if not exists proposal_version        text,
  -- The research basis the proposal was drafted under, and the case a new page answers.
  add column if not exists basis                   text,
  add column if not exists case_id                 text,
  -- What applying the bundle was meant to achieve, in the bundle's own one sentence.
  add column if not exists bundle_hypothesis       text,
  -- [{ kind, label, after }] the operator says they applied, where `after` is the exact copy that
  -- component carried (null when the change holds none of its own). A SUBSET of the bundle is a
  -- partial bundle, and it is stored as one, so measurement never claims more shipped than did.
  -- The copy travels with the record because the live check compares the page against it: strip it
  -- and every bundle verification quietly degrades to "I cannot tell".
  add column if not exists components_applied      jsonb,
  -- THE STAMP. Write-once.
  add column if not exists implemented_at          timestamptz,
  -- The owned page's held content hash at mark time, from the snapshot already on file.
  add column if not exists pre_change_content_hash text,
  -- { search: {clicks, impressions, ctr, position, windowDays}, ai: {day, checked, mentioning}|null,
  --   capturedAt }. Write-once.
  add column if not exists shipment_baseline       jsonb,
  -- { status, checkedAt, components: [{ kind, state, note }], recheckAfter }. NULL = the check is
  -- due. recheckAfter is a UTC day and is set ONLY when the site did not answer at all: that one
  -- ending earns a single retry on a later day, because a timeout says nothing about the change.
  add column if not exists verification            jsonb,
  -- Why the operator overrode what the check found, in their own words.
  add column if not exists operator_override_reason text;

-- THE RANKING WINDOW. "Which pages is this account still measuring" is read from the stamp.
create index if not exists shipped_change_proof_implemented_idx
  on public.shipped_change_proof (tenant_id, implemented_at desc)
  where implemented_at is not null;

-- THE DUE LIST. Shipments that carry a stamp and have never been checked live.
create index if not exists shipped_change_proof_needs_verification_idx
  on public.shipped_change_proof (tenant_id, implemented_at)
  where implemented_at is not null and verification is null;

-- ONE Shipment per (account, proposal, version applied). The application derives the same id
-- from the same inputs, so this is belt and braces against a duplicate arriving by any path.
create unique index if not exists ux_shipped_change_proof_proposal
  on public.shipped_change_proof (tenant_id, proposal_id, proposal_version)
  where proposal_id is not null;

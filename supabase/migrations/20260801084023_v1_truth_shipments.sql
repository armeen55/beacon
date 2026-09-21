-- 2026-07-31  V1 Truth Convergence, Phase 6: THE CANONICAL SHIPMENT.
--
-- A Shipment is the operator-confirmed implementation of one ChangeProposal and its verified
-- live state. shipped_change_proof already IS the record of a change that shipped and what
-- happened after it, so the Shipment is added to this table as columns. Every column below is
-- NULLABLE: the manual "Record shipped change" rows written before today decode exactly as
-- they always did.
--
-- WRITTEN ONCE. implemented_at is THE STAMP the 28-day measurement window is read from, and
-- shipment_baseline is where the page stood at mark time (search AND AI). The store excludes
-- both from every later update and refuses a second write; this migration only makes room.
--
-- THE DUE MARKER. verification IS NULL on a row that has a stamp means the live check is owed.
-- There is no queue table and no scheduler: the runtime reads the partial index below.
--
-- Forward-only, additive, idempotent. Nothing is dropped, renamed, or backfilled.

alter table public.shipped_change_proof
  add column if not exists proposal_id             text,
  add column if not exists proposal_version        text,
  add column if not exists basis                   text,
  add column if not exists case_id                 text,
  add column if not exists bundle_hypothesis       text,
  add column if not exists components_applied      jsonb,
  add column if not exists implemented_at          timestamptz,
  add column if not exists pre_change_content_hash text,
  add column if not exists shipment_baseline       jsonb,
  add column if not exists verification            jsonb,
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
  where proposal_id is not null;;

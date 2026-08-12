-- TWO ADDITIVE COLUMNS, FORWARD ONLY, NULLABLE. Nothing is rewritten and no row moves.
--
-- 1. change_proposals.withdrawn_reason
--    A withdrawal is permanent in practice: the skip set reads off it and a save under the same basis and
--    the same evidence is refused. Every withdrawal nevertheless looked identical afterwards, so the night a
--    stale-card sweep took the operator's open cards mid-edit there was nothing on the rows to tell them
--    apart from the drafts a safety gate had genuinely refused. The reason is written with the disposition
--    from now on (proposal-store.setDisposition).
alter table public.change_proposals add column if not exists withdrawn_reason text;

-- 2. shipped_change_proof.pinned_read
--    THE FINISHED READING, HELD STILL. /results re-measures the whole ledger in the background every fifteen
--    minutes, and a re-measure asks Google again with whatever comparison pages are untreated that day. Google
--    backfills days INSIDE windows that closed weeks ago, so a change reported at +1,040 clicks was re-read at
--    +1,428 the same afternoon. Once a window has closed with every day behind it finalized and no further
--    checkpoint is owed, the whole read tuple (verdict, metric, lift, impressions lift, basis day, confidence,
--    controls used) is frozen here and every later rebuild serves it. A later change on the same page may
--    still demote the verdict to confounded; the numbers never move again.
alter table public.shipped_change_proof add column if not exists pinned_read jsonb;

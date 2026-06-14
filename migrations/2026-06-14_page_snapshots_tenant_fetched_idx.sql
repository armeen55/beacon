-- wave-2 perf follow-up (2026-06-14): index page_snapshots on
-- (tenant_id, fetched_at DESC).
--
-- WHY: the two hottest page_snapshots reads BOTH filter by tenant_id and
-- order by fetched_at DESC —
--   • the web reader getPageSnapshots() (.eq(tenant_id).order(fetched_at
--     desc).limit(500)) on every /today, /recommendations, /changes load,
--   • the nightly getAllPageSnapshotsForGeneration() (.eq(tenant_id)
--     .order(fetched_at desc).range()) added in audit #12 —
-- yet the table had NO index on tenant_id at all (only page_id + PK on id).
-- So both reads were seq-scan + sort. Snapshot HISTORY accumulates (~35
-- rows per scan, unbounded over time), so for a large/long-lived tenant
-- this becomes a full-table scan + sort on a hot path. (tenant_id,
-- fetched_at DESC) turns both into ordered index scans — the web read can
-- stop after 500, the generation read seeks straight to the tenant's rows
-- in fetched_at order with no sort.
--
-- Additive + reversible (DROP INDEX); no data change. Table is small today
-- (~3k rows) so a plain CREATE INDEX locks for only milliseconds.

create index if not exists page_snapshots_tenant_fetched_idx
  on public.page_snapshots (tenant_id, fetched_at desc);

-- wave-6 ground-truth fix (2026-06-14): composite (tenant_id, <date>)
-- indexes for the two heaviest /today canonical reads.
--
-- WHY: the main dashboard (`/`) was SILENTLY RENDERING EMPTY in production.
-- `loadTodayPageData` -> `loadFreshCanonicalData` -> `queryAllPagedScoped`
-- runs two date-windowed, tenant-scoped, OFFSET-paginated reads:
--   • prompt_answer_observations  WHERE tenant_id = $1 AND observed_at >= $2
--   • daily_metric_snapshots      WHERE tenant_id = $1 AND date       >= $2
-- Neither table had a composite (tenant_id, <date>) index:
--   - prompt_answer_observations had only PK(id), (topic, platform), and a
--     UNIQUE on (tenant_id, prompt_id, platform, (observed_at::date)) — the
--     4th term is an EXPRESSION, so a plain `observed_at >= timestamptz`
--     range can't seek it.
--   - daily_metric_snapshots had only PK(id), (scope_type, scope_id), (date).
-- So each query was a Seq Scan + filter. Worse, PostgREST `.range()`
-- paginates with LIMIT/OFFSET and the scan has NO usable index, so EVERY
-- 1000-row page re-runs the full seq scan. Measured on prod (Ritz, 21,047
-- obs rows, width=1684 wide-JSONB): one PAO seq scan = 3,670 ms; ~9 OFFSET
-- pages cumulatively far exceed the 8s Postgres statement_timeout. The read
-- throws `canceling statement due to statement timeout`, the caller catches
-- it ("continuing with empty canonical arrays"), and the customer sees a
-- BLANK Today with no error. The same missing index also timed out the
-- poll-health per-platform obs-count (single-day observed_at range).
--
-- AFTER (verified via EXPLAIN ANALYZE on prod): the PAO query becomes
-- `Index Scan using idx_pao_tenant_observed_at`; the worst page
-- (OFFSET 8000) drops 3,670 ms -> 93 ms (~39x). End-to-end the dashboard
-- renders with full data (~4s local incl. laptop->Supabase round-trip
-- latency) instead of empty. DMS stays a fast seq scan for Ritz today
-- (~30 ms, 99% of rows fall in the 120-day window so the planner correctly
-- declines the index) but idx_dms_tenant_date pays off for selective
-- tenants (e.g. Iranopedia) and as history grows past the window.
--
-- Additive + reversible (DROP INDEX); no data change. Tables are small
-- today (~21k / ~19k rows) so a plain CREATE INDEX locks for only ms.

create index if not exists idx_pao_tenant_observed_at
  on public.prompt_answer_observations (tenant_id, observed_at);

create index if not exists idx_dms_tenant_date
  on public.daily_metric_snapshots (tenant_id, date);

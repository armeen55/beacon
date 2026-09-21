-- The page-signal and decay reads filter (tenant_id, is_final, date >= since) then aggregate page/query
-- columns over ~160K rows with no matching index, timing out about half the time. One covering partial
-- index serves both reads as index-only scans. Additive only; drops nothing.
create index if not exists gsc_daily_rows_tenant_final_date_idx
  on gsc_daily_rows (tenant_id, date)
  include (page, query, clicks, impressions, position)
  where is_final = true;;

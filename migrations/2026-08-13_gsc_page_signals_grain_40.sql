-- 2026-08-13: same function, one number: rn <= 40 (was 10). Decision was reasoning over ~7 percent
-- of the account demand; the reader cap is 40 and this lifts the server side to match. Additive replace.
-- 2026-06-13 : Server-side GSC page-signal aggregation RPC.
--
-- Applied to prod via MCP apply_migration (gsc_page_signals_rpc). Recorded
-- here for repo/fresh-env reproducibility.
--
-- WHY: loadGscPageSignalsForTenant paginated raw gsc_daily_rows client-side
-- and truncated at an 80k-row safety cap. A large site has far more rows in
-- the 90-day window (Iranopedia: ~208k), so the read summed an arbitrary,
-- INCOMPLETE slice and the card's "in the last 90 days" counts were wrong
-- (and depended on read order). This RPC does ONE server-side GROUP BY:
-- complete per-page totals + the top-10 queries per page, in ~570ms over
-- 208k rows (one round-trip vs ~80). Additive + idempotent (CREATE OR REPLACE).

create or replace function gsc_page_signals_v1(p_tenant text, p_since date)
returns table(
  page text,
  clicks bigint,
  impressions bigint,
  pos_weighted double precision,
  top_queries jsonb
)
language sql
stable
as $$
  with per_pq as (
    select
      page,
      query,
      sum(clicks)::bigint        as clicks,
      sum(impressions)::bigint   as impressions,
      sum(position * impressions)::double precision as pos_w
    from gsc_daily_rows
    where tenant_id = p_tenant
      and is_final = true
      and date >= p_since
    group by page, query
  ),
  ranked as (
    select page, query, clicks, impressions, pos_w,
           row_number() over (partition by page order by impressions desc, query asc) as rn
    from per_pq
  ),
  top as (
    select page,
           jsonb_agg(
             jsonb_build_object(
               'query', query,
               'clicks', clicks,
               'impressions', impressions,
               'position', case when impressions > 0 then pos_w / impressions else 0 end
             )
             order by impressions desc, query asc
           ) filter (where rn <= 40) as top_queries
    from ranked
    group by page
  ),
  per_page as (
    select page,
           sum(clicks)::bigint      as clicks,
           sum(impressions)::bigint as impressions,
           sum(pos_w)::double precision as pos_w
    from per_pq
    group by page
  )
  select pp.page, pp.clicks, pp.impressions, pp.pos_w as pos_weighted,
         coalesce(t.top_queries, '[]'::jsonb) as top_queries
  from per_page pp
  left join top t using (page);
$$;

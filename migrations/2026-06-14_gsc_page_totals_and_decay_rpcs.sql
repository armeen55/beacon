-- audit #24 (2026-06-14): server-side aggregation RPCs for the two
-- remaining client-side-paginated GSC reads in gsc-page-signals.ts.
--
-- WHY: every nightly generation, loadGscPageSignalsForTenant paged
-- gsc_daily_page_totals in ~20 round-trips (~19.5k rows for Iranopedia)
-- and loadGscDecaySignalsForTenant paged gsc_daily_rows in 80-160
-- round-trips (~130k rows across the 2x28-day decay window), then summed
-- in app code. The decay read's 160k client-side cap would also SILENTLY
-- TRUNCATE — corrupting now-vs-prior decay detection — once a site's
-- in-window rows exceed it (Iranopedia is already ~130k). Each read
-- becomes ONE server-side GROUP BY returning roughly one row per page.
--
-- Mirrors the proven gsc_page_signals_v1 contract exactly: LANGUAGE sql
-- STABLE, search_path pinned to (pg_catalog, public), SECURITY INVOKER
-- (default — the app calls via service_role with an explicit p_tenant
-- filter), EXECUTE revoked from public/anon/authenticated and granted to
-- service_role only. Positions are returned impressions-WEIGHTED
-- (Σ position*impressions); the caller divides by impressions, same as
-- gsc_page_signals_v1. Per-page rows are re-canonicalized + merged app-side
-- (canonicalizeCitationUrl), so grouping on the raw `page` here is safe.
--
-- Additive + reversible (DROP FUNCTION); touches no data.

-- ── 1. Page-level totals (replaces the gsc_daily_page_totals pager) ──
create or replace function public.gsc_page_totals_v1(p_tenant text, p_since date)
  returns table(
    page text,
    clicks bigint,
    impressions bigint,
    pos_weighted double precision
  )
  language sql
  stable
  set search_path to 'pg_catalog', 'public'
as $function$
  select page,
         coalesce(sum(clicks), 0)::bigint                       as clicks,
         coalesce(sum(impressions), 0)::bigint                  as impressions,
         coalesce(sum(position * impressions), 0)::double precision as pos_weighted
  from gsc_daily_page_totals
  where tenant_id = p_tenant
    and is_final = true
    and date >= p_since
  group by page;
$function$;

revoke execute on function public.gsc_page_totals_v1(text, date)
  from public, anon, authenticated;
grant execute on function public.gsc_page_totals_v1(text, date)
  to service_role;

-- ── 2. Split-window decay (replaces the gsc_daily_rows decay pager) ──
-- now window  = [p_split, today]   (the trailing DECAY_WINDOW_DAYS)
-- prior window = [p_since, p_split) (the DECAY_WINDOW_DAYS before that)
create or replace function public.gsc_decay_v1(p_tenant text, p_since date, p_split date)
  returns table(
    page text,
    clicks_now bigint,
    impressions_now bigint,
    pos_w_now double precision,
    clicks_prior bigint,
    impressions_prior bigint,
    pos_w_prior double precision
  )
  language sql
  stable
  set search_path to 'pg_catalog', 'public'
as $function$
  select page,
         coalesce(sum(clicks) filter (where date >= p_split), 0)::bigint                          as clicks_now,
         coalesce(sum(impressions) filter (where date >= p_split), 0)::bigint                     as impressions_now,
         coalesce(sum(position * impressions) filter (where date >= p_split), 0)::double precision as pos_w_now,
         coalesce(sum(clicks) filter (where date < p_split), 0)::bigint                            as clicks_prior,
         coalesce(sum(impressions) filter (where date < p_split), 0)::bigint                       as impressions_prior,
         coalesce(sum(position * impressions) filter (where date < p_split), 0)::double precision  as pos_w_prior
  from gsc_daily_rows
  where tenant_id = p_tenant
    and is_final = true
    and date >= p_since
  group by page;
$function$;

revoke execute on function public.gsc_decay_v1(text, date, date)
  from public, anon, authenticated;
grant execute on function public.gsc_decay_v1(text, date, date)
  to service_role;

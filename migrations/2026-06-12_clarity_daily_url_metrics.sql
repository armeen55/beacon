-- 2026-06-12 — Clarity harvester: per-URL daily behavioral metrics.
-- Clarity's Data Export API exposes only a 1-3 day window with NO
-- backfill (10 requests/day cap) — Beacon pulls ONCE nightly and
-- accumulates its own history here. Additive; RLS mirrors peers.
-- (Applied to prod via MCP on 2026-06-12.)

create table if not exists clarity_daily_url_metrics (
  tenant_id text not null,
  date date not null,
  url text not null,
  sessions integer not null default 0,
  rage_clicks integer not null default 0,
  dead_clicks integer not null default 0,
  excessive_scroll integer not null default 0,
  quickbacks integer not null default 0,
  script_errors integer not null default 0,
  avg_scroll_depth double precision,
  engagement_time_seconds double precision,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, date, url)
);

alter table clarity_daily_url_metrics enable row level security;

drop policy if exists clarity_daily_url_metrics_tenant_rw on clarity_daily_url_metrics;
create policy clarity_daily_url_metrics_tenant_rw on clarity_daily_url_metrics
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

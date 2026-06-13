-- 2026-06-12 — Profound Agent Analytics v2: AI-crawler hits + AI
-- referral visits per path, from POST /v2/reports/{bots,referrals}
-- (raw-domain reports — no category required; the deprecated
-- /v1/logs/raw* path sunset 2026-06-10). Trailing 3-day EST window
-- re-pulled nightly; idempotent UPSERTs. Additive; RLS mirrors peers.
-- (Applied to prod via MCP on 2026-06-12.)

create table if not exists profound_bot_rows (
  tenant_id text not null,
  date date not null,
  path text not null default '',
  bot_name text not null default '',
  bot_type text not null default '',
  hit_count double precision not null default 0,
  citations double precision not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, date, path, bot_name, bot_type)
);

alter table profound_bot_rows enable row level security;

drop policy if exists profound_bot_rows_tenant_rw on profound_bot_rows;
create policy profound_bot_rows_tenant_rw on profound_bot_rows
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

create table if not exists profound_referral_rows (
  tenant_id text not null,
  date date not null,
  path text not null default '',
  referral_source text not null default '',
  referral_type text not null default '',
  visits double precision not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (tenant_id, date, path, referral_source, referral_type)
);

alter table profound_referral_rows enable row level security;

drop policy if exists profound_referral_rows_tenant_rw on profound_referral_rows;
create policy profound_referral_rows_tenant_rw on profound_referral_rows
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

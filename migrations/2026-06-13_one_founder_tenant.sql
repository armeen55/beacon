-- 2026-06-13 — exactly one founder tenant (cross-tenant safety).
--
-- BeaconTenant.role is a TIER (founder | beta_customer | paid_customer), NOT a
-- membership role. tenant-data.ts uses role='founder' to decide which tenant
-- owns LEGACY UNTAGGED rows (predating the multi-tenant tenant_id migration).
-- All three tenants had been seeded role='founder', so the resolver's lookup
-- was nondeterministic — legacy untagged rows could attach to the wrong tenant
-- (a silent cross-tenant breach). Ritz is the only tenant that ever wrote
-- those legacy rows, so it stays founder; the others become customer tiers.
--
-- The resolver (getFounderTenantIdForLegacyFallback) now THROWS on >1 founder,
-- so this state is enforced in code as well as data. Idempotent.

UPDATE public.tenants SET role = 'paid_customer', updated_at = now()
  WHERE id = 'tenant-iranopedia' AND role <> 'paid_customer';

UPDATE public.tenants SET role = 'beta_customer', updated_at = now()
  WHERE id = 'tenant-finglish' AND role <> 'beta_customer';

-- tenant-ritz-founder intentionally remains role='founder' (the historical
-- legacy-untagged writer). Do NOT add a second founder.

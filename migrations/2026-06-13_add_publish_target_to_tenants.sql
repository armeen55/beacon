-- 2026-06-13 — add publish_target to public.tenants (Iranopedia pivot blocker).
--
-- WHY: the tenant registry (src/domains/tenants/store.ts getTenant/listTenants)
-- reads the Supabase `tenants` table on hosted (DATA_SOURCE=supabase) so the
-- tenant switcher can resolve names AND executePush can route Accept→Wix. The
-- table had no publish_target column, so executePush fell back to dev_note
-- (no live Wix push) for every hosted tenant. This adds it.
--
-- SAFETY: additive + reversible. NOT NULL with a safe default of 'dev_note'
-- (an unset/unknown tenant NEVER auto-publishes), CHECK-constrained to the
-- three PublishTargetKind values. Ritz is ALSO hard-refused in code
-- (executePush RITZ_TENANT_ID guard) regardless of this value.
--
-- Applied to project jdegznovgysxyweknewh via apply_migration on 2026-06-13;
-- this file mirrors it for the repo's migration history.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS publish_target text NOT NULL DEFAULT 'dev_note'
  CHECK (publish_target IN ('wix_cms', 'git_pr', 'dev_note'));

-- Tenant routing (data, not schema): Iranopedia publishes to Wix; Ritz +
-- Finglish stay dev_note (Ritz is dev-note-forever by Invariant 2).
UPDATE public.tenants SET publish_target = 'wix_cms', updated_at = now()
  WHERE id = 'tenant-iranopedia';
UPDATE public.tenants SET publish_target = 'dev_note', updated_at = now()
  WHERE id IN ('tenant-ritz-founder', 'tenant-finglish');

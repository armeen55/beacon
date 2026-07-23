-- Slice 1 (generic Account + BusinessProfile): legacy vertical columns on
-- tenants become optional with no vertical defaults. ADDITIVE ONLY: no
-- column drops, no row changes; historical values are preserved untouched.
-- Application code no longer reads or writes these columns.
-- Applied 2026-07-23 via the Supabase management connection as
-- migration `generic_account_neutral_defaults`.
ALTER TABLE tenants
  ALTER COLUMN segment DROP NOT NULL,
  ALTER COLUMN segment DROP DEFAULT,
  ALTER COLUMN project_mix DROP NOT NULL,
  ALTER COLUMN project_mix DROP DEFAULT,
  ALTER COLUMN cities_served DROP NOT NULL,
  ALTER COLUMN cities_served DROP DEFAULT,
  ALTER COLUMN budget_range DROP NOT NULL,
  ALTER COLUMN budget_range DROP DEFAULT,
  ALTER COLUMN publish_target DROP NOT NULL,
  ALTER COLUMN publish_target DROP DEFAULT,
  ALTER COLUMN role DROP NOT NULL,
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN email_frequency DROP NOT NULL,
  ALTER COLUMN email_frequency DROP DEFAULT,
  ALTER COLUMN discovered_competitors DROP NOT NULL,
  ALTER COLUMN discovered_competitors DROP DEFAULT;

-- Migrate the code-curated authoritative-source domains into the historical
-- account's own BusinessProfile row (union, no removals). The code path that
-- carried these as source is deleted in the same slice.
UPDATE business_config
SET data = jsonb_set(
  data,
  '{authoritativeSourceDomains}',
  (
    SELECT COALESCE(jsonb_agg(DISTINCT d), '[]'::jsonb) FROM (
      SELECT jsonb_array_elements_text(COALESCE(data->'authoritativeSourceDomains', '[]'::jsonb)) AS d
      UNION
      SELECT unnest(ARRAY['wikipedia.org','britannica.com','unesco.org','iranicaonline.org','loc.gov']) AS d
    ) u
  )
), updated_at = now()
WHERE id = 'tenant-iranopedia';

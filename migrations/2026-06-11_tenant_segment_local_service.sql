-- Migration: 2026-06-11_tenant_segment_local_service.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   2026-06-11 via Supabase MCP (day-shift /goal: URL-only
--            onboarding for ANY vertical — zero hardcoding).
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     North-star onboarding — add the 'local_service' segment for
--            non-builder local businesses (restaurant, dentist, plumber…),
--            derived at launch from the site's own signals (physical
--            address / phone / areaServed in its structured data).
--
-- Why: launch now derives the segment (suggestSegmentFromProfile +
-- executeLaunchTransaction, src/app/(shell)/onboard/review/launch-flow.ts).
-- Without this widening, writing 'local_service' violates
-- tenants_segment_check and the entire activation UPDATE fails — a
-- local-service stranger could not launch. TypeScript union widened the
-- same day (TenantSegment, src/domains/tenants/types.ts); engine toggles
-- mirror the builder segment (tenant-features.ts) — the local engines are
-- vertical-agnostic; the separate label keeps brain bins honest.
--
-- Constraints:
--   * ADDITIVE in effect — the allowed-value list grows; every existing
--     row remains valid. No data mutation. Reversible by re-narrowing
--     (valid while no local_service rows exist).

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_segment_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_segment_check CHECK (
    segment = ANY (ARRAY[
      'local_residential_builder'::text,
      'local_service'::text,
      'content_publisher'::text,
      'product_app'::text
    ])
  );

COMMENT ON COLUMN public.tenants.segment IS 'Property segment (2026-06-11 local_service widening): local_residential_builder | local_service | content_publisher | product_app. Mirrors TenantSegment in src/domains/tenants/types.ts. Cross-tenant brain pattern keys are segment-scoped.';

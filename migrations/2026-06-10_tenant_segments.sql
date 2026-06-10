-- Migration: 2026-06-10_tenant_segments.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   2026-06-10 via Supabase MCP (operator-approved master goal:
--            multi-property activation).
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Multi-property activation — widen the tenant segment CHECK
--            from the v1 single value to the three property segments.
--
-- Why: v1 pinned `tenants_segment_check` to 'local_residential_builder'
-- (single-segment era). The operator's own properties become tenants #2
-- and #3: Iranopedia (content_publisher) and Finglish (product_app).
-- TypeScript union widened the same day in src/domains/tenants/types.ts
-- (TenantSegment). Cross-tenant brain pattern keys include segment, so
-- patterns never mix across segments by construction.
--
-- Constraints:
--   * ADDITIVE in effect — the allowed-value list grows; existing rows
--     (all 'local_residential_builder') remain valid. No data mutation.
--   * Rollback: drop + recreate the original single-value CHECK
--     (valid only while no non-builder rows exist).

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_segment_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_segment_check CHECK (
    segment = ANY (ARRAY[
      'local_residential_builder'::text,
      'content_publisher'::text,
      'product_app'::text
    ])
  );

COMMENT ON COLUMN public.tenants.segment IS 'Property segment (2026-06-10 multi-property widening): local_residential_builder | content_publisher | product_app. Mirrors TenantSegment in src/domains/tenants/types.ts. Cross-tenant brain pattern keys are segment-scoped.';

-- Migration: 2026-05-16_connector_tokens.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   PENDING — operator approval required before apply.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     connector-tokens-supabase-and-gsc-scope-split
--            (post-A.3.b1.alpha, operator-substrate persistence fix)
--
-- Why this migration exists:
--   The OAuth callback at `/api/connectors/google/callback` could not
--   persist tokens on Vercel. Prior `src/lib/connector-store.ts` wrote
--   tokens to `.data/connector-tokens.json` via `writeFileSync` +
--   `renameSync`. On Vercel the lambda filesystem is read-only post-
--   init and `.data/` is gitignored (not bundled). Every successful
--   Google consent flow ended with:
--     "ENOENT: no such file or directory,
--      open '/var/task/.data/connector-tokens.json.tmp'"
--   This migration adds the durable storage layer connector tokens
--   read/write through, replacing the disk file path entirely.
--
-- Provider keys (locked by this slice):
--   * google_gsc — Google Search Console (webmasters.readonly)
--   * google_gbp — Google Business Profile (business.manage)
--   * yelp      — Yelp Fusion API key
--   These keys reflect Google's per-grant authorization model: each
--   OAuth flow yields a refresh token bound to the requested scope
--   set. A single "google" slot conflated the two and forced the
--   consent screen to request both scopes simultaneously — the trust
--   bug operators reported when GSC connect asked for GBP edit
--   permissions.
--
-- Sequencing model A (operator-locked, mirrors robots-state):
--   New code soft-fails on `42P01` (undefined_table) for READS so
--   production OAuth state-check / settings page degrade gracefully
--   if a code deploy lands before this migration. WRITES fail loud
--   so the OAuth callback errors clearly during the migration
--   window — easier to diagnose than silent token-drop.
--
-- Constraints (operator-locked):
--   * ADDITIVE ONLY — new table, no ALTERs to existing tables.
--   * No data mutation in this migration. Table starts empty; the
--     next successful Google OAuth flow populates the first row.
--   * RLS deny-all for authenticated. service_role bypasses RLS.
--     Customer surfaces never read this table; only server-side
--     OAuth-callback / settings actions / connector clients via
--     service_role.
--   * tenant_id + provider composite PK enforces per-tenant token
--     isolation. Two tenants connecting Google get two independent
--     refresh tokens.
--   * Plaintext payload (matches the prior on-disk plaintext posture
--     and Section 4 F3 lock: "Defer encryption-at-rest for A.3.
--     Marked as a security follow-up before onboarding paying
--     customers beyond trusted pilots.") A follow-up bundle adds
--     column-level encryption before the second customer.
--   * Rollback: DROP TABLE IF EXISTS public.connector_tokens CASCADE.
--     Reverts cleanly because no other tables reference it. Existing
--     OAuth grants on Google's side remain valid; operator
--     re-clicks Connect to repopulate.

CREATE TABLE IF NOT EXISTS public.connector_tokens (
  tenant_id   text         NOT NULL,
  provider    text         NOT NULL,
  payload     jsonb        NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

COMMENT ON TABLE public.connector_tokens IS 'connector-tokens-supabase-and-gsc-scope-split (2026-05-16): per-tenant per-provider OAuth/API tokens. Provider ∈ {google_gsc, google_gbp, yelp}. Payload is plaintext JSONB matching prior on-disk shape; encryption-at-rest deferred to F3 follow-up before broader customer onboarding.';

COMMENT ON COLUMN public.connector_tokens.tenant_id IS 'Beacon tenant identifier (e.g. tenant-ritz-founder). Composite PK with provider — one row per tenant per provider.';

COMMENT ON COLUMN public.connector_tokens.provider IS 'Provider key. google_gsc = Search Console (webmasters.readonly). google_gbp = Business Profile (business.manage). yelp = Yelp Fusion. New providers extend by adding a new value; readers are provider-discriminated.';

COMMENT ON COLUMN public.connector_tokens.payload IS 'JSONB payload matching the per-provider shape in connector-store.ts. Google: access_token, refresh_token, expires_at, connected_at, scopes[], optional selected_location_*. Yelp: api_key, connected_at, business_id, optional last_synced_at. Plaintext today (Section 4 F3 follow-up adds encryption).';

CREATE INDEX IF NOT EXISTS connector_tokens_updated_at_idx
  ON public.connector_tokens (updated_at DESC);

ALTER TABLE public.connector_tokens ENABLE ROW LEVEL SECURITY;

-- Deny-all for authenticated clients. service_role bypasses RLS.
-- Customer surfaces never read this table; only server-side
-- OAuth-callback / settings / connector-client paths via
-- service_role.
CREATE POLICY "deny_authenticated" ON public.connector_tokens
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

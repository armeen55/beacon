/**
 * resolve-preview-config — De-vert #116/#125 (2026-06-14).
 *
 * Read-only resolver for the /onboard/review prompt PREVIEW. Its only job
 * is to surface the site-derived services / industry / locations so the
 * preview matches what `executeLaunchTransaction` will actually write — the
 * builder-tag prompt families only fire for the six ProjectMixTags, so a
 * non-builder (bakery, dentist, SaaS) would otherwise see a near-empty
 * preview and a disabled Launch button.
 *
 * Precedence (mirrors launch + getBusinessConfigForCurrentTenant):
 *   1. Already-persisted per-tenant config (env/file/Supabase row) — when a
 *      retry or sibling launch already derived one.
 *   2. Read-only site derivation: the SAME chain launch runs
 *      (fetchSiteProfilePages → deriveBusinessProfile → deriveBusinessConfig)
 *      but WITHOUT persisting. The review step is one-time per onboarding,
 *      so the polite ≤3-page fetch here is acceptable; launch re-derives and
 *      persists for real.
 *
 * FAILURE-SOFT: an unreachable/blocked site (or any throw) yields an empty
 * patch — the preview then shows brand prompts only, exactly as a
 * site-with-no-signals would at launch. NEVER throws; NEVER persists.
 */

import "server-only";
import {
  hydrateBusinessConfigFromSupabase,
  type BusinessConfig,
} from "@/lib/business-config";

export type PreviewConfigSignals = {
  services: string[];
  industry: string | null;
  locations: string[];
};

const EMPTY: PreviewConfigSignals = {
  services: [],
  industry: null,
  locations: [],
};

export async function resolvePreviewConfigSignals(args: {
  tenantId: string;
  domain: string;
  typedName?: string | null;
  typedCities?: string[] | null;
  competitors?: string[] | null;
}): Promise<PreviewConfigSignals> {
  // 1. Already-persisted config (priority a–d': env/file/Supabase row).
  const persisted = await hydrateBusinessConfigFromSupabase(args.tenantId);
  if (persisted) return signalsFromConfig(persisted);

  // 2. Read-only site derivation — same chain launch uses, no persist.
  if (!args.domain.trim()) return EMPTY;
  try {
    const [
      { fetchSiteProfilePages, normalizeSiteUrl },
      { deriveBusinessProfile },
      { deriveBusinessConfig },
    ] = await Promise.all([
      import("@/domains/onboarding/fetch-site-profile"),
      import("@/domains/onboarding/derive-business-profile"),
      import("@/domains/onboarding/derive-business-config"),
    ]);
    const normalized = normalizeSiteUrl(args.domain);
    if (!normalized) return EMPTY;
    // Match launch's slow-CMS tolerance (real Wix homepages exceed 10s cold).
    const fetched = await fetchSiteProfilePages(args.domain, {
      timeoutMs: 20_000,
    });
    const profile = fetched.ok ? deriveBusinessProfile(fetched.pages) : null;
    const config = deriveBusinessConfig({
      profile,
      domain: normalized.domain,
      typedName: args.typedName,
      typedCities: args.typedCities,
      competitors: args.competitors,
    });
    return signalsFromConfig(config);
  } catch {
    return EMPTY;
  }
}

function signalsFromConfig(
  config: Partial<BusinessConfig>,
): PreviewConfigSignals {
  return {
    services: config.services ?? [],
    industry: config.industry ?? null,
    locations: config.locations ?? [],
  };
}

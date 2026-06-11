/**
 * launch-config — North-star onboarding (2026-06-11).
 *
 * The composed launch-time step that turns "stranger typed a URL" into
 * a PERSISTED per-tenant BusinessConfig:
 *
 *   fetchSiteProfilePages (polite, ≤3 pages)
 *     → deriveBusinessProfile (pure extraction)
 *     → deriveBusinessConfig (typed-beats-derived mapping)
 *     → saveBusinessConfig (per-tenant file + per-tenant Supabase row)
 *
 * FAILURE-SOFT BY CONTRACT: an unreachable/robots-blocked site must
 * never block a launch. The config is then built from the wizard-typed
 * fields alone — still persisted, so an active tenant NEVER runs on the
 * neutral placeholder. The result reports which path happened so the
 * caller can log it honestly.
 *
 * No LLM, no paid APIs — the only network is ≤3 polite fetches of the
 * stranger's own site.
 */

import { saveBusinessConfig, type BusinessConfig } from "@/lib/business-config";
import type { PoliteFetchDeps } from "@/domains/competitor-intel/polite-fetch";
import type { TenantSegment } from "@/domains/tenants/types";
import {
  deriveBusinessProfile,
  type DerivedBusinessProfile,
} from "./derive-business-profile";
import { deriveBusinessConfig } from "./derive-business-config";
import { fetchSiteProfilePages, normalizeSiteUrl } from "./fetch-site-profile";

/** Site signals → segment. Pure; null when ambiguous.
 *
 * Live check 2026-06-11 (iranopedia.com): `locations` alone is NOT a
 * local signal — a content site's Organization node carried a region-
 * only address ("CA") that produced locations and would have flipped an
 * encyclopedia to local_service. Local now requires a REAL physical
 * address (street/locality — see extractAddress) or a phone; everything
 * weaker stays null and keeps the safe provisioning default. */
export function suggestSegmentFromProfile(
  profile: DerivedBusinessProfile | null,
): TenantSegment | null {
  if (!profile) return null;
  if (profile.contentSiteSignal) return "content_publisher";
  const localSignals = profile.address !== null || profile.phone !== null;
  return localSignals ? "local_service" : null;
}

export type LaunchConfigArgs = {
  tenantId: string;
  /** Domain as saved by the wizard's business step. */
  domain: string;
  typedName?: string | null;
  typedCities?: string[] | null;
  competitors?: string[] | null;
} & PoliteFetchDeps;

export type LaunchConfigResult = {
  outcome: "derived_and_saved" | "typed_only_saved" | "skipped_no_domain";
  /** Field names the site derivation actually contributed. */
  derivedFields: string[];
  /** The persisted config (undefined only when skipped) — the launch
   *  flow threads services/industry/locations into prompt generation. */
  config?: Partial<BusinessConfig>;
  /**
   * Segment suggested by the SITE's own signals: article schema with no
   * address → content_publisher; physical presence (address/phone/
   * areaServed) → local_service. Null when the site is ambiguous — the
   * caller keeps the provisioning default. (The launch flow upgrades to
   * local_residential_builder when the human picked builder tags — a
   * self-declaration beats inference.)
   */
  suggestedSegment: TenantSegment | null;
};

export async function deriveAndPersistTenantConfig(
  args: LaunchConfigArgs,
): Promise<LaunchConfigResult> {
  const normalized = normalizeSiteUrl(args.domain);
  if (!normalized) {
    // No usable domain — nothing to key the config on. The wizard
    // validates domains, so this is a defensive branch.
    return {
      outcome: "skipped_no_domain",
      derivedFields: [],
      suggestedSegment: null,
    };
  }

  const fetched = await fetchSiteProfilePages(args.domain, {
    fetchImpl: args.fetchImpl,
    // Live check 2026-06-11: real Wix homepages exceed the 10s
    // competitor-intel default cold. Launch is one-time — give slow
    // sites 20s before falling back to typed-only config.
    timeoutMs: args.timeoutMs ?? 20_000,
  });
  const profile = fetched.ok ? deriveBusinessProfile(fetched.pages) : null;

  const config = deriveBusinessConfig({
    profile,
    domain: normalized.domain,
    typedName: args.typedName,
    typedCities: args.typedCities,
    competitors: args.competitors,
  });

  saveBusinessConfig(args.tenantId, config);

  const typedOrStructural = new Set([
    "name",
    "domain",
    "scanSettings",
    "locations",
    "primaryCompetitors",
  ]);
  const derivedFields = profile
    ? Object.keys(config).filter((k) => !typedOrStructural.has(k))
    : [];

  return {
    outcome: profile ? "derived_and_saved" : "typed_only_saved",
    derivedFields,
    config,
    suggestedSegment: suggestSegmentFromProfile(profile),
  };
}

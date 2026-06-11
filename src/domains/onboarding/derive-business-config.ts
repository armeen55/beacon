/**
 * derive-business-config — North-star onboarding (2026-06-11).
 *
 * Pure mapper: derived site profile + wizard-typed fields → the
 * `Partial<BusinessConfig>` persisted at launch. The contract that
 * keeps this honest:
 *
 *   - TYPED beats DERIVED: what the human confirmed in the wizard
 *     (name, cities) always wins; derivation fills what they were
 *     never asked for (industry, phone, address, services, key pages,
 *     content-site mode, off-site profile URLs).
 *   - DERIVED-ONLY fields come from the site or stay empty — no
 *     vertical/geo defaults, ever. A site that exposes nothing gets
 *     honest blanks, not somebody else's config.
 *   - Launch IS the scan opt-in: the stranger typed their own domain
 *     and clicked Launch, so `scanSettings.enabled: true` (the
 *     PLACEHOLDER stays disabled — only an explicit launch opts in).
 *     Timezone stays UTC — neutral, never a geo guess.
 *
 * `mergeWithPlaceholder` (business-config.ts) fills every field this
 * mapper doesn't set, so the persisted config is always complete.
 */

import type { BusinessConfig } from "@/lib/business-config";
import type { DerivedBusinessProfile } from "./derive-business-profile";

/** "fredericksburg" → "Fredericksburg"; 2-letter region codes → "TX". */
export function displayCaseLocation(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return trimmed
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function profileUrlFor(
  socialProfiles: string[],
  hostSuffix: string,
): string | null {
  for (const url of socialProfiles) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host === hostSuffix || host.endsWith(`.${hostSuffix}`)) return url;
    } catch {
      /* malformed sameAs URL */
    }
  }
  return null;
}

export type DeriveBusinessConfigArgs = {
  /** Site-derived profile; null when the site was unreachable. */
  profile: DerivedBusinessProfile | null;
  /** Bare domain (normalized) — required, from the wizard. */
  domain: string;
  /** Wizard-typed business name (beats derived). */
  typedName?: string | null;
  /** Wizard-typed cities (beat + merge ahead of derived locations). */
  typedCities?: string[] | null;
  /** Competitors collected by the wizard's competitors step. */
  competitors?: string[] | null;
};

export function deriveBusinessConfig(
  args: DeriveBusinessConfigArgs,
): Partial<BusinessConfig> {
  const { profile, domain } = args;
  const typedName = args.typedName?.trim() || null;
  const typedCities = (args.typedCities ?? []).map((c) => c.trim()).filter(Boolean);
  const competitors = (args.competitors ?? []).map((c) => c.trim()).filter(Boolean);

  const config: Partial<BusinessConfig> = {
    name: typedName ?? profile?.name ?? domain,
    domain,
    // Launch is the explicit opt-in (see header) — enable the scanner.
    scanSettings: {
      preferredHour: 9,
      timezone: "UTC",
      scope: "full",
      enabled: true,
    },
  };

  if (profile?.industry) config.industry = profile.industry;
  if (profile?.phone) config.phone = profile.phone;
  if (profile?.address) config.address = profile.address;

  const locations = uniquePreservingOrder([
    ...typedCities,
    ...(profile?.locations ?? []).map(displayCaseLocation),
  ]);
  if (locations.length > 0) config.locations = locations;

  if (profile && profile.services.length > 0) {
    config.services = uniquePreservingOrder(profile.services);
  }
  if (profile && profile.keyPages.length > 0) {
    config.keyPages = profile.keyPages;
  }
  if (competitors.length > 0) config.primaryCompetitors = competitors;
  if (profile?.contentSiteSignal) config.contentSiteMode = true;

  if (profile) {
    const houzz = profileUrlFor(profile.socialProfiles, "houzz.com");
    const angi = profileUrlFor(profile.socialProfiles, "angi.com");
    const bbb = profileUrlFor(profile.socialProfiles, "bbb.org");
    if (houzz) config.houzzProfileUrl = houzz;
    if (angi) config.angiProfileUrl = angi;
    if (bbb) config.bbbProfileUrl = bbb;
    // The generic 4th off-site channel: a non-builder local business's
    // industry directory (restaurant → yelp/tripadvisor, doctor →
    // healthgrades, lawyer → avvo, realtor → zillow). First match wins;
    // the off-site-authority engine treats it as "Configured".
    const industryDirectory =
      profileUrlFor(profile.socialProfiles, "yelp.com") ??
      profileUrlFor(profile.socialProfiles, "tripadvisor.com") ??
      profileUrlFor(profile.socialProfiles, "healthgrades.com") ??
      profileUrlFor(profile.socialProfiles, "avvo.com") ??
      profileUrlFor(profile.socialProfiles, "zillow.com");
    if (industryDirectory) config.industryDirectoryProfileUrl = industryDirectory;
  }

  return config;
}

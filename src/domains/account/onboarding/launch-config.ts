/**
 * launch-config — minimal per-tenant config persistence (Core 100K).
 *
 * Turns "stranger confirmed a URL + name" into a PERSISTED per-tenant
 * BusinessProfile. The elaborate site-profile derivation (fetch ≤3 pages →
 * deriveBusinessProfile → deriveBusinessConfig → industry/services/segment
 * inference) was retired with the legacy onboarding wizard. The config is
 * now built from the tenant's confirmed fields alone:
 *
 *   name + domain + confirmed cities (locations) + competitors
 *     → saveBusinessProfile (per-tenant file + per-tenant Supabase row)
 *
 * FAILURE-SOFT BY CONTRACT: an active tenant NEVER runs on the neutral
 * placeholder — a minimal config is always persisted. On Vercel the durable
 * Supabase write is confirmed; a failed durable write reports persist_failed
 * so the launch refuses to flip the tenant active.
 *
 * No LLM, no paid APIs, no network — deep profiling is gone; cruder is the
 * point.
 */

import { saveBusinessProfile, type BusinessProfile } from "@/lib/business-config";
import { normalizeSiteUrl } from "./fetch-site-profile";

export type LaunchConfigArgs = {
  tenantId: string;
  /** Domain as confirmed at the URL-entry step. */
  domain: string;
  typedName?: string | null;
  typedCities?: string[] | null;
  competitors?: string[] | null;
};

export type LaunchConfigResult = {
  outcome:
    | "typed_only_saved"
    | "skipped_no_domain"
    // The durable config write did NOT land. The caller MUST NOT flip the
    // tenant active — a config-less active tenant resolves PLACEHOLDER_CONFIG
    // in every downstream engine.
    | "persist_failed";
  /** Field names the config actually set (always the typed/structural set). */
  derivedFields: string[];
  /** Set when outcome is "persist_failed" — the Supabase upsert error. */
  persistError?: string;
  /** The persisted config (undefined only when skipped). */
  config?: Partial<BusinessProfile>;
};

export async function deriveAndPersistTenantConfig(
  args: LaunchConfigArgs,
): Promise<LaunchConfigResult> {
  const normalized = normalizeSiteUrl(args.domain);
  if (!normalized) {
    // No usable domain — nothing to key the config on. The URL-entry step
    // validates domains, so this is a defensive branch.
    return { outcome: "skipped_no_domain", derivedFields: [] };
  }

  const typedName = (args.typedName ?? "").trim();
  const typedCities = (args.typedCities ?? []).filter((c) => c.trim().length > 0);
  const competitors = (args.competitors ?? []).filter((c) => c.trim().length > 0);

  // Minimal config from the confirmed fields. name falls back to the domain
  // when the tenant has not typed one yet.
  const config: Partial<BusinessProfile> = {
    name: typedName || normalized.domain,
    domain: normalized.domain,
    locations: typedCities,
    primaryCompetitors: competitors,
  };

  // saveBusinessProfile merges the patch with the current profile and writes
  // the account's own Supabase row — the single durable channel. An active
  // account must never exist without a durable profile, so a failed write
  // reports persist_failed and the launch refuses to flip.
  const saved = await saveBusinessProfile(args.tenantId, config);
  if (!saved.persisted) {
    return {
      outcome: "persist_failed",
      derivedFields: [],
      persistError: saved.persistError,
    };
  }

  return {
    outcome: "typed_only_saved",
    derivedFields: Object.keys(config),
    config,
  };
}

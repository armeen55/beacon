/**
 * launch-config — minimal per-tenant config persistence (Core 100K).
 *
 * Turns "stranger confirmed a URL + name" into a PERSISTED per-tenant
 * BusinessConfig. The elaborate site-profile derivation (fetch ≤3 pages →
 * deriveBusinessProfile → deriveBusinessConfig → industry/services/segment
 * inference) was retired with the legacy onboarding wizard. The config is
 * now built from the tenant's confirmed fields alone:
 *
 *   name + domain + confirmed cities (locations) + competitors
 *     → saveBusinessConfig (per-tenant file + per-tenant Supabase row)
 *
 * FAILURE-SOFT BY CONTRACT: an active tenant NEVER runs on the neutral
 * placeholder — a minimal config is always persisted. On Vercel the durable
 * Supabase write is confirmed; a failed durable write reports persist_failed
 * so the launch refuses to flip the tenant active.
 *
 * No LLM, no paid APIs, no network — deep profiling is gone; cruder is the
 * point.
 */

import { saveBusinessConfig, type BusinessConfig } from "@/lib/business-config";
import { syncTenantBusinessConfigConfirmed } from "@/lib/persistence/dual-write";
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
  config?: Partial<BusinessConfig>;
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
  const config: Partial<BusinessConfig> = {
    name: typedName || normalized.domain,
    domain: normalized.domain,
    locations: typedCities,
    primaryCompetitors: competitors,
  };

  // saveBusinessConfig merges the patch with the current config and returns
  // the full BusinessConfig actually persisted — confirm THAT (not the patch)
  // so the durable row matches what every reader expects.
  const savedConfig = saveBusinessConfig(args.tenantId, config);

  // An active tenant must NEVER exist without a durable config. Off-Vercel the
  // per-tenant file write IS the durable channel. On Vercel the Supabase row
  // is the sole durable channel and its write is fire-and-forget — confirm it
  // landed and report persist_failed if not, so the launch refuses to flip.
  if (process.env.VERCEL === "1") {
    const persisted = await syncTenantBusinessConfigConfirmed(
      args.tenantId,
      savedConfig,
    );
    if (!persisted.ok) {
      return {
        outcome: "persist_failed",
        derivedFields: [],
        persistError: persisted.reason,
      };
    }
  }

  return {
    outcome: "typed_only_saved",
    derivedFields: Object.keys(config),
    config,
  };
}

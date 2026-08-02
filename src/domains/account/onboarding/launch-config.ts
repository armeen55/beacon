/**
 * launch-config — persist the account's first BusinessProfile at launch.
 *
 * Turns "stranger confirmed a URL + name" into a persisted canonical
 * BusinessProfile: the typed name becomes the operator-confirmed name
 * section. Domain identity is NOT written here — the Account row owns the
 * one Website. Deep profile inference (business type, topics, audiences)
 * arrives with the full onboarding build; the launch stays minimal.
 *
 * An active account must never exist without a durable profile row, so a
 * failed durable write reports persist_failed and the launch refuses to
 * flip the account active.
 */

import { saveBusinessProfile } from "@/domains/account/business-profile";
import { normalizeSiteUrl } from "./fetch-site-profile";

type LaunchConfigArgs = {
  tenantId: string;
  /** Domain as confirmed at the URL-entry step (validation only; not persisted here). */
  domain: string;
  typedName?: string | null;
};

type LaunchConfigResult = {
  outcome:
    | "typed_only_saved"
    | "skipped_no_domain"
    // The durable profile write did NOT land. The caller MUST NOT flip the
    // account active — an active account without a profile row would resolve
    // empty in every downstream engine.
    | "persist_failed";
  /** Section names the profile actually set. */
  derivedFields: string[];
  /** Set when outcome is "persist_failed" — the durable write error. */
  persistError?: string;
};

export async function deriveAndPersistTenantConfig(
  args: LaunchConfigArgs,
): Promise<LaunchConfigResult> {
  const normalized = normalizeSiteUrl(args.domain);
  if (!normalized) {
    // No usable domain — the URL-entry step validates domains, so this is a
    // defensive branch; nothing to launch against.
    return { outcome: "skipped_no_domain", derivedFields: [] };
  }

  const typedName = (args.typedName ?? "").trim();
  const name = typedName || normalized.domain;

  const saved = await saveBusinessProfile(args.tenantId, {
    name: {
      value: name,
      origin: typedName ? "operator_confirmed" : "inferred",
      confidence: typedName ? 1 : null,
      sourceUrls: [],
    },
  });
  if (!saved.persisted) {
    return {
      outcome: "persist_failed",
      derivedFields: [],
      persistError: saved.persistError,
    };
  }
  return { outcome: "typed_only_saved", derivedFields: ["name"] };
}

import "server-only";

import { createHash } from "node:crypto";

import type { BusinessProfile } from "@/domains/account/business-profile";

/**
 * onboarding/basis - THE one basis fingerprint implementation (moved here from
 * Runtime in the Slice 6 integrity closure so Runtime AND Evidence share it
 * without breaking kernel direction). The basis scopes every derived artifact:
 * prompt candidates and core sets (Runtime onboarding) and durable research
 * state (Evidence funnel). Any change to the canonical inputs mints a new
 * basis; old-basis artifacts remain inert history and can never render as
 * current, count toward readiness, or feed research.
 */

/** Bump ONLY when generation logic changes enough that old derived sets should
 *  regenerate; it is a basis input, so a bump strands every prior basis. */
const PROMPT_GENERATION_VERSION = 1;
/** Reserved separators: control chars stripped from every value, so no field
 *  can forge a boundary. */
const SEP_TOP = "\x1e", SEP_FIELD = "\x1f", SEP_LIST = "\x1d";

function normField(value: unknown): string {
  return String(value ?? "").replace(/[\x1c-\x1f]/g, "").trim().toLowerCase();
}
function normList(value: unknown): string {
  return (Array.isArray(value) ? value : [])
    .map((v) => normField(v))
    .filter(Boolean)
    .sort()
    .join(SEP_LIST);
}

/** Basis fingerprint: a stable "basis_" + 16-hex tag over the research-affecting
 *  inputs (tenant, domain, goal, generation version, confirmed profile facts,
 *  lists lowercased/trimmed/sorted). Pure and deterministic. */
export function basisTag(tenantId: string, domain: string, profile: BusinessProfile, goal: string | null): string {
  const p = profile as unknown as Record<string, { value?: unknown }>;
  const profileSegment = [
    normField(profile.name.value), normField(profile.businessType.value), normField(profile.siteArchetype.value),
    normList(p.offerings?.value), normList(p.audiences?.value), normList(p.customerProblems?.value),
    normList(p.geographicScope?.value), normList(p.topicsToOwn?.value), normList(p.topicsToExclude?.value),
  ].join(SEP_FIELD);
  const canonical = [
    normField(tenantId), normField(domain), normField(goal), String(PROMPT_GENERATION_VERSION), profileSegment,
  ].join(SEP_TOP);
  return "basis_" + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

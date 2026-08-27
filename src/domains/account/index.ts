/**
 * Account kernel — public facade.
 *
 * Owns tenant identity, membership provisioning, and the onboarding flow
 * (access gating, config derivation, first-scan dispatch). This index is the
 * ONLY surface `src/app` and
 * `src/components` may import for VALUE imports. Internal files stay private.
 */

// Canonical records: Account (identity + lifecycle), Website (domain identity),
// BusinessProfile (confirmed structured truth with per-section provenance).
export type { Account, AccountStatus, Website } from "./tenants/types";
export { websiteOf } from "./tenants/types";
export { getTenant } from "./tenants/store";
export type {
  BusinessProfile,
  ProfileSection,
  BusinessType,
  CompetitorRef,
} from "./business-profile";
export {
  loadBusinessProfile,
  saveBusinessProfile,
  emptyBusinessProfile,
  invalidateBusinessProfileCache,
  locationRegexFrom,
  serviceRegexFrom,
} from "./business-profile";

// Onboarding: provisioning + membership
export {
  provisionTenantForNewUser,
  lookupExistingMembership,
} from "./onboarding/provision-tenant";

// Account lifecycle: the ONE resolver that decides ready / incomplete /
// suspended / unavailable. Every surface gate reads it, so no signed-in
// customer can land on a dead end.
export {
  resolveAccountAccess,
  requireReadyAccount,
  AccountUnavailableError,
} from "./lifecycle";

// Onboarding: access gating + the ONE basis fingerprint (shared by Runtime and Evidence)
export { requireOnboardingTenant } from "./onboarding/access";
export { basisTag } from "./onboarding/basis";

// Onboarding: site-profile normalization
export { normalizeSiteUrl } from "./onboarding/fetch-site-profile";

// Onboarding: config derivation

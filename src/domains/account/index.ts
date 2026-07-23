/**
 * Account kernel — public facade.
 *
 * Owns tenant identity, membership provisioning, and the onboarding flow
 * (access gating, URL-first look, config derivation, first-scan dispatch,
 * first-audit scorecard). This index is the ONLY surface `src/app` and
 * `src/components` may import for VALUE imports. Internal files stay private.
 */

// Canonical records: Account (identity + lifecycle), Website (domain identity),
// BusinessProfile (confirmed structured truth with per-section provenance).
export type { Account, AccountStatus, Website } from "./tenants/types";
export { websiteOf } from "./tenants/types";
export { getTenant, getTenantBySlug } from "./tenants/store";
export type {
  BusinessProfile,
  ProfileSection,
  ProfileOrigin,
  BusinessType,
  BusinessConstraints,
  CompetitorRef,
} from "./business-profile";
export {
  loadBusinessProfile,
  saveBusinessProfile,
  emptyBusinessProfile,
  isProfileEmpty,
  locationRegexFrom,
  serviceRegexFrom,
} from "./business-profile";

// Onboarding: provisioning + membership
export {
  provisionTenantForNewUser,
  lookupExistingMembership,
  isPlaceholderBusinessName,
} from "./onboarding/provision-tenant";

// Onboarding: access gating
export { requireOnboardingTenant } from "./onboarding/access";

// Onboarding: URL-first look
export { runFirstLook, deriveNameFromDomain } from "./onboarding/url-first";

// Onboarding: site-profile normalization
export { normalizeSiteUrl } from "./onboarding/fetch-site-profile";

// Onboarding: config derivation + first-scan dispatch
export { deriveAndPersistTenantConfig } from "./onboarding/launch-config";
export { dispatchFirstScanForTenant } from "./onboarding/first-scan-dispatch";

// Onboarding: first-audit scorecard
export { composeFirstAuditScorecard } from "./onboarding/first-audit";

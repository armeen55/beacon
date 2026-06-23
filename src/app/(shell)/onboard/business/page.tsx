/**
 * /onboard/business — Gap C.1 step 1 (2026-05-07).
 *
 * First step of the onboarding wizard: business name + website.
 * Replaces the Gap B placeholder welcome screen.
 *
 * Access control:
 *   - Authenticated users with a `pending_onboarding` tenant only.
 *   - Active/paused/cancelled tenants are redirected away by
 *     `requireOnboardingTenant`.
 *
 * Persistence:
 *   - The form posts to `saveBusinessProfile` (same directory) which
 *     updates the current user's pending tenant row, then redirects to
 *     /onboard/scope.
 *   - No status flip. No prompt creation. No paid APIs.
 *
 * Customer-safe copy: no tenant/admin/RLS/schema language.
 */

import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import { isPlaceholderBusinessName } from "@/domains/onboarding/provision-tenant";
import { BusinessForm } from "./business-form";

export const dynamic = "force-dynamic";

export default async function OnboardBusinessPage() {
  const { tenant } = await requireOnboardingTenant();

  return (
    <OnboardingShell
      step={1}
      title="Set up your business"
      subtitle="Takes about 2 minutes. Tell us your business name and website. Beacon then reads your site and starts tracking how AI assistants and Google describe you. Four short steps, and your answers save as you go."
    >
      <BusinessForm
        initialBusinessName={
          // Empty out the placeholder ("New Beacon Account" / domain
          // prefix) so the operator types real input rather than
          // accepting an auto-derived guess.
          isPlaceholderBusinessName(tenant.business_name)
            ? ""
            : tenant.business_name
        }
        initialDomain={tenant.domain ?? ""}
      />
    </OnboardingShell>
  );
}

/**
 * /onboard/scope — Gap C.2 step 2 (2026-05-07).
 *
 * Service area + services. Replaces the Gap C.1 placeholder with a
 * real form: cities served (multi-line) + project mix (checkboxes).
 *
 * Access control:
 *   - Authenticated users with a pending_onboarding tenant only.
 *   - requireOnboardingTenant() handles every other case via redirect.
 *
 * Persistence:
 *   - Form posts to saveScopeProfile (same dir) which UPDATEs the
 *     current user's tenant row gated by status='pending_onboarding'.
 *   - On success → redirect to /onboard/competitors (Gap C.3 placeholder).
 *   - No status flip. No prompt creation. No paid APIs.
 *
 * Customer-safe copy: no admin/RLS/schema language.
 */

import Link from "next/link";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import type { ProjectMixTag } from "@/domains/tenants/types";
import { ScopeForm } from "./scope-form";

export const dynamic = "force-dynamic";

export default async function OnboardScopePage() {
  const ctx = await requireOnboardingTenant();

  return (
    <OnboardingShell
      step={2}
      title="Service area and services"
      subtitle="Tell us where your customers are. Beacon reads what you offer from your website."
    >
      <div className="space-y-6">
        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-2">
          <p className="font-medium">Saved so far</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Business</dt>
            <dd>{ctx.tenant.business_name}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="font-mono">{ctx.tenant.domain || "—"}</dd>
          </dl>
        </div>

        <ScopeForm
          initialCities={ctx.tenant.cities_served ?? []}
          initialProjectMix={(ctx.tenant.project_mix ?? []) as ProjectMixTag[]}
        />

        <div className="flex items-center gap-3 pt-2">
          <Link
            href="/onboard/business"
            className="text-[13px] underline text-muted-foreground"
          >
            Back: edit business details
          </Link>
        </div>
      </div>
    </OnboardingShell>
  );
}

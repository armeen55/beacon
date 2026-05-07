/**
 * /onboard/competitors — Gap C.3 step 3 (2026-05-07).
 *
 * Replaces the Gap C.2 placeholder with a real form: 1-5 builders the
 * operator wants Beacon to compare them against.
 *
 * Access control:
 *   - Authenticated users with a pending_onboarding tenant only.
 *   - requireOnboardingTenant() handles every other case via redirect.
 *
 * Persistence:
 *   - Form posts to saveCompetitorsProfile (same dir) which UPDATEs the
 *     current user's tenant row gated by status='pending_onboarding'.
 *   - On success → redirect to /onboard/review (Gap C.3 placeholder
 *     for the future Launch step).
 *   - No status flip. No prompt creation. No paid APIs.
 *
 * Customer-safe copy: no admin/RLS/schema language.
 */

import Link from "next/link";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import {
  PROJECT_MIX_LABELS,
} from "@/domains/onboarding/scope-validation";
import type { ProjectMixTag } from "@/domains/tenants/types";
import { CompetitorsForm } from "./competitors-form";

export const dynamic = "force-dynamic";

export default async function OnboardCompetitorsPage() {
  const ctx = await requireOnboardingTenant();

  const cities = ctx.tenant.cities_served ?? [];
  const projectMix = (ctx.tenant.project_mix ?? []) as ProjectMixTag[];

  return (
    <OnboardingShell
      step={3}
      title="Competitors to watch"
      subtitle="Pick the builders you want Beacon to compare you against."
    >
      <div className="space-y-6">
        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-3">
          <p className="font-medium">Saved so far</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Business</dt>
            <dd>{ctx.tenant.business_name}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="font-mono">{ctx.tenant.domain || "—"}</dd>
            <dt className="text-muted-foreground">Cities</dt>
            <dd>{cities.length ? cities.join(", ") : "—"}</dd>
            <dt className="text-muted-foreground">Work</dt>
            <dd>
              {projectMix.length
                ? projectMix.map((t) => PROJECT_MIX_LABELS[t]).join(", ")
                : "—"}
            </dd>
          </dl>
        </div>

        <CompetitorsForm
          initialCompetitors={ctx.tenant.discovered_competitors ?? []}
        />

        <div className="flex items-center gap-3 pt-2">
          <Link
            href="/onboard/scope"
            className="text-[13px] underline text-muted-foreground"
          >
            Back: edit service area
          </Link>
        </div>
      </div>
    </OnboardingShell>
  );
}

/**
 * /onboard/competitors — Gap C.2 step 3 placeholder (2026-05-07).
 *
 * After step 2 (cities + services) saves, we redirect here. This step
 * (top 3 competitors to track) gets its real form in Gap C.3 — for now
 * it's a placeholder that:
 *
 *   - confirms step 2 saved by echoing cities + project mix back
 *   - previews step 3 without collecting any inputs
 *   - keeps the same access guard (pending_onboarding only)
 *
 * No data collection. No paid APIs. No status flip. No prompt creation.
 */

import Link from "next/link";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import {
  PROJECT_MIX_LABELS,
} from "@/domains/onboarding/scope-validation";
import type { ProjectMixTag } from "@/domains/tenants/types";

export const dynamic = "force-dynamic";

export default async function OnboardCompetitorsPage() {
  const { tenant } = await requireOnboardingTenant();

  const cities = tenant.cities_served ?? [];
  const projectMix = (tenant.project_mix ?? []) as ProjectMixTag[];

  return (
    <OnboardingShell
      step={3}
      title="Competitors to watch"
      subtitle="Next we'll pick which builders you want Beacon to compare you against."
    >
      <div className="space-y-4">
        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-3">
          <p className="font-medium">Saved so far</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Business</dt>
            <dd>{tenant.business_name}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="font-mono">{tenant.domain || "—"}</dd>
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

        <div className="rounded-md border border-foreground/10 bg-surface-inset/40 p-4 text-[13px] space-y-2">
          <p className="font-medium">Coming up in this step</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li>Pick 3-5 competitors you want Beacon to track</li>
            <li>We'll suggest some based on your area + work mix</li>
          </ul>
          <p className="text-[12px] text-muted-foreground pt-2">
            We'll wire the form for these next. Today this page just confirms
            step 2 landed.
          </p>
        </div>

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

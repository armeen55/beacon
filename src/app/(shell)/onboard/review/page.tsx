/**
 * /onboard/review — Gap C.3 step 4 placeholder (2026-05-07).
 *
 * After step 3 (competitors) saves, we redirect here. This step is
 * "Review and launch" — Gap C.4 will replace this placeholder with
 * the real Launch step. Today it:
 *
 *   - shows the full saved-so-far summary (business + website + cities
 *     + services + competitors)
 *   - says what comes next ("review and launch") without exposing a
 *     Launch button
 *   - does NOT activate the tenant
 *   - does NOT generate prompts
 *   - does NOT call paid APIs
 *
 * Access guard: same as the rest of /onboard/* — only
 * status=pending_onboarding tenants land here.
 */

import Link from "next/link";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import { PROJECT_MIX_LABELS } from "@/domains/onboarding/scope-validation";
import type { ProjectMixTag } from "@/domains/tenants/types";

export const dynamic = "force-dynamic";

export default async function OnboardReviewPage() {
  const { tenant } = await requireOnboardingTenant();

  const cities = tenant.cities_served ?? [];
  const projectMix = (tenant.project_mix ?? []) as ProjectMixTag[];
  const competitors = tenant.discovered_competitors ?? [];

  return (
    <OnboardingShell
      step={4}
      title="Review and launch"
      subtitle="Here's everything we have. Next step adds a Launch button to start your first reading."
    >
      <div className="space-y-4">
        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-3">
          <p className="font-medium">Your business</p>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Business</dt>
            <dd>{tenant.business_name || "—"}</dd>
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
            <dt className="text-muted-foreground">Competitors</dt>
            <dd>{competitors.length ? competitors.join(", ") : "—"}</dd>
          </dl>
        </div>

        <div className="rounded-md border border-foreground/10 bg-surface-inset/40 p-4 text-[13px] space-y-2">
          <p className="font-medium">Next: review and launch</p>
          <p className="text-muted-foreground">
            We're wiring up the Launch step next. When it's ready, you'll
            confirm the details above and Beacon will start watching how
            AI search engines describe you. Your first reading lands the
            following morning.
          </p>
          <p className="text-[12px] text-muted-foreground pt-2">
            Today this page just confirms steps 1-3 saved.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Link
            href="/onboard/competitors"
            className="text-[13px] underline text-muted-foreground"
          >
            Back: edit competitors
          </Link>
        </div>
      </div>
    </OnboardingShell>
  );
}

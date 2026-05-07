/**
 * /onboard/scope — Gap C.1 step 2 placeholder (2026-05-07).
 *
 * After step 1 (business name + website) saves, we redirect here.
 * This step (cities served + services / project mix) gets its real
 * form in Gap C.2 — for now it's a placeholder that:
 *
 *   - confirms step 1 saved by echoing the business name + domain back
 *     to the operator
 *   - shows what's next without collecting any inputs
 *   - keeps the same access guard (only pending_onboarding tenants)
 *
 * No data collection. No paid APIs. No status flip.
 */

import Link from "next/link";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";

export const dynamic = "force-dynamic";

export default async function OnboardScopePage() {
  const { tenant } = await requireOnboardingTenant();

  return (
    <OnboardingShell
      step={2}
      title="Service area and services"
      subtitle="Next we'll capture which cities and services you focus on."
    >
      <div className="space-y-4">
        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-2">
          <p className="font-medium">Saved so far</p>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Business</dt>
            <dd>{tenant.business_name}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="font-mono">{tenant.domain || "—"}</dd>
          </dl>
        </div>

        <div className="rounded-md border border-foreground/10 bg-surface-inset/40 p-4 text-[13px] space-y-2">
          <p className="font-medium">Coming up in this step</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li>Cities you serve (e.g. Atherton, Menlo Park)</li>
            <li>The kind of work you take on (whole-home, kitchen/bath, ADUs…)</li>
          </ul>
          <p className="text-[12px] text-muted-foreground pt-2">
            We'll wire the form for these next. Today this page just confirms
            step 1 landed.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Link
            href="/onboard/business"
            className="text-[13px] underline text-muted-foreground"
          >
            Edit business details
          </Link>
        </div>
      </div>
    </OnboardingShell>
  );
}

/**
 * /onboard/review — Gap C.4 step 4 (2026-05-07).
 *
 * Final review + Launch. Replaces the Gap E.1 preview-only surface
 * with the actual Launch step:
 *
 *   - shows the full saved-so-far summary (business + website + cities
 *     + services + competitors)
 *   - generates a deterministic preview of the prompts Beacon will
 *     start tracking (up to 25)
 *   - groups the preview by family (brand / competitor / city / cost)
 *   - presents the TOS checkbox + Launch button (LaunchForm)
 *   - on Launch, the server action `launchTenant`:
 *       1. inserts the prompts into tracked_prompts (account_id=slug)
 *       2. flips tenants.status from 'pending_onboarding' → 'active'
 *       3. sets tos_accepted_at + updated_at
 *       4. redirects to /today
 *
 * The Launch step is the FIRST and ONLY code path that flips status
 * to 'active'. Before this fires, the tenant is invisible to cron.
 *
 * Access guard: only status=pending_onboarding tenants land here.
 * Already-launched tenants are redirected to /today by the access
 * guard (or by launchTenant if they retry the action).
 *
 * Page itself does NOT mutate. The LaunchForm posts to the server
 * action which owns the writes.
 */

import Link from "next/link";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import { PROJECT_MIX_LABELS } from "@/domains/onboarding/scope-validation";
import {
  generateStarterPrompts,
  type PromptCategory,
  type PromptDraft,
} from "@/domains/onboarding/prompt-generator";
import type { ProjectMixTag } from "@/domains/tenants/types";
import { LaunchForm } from "./launch-form";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<PromptCategory, string> = {
  brand_discovery: "Brand searches",
  competitor_comparison: "Head-to-head with competitors",
  service_in_city: "City + service queries",
  cost_query: "Cost questions",
};

const CATEGORY_ORDER: PromptCategory[] = [
  "brand_discovery",
  "competitor_comparison",
  "service_in_city",
  "cost_query",
];

export default async function OnboardReviewPage() {
  const { tenant } = await requireOnboardingTenant();

  const cities = tenant.cities_served ?? [];
  const projectMix = (tenant.project_mix ?? []) as ProjectMixTag[];
  const competitors = tenant.discovered_competitors ?? [];

  // Pure generation — no I/O, no DB write. Re-derived per render.
  const drafts = generateStarterPrompts({
    businessName: tenant.business_name ?? "",
    domain: tenant.domain ?? "",
    citiesServed: cities,
    projectMix,
    competitors,
  });

  const grouped: Record<PromptCategory, PromptDraft[]> = {
    brand_discovery: [],
    competitor_comparison: [],
    service_in_city: [],
    cost_query: [],
  };
  for (const d of drafts) {
    grouped[d.category].push(d);
  }

  return (
    <OnboardingShell
      step={4}
      title="Review and launch"
      subtitle="Beacon will start tracking these prompts the next time you refresh your connected data."
    >
      <div className="space-y-5">
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

        {drafts.length === 0 ? (
          <div className="rounded-md border border-foreground/10 bg-surface-inset/40 p-4 text-[13px]">
            <p className="font-medium">No starter prompts yet</p>
            <p className="text-muted-foreground pt-1">
              Add a business name, at least one city, and at least one work
              type — Beacon needs those to draft starter prompts.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-medium">
                Starter prompts ({drafts.length})
              </p>
              <p className="text-[12px] text-muted-foreground">
                Drafted from your inputs — you can edit later.
              </p>
            </div>

            {CATEGORY_ORDER.map((cat) => {
              const list = grouped[cat];
              if (list.length === 0) return null;
              return (
                <div key={cat} className="space-y-2">
                  <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABELS[cat]}{" "}
                    <span className="font-mono normal-case">
                      ({list.length})
                    </span>
                  </p>
                  <ul className="space-y-1.5">
                    {list.map((p) => (
                      <li
                        key={p.priority}
                        className="rounded-md border border-foreground/10 px-3 py-2 text-[13px]"
                      >
                        <span className="font-mono">{p.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <LaunchForm promptCount={drafts.length} />

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

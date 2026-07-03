/**
 * /onboard - the URL-first entry (2026-07-03, BEACON_500 R12 / T0e).
 *
 * One field: the site address. Submitting derives the name and domain,
 * saves them to the pending tenant, persists the first business config,
 * runs the bounded first-look scan (discovery + one crawl batch + day-0
 * baselines), and lands on /onboard/done with an honest scorecard.
 *
 * The guided four-step wizard still exists (/onboard/business); this page
 * links to it for anyone who prefers typing details first. Access control
 * matches every other onboard step: pending_onboarding tenants only.
 */

import Link from "next/link";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import { UrlFirstForm } from "./url-form";

export const dynamic = "force-dynamic";
// The submit action runs a polite bounded crawl of the stranger's site
// (discovery + one batch + $0 baselines). Same ceiling as /onboard/review.
export const maxDuration = 60;

export default async function OnboardUrlFirstPage() {
  const { tenant } = await requireOnboardingTenant();

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            What site do you want to grow?
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Give me one address. I read your pages, score what I find, and
            hand you the first change worth making. No code on your site,
            nothing published without your approval.
          </p>
        </div>
        <UrlFirstForm initialUrl={tenant.domain ?? ""} />
        <p className="text-[12px] text-muted-foreground pt-2">
          Prefer to type your details first?{" "}
          <Link href="/onboard/business" className="underline">
            Start with the guided steps
          </Link>
          . Your answers save as you go either way.
        </p>
      </div>
    </div>
  );
}

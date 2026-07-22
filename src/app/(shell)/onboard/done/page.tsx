/**
 * /onboard/done - the first-audit scorecard (2026-07-03, BEACON_500 R12/T0e).
 *
 * What the URL-first signup lands on: what I found (pages read, missing
 * titles and descriptions, thin pages, questions), the FIRST recommended
 * change argued from the scanned data alone, the day-0 baseline receipts,
 * a skippable Search Console offer, a Keep scanning continuation, and the
 * finish-setup checklist (the shared R3 card). An unreachable site renders
 * a clear sentence + retry, never a blank screen.
 *
 * Accessible to pending AND active tenants (allowActive): the scorecard
 * stays readable right after launch.
 */

import Link from "next/link";
import { requireOnboardingTenant } from "@/domains/onboarding/access";
import { loadCrawlFrontier } from "@/domains/scanning/crawl-frontier";
import { composeFirstAuditScorecard } from "@/domains/onboarding/first-audit";
import { ConnectGscCard } from "./connect-gsc-card";
import { LaunchButton } from "./launch-button";
import { keepScanningAction, retryFirstLookAction } from "./actions";

export const dynamic = "force-dynamic";
// No page-level maxDuration override: this route INHERITS the (shell) layout's
// 300s ceiling so the layout's post-response autonomous cycle is never killed
// early (a 60s cap left the status UI stuck on "working"). Keep scanning's one
// bounded crawl batch (max 15 pages / 45s) still finishes far under that.

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-foreground/15 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

export default async function OnboardDonePage() {
  const { tenant, tenantId } = await requireOnboardingTenant({ allowActive: true });
  const state = await loadCrawlFrontier(tenantId);

  // No first look yet: honest empty state, never a blank screen.
  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-4" data-first-audit="empty">
          <h1 className="text-2xl font-semibold tracking-tight">
            I have not read your site yet
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Give me your site address and I will read it page by page, then
            hand you the first change worth making.
          </p>
          <Link
            href="/onboard"
            className="inline-block rounded-md bg-foreground text-background px-4 py-2 text-[14px] font-medium"
          >
            Enter your site address
          </Link>
        </div>
      </div>
    );
  }

  const card = composeFirstAuditScorecard(state);

  // Unreachable site: a clear sentence + retry.
  if (card.status === "unreachable") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-4" data-first-audit="unreachable">
          <h1 className="text-2xl font-semibold tracking-tight">
            I could not read {card.domain}
          </h1>
          <p className="text-[14px] text-muted-foreground">
            Your site did not answer when I tried to read its pages. Check
            that it loads in a browser, then try again. If it uses a
            crawler block, allow BeaconBot in robots.txt first.
          </p>
          <form action={retryFirstLookAction}>
            <button
              type="submit"
              className="rounded-md bg-foreground text-background px-4 py-2 text-[14px] font-medium"
            >
              Try again
            </button>
          </form>
          <p className="text-[12px] text-muted-foreground">
            Wrong address?{" "}
            <Link href="/onboard" className="underline">
              Enter a different one
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const launched = tenant.status === "active";

  return (
    <div className="min-h-screen flex justify-center px-6 py-12">
      <div className="w-full max-w-2xl space-y-8" data-first-audit="scorecard">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Here is what I found on {card.domain}
          </h1>
          <p className="text-[14px] text-muted-foreground">{card.progressLine}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Pages I read" value={card.pagesRead} />
          <Stat label="Missing search descriptions" value={card.missingDescription} />
          <Stat label="Thin pages" value={card.thinPages} />
          <Stat label="Questions your site answers" value={card.questionsFound} />
        </div>

        {card.firstWin ? (
          <div
            className="rounded-md border border-foreground/25 p-4 space-y-2"
            data-first-audit-win={card.firstWin.action}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Your first win
            </p>
            <p className="text-[15px] font-semibold">{card.firstWin.action}</p>
            <p className="text-[13px] text-muted-foreground">{card.firstWin.plainWhy}</p>
            <p className="text-[13px]">{card.firstWin.exactFix}</p>
            <a
              href={card.firstWin.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-[13px] underline"
            >
              Open the page
            </a>
          </div>
        ) : card.pagesRead > 0 ? (
          <div className="rounded-md border border-foreground/15 p-4">
            <p className="text-[13px]">
              The pages I read so far look structurally sound. I will have a
              sharper first recommendation once I finish reading your site and
              see real search data.
            </p>
          </div>
        ) : null}

        {(card.seededQuestions || card.serpTerms.length > 0) && (
          <p className="text-[13px] text-muted-foreground">
            {card.seededQuestions
              ? "I saved the questions your site answers so I can track how AI assistants answer them. "
              : ""}
            {card.serpTerms.length > 0
              ? `I also lined up a Google check for ${card.serpTerms.length} of your strongest topics.`
              : ""}
          </p>
        )}

        {card.status === "in_progress" ? (
          <form action={keepScanningAction}>
            <button
              type="submit"
              className="rounded-md border border-foreground/25 px-4 py-2 text-[13px] font-medium"
            >
              Keep scanning now
            </button>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Each click reads up to 15 more pages. I also keep reading a few
              more each time you use Beacon, until I have read everything, up to
              150 pages.
            </p>
          </form>
        ) : null}

        <ConnectGscCard domain={card.domain} />

        {!launched ? (
          <LaunchButton />
        ) : (
          <p className="text-[13px]">
            You are live.{" "}
            <Link href="/" className="underline">
              Open your dashboard
            </Link>{" "}
            to see today&apos;s plan.
          </p>
        )}

        </div>
    </div>
  );
}

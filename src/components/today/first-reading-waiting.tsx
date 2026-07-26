/**
 * first-reading-waiting — Gap F.1 (2026-05-07).
 *
 * The "Beacon is preparing your first reading" surface that /today
 * renders when a freshly launched tenant has prompts but no
 * observations yet.
 *
 * Pivot framing (2026-06-14, audit #22): Beacon leads with your site's
 * own search demand + content, and tracks AI-answer visibility as one
 * additional signal — so the copy no longer positions the whole product
 * as an "AI visibility" reading. Claims here stay generic ("your first
 * reading") because this fresh-tenant screen can't assume which
 * connectors (GSC/GA4) are wired yet.
 *
 * Pure presentation. Receives a context object from the resolver.
 * No data fetch, no client interactivity beyond the in-page link.
 *
 * Customer-safe copy: explains what's happening + what's already set
 * up + what to do next ("Review tracked prompts"). NEVER mentions
 * cron / 07:00 UTC / GitHub / Supabase / poll / observations.
 */

import Link from "next/link";
import type { FirstReadingContext } from "@/domains/account/onboarding/first-reading-state";

export function FirstReadingWaiting({
  context,
}: {
  context: FirstReadingContext;
}) {
  return (
    <div
      className="min-h-[70vh] flex items-center justify-center px-6 py-12"
      role="status"
      data-today-first-reading="true"
    >
      <div className="w-full max-w-xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Beacon is preparing your first reading.
          </h1>
          <p className="text-[14px] text-muted-foreground">
            I am reading your site and checking how AI assistants answer your
            questions. This fills in while you are signed in. Connecting Google
            Search Console makes the first reading sharper.
          </p>
          <Link
            href="/settings/connectors"
            className="inline-flex items-center rounded-md bg-accent-primary px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-primary/90"
          >
            Connect your data sources →
          </Link>
        </div>

        <div className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-3">
          <p className="font-medium">What&apos;s already set up</p>
          <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Business</dt>
            <dd>{context.businessName}</dd>
            {context.domain ? (
              <>
                <dt className="text-muted-foreground">Website</dt>
                <dd className="font-mono">{context.domain}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Questions I track</dt>
            <dd>
              {context.promptCount}{" "}
              <span className="text-muted-foreground">
                {context.promptCount === 1 ? "question" : "questions"} ready
              </span>
            </dd>
            <dt className="text-muted-foreground">Next reading</dt>
            <dd>{context.nextReadingDescription}</dd>
          </dl>
        </div>

        {context.derived &&
        (context.derived.industry ||
          context.derived.locations.length > 0 ||
          context.derived.serviceCount > 0) ? (
          <div
            className="rounded-md border border-foreground/15 p-4 text-[13px] space-y-3"
            data-today-derived-profile="true"
          >
            <p className="font-medium">What Beacon learned from your site</p>
            <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-[13px]">
              {context.derived.industry ? (
                <>
                  <dt className="text-muted-foreground">Business type</dt>
                  <dd className="capitalize">{context.derived.industry}</dd>
                </>
              ) : null}
              {context.derived.locations.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">Areas served</dt>
                  <dd>
                    {context.derived.locations.slice(0, 6).join(", ")}
                    {context.derived.locations.length > 6
                      ? ` +${context.derived.locations.length - 6} more`
                      : ""}
                  </dd>
                </>
              ) : null}
              {context.derived.serviceCount > 0 ? (
                <>
                  <dt className="text-muted-foreground">Services found</dt>
                  <dd>{context.derived.serviceCount}</dd>
                </>
              ) : null}
              {context.derived.keyPageCount > 0 ? (
                <>
                  <dt className="text-muted-foreground">Key pages</dt>
                  <dd>{context.derived.keyPageCount}</dd>
                </>
              ) : null}
            </dl>
            <p className="text-[12px] text-muted-foreground">
              Detected from your website during setup, you can adjust any of
              this later in Settings.
            </p>
          </div>
        ) : null}

        <div className="rounded-md border border-foreground/10 bg-surface-inset/40 p-4 text-[13px] space-y-2">
          <p className="font-medium">What happens next</p>
          <ol className="list-decimal pl-5 text-muted-foreground space-y-1">
            <li>
              <Link
                href="/settings/connectors"
                className="font-medium text-foreground underline underline-offset-2 hover:text-accent-primary"
              >
                Connect your sources
              </Link>: Google Search Console plus optional GA4 or
              Clarity.
            </li>
            <li>
              Stay signed in: I read your pages and check how AI assistants
              answer your questions while you use Beacon, then fill this
              dashboard with your search demand and who you get compared to.
            </li>
            <li>
              Review your recommendations: once your first reading comes in,
              you&apos;ll see suggestions for the next move you can make.
            </li>
          </ol>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Link
            href="/changes"
            className="text-[13px] underline"
          >
            See your changes
          </Link>
        </div>
      </div>
    </div>
  );
}

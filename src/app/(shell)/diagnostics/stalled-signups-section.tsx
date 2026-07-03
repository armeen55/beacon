/**
 * stalled-signups-section (2026-07-03, BEACON_500 R12 / T0e) - the operator
 * rescue surface for signups that went quiet.
 *
 * Self-hiding: renders nothing when no pending signup is stalled (the
 * common case). Each stalled row shows the honest stage, the recovery
 * map's plain problem + exact fix, and where possible the one-click
 * resume (a bounded first read or one more crawl batch, right here).
 * Fail-soft: a loader error hides the section rather than breaking the
 * operator page.
 */

import { loadStalledSignups, type StalledSignup } from "@/domains/onboarding/stalled-signups";
import { resumeStalledSignupAction } from "./stalled-signup-actions";

const STAGE_LABEL: Record<StalledSignup["stage"], string> = {
  no_site_url: "No site address",
  no_scan: "First read never ran",
  scan_stalled: "First read stalled",
  site_unreachable: "Site did not answer",
};

export async function StalledSignupsSection() {
  let stalled: StalledSignup[] = [];
  try {
    stalled = await loadStalledSignups();
  } catch {
    return null;
  }
  if (stalled.length === 0) return null;

  return (
    <div data-diagnostic="stalled-signups">
      <h3 className="text-sm font-semibold tracking-tight text-foreground mb-2">
        Stalled signups
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        {stalled.length === 1 ? "1 signup" : `${stalled.length} signups`} started
        more than a day ago and never got a first look at their site. Each row
        names the exact fix.
      </p>
      <ul className="space-y-2">
        {stalled.map((s) => (
          <li
            key={s.tenantId}
            data-stalled-signup={s.tenantId}
            className="rounded-md border border-border/50 bg-surface px-3 py-2.5 text-[13px]"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{s.businessName || s.tenantId}</span>
              <span className="text-muted-foreground">
                {s.domain || "no domain"} · {STAGE_LABEL[s.stage]} · quiet for {s.stalledHours}h
                {s.pagesRead > 0 ? ` · ${s.pagesRead} pages read` : ""}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">{s.recovery.plainProblem}</p>
            <p className="mt-0.5">{s.recovery.exactFix}</p>
            {s.recovery.resume ? (
              <form action={resumeStalledSignupAction} className="mt-2">
                <input type="hidden" name="tenantId" value={s.recovery.resume.tenantId} />
                <input type="hidden" name="kind" value={s.recovery.resume.kind} />
                <button
                  type="submit"
                  className="rounded-md border border-foreground/25 px-3 py-1.5 text-[12px] font-medium"
                >
                  {s.recovery.resume.kind === "start_first_look"
                    ? s.stage === "site_unreachable"
                      ? "Try the first read again"
                      : "Run the first read"
                    : "Continue reading"}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

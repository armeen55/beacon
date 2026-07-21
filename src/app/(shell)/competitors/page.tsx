import { redirect } from "next/navigation";

/**
 * /competitors (FP10b, 2026-07-02) - retired as a top-level destination. The
 * diagnosis found this page was a shell whose promised content ("who AI cites
 * instead of you") lives as backend evidence feeding the Changes queue (the AI
 * questions surface) - and the rest of this page was operator job-trigger
 * buttons, not customer intelligence. That real intelligence now renders as
 * competitor citation evidence rendered on Changes cards
 * (competitor-rivals-section.tsx), sourced from the same loadCompetitorIntel
 * data this page used to render. The job-trigger buttons and the outreach
 * pipeline moved to /diagnostics/competitor-intel, the operator-only surface.
 *
 * This redirect keeps old bookmarks and links working.
 */
export default function CompetitorsPage() {
  redirect("/changes");
}

/**
 * InvestigationAlertLine (2026-07-21, Phase 4D fold of master-plan item 53) - the
 * overnight forensic investigation's ONE headline conclusion, as a single compact
 * alert line in Today's self-hiding alert lane (beside the circuit breaker), NOT a
 * drawer card. The producer (runInvestigationForTenant, called from the on-visit
 * enrichment cycle) is unchanged; this is a $0 persisted read of its latest
 * conclusion.
 *
 * Copy contract (the Beacon voice): first person, a concrete finding, and one next
 * step. When the ranker found a page-specific cause, that cause (and its implied
 * action) is the conclusion. When it found none, the line says so plainly instead
 * of inventing one. Self-hides when there is no fresh investigation, fails soft to
 * null, dark-mode + 375px safe.
 */
import Link from "next/link";
import { loadLatestInvestigations } from "@/domains/investigation/investigation-store";

/** "/nowruz" stays "/nowruz"; a bare "nowruz" family label gets a leading slash so
 *  the line always names a path. PURE. */
function asPath(familyLabel: string): string {
  const trimmed = familyLabel.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function InvestigationAlertLine({ tenantId }: { tenantId: string }) {
  try {
    const rows = await loadLatestInvestigations(tenantId, 1);
    const row = rows[0];
    if (!row) return null;
    const d = row.diagnosis;
    const family = asPath(d.familyLabel);
    const topCause = d.causes[0] ?? null;
    // The conclusion: the top ranked page-specific cause when the ranker found one
    // (with the one action it implies), otherwise the honest "no clear cause" answer.
    const conclusion = topCause
      ? `${topCause.sentence}${topCause.actionSentence ? ` ${topCause.actionSentence}` : ""}`
      : "I checked the page, the crawlers, recent changes, and site-wide shifts, and found no clear cause. I would look at this one by hand.";
    return (
      <section
        aria-label="Background investigation"
        className="rounded-lg border border-status-warning/40 bg-status-warning-bg px-4 py-2.5"
      >
        <p className="min-w-0 break-words text-body leading-relaxed text-foreground tabular-nums">
          I looked into the clicks drop on {family}: {conclusion}{" "}
          <Link
            href="/changes"
            className="font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Review in Changes
          </Link>
        </p>
      </section>
    );
  } catch {
    return null;
  }
}

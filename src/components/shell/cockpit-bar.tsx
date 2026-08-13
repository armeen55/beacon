import "server-only";

/**
 * CockpitBar (FINAL PREMIUM PLAN item 20) - the header becomes a cockpit: business name,
 * the scoreboard number (7-day clicks + delta), an honest data-freshness dot, and the one
 * primary action. Server component composed into the client AppHeader via rightSlot.
 * Fail-soft: any load error renders nothing (the header never breaks).
 */

import { monthDayLabel } from "@/components/data/receipt-line";
import { currentTenantId } from "@/lib/tenant-context";
import { getTenant, websiteOf, loadBusinessProfile } from "@/domains/account";
import { loadDailyTotalsForTenant } from "@/domains/decision";
import { loadWithDeadline } from "@/lib/load-with-deadline";

const DAY_MS = 86_400_000;

export async function CockpitBar() {
  try {
    // FP1 (2026-07-02) - deadline-bounded: this streams in the header on EVERY
    // signed-in page, and an unbounded read here held the whole HTTP stream open
    // (the ground-truth curl saw this exact boundary pending at 60s). Past the
    // deadline the bar just stays empty this navigation; the header never waits.
    const raced = await loadWithDeadline(
      currentTenantId().then((tenantId) =>
        Promise.all([
          getTenant(tenantId).catch(() => null),
          loadDailyTotalsForTenant(tenantId, 21).catch(() => []),
          loadBusinessProfile(tenantId).catch(() => null),
        ] as const),
      ),
    );
    if (raced.timedOut) return null;
    const [tenant, daily, profile] = raced.data;
    // Canonical business name: the confirmed BusinessProfile, falling back to
    // the Website domain, never the provisional signup seed.
    const displayName =
      profile?.name.value.trim() || (tenant ? websiteOf(tenant).domain : "");
    const rows = [...daily].sort((a, b) => a.date.localeCompare(b.date));
    const lastDate = rows.length >= 8 ? rows[rows.length - 1]!.date : null;
    const lagDays = lastDate ? Math.round((Date.now() - Date.parse(lastDate + "T00:00:00Z")) / DAY_MS) : null;
    // Honest freshness: Google reports 2-3 days behind by design, so <= 4 days is healthy.
    const dot = lagDays == null ? null : lagDays <= 4 ? "bg-status-success" : lagDays <= 7 ? "bg-status-warning" : "bg-status-danger";
    // A STORED DATE IS NEVER PRINTED AS IT WAS WRITTEN: this tooltip said "through 2026-08-09" on every
    // signed-in page, which is a machine's way of naming a day and nobody else's.
    const through = monthDayLabel(lastDate);
    const dotTitle =
      lagDays == null || through == null
        ? null
        : lagDays <= 4
        ? `Search data current through ${through}. Google reports a few days behind, so this is healthy.`
        : `Search data stops at ${through}, ${lagDays} days ago. The connection may need attention.`;
    // Wave 3B (2026-07-10) - the 7-day clicks number and week-over-week delta were DROPPED from
    // this header bar. That same number lived in two places on Today (here AND the scoreboard
    // section), each computed independently, so a rounding or window difference could show the
    // operator two answers for one number ("731 / -14%" twice). The scoreboard section (and the
    // ONE Today command) is now the single owner of that number; the header keeps only the
    // at-a-glance freshness dot so a stale connection is still visible everywhere.
    return (
      <div className="flex items-center gap-3 text-[12px] tabular-nums">
        {displayName ? (
          <span className="hidden font-semibold text-foreground sm:inline">{displayName}</span>
        ) : null}
        {dot && dotTitle ? (
          <span className="inline-flex items-center gap-1.5" title={dotTitle}>
            <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
            <span className="text-muted-foreground">Search data</span>
          </span>
        ) : null}
        {/* The black "Changes" button moved to AppHeader (2026-08-12): it rendered on /changes too, sending
            a customer to the page they were already standing on. Only the client header knows the route. */}
      </div>
    );
  } catch {
    return null;
  }
}

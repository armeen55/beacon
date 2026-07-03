export const dynamic = "force-dynamic"; // shell layout reads tenant context (Supabase) - force the whole shell subtree dynamic so NO page prerenders at build (avoids build-time "Invalid API key")

import { ShellProvider, ShellDataHydrator, type NavBadges, type LatePaletteItem } from "@/components/shell/shell-provider";
import { AppSidebar, MobileSidebar } from "@/components/shell/app-sidebar";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { Suspense } from "react";
import { CockpitBar } from "@/components/shell/cockpit-bar";
import { AppHeader } from "@/components/shell/app-header";
import { CommandPalette, type PaletteItem } from "@/components/shell/command-palette";
import { DemoBannerGate } from "@/components/shell/demo-banner";
import { getConnectorInfo } from "@/lib/connector-store";
import {
  getChangelogEntries,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { allNavItems } from "@/lib/navigation";
import { getPendingFindings } from "@/domains/scanning/findings-store";
import {
  CONTENT_CHANGE_TYPES,
  BUG_FINDING_TYPES,
} from "@/domains/scanning/content-change-types";
import {
  getWatchingUrlOutcomes,
  ensureUrlChangeOutcomesSeeded,
} from "@/domains/attribution/url-change-outcome";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { currentTenantId } from "@/lib/tenant-context";
import { scheduleConnectorAutoRefresh } from "@/lib/connectors/auto-refresh-on-use";
import { loadWithDeadline } from "@/lib/load-with-deadline";

// T-CustomerNav (2026-05-08) - keys aligned with `navigationGroups`
// in `src/lib/navigation.ts`. Pre-T-CustomerNav this map carried
// dead entries for routes hidden from the sidebar 2026-04-17 /
// 2026-04-22 (/pages, /local, and the competitor map).
//
// 2026-06-14 - these palette labels MUST match the actual g+<key>
// handler in `command-palette.tsx`. Previously this map advertised
// `G R` / `G P` next to Recommendations / Prompts and omitted
// Connectors entirely, while the handler only fired on t/c/s - so
// the palette promised shortcuts that did nothing and hid the one
// new customer surface. Now all six customer routes carry the exact
// key the handler implements (`g+k` → Connectors). Keep this in
// lockstep with the handler + the help dialog; the architecture test
// `customer-nav-exposure.test.ts` enforces no hidden routes.
const NAV_SHORTCUTS: Record<string, string> = {
  "/": "G T",
  // FP4 (2026-07-03): URLs now match nav labels, so the letters follow the
  // names. G C = Changes (/changes), G E = Results (/results).
  "/changes": "G C",
  "/results": "G E",
  "/ask": "G A",
  "/prompts": "G P",
  "/settings/connectors": "G K",
  "/settings": "G S",
};

const CHANGELOG_PALETTE_CAP = 50;

/** FP1 (2026-07-02) - the six Supabase reads behind badges/demo/palette get this
 *  long, TOTAL, before the shell gives up on them for this navigation. The shell
 *  itself has already painted by then; a wedged read only costs the badges. */
const SHELL_DATA_DEADLINE_MS = 8000;

/**
 * FP1 (2026-07-02) - the shell paints INSTANTLY. Every Supabase read this layout
 * used to await before returning (badge counts, demo-mode detection, changelog
 * palette entries: the audit counted 6 blocking awaits taxing EVERY signed-in
 * click) now lives in <DeferredShellData/>, streamed behind Suspense AFTER the
 * nav/header/page shell is on the wire. Badges and the demo banner hydrate
 * client-side when the data lands; if it never lands, the app still works.
 */
export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isOperator = isOperatorModeServer();

  // Static palette entries only (nav routes, zero I/O). The changelog "Results"
  // group streams in with the deferred shell data below.
  const paletteItems: PaletteItem[] = allNavItems.map((n) => ({
    id: `nav-${n.href}`,
    label: n.label,
    group: "Navigate",
    href: n.href,
    shortcut: NAV_SHORTCUTS[n.href],
  }));

  return (
    <ShellProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-background"
      >
        Skip to content
      </a>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar isOperator={isOperator} />
        <MobileSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader rightSlot={<Suspense fallback={null}><CockpitBar /></Suspense>} />
          <main
            id="main-content"
            aria-label="Main content"
            // #524 - tabIndex={-1} so the "Skip to content" link can move
            // focus into <main> (which isn't natively focusable) reliably
            // across browsers.
            tabIndex={-1}
            className="flex-1 overflow-y-auto"
          >
            <DemoBannerGate />
            {/* #515 - step the mobile padding down (p-3) so dense tables
                don't lose ~13% horizontal room on a ~360px phone; restore
                the roomy padding from sm upward. */}
            <div className="mx-auto max-w-[1120px] p-3 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
      <CommandPalette items={paletteItems} />
      {/* FP1 - badges/demo/palette-extras stream in AFTER first paint; a slow or
          wedged read renders nothing rather than delaying or stranding the shell. */}
      <Suspense fallback={null}>
        <DeferredShellData />
      </Suspense>
    </ShellProvider>
  );
}

/** FP1 (2026-07-02) - the old render-blocking body of the layout, now streamed.
 *  Bounded by SHELL_DATA_DEADLINE_MS and fail-soft: timeout or error just means
 *  no badges this navigation, never a hung stream. */
async function DeferredShellData() {
  const result = await loadWithDeadline(
    loadShellData().catch(() => null),
    SHELL_DATA_DEADLINE_MS,
  );
  if (result.timedOut || !result.data) return null;
  const { badges, isDemoMode, latePaletteItems } = result.data;
  return (
    <ShellDataHydrator badges={badges} isDemoMode={isDemoMode} latePaletteItems={latePaletteItems} />
  );
}

async function loadShellData(): Promise<{
  badges: NavBadges;
  isDemoMode: boolean;
  latePaletteItems: LatePaletteItem[];
}> {
  // Perf bundle 7 (2026-05-12) - production-safe perf tracing.
  // NOOP when BEACON_PERF_TRACE != "true". When enabled, correlates
  // with middleware via the `x-beacon-perf-trace-id` header.
  const trace = createPerfTrace("shell-layout", {
    traceId: await readPerfTraceIdFromHeaders(),
  });

  // On-USE connector auto-refresh (2026-06-22) - keep every connected source
  // live without a "Pull my data" click. Scheduled via next/after so it runs
  // AFTER this response (zero added page latency) and only refreshes sources
  // whose last_synced_at has aged past their per-provider threshold, so firing
  // on every signed-in click can't hammer egress or paid API quota. Fail-soft.
  scheduleConnectorAutoRefresh(await currentTenantId());

  // Perf bundle 6 (2026-05-12) - parallelize the independent shell reads
  // that fire on EVERY signed-in click. Pre-fix: five sequential awaits, a
  // 100-500 ms warm tax on every route under (shell). Post-fix: the
  // independent operations run in parallel; the one ordered dependency
  // (getWatchingUrlOutcomes uses the seed cache populated by
  // ensureUrlChangeOutcomesSeeded) runs after the Promise.all.
  //
  // Phase 3.5C (2026-04-22): the seed is required so the Changes-badge
  // count reflects real verdict state on Vercel.
  const [
    ,
    pendingFindings,
    isDemoModeRaw,
    changelogEntries,
    wixInfo,
    gscInfo,
  ] = await trace.time("parallel_4_awaits", () =>
    Promise.all([
      trace.time("ensureUrlChangeOutcomesSeeded", () =>
        ensureUrlChangeOutcomesSeeded(),
      ),
      trace.time("getPendingFindings", () => getPendingFindings()),
      trace.time("hasActiveExperiment", () => hasActiveExperiment()),
      trace.time("getChangelogEntries", () => getChangelogEntries()),
      // Demo/sample framing must drop the moment a real source is wired.
      trace.time("connector_wix", () => getConnectorInfo("wix")),
      trace.time("connector_gsc", () => getConnectorInfo("google_gsc")),
    ]),
  );
  const watchingUrlOutcomes = await trace.time("getWatchingUrlOutcomes", () =>
    getWatchingUrlOutcomes(),
  );

  // ── Badge computation ──
  //
  // Each badge is wired to something the operator can act on.
  //
  //   Today  - pending CONTENT_CHANGE findings waiting for confirm/dismiss.
  //            Same filter as the "Scan diffs to review (N)" accordion inside
  //            Today (renamed from "N changes detected" in Phase 6A.4 to stop
  //            implying raw scan diffs are tracked changes), so the sidebar
  //            number matches what the operator sees on the page.
  //
  //   Changes - URLs whose post-change verdict is `hurting`. One row per URL.
  //             v2 QA polish bundle (2026-05-11) narrowed this from the
  //             full WATCHING_VERDICTS set ({hurting, weak_signal,
  //             nothing_yet, too_early}) down to `hurting` only. Pre-
  //             narrow, the badge counted in-flight watching states
  //             (too_early / nothing_yet / weak_signal) the same as
  //             genuine alarms, which conflated the v2 page's
  //             "Watching for signal" counter with its "Needs attention"
  //             counter and read as "sidebar 3 vs page 24" - confusing.
  //             Post-narrow, the badge means exactly: "URLs that need
  //             your attention now", matching the v2 page's "Needs
  //             attention" half of the counter strip using only the
  //             existing `getWatchingUrlOutcomes()` fetch (no new
  //             round-trip from the shell layout).
  const todayBadge = pendingFindings.filter((f) =>
    CONTENT_CHANGE_TYPES.has(f.type),
  ).length;
  const changesBadge = watchingUrlOutcomes.filter(
    (o) => o.verdict === "hurting",
  ).length;

  const badges: NavBadges = {};
  if (todayBadge > 0) badges["/"] = todayBadge;
  if (changesBadge > 0) badges["/results"] = changesBadge;

  // Sample / walkthrough data when no import runs exist (`import-runs` store
  // empty) - UNLESS a real source is connected. A tenant with Wix or GSC wired
  // is operating on its own live data, never "demo content" (2026-06-13).
  const hasRealConnector =
    wixInfo.status === "connected" || gscInfo.status === "connected";
  const isDemoMode = !isDemoModeRaw && !hasRealConnector;

  // ── Late palette items ──
  // T-CustomerNav (2026-05-08) - palette items only surface customer-facing
  // routes; the pre-T-CustomerNav "Market" group over hidden routes stays dead.
  const latePaletteItems: LatePaletteItem[] = (
    changelogEntries.length > CHANGELOG_PALETTE_CAP
      ? changelogEntries.slice(-CHANGELOG_PALETTE_CAP)
      : changelogEntries
  ).map((c) => ({
    id: c.id,
    label: c.asset_name,
    group: "Results",
    href: `/changes/${c.id}`,
    meta: c.topic_targeted || undefined,
  }));

  trace.data("changelog_count", changelogEntries.length);
  trace.data("palette_items", latePaletteItems.length);
  trace.data("today_badge", badges["/"] ?? 0);
  trace.data("changes_badge", badges["/results"] ?? 0);
  trace.flush();

  return { badges, isDemoMode, latePaletteItems };
}

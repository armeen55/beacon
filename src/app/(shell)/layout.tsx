export const dynamic = "force-dynamic"; // shell layout reads tenant context (Supabase) - force the whole shell subtree dynamic so NO page prerenders at build (avoids build-time "Invalid API key")
export const maxDuration = 300; // the post-response autonomous research cycle is bounded but intentionally comprehensive

import { ShellProvider, ShellDataHydrator, type LatePaletteItem } from "@/components/shell/shell-provider";
import { AppSidebar, MobileSidebar } from "@/components/shell/app-sidebar";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { Suspense } from "react";
import { CockpitBar } from "@/components/shell/cockpit-bar";
import { AppHeader } from "@/components/shell/app-header";
import { CommandPalette, type PaletteItem } from "@/components/shell/command-palette";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { allNavItems } from "@/lib/navigation";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { currentTenantId } from "@/lib/tenant-context";
import { ensureResearchRunOnVisit } from "@/domains/runtime";
import { loadWithDeadline } from "@/lib/load-with-deadline";

// T-CustomerNav (2026-05-08) - keys aligned with `navigationGroups`
// in `src/lib/navigation.ts`. Pre-T-CustomerNav this map carried
// dead entries for routes hidden from the sidebar 2026-04-17 /
// 2026-04-22 (/pages, /local, and the competitor map).
//
// 2026-06-14 - these palette labels MUST match the actual g+<key>
// handler in `command-palette.tsx`. Keep this in lockstep with the
// handler + the help dialog.
//
// Phase 4D (2026-07-21) - the /ask and /prompts shortcuts (G A / G P) were
// dropped with their surfaces; only the five live nav routes carry a hint.
const NAV_SHORTCUTS: Record<string, string> = {
  "/": "G T",
  // FP4 (2026-07-03): URLs now match nav labels, so the letters follow the
  // names. G C = Changes (/changes), G E = Results (/results).
  "/changes": "G C",
  "/results": "G E",
  "/settings/connectors": "G K",
  "/settings": "G S",
};

const CHANGELOG_PALETTE_CAP = 50;

/** FP1 (2026-07-02) - the deferred Supabase reads behind the palette get this
 *  long, TOTAL, before the shell gives up on them for this navigation. The shell
 *  itself has already painted by then; a wedged read only costs the palette. */
const SHELL_DATA_DEADLINE_MS = 8000;

/**
 * FP1 (2026-07-02) - the shell paints INSTANTLY. Every Supabase read this layout
 * used to await before returning (demo-mode detection, changelog
 * palette entries: the audit counted 6 blocking awaits taxing EVERY signed-in
 * click) now lives in <DeferredShellData/>, streamed behind Suspense AFTER the
 * nav/header/page shell is on the wire. The palette and demo banner hydrate
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
            {/* #515 - step the mobile padding down (p-3) so dense tables
                don't lose ~13% horizontal room on a ~360px phone; restore
                the roomy padding from sm upward. */}
            <div className="mx-auto max-w-[1120px] p-3 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
      <CommandPalette items={paletteItems} />
      {/* FP1 - demo/palette-extras stream in AFTER first paint; a slow or
          wedged read renders nothing rather than delaying or stranding the shell. */}
      <Suspense fallback={null}>
        <DeferredShellData />
      </Suspense>
    </ShellProvider>
  );
}

/** FP1 (2026-07-02) - the old render-blocking body of the layout, now streamed.
 *  Bounded by SHELL_DATA_DEADLINE_MS and fail-soft: timeout or error just means
 *  no extra palette items this navigation, never a hung stream. */
async function DeferredShellData() {
  const result = await loadWithDeadline(
    loadShellData().catch(() => null),
    SHELL_DATA_DEADLINE_MS,
  );
  if (result.timedOut || !result.data) return null;
  return <ShellDataHydrator latePaletteItems={result.data.latePaletteItems} />;
}

async function loadShellData(): Promise<{ latePaletteItems: LatePaletteItem[] }> {
  // Perf bundle 7 (2026-05-12) - production-safe perf tracing.
  // NOOP when BEACON_PERF_TRACE != "true". When enabled, correlates
  // with middleware via the `x-beacon-perf-trace-id` header.
  const trace = createPerfTrace("shell-layout", {
    traceId: await readPerfTraceIdFromHeaders(),
  });

  // A VISIT IS RECOVERY, NOT THE ENGINE (2026-08-02). The daily round is driven by the one global
  // scheduler now; this trigger is what a visit adds on top: if today's run stalled or never started,
  // opening Beacon nudges it back into motion. The database lease (not any in-memory guard) still makes
  // the cycle exactly-once, so a visit during a healthy day costs nothing.
  ensureResearchRunOnVisit(await currentTenantId());

  // ONE READ PER NAVIGATION. THE SIDEBAR NUMBERS ARE GONE, and with them three reads that fired on every
  // signed-in click. They counted raw scan diffs waiting to be triaged and URLs a retired verdict system
  // called hurting: two vocabularies this product no longer decides anything in, so the number beside Today
  // never matched Today and the number beside Results never matched the ledger. A count belongs on the screen
  // that can explain it, where both of those now live.
  const changelogEntries = await trace.time("getChangelogEntries", () => getChangelogEntries());

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
  trace.flush();

  return { latePaletteItems };
}

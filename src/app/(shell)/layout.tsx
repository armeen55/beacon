import { ShellProvider, type NavBadges } from "@/components/shell/shell-provider";
import { AppSidebar, MobileSidebar } from "@/components/shell/app-sidebar";
import { AppHeader } from "@/components/shell/app-header";
import { CommandPalette, type PaletteItem } from "@/components/shell/command-palette";
import { DemoBannerGate } from "@/components/shell/demo-banner";
import {
  changelogEntries,
  results,
  hasActiveExperiment,
  importRuns,
} from "@/lib/seed-data.server";
import { allNavItems } from "@/lib/navigation";
import { eventDecisions } from "@/domains/attribution/store";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { pageIssues } from "@/domains/pages/issues";

const NAV_SHORTCUTS: Record<string, string> = {
  "/": "G T",
  "/pages": "G P",
  "/changes": "G C",
  "/competitors": "G M",
  "/local": "G L",
  "/settings": "G S",
};

const CHANGELOG_PALETTE_CAP = 50;

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Badge computation ──
  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const reviewPending = events.length - eventDecisions.length;
  const openIssues = pageIssues.filter(
    (i) => i.status === "new" || i.status === "shipped"
  ).length;

  const badges: NavBadges = {};
  const totalInbox = (reviewPending > 0 ? 1 : 0) + openIssues;
  if (totalInbox > 0) badges["/"] = totalInbox;
  if (reviewPending > 0) badges["/changes"] = reviewPending;
  if (openIssues > 0) badges["/pages"] = openIssues;

  // Sample / walkthrough data when no import runs exist (`import-runs` store empty).
  const isDemoMode = !hasActiveExperiment();

  // ── Palette items ──
  const uniqueTopics = [
    ...new Set(
      changelogEntries
        .map((c) => c.topic_targeted)
        .filter((t): t is string => Boolean(t))
    ),
  ];

  const paletteItems: PaletteItem[] = [
    ...allNavItems.map((n) => ({
      id: `nav-${n.href}`,
      label: n.label,
      group: "Navigate",
      href: n.href,
      shortcut: NAV_SHORTCUTS[n.href],
    })),
    ...(changelogEntries.length > CHANGELOG_PALETTE_CAP
      ? changelogEntries.slice(-CHANGELOG_PALETTE_CAP)
      : changelogEntries
    ).map((c) => ({
      id: c.id,
      label: c.asset_name,
      group: "Changes",
      href: `/changes/${c.id}`,
      meta: c.topic_targeted || undefined,
    })),
    ...uniqueTopics.map((t) => ({
      id: `topic-${t}`,
      label: t,
      group: "Market",
      href: "/competitors#opportunities",
      meta: "Topic",
    })),
  ];

  return (
    <ShellProvider badges={badges} isDemoMode={isDemoMode}>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />
        <MobileSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-y-auto">
            <DemoBannerGate />
            <div className="mx-auto max-w-[1120px] p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
      <CommandPalette items={paletteItems} />
    </ShellProvider>
  );
}

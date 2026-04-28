import { ShellProvider, type NavBadges } from "@/components/shell/shell-provider";
import { AppSidebar, MobileSidebar } from "@/components/shell/app-sidebar";
import { AppHeader } from "@/components/shell/app-header";
import { CommandPalette, type PaletteItem } from "@/components/shell/command-palette";
import { DemoBannerGate } from "@/components/shell/demo-banner";
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

const NAV_SHORTCUTS: Record<string, string> = {
  "/": "G T",
  "/pages": "G P",
  "/changes": "G C",
  "/competitors": "G M",
  "/local": "G L",
  "/settings": "G S",
};

const CHANGELOG_PALETTE_CAP = 50;

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Phase 3.5C (2026-04-22): seed the URL-change-outcomes array from Supabase
  // so the Changes-badge count reflects real verdict state on Vercel.
  await ensureUrlChangeOutcomesSeeded();

  // ── Badge computation ──
  //
  // Each badge is wired to something the operator can act on.
  //
  //   Today  — pending CONTENT_CHANGE findings waiting for confirm/dismiss.
  //            Same filter as the "Scan diffs to review (N)" accordion inside
  //            Today (renamed from "N changes detected" in Phase 6A.4 to stop
  //            implying raw scan diffs are tracked changes), so the sidebar
  //            number matches what the operator sees on the page.
  //
  //   Pages  — URLs with one or more BUG_FINDING_TYPES (schema_invalid,
  //            faq_without_schema, robots_txt_blocked, deploy_mismatch).
  //            Bugs to fix, not experiments to run. De-duped by URL so the
  //            number counts affected pages, not raw findings.
  //
  //   Changes — URLs currently being watched by the Z-score engine (verdict
  //             in {hurting, nothing_yet, too_early}). One row per URL.
  //             Replaces the legacy `experiment-store` read as of 2026-04-19.
  const pendingFindings = await getPendingFindings();
  const todayBadge = pendingFindings.filter((f) =>
    CONTENT_CHANGE_TYPES.has(f.type),
  ).length;
  const pagesWithBugs = new Set(
    pendingFindings
      .filter((f) => BUG_FINDING_TYPES.has(f.type))
      .map((f) => f.pagePath),
  );
  const pagesBadge = pagesWithBugs.size;
  // Count distinct URLs with a live verdict \u2014 hurting, nothing_yet, too_early.
  // Settled wins ("helping") and dead ends ("not_enough_data") are excluded.
  const changesBadge = (await getWatchingUrlOutcomes()).length;

  const badges: NavBadges = {};
  if (todayBadge > 0) badges["/"] = todayBadge;
  if (pagesBadge > 0) badges["/pages"] = pagesBadge;
  if (changesBadge > 0) badges["/changes"] = changesBadge;

  // Sample / walkthrough data when no import runs exist (`import-runs` store empty).
  const isDemoMode = !(await hasActiveExperiment());

  // ── Palette items ──
  const changelogEntries = await getChangelogEntries();
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

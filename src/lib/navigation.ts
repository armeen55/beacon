import {
  Sun,
  Settings,
  GitCompareArrows,
  ListChecks,
  Target,
  Compass,
  Network,
  LineChart,
  Plug,
  FlaskConical,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Unified navigation (2026-06-23 IA consolidation — operator directive
 * "everything should be available to everyone, I literally have 0 users").
 *
 * One nav for one workflow: Today (what to do now) -> Opportunities (everything
 * Beacon found) + Drafts (ready-to-review fixes) -> Experiments (planned
 * changes) -> Results (shipped + did it work). Then the data sources + settings.
 *
 * No separate "operator" tier any more: the surfaces that used to be
 * operator-only (Opportunities, Experiments, Results, Competitors, Connections)
 * now live in the single list so the app reads as ONE product, not two classes
 * of pages. "Recommendations" is renamed "Drafts" (the word was legacy and
 * overlapped with Opportunities/Experiments).
 */
export const navigationGroups: NavGroup[] = [
  {
    label: "",
    items: [{ label: "Today", href: "/", icon: Sun }],
  },
  {
    label: "Find & fix",
    items: [
      { label: "Opportunities", href: "/opportunities", icon: Compass },
      { label: "Drafts", href: "/recommendations", icon: Target },
    ],
  },
  {
    label: "Track results",
    items: [
      { label: "Experiments", href: "/experiments", icon: FlaskConical },
      { label: "Results", href: "/proof", icon: LineChart },
      { label: "Changes", href: "/changes", icon: GitCompareArrows },
    ],
  },
  {
    label: "Your data",
    items: [
      { label: "AI questions", href: "/prompts", icon: ListChecks },
      { label: "Competitors", href: "/competitors", icon: Users },
      { label: "Connections", href: "/connections", icon: Network },
      { label: "Connectors", href: "/settings/connectors", icon: Plug },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

/**
 * Kept as an EMPTY group for import compatibility (the server layout + sidebar
 * still reference it). The 2026-06-23 IA consolidation folded every former
 * operator-only route into `navigationGroups` above, so there is no longer a
 * separate operator tier to append.
 */
export const operatorNavGroup: NavGroup = {
  label: "",
  items: [],
};

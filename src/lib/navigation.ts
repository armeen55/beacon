import {
  Sun,
  Settings,
  GitCompareArrows,
  ListChecks,
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

// Hidden from nav 2026-04-17 (Day 2 trust cleanup): /local, /topics.
// Hidden from nav 2026-04-22 (Phase 3.5F "Surface Trust"): /pages, /competitors,
// /diagnostics/spikes. URLs stay alive for direct access; they read legacy
// module-level JSON stores that return empty on Vercel and render as
// half-broken placeholders today. Revisit once rebuilt; for now the dogfood
// nav is Today · Changes · Settings.
export const navigationGroups: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Today", href: "/", icon: Sun },
      { label: "Prompts", href: "/prompts", icon: ListChecks },
      { label: "Changes", href: "/changes", icon: GitCompareArrows },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

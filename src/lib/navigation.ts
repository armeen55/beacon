import {
  Sun,
  Globe,
  Users,
  Settings,
  GitCompareArrows,
  Activity,
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
// URLs stay alive, just removed from daily-ritual view. Restore by re-adding below.
export const navigationGroups: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Today", href: "/", icon: Sun },
      { label: "Pages", href: "/pages", icon: Globe },
      { label: "Changes", href: "/changes", icon: GitCompareArrows },
      { label: "Market", href: "/competitors", icon: Users },
      { label: "Diagnostics", href: "/diagnostics/spikes", icon: Activity },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

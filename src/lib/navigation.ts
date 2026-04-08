import {
  ListChecks,
  BarChart3,
  Upload,
  Activity,
  ClipboardCheck,
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

export const navigationGroups: NavGroup[] = [
  {
    label: "Core",
    items: [
      { label: "Review", href: "/review", icon: ClipboardCheck },
      { label: "Changelog", href: "/changes", icon: ListChecks },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Results", href: "/results", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Import", href: "/import", icon: Upload },
      { label: "Diagnostics", href: "/diagnostics", icon: Activity },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

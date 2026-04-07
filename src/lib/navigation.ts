import {
  LayoutDashboard,
  Target,
  FileText,
  ListChecks,
  BarChart3,
  Upload,
  Activity,
  ClipboardCheck,
  Zap,
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
      { label: "Today", href: "/", icon: LayoutDashboard },
      { label: "Review", href: "/review", icon: ClipboardCheck },
      { label: "Changelog", href: "/changes", icon: ListChecks },
      { label: "Actions", href: "/actions", icon: Zap },
    ],
  },
  {
    label: "Analysis",
    items: [
      { label: "Results", href: "/results", icon: BarChart3 },
      { label: "Opportunities", href: "/opportunities", icon: Target },
      { label: "Diagnostics", href: "/diagnostics", icon: Activity },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Import", href: "/import", icon: Upload },
      { label: "Briefs", href: "/briefs", icon: FileText },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

import {
  LayoutDashboard,
  Target,
  FileText,
  ListChecks,
  BarChart3,
  Users,
  Shield,
  Calendar,
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
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Weekly", href: "/weekly", icon: Calendar },
    ],
  },
  {
    label: "Strategy",
    items: [
      { label: "Opportunities", href: "/opportunities", icon: Target },
      { label: "Competitors", href: "/competitors", icon: Users },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Briefs", href: "/briefs", icon: FileText },
      { label: "Changelog", href: "/changes", icon: ListChecks },
    ],
  },
  {
    label: "Measurement",
    items: [
      { label: "Results", href: "/results", icon: BarChart3 },
      { label: "Coverage", href: "/coverage", icon: Shield },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Review", href: "/review", icon: ClipboardCheck },
      { label: "Import", href: "/import", icon: Upload },
      { label: "Diagnostics", href: "/diagnostics", icon: Activity },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

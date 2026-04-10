import {
  ListChecks,
  Upload,
  Activity,
  ClipboardCheck,
  Sun,
  Globe,
  Lightbulb,
  BarChart3,
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

export const navigationGroups: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Today", href: "/", icon: Sun },
      { label: "Pages", href: "/pages", icon: Globe },
      { label: "Changes", href: "/changes", icon: ListChecks },
      { label: "Competitors", href: "/competitors", icon: Users },
      { label: "Opportunities", href: "/topics", icon: Lightbulb },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Import", href: "/import", icon: Upload },
      { label: "Review", href: "/review", icon: ClipboardCheck },
      { label: "History", href: "/results", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Diagnostics", href: "/diagnostics", icon: Activity },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

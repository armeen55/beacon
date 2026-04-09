import {
  ListChecks,
  Upload,
  Activity,
  ClipboardCheck,
  Sun,
  Globe,
  Lightbulb,
  BarChart3,
  Sparkles,
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
      { label: "Your Website", href: "/pages", icon: Globe },
      { label: "Gap ledger", href: "/topics", icon: Lightbulb },
    ],
  },
  {
    label: "Work",
    items: [{ label: "Changes", href: "/changes", icon: ListChecks }],
  },
  {
    label: "Advanced",
    items: [
      { label: "Review", href: "/review", icon: ClipboardCheck },
      { label: "Sample history", href: "/results", icon: BarChart3 },
      { label: "Import", href: "/import", icon: Upload },
      { label: "Diagnostics (analyst)", href: "/diagnostics", icon: Activity },
    ],
  },
  {
    label: "Experimental",
    items: [
      { label: "Draft ideas", href: "/expansion", icon: Sparkles },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

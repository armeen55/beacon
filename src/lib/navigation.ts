import {
  Sun,
  Globe,
  Users,
  Settings,
  GitCompareArrows,
  MapPin,
  MessageSquare,
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
      { label: "Changes", href: "/changes", icon: GitCompareArrows },
      { label: "Market", href: "/competitors", icon: Users },
      { label: "Local", href: "/local", icon: MapPin },
      { label: "Topics", href: "/topics", icon: MessageSquare },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

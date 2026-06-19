import {
  Sun,
  Settings,
  GitCompareArrows,
  ListChecks,
  Target,
  Compass,
  Plug,
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
      { label: "Recommendations", href: "/recommendations", icon: Target },
      { label: "Prompts", href: "/prompts", icon: ListChecks },
      { label: "Changes", href: "/changes", icon: GitCompareArrows },
      { label: "Connectors", href: "/settings/connectors", icon: Plug },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const allNavItems: NavItem[] = navigationGroups.flatMap((g) => g.items);

/**
 * Operator-OS rebuild (2026-06-19) — OPERATOR-ONLY nav, rendered in the sidebar
 * only when `isOperatorModeServer()` is true (threaded from the server layout).
 * Kept SEPARATE from `navigationGroups` (and out of `allNavItems`) so the
 * customer surface stays exactly the 6 customer routes — the cmd+K palette and
 * the customer-nav-exposure invariant both read `navigationGroups`/`allNavItems`,
 * never this. These routes self-gate with `notFound()` for non-operators too.
 */
export const operatorNavGroup: NavGroup = {
  label: "Operator",
  items: [{ label: "Opportunities", href: "/opportunities", icon: Compass }],
};

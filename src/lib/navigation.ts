import {
  Sun,
  Settings,
  ListChecks,
  ListTodo,
  MessageCircle,
  LineChart,
  Plug,
  Users,
  Search,
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
 * Unified navigation (2026-07-01 one-workflow consolidation — operator directive
 * "isn't everything just one to-do list? why does it look like five products").
 *
 * ONE workflow, three surfaces over a single CHANGE lifecycle:
 *   Today    (/)         — the 5–10 changes to do now
 *   Changes  (/worklist) — the full ranked list (suggested → ready → applied → measuring)
 *   Results  (/proof)    — measuring + outcomes
 * then Research (deeper evidence, not needed for daily work) and Settings.
 *
 * "Drafts" (/recommendations) and "Ready to ship" (/experiments) are NOT separate
 * products — they are STAGES of a change, reachable from the Changes list and via
 * direct URL. They were removed from the sidebar so the app reads as one tool, not
 * five. Their routes still exist (no destructive removal); only the duplicate
 * top-level nav entries are gone.
 *
 * "Ask" (/ask, master plan item 59) - the ask-your-team chat. Placed alongside the
 * core workflow (not under Research) because it answers questions about the SAME
 * change lifecycle in plain language, pulling from every surface at once rather than
 * being its own deep-evidence destination.
 */
export const navigationGroups: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Today", href: "/", icon: Sun },
      // Worklist relabeled "Changes": the one ranked list of everything to do.
      { label: "Changes", href: "/worklist", icon: ListTodo },
      // Results = what changed / is it measuring / did it work (/proof). The /changes
      // index redirects here; /changes/[id] detail still works.
      { label: "Results", href: "/proof", icon: LineChart },
      // Ask-your-team chat (item 59) - a named specialist answers any question with
      // real numbers, every claim linked back to its source surface.
      { label: "Ask", href: "/ask", icon: MessageCircle },
    ],
  },
  {
    label: "Research",
    items: [
      // UX2 (BEACON_500 master plan, the operator's own idea) - every cached
      // keyword in one sortable library. First hub item; more (Pages, Topics,
      // Content roadmap) land in later UX2 slices.
      { label: "Keywords", href: "/research/keywords", icon: Search },
      { label: "AI questions", href: "/prompts", icon: ListChecks },
      { label: "Competitors", href: "/competitors", icon: Users },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Connections", href: "/settings/connectors", icon: Plug },
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

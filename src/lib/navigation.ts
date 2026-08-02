import {
  Sun,
  Eye,
  Settings,
  ListTodo,
  LineChart,
  Plug,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Unified navigation (2026-07-01 one-workflow consolidation, operator directive
 * "isn't everything just one to-do list? why does it look like five products").
 *
 * ONE workflow, three surfaces over a single CHANGE lifecycle:
 *   Today    (/)         the 5-10 changes to do now
 *   Changes  (/changes)  the full ranked list (suggested, ready, applied, measuring)
 *   Results  (/results)  measuring + outcomes
 * then Research (deeper evidence, not needed for daily work) and Settings.
 *
 * FP4 (2026-07-03) route-name unification: the URLs now MATCH the nav labels.
 * The ranked list lives at /changes (was /worklist) and the results page lives
 * at /results (was /proof); both old URLs are permanent redirects. The
 * diagnosis found one page carrying four names while "/changes" in the URL bar
 * bounced somewhere else entirely; after FP4 the URL, the sidebar label, and
 * the page h1 agree everywhere.
 *
 * Phase 4D (2026-07-21): the ⌘K palette's "supporting evidence" extras (Ask,
 * Keyword research, AI questions, Activity receipts) were removed along with
 * their surfaces, so the palette now lists only the five nav routes. The
 * stage-of-a-change redirect stubs (/recommendations, /experiments) still
 * bounce into /changes views but carry no nav or palette entry.
 *
 * The last group deliberately has NO heading: the audit flagged "Settings" as
 * both a group label and an item directly beneath it, which read as the same
 * word twice for no reason. The two rows (Connections, Settings) speak for
 * themselves.
 */
export const navigationGroups: NavGroup[] = [
  {
    label: "",
    items: [
      { label: "Today", href: "/", icon: Sun },
      { label: "Visibility", href: "/visibility", icon: Eye },
      { label: "Changes", href: "/changes", icon: ListTodo },
      { label: "Results", href: "/results", icon: LineChart },
    ],
  },
  {
    label: "",
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

// ---------------------------------------------------------------------------
// Route titles (FP4, 2026-07-03). ONE registry that names every reachable
// shell route in plain language. The header breadcrumb (app-header.tsx), the
// Ask citation chips (ask-chat-client.tsx), and anything else that needs to
// name a surface derive from HERE, so no route can render its raw slug or a
// bare "Detail" as its title (the audit's "research / Detail" killer).
// ---------------------------------------------------------------------------

type RouteCrumb = {
  /** Plain title for the header. */
  title: string;
  /** Optional parent breadcrumb link (nearest listed ancestor). */
  parent: { label: string; href: string } | null;
};

type RouteTitleEntry = {
  /** Path prefix this entry names (longest prefix wins). */
  prefix: string;
  /** Plain-language name of the surface. */
  title: string;
  /** href of the parent surface for breadcrumbs (must itself be titled). */
  parentHref?: string;
  /**
   * Title for a DYNAMIC child underneath this prefix (e.g. /prompts/[id])
   * when the page has not set a subject via <HeaderTitle/>. Never the bare
   * word "Detail".
   */
  childTitle?: string;
};

/**
 * Non-nav routes that render inside the shell. Nav items themselves are
 * folded in automatically from `navigationGroups`. Bookmark-compat redirect
 * stubs (/worklist, /proof, /moves, /briefs, ...) never paint a header so
 * they are not listed.
 */
// Phase 4D (2026-07-21): pruned to routes that still render a shell header. The
// pruned entries (/recommendations, /prompts, /ask, /local, /observations,
// /topics/opportunity, /competitors, and the retired /settings/{import,prompts,
// history,spend,methodology,exit-gates,health} sub-pages) named surfaces that no
// longer exist; a request to any of them 404s or redirects and never paints a
// header, so a title entry for it was dead weight.
const EXTRA_ROUTE_TITLES: RouteTitleEntry[] = [
  { prefix: "/changes", title: "Changes", childTitle: "Change detail" },
  { prefix: "/help", title: "Help & glossary" },
  { prefix: "/onboard", title: "Set up your business", childTitle: "Set up your business" },
  { prefix: "/settings", title: "Settings" },
  { prefix: "/settings/connectors", title: "Connections", parentHref: "/settings" },
  { prefix: "/settings/config", title: "Business info", parentHref: "/settings" },
  { prefix: "/diagnostics", title: "Diagnostics" },
];

const ROUTE_TITLES: RouteTitleEntry[] = [
  { prefix: "/", title: "Today" },
  ...allNavItems
    .filter((n) => n.href !== "/")
    .map((n) => ({ prefix: n.href, title: n.label })),
  ...EXTRA_ROUTE_TITLES,
];

function entryFor(pathname: string): RouteTitleEntry | null {
  let best: RouteTitleEntry | null = null;
  for (const entry of ROUTE_TITLES) {
    const matches =
      entry.prefix === "/"
        ? pathname === "/"
        : pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`);
    // `>=` so a later entry wins a same-prefix tie: EXTRA_ROUTE_TITLES rows
    // (which carry childTitle/parentHref) override the bare nav-derived rows.
    if (matches && (best === null || entry.prefix.length >= best.prefix.length)) {
      best = entry;
    }
  }
  return best;
}

/** "competitor-intel" -> "Competitor intel". Last-resort humanizer so an
 *  unregistered route still never shows its raw slug. */
function humanizeSegment(segment: string): string {
  const words = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Resolve the header title + parent breadcrumb for a shell pathname. Dynamic
 * detail pages can override the title with their real subject via
 * <HeaderTitle/> (shell-provider); this gives the registry answer.
 */
export function routeCrumbFor(pathname: string): RouteCrumb {
  const entry = entryFor(pathname);
  if (!entry) {
    // Unregistered route: humanize rather than echo the slug.
    const segments = pathname.split("/").filter(Boolean);
    return { title: humanizeSegment(segments[segments.length - 1] ?? "Beacon"), parent: null };
  }

  const parent = entry.parentHref ? entryFor(entry.parentHref) : null;
  const parentCrumb = parent ? { label: parent.title, href: parent.prefix } : null;

  if (pathname === entry.prefix || entry.prefix === "/") {
    return { title: entry.title, parent: parentCrumb };
  }

  // Deeper than the registered prefix: a detail page falls back to the entry's
  // plain childTitle under the entry as parent.
  return {
    title: entry.childTitle ?? entry.title,
    parent: { label: entry.title, href: entry.prefix },
  };
}

/**
 * Human name for a surface href, for citation chips and "where does this
 * number come from" labels. Strips query/hash first: "/results?page=x" ->
 * "Results".
 */

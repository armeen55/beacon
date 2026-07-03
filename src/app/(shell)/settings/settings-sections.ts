/**
 * Settings sections (FP4, 2026-07-03) - the ONE table of contents for
 * Settings. The audit found two disagreeing menus: the /settings index listed
 * config/connectors/history/spend/methodology while the tab strip listed
 * connectors/import/config/prompts/history, with different labels for the
 * same pages ("Connectors" vs "Connections", "Data" vs "Imported history").
 * Both surfaces now render THIS list, same items, same order, same labels,
 * so they cannot drift apart again. The first entry is "Connections", the
 * same word the sidebar uses for the same page.
 *
 * Deliberately absent: /settings/exit-gates and /settings/health stay
 * operator/internal (linked from their own surfaces, never a customer tab),
 * pinned by tests/architecture/customer-nav-exposure.test.ts.
 */
export const SETTINGS_SECTIONS = [
  {
    href: "/settings/connectors",
    label: "Connections",
    description: "Google, Wix, Profound, Clarity: connect, sync, and check status.",
  },
  {
    href: "/settings/config",
    label: "Business info",
    description: "Name, domain, phone, address, and category Beacon uses everywhere.",
  },
  {
    href: "/settings/import",
    label: "Import",
    description: "Bring in files by hand when a connection is not available.",
  },
  {
    href: "/settings/prompts",
    label: "Tracked questions",
    description: "The questions Beacon asks AI assistants about your business.",
  },
  {
    href: "/settings/history",
    label: "Data history",
    description: "Every scan and import Beacon has recorded, and when.",
  },
  {
    href: "/settings/spend",
    label: "Spend",
    description: "What Beacon has spent on outside data, receipt by receipt.",
  },
  {
    href: "/settings/methodology",
    label: "How Beacon measures",
    description: "What each number means, and where it comes from.",
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

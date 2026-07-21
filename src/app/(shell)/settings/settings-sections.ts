/**
 * Settings sections - the ONE table of contents for Settings. Both the
 * /settings index cards and the tab strip render THIS list, same items, same
 * order, same labels, so they cannot drift apart. The first entry is
 * "Connections", the same word the sidebar uses for the same page.
 *
 * Collapsed 2026-07-21 (Phase 4C) to the two surfaces that carry live operator
 * value: Connections and Business info. The retired subsections (Import,
 * Tracked questions, Data history, Spend, How Beacon measures, How I decide,
 * What I cannot do yet) were read-only views or docs whose underlying stores
 * survive and are surfaced on Today, Changes, and Results.
 */
export const SETTINGS_SECTIONS = [
  {
    href: "/settings/connectors",
    label: "Connections",
    description: "Google, Wix, Clarity: connect, sync, and check status.",
  },
  {
    href: "/settings/config",
    label: "Business info",
    description: "Name, domain, phone, address, and category Beacon uses everywhere.",
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

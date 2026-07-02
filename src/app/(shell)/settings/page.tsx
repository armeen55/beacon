import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";

/**
 * `/settings` index (D7 fix batch, 2026-07-02), previously a bare redirect to
 * Connectors, which left `/settings/config`, `/settings/history`,
 * `/settings/spend`, and `/settings/methodology` reachable only by typing the
 * URL directly (they carry no tab in `settings-tabs-client.tsx`). This gives
 * every settings surface a real, findable entry point without changing the
 * tab bar: Connectors still deep-links from the tabs as before.
 */

const SETTINGS_LINKS = [
  {
    href: "/settings/config",
    title: "Your business info",
    description: "Name, domain, phone, address, and category Beacon uses everywhere.",
  },
  {
    href: "/settings/connectors",
    title: "Connections",
    description: "Google, Wix, Profound, Clarity: connect, sync, and check status.",
  },
  {
    href: "/settings/history",
    title: "Imported history",
    description: "Data you have imported by hand, and when.",
  },
  {
    href: "/settings/spend",
    title: "Spend receipts",
    description: "What Beacon has spent on API calls, and on what.",
  },
  {
    href: "/settings/methodology",
    title: "How Beacon measures",
    description: "What each number means, and where it comes from.",
  },
] as const;

export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        description="Your business info, connections, and how Beacon measures things."
      />
      <ul className="space-y-2">
        {SETTINGS_LINKS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-border/60 bg-surface px-4 py-3.5 transition-colors hover:border-accent-primary/40 hover:bg-surface-raised/30"
            >
              <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

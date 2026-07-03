import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { SETTINGS_SECTIONS } from "./settings-sections";

/**
 * `/settings` index (FP4, 2026-07-03) - renders the ONE settings table of
 * contents (settings-sections.ts), the same list the tab strip above shows,
 * with a one-line description per section. The audit found this page and the
 * tab strip disagreeing on both items and labels; deriving both from the same
 * registry ends that permanently.
 */
export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        description="Your business info, connections, and how Beacon measures things."
      />
      <ul className="space-y-2">
        {SETTINGS_SECTIONS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-border/60 bg-surface px-4 py-3.5 transition-colors hover:border-accent-primary/40 hover:bg-surface-raised/30"
            >
              <p className="text-[13px] font-semibold text-foreground">{item.label}</p>
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

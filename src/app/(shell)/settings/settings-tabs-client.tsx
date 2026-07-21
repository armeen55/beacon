"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS } from "./settings-sections";

/**
 * FP4 (2026-07-03) - the tab strip renders the ONE settings table of contents
 * (settings-sections.ts), the same list the /settings index page shows as
 * cards, so the two can never disagree again. A deeper page under a section
 * (e.g. /settings/connectors/...) keeps its parent tab lit.
 */
export function SettingsTabsClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center gap-1 mb-6 border-b border-border/40 pb-2 overflow-x-auto">
        {SETTINGS_SECTIONS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap",
                isActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </>
  );
}

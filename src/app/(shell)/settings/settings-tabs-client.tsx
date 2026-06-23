"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Connectors restored to the tab bar 2026-06-15 (goal pivot): it is now the
// PRIMARY customer self-serve surface — connect GSC/GA4/SEMrush/Profound/Clarity/
// Wix and Sync each on demand. It must be reachable by clicking, not URL-typing.
// Still hidden: Sign-offs (/settings/exit-gates) + Methodology — internal.
const TABS = [
  { href: "/settings/connectors", label: "Connectors" },
  { href: "/settings/import", label: "Import" },
  { href: "/settings/config", label: "Config" },
  { href: "/settings/prompts", label: "Prompts" },
  { href: "/settings/history", label: "Data" },
] as const;

export function SettingsTabsClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center gap-1 mb-6 border-b border-border/40 pb-2 overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap",
              pathname === tab.href
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {children}
    </>
  );
}

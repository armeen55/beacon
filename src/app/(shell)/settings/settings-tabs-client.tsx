"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/import", label: "Import" },
  { href: "/settings/config", label: "Config" },
  { href: "/settings/connectors", label: "Connectors" },
  { href: "/settings/history", label: "Data" },
  { href: "/settings/exit-gates", label: "Sign-offs" },
  { href: "/settings/methodology", label: "Methodology" },
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
              "px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap",
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

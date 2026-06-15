"use client";

import type React from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "./shell-provider";
import { allNavItems } from "@/lib/navigation";

function useBreadcrumb(pathname: string) {
  if (pathname === "/") return { title: "Today", parent: null };
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments[0] === "topics" &&
    segments[1] === "opportunity" &&
    segments.length >= 3
  ) {
    return {
      title: "Opportunity detail",
      parent: { label: "Market", href: "/competitors" },
    };
  }
  const base = "/" + segments[0];
  const item = allNavItems.find((n) => n.href === base);
  const parentLabel = item?.label ?? segments[0];
  if (segments.length > 1) {
    return { title: null, parent: { label: parentLabel, href: base } };
  }
  return { title: parentLabel, parent: null };
}

export function AppHeader({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const pathname = usePathname();
  const { toggleSidebar, sidebarOpen } = useShell();
  const { title, parent } = useBreadcrumb(pathname);

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border/50 bg-background px-6">
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 md:hidden"
        onClick={toggleSidebar}
        aria-label="Open navigation menu"
        aria-expanded={sidebarOpen}
      >
        <Menu className="h-4 w-4" />
      </Button>
      {parent ? (
        <div className="flex items-center gap-1.5 text-[13px]">
          <Link
            href={parent.href}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {parent.label}
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-semibold text-foreground">{title ?? "Detail"}</span>
        </div>
      ) : (
        <h1 className="text-[13px] font-semibold">{title}</h1>
      )}
      {/* Night-shift #119 (2026-06-11): server-rendered tenant switcher
          composed in via RSC props (this component stays client). */}
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
      <div className={`${rightSlot ? "ml-3" : "ml-auto"} hidden md:flex items-center gap-1.5 text-[10px] text-muted-foreground/40`}>
        <kbd className="border border-border rounded px-1.5 py-0.5 font-mono">
          ⌘K
        </kbd>
        <span>search</span>
        <span className="mx-1">·</span>
        <kbd className="border border-border rounded px-1.5 py-0.5 font-mono">
          ?
        </kbd>
        <span>shortcuts</span>
      </div>
    </header>
  );
}

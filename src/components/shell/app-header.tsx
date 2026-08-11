"use client";

import type React from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "./shell-provider";
import { routeCrumbFor } from "@/lib/navigation";

export function AppHeader({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const pathname = usePathname();
  // FP4 (2026-07-03) - titles come from the ONE route registry in
  // navigation.ts (longest-prefix match), so no page can render its raw URL
  // slug or a bare "Detail" as its name (the audit's "research / Detail"
  // breadcrumb). Detail pages push their real subject (the prompt text, the
  // change's page) into `headerTitle` via <HeaderTitle/>; the registry's
  // plain fallback covers everything else.
  const { toggleSidebar, sidebarOpen, headerTitle } = useShell();
  const crumb = routeCrumbFor(pathname);
  const title = headerTitle ?? crumb.title;
  const parent = crumb.parent;

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
        <div className="flex items-center gap-1.5 text-[15px] md:text-[13px]">
          <Link
            href={parent.href}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {parent.label}
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="max-w-[48ch] truncate font-semibold text-foreground">{title}</span>
        </div>
      ) : (
        <h1 className="text-[15px] md:text-[13px] font-semibold">{title}</h1>
      )}
      {/* Night-shift #119 (2026-06-11): server-rendered tenant switcher
          composed in via RSC props (this component stays client). */}
      {rightSlot ? <div className="ml-auto">{rightSlot}</div> : null}
      {/* The hint strip never shrinks or wraps: at a narrow desktop width the flex gaps collapsed and the two
          hints ran together as one unreadable token. shrink-0 + nowrap keeps the words apart at every width. */}
      <div className={`${rightSlot ? "ml-3" : "ml-auto"} hidden shrink-0 md:flex items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground`}>
        <kbd className="shrink-0 border border-border rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
        <span className="shrink-0">search</span>
        <span aria-hidden className="shrink-0 px-1">·</span>
        <kbd className="shrink-0 border border-border rounded px-1.5 py-0.5 font-mono">?</kbd>
        <span className="shrink-0">shortcuts</span>
      </div>
    </header>
  );
}

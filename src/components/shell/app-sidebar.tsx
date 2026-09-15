"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigationGroups } from "@/lib/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetHeader,
} from "@/components/ui/sheet";
import { useShell } from "./shell-provider";

/** The chord hint per route, handed down from the layout's one map (href to "G X"). */
type Shortcuts = Record<string, string>;

function SidebarContent({ shortcuts }: { shortcuts: Shortcuts }) {
  const pathname = usePathname();
  // 2026-08-12: the operator-only nav group has been empty since the 2026-06-23 IA consolidation folded
  // every operator route into the customer nav, and appending it rendered an empty row of navigation
  // padding for the operator. One nav, one set of groups, for everybody.
  const groups = navigationGroups;

  // Longest-prefix-wins active state: /settings/connectors must highlight
  // "Connections" only, not also "Settings" (both matched under a plain
  // startsWith and the sidebar showed two lit rows for one page).
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)))
    .reduce<string | null>((best, item) => (best === null || item.href.length > best.length ? item.href : best), null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b border-sidebar-border px-4">
        {/* Emergency P0 v3 (2026-05-12): prefetch={false} on every
            shell nav Link. Beacon's top-level routes (/, /recommendations,
            /changes, /prompts, /settings) are all data-heavy server
            routes that each call expensive loaders (the persisted
            recommendation queue loader etc). Default Next prefetch on
            visibility hydrates ALL of them
            on first paint of the shell: one click = N background server
            renders = Vercel function + Supabase pool exhaustion. Detail
            Links were already prefetch={false}; this closes the
            top-level-nav half of the storm. */}
        <Link href="/" prefetch={false} className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background text-xs font-bold">
            B
          </div>
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-semibold tracking-tight text-foreground">
              Beacon
            </span>
            <span className="text-[11px] font-medium text-sidebar-foreground tracking-tight">
              Get found on Google &amp; AI search
            </span>
          </span>
        </Link>
      </div>

      <ScrollArea className="flex-1 py-3">
        <nav aria-label="Primary" className="flex flex-col gap-5 px-3">
          {groups.map((group, groupIndex) => (
            <div key={group.label || `nav-group-${groupIndex}`}>
              {group.label && (
                <p className="px-2 mb-1 text-[11px] font-medium text-sidebar-foreground/50 tracking-normal">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = item.href === activeHref;
                  const shortcut = shortcuts[item.href];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors duration-100",
                        isActive
                          ? "bg-accent-primary-muted text-foreground font-semibold border-l-2 border-accent-primary"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive
                            ? "text-accent-primary"
                            : "text-sidebar-foreground/70"
                        )}
                      />
                      <span className="flex-1">{item.label}</span>
                      {shortcut && (
                        <span className="text-[9px] text-muted-foreground/25 font-mono tracking-wide">
                          {shortcut}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
      {/* Account footer (audit Phase 6): a casual user needs an always-visible
          way to sign out. Plain <form> POST to the existing /auth/signout route
          so it works without JS; no-op + redirect to /login if auth is off. */}
      {/* Same row treatment as a nav link (icon, gap, padding, type scale) so Sign out reads as the last row of
          the navigation rather than a control floating loose under it. */}
      <div className="border-t border-sidebar-border px-3 py-2">
        <form method="post" action="/auth/signout">
          <button
            type="submit"
            className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sidebar-foreground transition-colors duration-100 hover:bg-sidebar-accent hover:text-foreground"
            data-sidebar-action="sign-out"
          >
            <LogOut className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
            <span className="flex-1">Sign out</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppSidebar({ shortcuts }: { shortcuts: Shortcuts }) {
  return (
    <aside className="hidden w-[216px] shrink-0 border-r border-sidebar-border bg-sidebar md:block">
      <SidebarContent shortcuts={shortcuts} />
    </aside>
  );
}

export function MobileSidebar({ shortcuts }: { shortcuts: Shortcuts }) {
  const { sidebarOpen, setSidebarOpen } = useShell();

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent side="left" className="w-[216px] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent shortcuts={shortcuts} />
      </SheetContent>
    </Sheet>
  );
}

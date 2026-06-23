"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationGroups, operatorNavGroup } from "@/lib/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetHeader,
} from "@/components/ui/sheet";
import { useShell } from "./shell-provider";

// T-CustomerNav (2026-05-08) — aligned with `navigationGroups` in
// `src/lib/navigation.ts`. Dead entries for /pages /competitors
// /local removed; they were never displayed (loop iterates
// navigationGroups, not this map) but the map shape was the audit's
// source for "competitor in customer surface" smell. Keep this in
// lockstep with the navigation registry.
const NAV_SHORTCUTS: Record<string, string> = {
  "/": "G T",
  "/recommendations": "G R",
  "/prompts": "G P",
  "/changes": "G C",
  "/settings": "G S",
};

const BADGE_STYLES: Record<string, string> = {
  "/": "bg-status-danger/15 text-status-danger",
  "/changes": "bg-status-warning/15 text-status-warning",
};

function SidebarContent({ isOperator = false }: { isOperator?: boolean }) {
  const pathname = usePathname();
  const { badges } = useShell();
  // Operator-OS rebuild: append the operator-only nav group when in operator
  // mode (threaded from the server layout). Customers never get this branch.
  const groups = isOperator
    ? [...navigationGroups, operatorNavGroup]
    : navigationGroups;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b border-sidebar-border px-4">
        {/* Emergency P0 v3 (2026-05-12) — prefetch={false} on every
            shell nav Link. Beacon's top-level routes (/, /recommendations,
            /changes, /prompts, /settings) are all data-heavy server
            routes that each call expensive loaders (loadLiveRecommendationQueue
            etc). Default Next prefetch on visibility hydrates ALL of them
            on first paint of the shell — one click = N background server
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
            <span className="text-[10px] font-medium text-sidebar-foreground/70 tracking-tight">
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
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  const shortcut = NAV_SHORTCUTS[item.href];
                  const badge = badges[item.href];
                  const badgeStyle = BADGE_STYLES[item.href];

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors duration-100",
                        isActive
                          ? "bg-accent-primary-muted text-foreground"
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
                      {badge != null && badge > 0 && badgeStyle && (
                        <span
                          className={cn(
                            "inline-flex items-center justify-center min-w-[18px] h-[16px] rounded-full text-[9px] font-semibold tabular-nums px-1",
                            badgeStyle
                          )}
                          // a11y #421: the red/amber count badge conveyed
                          // urgency by color + a bare number with no label. An
                          // explicit aria-label on the badge gives screen-reader
                          // users "3 need attention" instead of a stray "3", so
                          // the meaning is no longer color+number alone. (The
                          // aria-label supplies the accessible name; the visible
                          // number stays as-is for sighted users.)
                          aria-label={`${badge} need attention`}
                        >
                          {badge}
                        </span>
                      )}
                      {shortcut && !(badge != null && badge > 0 && badgeStyle) && (
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
    </div>
  );
}

export function AppSidebar({ isOperator = false }: { isOperator?: boolean }) {
  return (
    <aside className="hidden w-[216px] shrink-0 border-r border-sidebar-border bg-sidebar md:block">
      <SidebarContent isOperator={isOperator} />
    </aside>
  );
}

export function MobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useShell();

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent side="left" className="w-[216px] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent />
      </SheetContent>
    </Sheet>
  );
}

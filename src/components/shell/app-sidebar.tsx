"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

const NAV_SHORTCUTS: Record<string, string> = {
  "/": "G T",
  "/pages": "G P",
  "/changes": "G C",
  "/competitors": "G X",
  "/topics": "G O",
  "/import": "G I",
  "/review": "G R",
};

const BADGE_STYLES: Record<string, string> = {
  "/": "bg-status-danger/15 text-status-danger",
  "/review": "bg-status-warning/15 text-status-warning",
  "/pages": "bg-accent-primary/15 text-accent-primary",
};

function SidebarContent() {
  const pathname = usePathname();
  const { badges } = useShell();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center border-b border-sidebar-border px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background text-xs font-bold">
            B
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            Beacon
          </span>
        </Link>
      </div>

      <ScrollArea className="flex-1 py-3">
        <nav className="flex flex-col gap-5 px-3">
          {navigationGroups.map((group) => (
            <div key={group.label}>
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

export function AppSidebar() {
  return (
    <aside className="hidden w-[216px] shrink-0 border-r border-sidebar-border bg-sidebar md:block">
      <SidebarContent />
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

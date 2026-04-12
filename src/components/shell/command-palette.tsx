"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaletteItem = {
  id: string;
  label: string;
  group: string;
  href: string;
  meta?: string;
  shortcut?: string;
};

type Mode = "palette" | "help" | null;

const GROUP_ORDER = ["Navigate", "Changes", "Market"];

export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const [mode, setMode] = useState<Mode>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let gPending = false;
    let gTimeout: ReturnType<typeof setTimeout>;

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setMode("palette");
        setQuery("");
        setSelected(0);
        return;
      }

      if (e.key === "Escape" && (mode === "palette" || mode === "help")) {
        e.preventDefault();
        setMode(null);
        return;
      }

      if (isInput || mode) return;

      if (e.key === "?") {
        e.preventDefault();
        setMode((m) => (m === "help" ? null : "help"));
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !gPending) {
        gPending = true;
        gTimeout = setTimeout(() => {
          gPending = false;
        }, 500);
        return;
      }

      if (gPending) {
        gPending = false;
        clearTimeout(gTimeout);
        const routes: Record<string, string> = {
          t: "/",
          p: "/pages",
          c: "/changes",
          m: "/competitors",
          s: "/settings",
        };
        if (routes[e.key]) {
          e.preventDefault();
          router.push(routes[e.key]);
        }
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(gTimeout);
    };
  }, [router, pathname, mode]);

  useEffect(() => {
    if (mode === "palette") {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [mode]);

  const filtered = query
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          (item.meta &&
            item.meta.toLowerCase().includes(query.toLowerCase()))
      )
    : items;

  const maxPerGroup = query ? 25 : 6;
  const groups: { label: string; items: PaletteItem[] }[] = [];
  for (const g of GROUP_ORDER) {
    const gItems = filtered
      .filter((i) => i.group === g)
      .slice(0, maxPerGroup);
    if (gItems.length > 0) groups.push({ label: g, items: gItems });
  }
  const flatItems = groups.flatMap((g) => g.items);

  function go(item: PaletteItem) {
    setMode(null);
    router.push(item.href);
  }

  function handlePaletteKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatItems[selected]) go(flatItems[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMode(null);
    }
  }

  useEffect(() => {
    if (mode === "palette") {
      const el = document.querySelector(
        `[data-palette-idx="${selected}"]`
      );
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [selected, mode]);

  return (
    <>
      {mode === "palette" && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
          onClick={() => setMode(null)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div
            className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(0);
                }}
                onKeyDown={handlePaletteKeyDown}
                placeholder="Search Beacon..."
                className="w-full bg-transparent py-3 text-[14px] outline-none placeholder:text-muted-foreground/50"
              />
              <kbd className="text-[10px] text-muted-foreground/60 border border-border rounded px-1.5 py-0.5 shrink-0">
                esc
              </kbd>
            </div>

            <div className="max-h-[320px] overflow-y-auto py-1.5">
              {groups.map((group) => (
                <div key={group.label} className="mb-1">
                  <p className="px-4 py-1 text-[11px] font-medium text-muted-foreground/60">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const idx = flatItems.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        data-palette-idx={idx}
                        onClick={() => go(item)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-1.5 text-left text-[13px] transition-colors",
                          idx === selected
                            ? "bg-accent-primary-muted text-foreground"
                            : "text-muted-foreground hover:bg-surface-inset hover:text-foreground"
                        )}
                      >
                        <span className="flex-1 truncate">
                          {item.label}
                        </span>
                        {item.meta && (
                          <span className="text-[10px] text-muted-foreground/50 truncate max-w-[150px]">
                            {item.meta}
                          </span>
                        )}
                        {item.shortcut && (
                          <kbd className="text-[9px] text-muted-foreground/40 font-mono">
                            {item.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {flatItems.length === 0 && (
                <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                  No results for &ldquo;{query}&rdquo;
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground/50">
              <span>↑↓ navigate</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}

      {mode === "help" && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
          onClick={() => setMode(null)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-sm rounded-xl border border-border bg-background shadow-2xl overflow-hidden p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[13px] font-semibold">
                Keyboard shortcuts
              </h3>
              <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                esc
              </kbd>
            </div>

            <div className="space-y-4">
              <HelpGroup title="Global">
                <HelpRow keys="⌘K" label="Command palette" />
                <HelpRow keys="?" label="This help" />
              </HelpGroup>

              <HelpGroup title="Navigation">
                <HelpRow keys="G T" label="Today" />
                <HelpRow keys="G P" label="Pages" />
                <HelpRow keys="G M" label="Market" />
                <HelpRow keys="G C" label="Changes" />
                <HelpRow keys="G S" label="Settings" />
              </HelpGroup>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HelpGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground/60 mb-1.5">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function HelpRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <kbd className="text-[10px] font-mono text-foreground bg-surface-inset border border-border rounded px-1.5 py-0.5 min-w-[28px] text-center">
        {keys}
      </kbd>
    </div>
  );
}

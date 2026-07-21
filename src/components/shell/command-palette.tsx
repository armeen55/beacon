"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-provider";

export type PaletteItem = {
  id: string;
  label: string;
  group: string;
  href: string;
  meta?: string;
  shortcut?: string;
};

type Mode = "palette" | "help" | null;

const GROUP_ORDER = ["Navigate", "Results", "Market"];

/**
 * #347 — subsequence ("fuzzy") match score. Returns null when `query`'s
 * characters do not appear in order within `text`; otherwise a score
 * where lower is a tighter match (contiguous + early matches win). This
 * replaces the naive `.includes` so e.g. "recs" / "rcm" still surface
 * "Recommendations". Pure, self-contained — no persistence/recents.
 */
function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (q === "") return 0;
  // Fast path: a direct substring is always the best kind of match.
  const sub = t.indexOf(q);
  if (sub !== -1) return sub;
  let ti = 0;
  let score = 0;
  let lastMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
    }
    if (found === -1) return null;
    // Penalize gaps between matched chars (non-contiguous matches rank
    // lower); add a large base so any real substring (above) wins.
    score += 100 + (found - lastMatch === 1 ? 0 : found - lastMatch);
    lastMatch = found;
    ti = found + 1;
  }
  return score;
}

export function CommandPalette({ items: staticItems }: { items: PaletteItem[] }) {
  // FP1 (2026-07-02) - the layout passes only the static nav items so the shell
  // paints without waiting on Supabase; the changelog "Results" entries stream in
  // later through the shell context (see ShellDataHydrator in shell-provider.tsx).
  const { latePaletteItems } = useShell();
  const items = useMemo<PaletteItem[]>(
    () => [...staticItems, ...latePaletteItems],
    [staticItems, latePaletteItems],
  );
  const [mode, setMode] = useState<Mode>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // #522 — surface the 500ms "g" chord on screen so the user knows it
  // registered before pressing the second key.
  const [gArmed, setGArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let gPending = false;
    let gTimeout: ReturnType<typeof setTimeout>;

    function disarmG() {
      gPending = false;
      setGArmed(false);
      clearTimeout(gTimeout);
    }

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

      // #537 — Escape is owned by handlePaletteKeyDown while the palette
      // is open; the window handler no longer also closes on Escape, so
      // there's a single owner (this listener only manages the OPEN
      // hotkeys: ⌘K, ?, and the g-chord).

      if (isInput || mode) return;

      if (e.key === "?") {
        e.preventDefault();
        setMode((m) => (m === "help" ? null : "help"));
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !gPending) {
        gPending = true;
        setGArmed(true);
        gTimeout = setTimeout(() => {
          gPending = false;
          setGArmed(false);
        }, 500);
        return;
      }

      if (gPending) {
        disarmG();
        // T-CustomerNav (2026-05-08) — keyboard shortcuts only target
        // customer-surface routes. Pre-T-CustomerNav `g+p` (→ /pages)
        // and `g+m` (→ /competitors) routed to URLs that have been
        // hidden from the sidebar since 2026-04-22 (Phase 3.5F
        // "Surface Trust"); the shortcuts were dead wiring exposing
        // hidden surfaces via CMD+K.
        //
        // FP4 (2026-07-03) - route-name unification: URLs now match the nav
        // labels, so the chord letters follow the names. g+c = Changes
        // (/changes), g+e = Results (/results).
        //
        // Phase 4D (2026-07-21) - g+a (Ask) and g+p (AI questions) were dropped
        // with their surfaces; the chord map now targets only the five live nav
        // routes. Keep this in lockstep with the help dialog's Navigation group
        // and `NAV_SHORTCUTS` in `src/app/(shell)/layout.tsx` + `app-sidebar.tsx`.
        const routes: Record<string, string> = {
          t: "/",
          c: "/changes",
          e: "/results",
          k: "/settings/connectors",
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

  // #347 — fuzzy-rank when searching: keep items whose label OR meta
  // subsequence-matches the query, then sort by best score so the
  // tightest matches lead.
  const filtered = query
    ? items
        .map((item) => {
          const labelScore = fuzzyScore(item.label, query);
          const metaScore = item.meta ? fuzzyScore(item.meta, query) : null;
          const best =
            labelScore === null
              ? metaScore
              : metaScore === null
                ? labelScore
                : Math.min(labelScore, metaScore);
          return { item, score: best };
        })
        .filter(
          (x): x is { item: PaletteItem; score: number } => x.score !== null,
        )
        .sort((a, b) => a.score - b.score)
        .map((x) => x.item)
    : items;

  const maxPerGroup = query ? 25 : 6;
  const groups: { label: string; items: PaletteItem[] }[] = [];
  // #505 — track whether any group was truncated so we can tell the user
  // the list isn't complete instead of implying it is.
  let truncated = false;
  for (const g of GROUP_ORDER) {
    const all = filtered.filter((i) => i.group === g);
    const gItems = all.slice(0, maxPerGroup);
    if (all.length > gItems.length) truncated = true;
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
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
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
                placeholder="Jump to a page or section..."
                aria-label="Jump to a page or section"
                // #519 — combobox/listbox wiring: announce the active
                // option as the user arrows through results.
                role="combobox"
                aria-expanded
                aria-controls="command-palette-listbox"
                aria-activedescendant={
                  flatItems[selected]
                    ? `command-palette-option-${selected}`
                    : undefined
                }
                className="w-full bg-transparent py-3 text-[14px] outline-none placeholder:text-muted-foreground/50"
              />
              <kbd className="text-[10px] text-muted-foreground/60 border border-border rounded px-1.5 py-0.5 shrink-0">
                esc
              </kbd>
            </div>

            <div className="max-h-[320px] overflow-y-auto py-1.5">
              {/* #519 — the results are a real listbox; each item is an
                  option with aria-selected, and the input points its
                  aria-activedescendant at the selected option's id. */}
              <ul id="command-palette-listbox" role="listbox" aria-label="Results">
                {groups.map((group) => (
                  <li key={group.label} className="mb-1" role="presentation">
                    <p className="px-4 py-1 text-[11px] font-medium text-muted-foreground/60">
                      {group.label}
                    </p>
                    <ul role="presentation">
                      {group.items.map((item) => {
                        const idx = flatItems.indexOf(item);
                        return (
                          <li key={item.id} role="presentation">
                            <button
                              id={`command-palette-option-${idx}`}
                              role="option"
                              aria-selected={idx === selected}
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
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              {flatItems.length === 0 && (
                <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                  No results for &ldquo;{query}&rdquo;
                </p>
              )}
              {/* #505 — when a group was capped at maxPerGroup, the list
                  isn't complete; say so rather than imply it is. */}
              {truncated && flatItems.length > 0 && (
                <p
                  className="px-4 py-2 text-center text-[11px] text-muted-foreground/70"
                  data-palette-truncated="true"
                >
                  Showing the first {maxPerGroup} per group — refine your search
                  to narrow these down.
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-dialog-title"
            className="relative w-full max-w-sm rounded-xl border border-border bg-background shadow-2xl overflow-hidden p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="shortcuts-dialog-title" className="text-[13px] font-semibold">
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
                <HelpRow keys="G C" label="Changes" />
                <HelpRow keys="G E" label="Results" />
                <HelpRow keys="G K" label="Connections" />
                <HelpRow keys="G S" label="Settings" />
              </HelpGroup>
            </div>
          </div>
        </div>
      )}

      {/* #522 — visible feedback that the "g" chord is armed, so the user
          knows it registered before pressing the second key. Clears on
          the 500ms timeout or the second key (both reset gArmed). */}
      {gArmed && (
        <div
          className="fixed bottom-4 left-4 z-50 rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-semibold text-muted-foreground shadow-lg"
          data-palette-g-chord="armed"
          aria-hidden="true"
        >
          g…
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

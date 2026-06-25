"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * command-palette (2026-06-25) — ⌘K / Ctrl-K jump-anywhere for the cockpit. The
 * page is a long, dense scroll of lenses; this is the power-user way to land on
 * any section or route instantly without hunting. Pure client, no data: takes the
 * same section anchors the jump-nav renders, plus the key routes. Esc closes,
 * ↑/↓ move, Enter navigates (smooth-scroll for #anchors, router push for routes).
 */

export type PaletteTarget = { id: string; label: string };

type Entry = { label: string; hint: string; go: () => void };

export function CommandPalette({ targets }: { targets: PaletteTarget[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const scrollTo = (id: string) => () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const sectionEntries: Entry[] = targets.map((t) => ({
      label: t.label,
      hint: "Section",
      go: scrollTo(t.id),
    }));
    const routeEntries: Entry[] = [
      { label: "Proof — what your changes did", hint: "Page", go: () => router.push("/proof") },
      { label: "Competitors — who AI recommends", hint: "Page", go: () => router.push("/competitors") },
      { label: "Changes — your shipped log", hint: "Page", go: () => router.push("/changes") },
      { label: "Settings — connectors & data", hint: "Page", go: () => router.push("/settings/connectors") },
      { label: "Back to top", hint: "Action", go: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    ];
    return [...sectionEntries, ...routeEntries];
  }, [targets, router]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q));
  }, [entries, query]);

  // Global ⌘K / Ctrl-K to open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus + reset on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  function run(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    entry.go();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(filtered[active]);
            }
          }}
          placeholder="Jump to a section or page…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-muted-foreground">No matches.</li>
          ) : (
            filtered.map((e, i) => (
              <li key={`${e.label}-${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(e)}
                  className={
                    "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px] " +
                    (i === active ? "bg-muted text-foreground" : "text-foreground/80 hover:bg-muted/50")
                  }
                >
                  <span className="truncate">{e.label}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{e.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <kbd className="rounded border border-border px-1">↑</kbd>{" "}
          <kbd className="rounded border border-border px-1">↓</kbd> move ·{" "}
          <kbd className="rounded border border-border px-1">↵</kbd> go ·{" "}
          <kbd className="rounded border border-border px-1">esc</kbd> close
        </div>
      </div>
    </div>
  );
}

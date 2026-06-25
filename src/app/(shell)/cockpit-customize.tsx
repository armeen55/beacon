"use client";

import { useEffect, useState } from "react";

/**
 * cockpit-customize (2026-06-25) — let the operator tailor the dense cockpit to
 * the lenses they actually use. The page is ~20 self-hiding sections; this hides
 * the ones an operator doesn't care about, persisted in localStorage, by toggling
 * `display` on the existing `#sec-*` anchor wrappers (no server, no structural
 * refactor, no data risk). A premium "make it mine" control. Pure client.
 */

const STORAGE_KEY = "beacon:cockpit-hidden-sections";

function readHidden(): Set<string> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function applyHidden(ids: Set<string>, all: { id: string }[]): void {
  for (const t of all) {
    const el = document.getElementById(t.id);
    if (el) (el as HTMLElement).style.display = ids.has(t.id) ? "none" : "";
  }
}

export function CockpitCustomize({ targets }: { targets: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  // Hydrate + apply saved prefs on mount.
  useEffect(() => {
    const saved = readHidden();
    setHidden(saved);
    setHydrated(true);
    applyHidden(saved, targets);
  }, [targets]);

  // The ⌘K palette can open this panel via a custom event (one control surface).
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("beacon:open-customize", openIt);
    return () => window.removeEventListener("beacon:open-customize", openIt);
  }, []);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      applyHidden(next, targets);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore quota / privacy-mode errors */
      }
      return next;
    });
  }

  function showAll() {
    setHidden(() => {
      const next = new Set<string>();
      applyHidden(next, targets);
      try {
        window.localStorage.setItem(STORAGE_KEY, "[]");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (!hydrated) return null;
  const hiddenCount = hidden.size;

  return (
    <div className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>⚙</span> Customize{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 max-h-[60vh] w-64 overflow-auto rounded-xl border border-border bg-background p-2 shadow-xl">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Show sections</span>
              {hiddenCount > 0 ? (
                <button type="button" onClick={showAll} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
                  Show all
                </button>
              ) : null}
            </div>
            <ul className="mt-1 space-y-0.5">
              {targets.map((t) => {
                const visible = !hidden.has(t.id);
                return (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-foreground hover:bg-muted/50">
                      <input type="checkbox" checked={visible} onChange={() => toggle(t.id)} className="h-3.5 w-3.5 accent-violet-600" />
                      <span className={visible ? "" : "text-muted-foreground line-through"}>{t.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

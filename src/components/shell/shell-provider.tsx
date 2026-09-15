"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

/** A palette item hydrated after first paint (the changelog "Results" group).
 *  Shape-compatible with `PaletteItem` in `command-palette.tsx`. */
export type LatePaletteItem = {
  id: string;
  label: string;
  group: string;
  href: string;
  meta?: string;
  shortcut?: string;
};

type ShellHydration = { latePaletteItems: LatePaletteItem[] };

type ShellContextValue = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Palette items that arrive after first paint (changelog entries). */
  latePaletteItems: LatePaletteItem[];
  /** FP1 (2026-07-02): palette-extras stream in AFTER the shell paints. */
  hydrateShellData: (data: ShellHydration) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((s) => !s), []);
  const [latePaletteItems, setLatePaletteItems] = useState<LatePaletteItem[]>([]);
  const hydrateShellData = useCallback((data: ShellHydration) => {
    setLatePaletteItems(data.latePaletteItems);
  }, []);

  return (
    <ShellContext.Provider
      value={{ sidebarOpen, toggleSidebar, setSidebarOpen, latePaletteItems, hydrateShellData }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}

/** FP1 (2026-07-02) - rendered by the layout's deferred (Suspense-streamed) data
 *  component. Pushes the late-loaded palette entries into the
 *  shell context once they arrive, so first paint never waits on Supabase. */
export function ShellDataHydrator({ latePaletteItems }: ShellHydration) {
  const { hydrateShellData } = useShell();
  useEffect(() => {
    hydrateShellData({ latePaletteItems });
  }, [hydrateShellData, latePaletteItems]);
  return null;
}

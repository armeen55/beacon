"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

export type NavBadges = Record<string, number>;

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

export type ShellHydration = {
  badges: NavBadges;
  isDemoMode: boolean;
  latePaletteItems: LatePaletteItem[];
};

type ShellContextValue = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  badges: NavBadges;
  /** True when no import runs exist, i.e. the workspace is showing bundled sample data (see `seed-data.server.ts`). */
  isDemoMode: boolean;
  /** Palette items that arrive after first paint (changelog entries). */
  latePaletteItems: LatePaletteItem[];
  /** FP1 (2026-07-02): badges/demo/palette-extras stream in AFTER the shell paints. */
  hydrateShellData: (data: ShellHydration) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  badges: initialBadges = {},
  isDemoMode: initialIsDemoMode = false,
}: {
  children: React.ReactNode;
  badges?: NavBadges;
  isDemoMode?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((s) => !s), []);
  // FP1 (2026-07-02) - the shell paints instantly with empty badges; the real
  // counts stream in from the layout's deferred data component and hydrate here.
  const [badges, setBadges] = useState<NavBadges>(initialBadges);
  const [isDemoMode, setIsDemoMode] = useState(initialIsDemoMode);
  const [latePaletteItems, setLatePaletteItems] = useState<LatePaletteItem[]>([]);
  const hydrateShellData = useCallback((data: ShellHydration) => {
    setBadges(data.badges);
    setIsDemoMode(data.isDemoMode);
    setLatePaletteItems(data.latePaletteItems);
  }, []);

  return (
    <ShellContext.Provider
      value={{ sidebarOpen, toggleSidebar, setSidebarOpen, badges, isDemoMode, latePaletteItems, hydrateShellData }}
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
 *  component. Pushes the late-loaded badges/demo-mode/palette entries into the
 *  shell context once they arrive, so first paint never waits on Supabase. */
export function ShellDataHydrator({ badges, isDemoMode, latePaletteItems }: ShellHydration) {
  const { hydrateShellData } = useShell();
  useEffect(() => {
    hydrateShellData({ badges, isDemoMode, latePaletteItems });
  }, [hydrateShellData, badges, isDemoMode, latePaletteItems]);
  return null;
}

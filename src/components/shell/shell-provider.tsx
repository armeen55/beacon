"use client";

import { createContext, useContext, useState, useCallback } from "react";

export type NavBadges = Record<string, number>;

type ShellContextValue = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  badges: NavBadges;
  /** True when no import runs exist — workspace is showing bundled sample data (see `seed-data.server.ts`). */
  isDemoMode: boolean;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  badges = {},
  isDemoMode = false,
}: {
  children: React.ReactNode;
  badges?: NavBadges;
  isDemoMode?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((s) => !s), []);

  return (
    <ShellContext.Provider
      value={{ sidebarOpen, toggleSidebar, setSidebarOpen, badges, isDemoMode }}
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

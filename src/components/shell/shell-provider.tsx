"use client";

import { createContext, useContext, useState, useCallback } from "react";

export type NavBadges = Record<string, number>;

type ShellContextValue = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  badges: NavBadges;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  badges = {},
}: {
  children: React.ReactNode;
  badges?: NavBadges;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((s) => !s), []);

  return (
    <ShellContext.Provider
      value={{ sidebarOpen, toggleSidebar, setSidebarOpen, badges }}
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

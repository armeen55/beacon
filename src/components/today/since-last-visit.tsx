"use client";

/**
 * Since Last Visit — tiny header above Today's action stack showing what's
 * new since the user last opened the page. Purely client-side via
 * localStorage: no server state, no data plumbing. Updates the timestamp
 * after a short grace period so the user actually sees the delta.
 *
 * Input: the current list of visible hurting/helping card IDs. The component
 * remembers the previous set and highlights additions/removals.
 *
 * Added 2026-04-19 (Phase 7 Part 1d-#7 "Today UX pass").
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "beacon.today.lastVisit.v1";
const GRACE_PERIOD_MS = 30_000; // Give the user 30s to read before marking as "seen"

type Snapshot = {
  seenAt: string;
  cardIds: string[];
};

export function SinceLastVisit({
  currentCardIds,
}: {
  currentCardIds: string[];
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Snapshot;
        if (parsed && typeof parsed.seenAt === "string" && Array.isArray(parsed.cardIds)) {
          setSnapshot(parsed);
        }
      }
    } catch {
      // Corrupted storage — ignore, fall through to "first visit" state.
    }
  }, []);

  // Write the new snapshot after the grace period. This way the strip shows
  // meaningful content ("3 new since Apr 18") on load and only silently
  // updates once the user has had a chance to read it.
  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => {
      try {
        const next: Snapshot = {
          seenAt: new Date().toISOString(),
          cardIds: currentCardIds,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage disabled or full — silently skip.
      }
    }, GRACE_PERIOD_MS);
    return () => clearTimeout(t);
  }, [mounted, currentCardIds]);

  // Before hydration OR on first-ever visit, render nothing.
  if (!mounted || !snapshot) return null;

  const prevSet = new Set(snapshot.cardIds);
  const currSet = new Set(currentCardIds);
  const newCards = currentCardIds.filter((id) => !prevSet.has(id));
  const resolvedCards = snapshot.cardIds.filter((id) => !currSet.has(id));

  if (newCards.length === 0 && resolvedCards.length === 0) return null;

  const newHurting = newCards.filter((id) => id.startsWith("hurt-")).length;
  const newWins = newCards.filter((id) => id.startsWith("win-")).length;
  const resolvedHurting = resolvedCards.filter((id) => id.startsWith("hurt-")).length;
  const resolvedWins = resolvedCards.filter((id) => id.startsWith("win-")).length;

  const parts: string[] = [];
  if (newHurting > 0) parts.push(`${newHurting} new regression${newHurting === 1 ? "" : "s"}`);
  if (newWins > 0) parts.push(`${newWins} new win${newWins === 1 ? "" : "s"}`);
  if (resolvedHurting > 0) parts.push(`${resolvedHurting} regression${resolvedHurting === 1 ? "" : "s"} resolved`);
  if (resolvedWins > 0) parts.push(`${resolvedWins} win${resolvedWins === 1 ? "" : "s"} closed`);
  if (parts.length === 0) return null;

  const seenDate = (() => {
    try {
      const d = new Date(snapshot.seenAt);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "your last visit";
    }
  })();

  return (
    <div className="rounded-md border border-accent-primary/25 bg-accent-primary/[0.03] px-3 py-2">
      <p className="text-[11px] text-foreground/80">
        <span className="font-semibold">Since {seenDate}:</span>{" "}
        <span className="text-muted-foreground">{parts.join(" \u00b7 ")}</span>
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * cockpit-jump-nav (2026-06-25) — a sticky "jump to" index for the cockpit's many
 * self-hiding sections. Each section is wrapped in an anchor `<div id=...>`; on
 * mount we keep only the anchors that actually rendered content (a self-hidden
 * section leaves an EMPTY wrapper), so the nav never points at a blank section.
 * Pure client, no deps — premium navigation for the 20-min ritual.
 */

export type JumpTarget = { id: string; label: string };

export function CockpitJumpNav({ targets }: { targets: JumpTarget[] }) {
  const [present, setPresent] = useState<JumpTarget[]>([]);

  useEffect(() => {
    // A wrapper whose section self-hid (returned null) has no element children.
    const live = targets.filter((t) => {
      const el = document.getElementById(t.id);
      return !!el && el.childElementCount > 0;
    });
    setPresent(live);
  }, [targets]);

  if (present.length <= 1) return null;

  return (
    <nav className="sticky top-2 z-20 -mx-1 flex flex-wrap gap-1.5 rounded-2xl border border-gray-200/70 bg-white/80 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-white/60 print:hidden">
      <span className="self-center pl-1 pr-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Jump to
      </span>
      {present.map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          className="rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

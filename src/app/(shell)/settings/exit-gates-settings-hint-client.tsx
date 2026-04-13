"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  EXIT_GATE_DEFAULT_UPDATED_AT,
  type ExitGateRecord,
  type ExitGateStatus,
} from "@/lib/exit-gates-types";

function humanStatus(s: ExitGateStatus): string {
  return s.replace(/_/g, " ");
}

function gateEngaged(g: ExitGateRecord): boolean {
  return (
    g.status !== "not_started" ||
    g.note.trim().length > 0 ||
    g.updated_at !== EXIT_GATE_DEFAULT_UPDATED_AT
  );
}

export function ExitGatesSettingsHintClient({ gates }: { gates: ExitGateRecord[] }) {
  const pathname = usePathname() ?? "";

  const local = gates.find((g) => g.key === "local_layer");
  const onSignOffsPage = pathname === "/settings/exit-gates";
  const anyEngaged = gates.some(gateEngaged);
  const localNeedsAttention = local && local.status !== "passed";
  const showForLocalOnSignOffs = Boolean(onSignOffsPage && localNeedsAttention);

  if (!anyEngaged && !showForLocalOnSignOffs) return null;

  const parts: string[] = [];
  for (const g of gates) {
    if (g.status !== "passed") parts.push(`${labelForKey(g.key)}: ${humanStatus(g.status)}`);
  }

  return (
    <div
      className="mb-4 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2 text-[11px] text-muted-foreground leading-snug"
      data-testid="exit-gates-settings-hint"
    >
      <span className="font-medium text-foreground/90">Readiness review</span>
      {" — "}
      <span>{parts.join(" · ")}</span>
      {" · "}
      <Link href="/settings/exit-gates" className="text-accent-primary font-medium hover:underline">
        Internal sign-off
      </Link>
      <span className="text-muted-foreground/80">
        {" "}
        (Does not affect underlying metrics, scores, or freshness states.)
      </span>
    </div>
  );
}

function labelForKey(key: ExitGateRecord["key"]): string {
  switch (key) {
    case "daily_ritual":
      return "Daily Ritual";
    case "replication":
      return "Replication";
    case "local_layer":
      return "Local layer";
    default:
      return key;
  }
}

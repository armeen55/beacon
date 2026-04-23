"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EXIT_GATE_DEFAULT_UPDATED_AT,
  type ExitGateKey,
  type ExitGateRecord,
  type ExitGateStatus,
} from "@/lib/exit-gates-types";
import { saveExitGateNote, setExitGateStatus } from "./actions";

const LABEL: Record<ExitGateKey, string> = {
  daily_ritual: "Daily Ritual",
  replication: "Replication",
  local_layer: "Local layer",
};

/** Static operator checklist for the Local layer sign-off — not persisted. */
const LOCAL_LAYER_CHECKLIST_ITEMS: readonly string[] = [
  "`/local` matches current methodology",
  "Review sources and disclosures are accurate",
  "NAP states are understandable",
  "Listing health and listing completeness are understandable",
  "Per-source timestamps are understandable",
  "Today and Market local surfacing is not misleading",
  "No copy implies real-time or full coverage",
];

function formatUpdated(iso: string): string {
  if (iso === EXIT_GATE_DEFAULT_UPDATED_AT) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function statusBadgeClass(s: ExitGateStatus): string {
  switch (s) {
    case "passed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25";
    case "failed":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "in_review":
      return "bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/25";
    default:
      return "bg-muted/40 text-muted-foreground border-border/50";
  }
}

function GateCard({ gate }: { gate: ExitGateRecord }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [noteDraft, setNoteDraft] = useState(gate.note);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    setNoteDraft(gate.note);
  }, [gate.note, gate.updated_at]);

  const runStatus = (status: ExitGateStatus) => {
    setSaveMsg(null);
    startTransition(async () => {
      await setExitGateStatus(gate.key, status);
      router.refresh();
    });
  };

  const runSaveNote = () => {
    setSaveMsg(null);
    startTransition(async () => {
      await saveExitGateNote(gate.key, noteDraft);
      setSaveMsg("Note saved.");
      router.refresh();
    });
  };

  return (
    <section
      className="rounded-lg border border-border/50 bg-surface-inset/10 p-4 mb-4"
      data-testid={`exit-gate-card-${gate.key}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-foreground">{LABEL[gate.key]}</h2>
        <span
          className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded border ${statusBadgeClass(gate.status)}`}
          data-testid={`exit-gate-status-${gate.key}`}
        >
          {gate.status.replace(/_/g, " ")}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Updated: <span className="font-mono text-foreground/80">{formatUpdated(gate.updated_at)}</span>
      </p>

      {gate.key === "local_layer" ? (
        <div
          className="mb-3 rounded-md border border-border/40 bg-background/40 px-3 py-2"
          data-testid="exit-gate-checklist-local_layer"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Review checklist
          </p>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-muted-foreground leading-snug">
            {LOCAL_LAYER_CHECKLIST_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => runStatus("in_review")}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/60 hover:bg-surface-inset/40 disabled:opacity-50"
        >
          Mark in review
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => runStatus("passed")}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/60 hover:bg-surface-inset/40 disabled:opacity-50"
        >
          Mark passed
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => runStatus("failed")}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-border/60 hover:bg-surface-inset/40 disabled:opacity-50"
        >
          Mark failed
        </button>
      </div>

      <label className="block text-[11px] font-medium text-foreground/90 mb-1">Note (optional)</label>
      <textarea
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        rows={3}
        className="w-full text-sm rounded-md border border-border/60 bg-background px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-primary/40 mb-2"
        placeholder="Short operator context…"
        data-testid={`exit-gate-note-${gate.key}`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={runSaveNote}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50"
        >
          Save note
        </button>
        {saveMsg ? <span className="text-[11px] text-muted-foreground">{saveMsg}</span> : null}
      </div>
    </section>
  );
}

export function ExitGatesClient({ initialGates }: { initialGates: ExitGateRecord[] }) {
  const [gates, setGates] = useState(initialGates);

  useEffect(() => {
    setGates(initialGates);
  }, [initialGates]);

  return (
    <div className="max-w-xl" data-testid="exit-gates-client">
      <p className="text-[12px] text-muted-foreground mb-4 leading-relaxed">
        Status values are for your own readiness tracking. They are not shown on Today, Market, the Local route, or Changes and do not modify scores, findings, freshness states, or proof logic.
      </p>
      {gates.map((g) => (
        <GateCard key={g.key} gate={g} />
      ))}
    </div>
  );
}

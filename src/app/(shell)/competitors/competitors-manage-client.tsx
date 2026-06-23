"use client";

import { useState, useTransition } from "react";
import type { ConfiguredCompetitorEntry } from "@/domains/competitors/universe-types";
import { saveConfiguredCompetitorUniverseAction } from "./competitors-actions";
import { cn } from "@/lib/utils";

function emptyRow(): ConfiguredCompetitorEntry {
  return {
    id: "",
    display_name: "",
    domain: "",
    status: "active",
    notes: null,
    tags: [],
  };
}

export function CompetitorsManageClient({
  initialEntries,
  universeVersion,
  universeFingerprint,
}: {
  initialEntries: ConfiguredCompetitorEntry[];
  universeVersion: number | null;
  universeFingerprint: string | null;
}) {
  const [rows, setRows] = useState<ConfiguredCompetitorEntry[]>(() =>
    initialEntries.length ? [...initialEntries] : []
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateRow(
    i: number,
    patch: Partial<ConfiguredCompetitorEntry>
  ): void {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function save(): void {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const r = await saveConfiguredCompetitorUniverseAction(rows);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setMsg("Saved. Your competitor list was updated.");
    });
  }

  return (
    <div className="rounded-md border border-border bg-surface-raised/20 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold text-foreground">
            Manage your competitor list
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Your competitor list is saved here.
            {universeVersion != null ? ` Version: v${universeVersion}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={cn(
              "text-[11px] px-3 py-1.5 rounded-md border border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary font-medium hover:bg-accent-primary/[0.12]"
            )}
            onClick={() => setRows((r) => [...r, emptyRow()])}
          >
            + Add a competitor
          </button>
          <button
            type="button"
            disabled={pending}
            className="text-[11px] px-3 py-1.5 rounded-md bg-accent-primary text-primary-foreground disabled:opacity-50"
            onClick={save}
          >
            {pending ? "Saving…" : "Save universe"}
          </button>
        </div>
      </div>
      {err && (
        <p className="text-[11px] text-status-danger font-medium">{err}</p>
      )}
      {msg && (
        <p className="text-[11px] text-status-success font-medium">{msg}</p>
      )}
      <div className="space-y-2 max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No competitors added yet. Click + Add a competitor to start.
          </p>
        ) : (
          rows.map((row, i) => (
            <div
              key={`${i}-${row.id || row.domain}`}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 text-[11px] border border-border/60 rounded p-2 bg-surface-inset/30"
            >
              <label className="md:col-span-2 flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground uppercase">
                  Id
                </span>
                <input
                  className="bg-background border border-border rounded px-2 py-1 font-mono text-[10px]"
                  value={row.id}
                  onChange={(e) => updateRow(i, { id: e.target.value })}
                  placeholder="cfg-example-com"
                />
              </label>
              <label className="md:col-span-3 flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground uppercase">
                  Display name
                </span>
                <input
                  className="bg-background border border-border rounded px-2 py-1"
                  value={row.display_name}
                  onChange={(e) =>
                    updateRow(i, { display_name: e.target.value })
                  }
                />
              </label>
              <label className="md:col-span-3 flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground uppercase">
                  Domain
                </span>
                <input
                  className="bg-background border border-border rounded px-2 py-1 font-mono text-[10px]"
                  value={row.domain}
                  onChange={(e) => updateRow(i, { domain: e.target.value })}
                  placeholder="example.com"
                />
              </label>
              <label className="md:col-span-1 flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground uppercase">
                  Active
                </span>
                <select
                  className="bg-background border border-border rounded px-1 py-1"
                  value={row.status}
                  onChange={(e) =>
                    updateRow(i, {
                      status:
                        e.target.value === "inactive" ? "inactive" : "active",
                    })
                  }
                >
                  <option value="active">Yes</option>
                  <option value="inactive">No</option>
                </select>
              </label>
              <label className="md:col-span-2 flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground uppercase">
                  Tags
                </span>
                <input
                  className="bg-background border border-border rounded px-2 py-1 text-[10px]"
                  value={(row.tags ?? []).join(", ")}
                  onChange={(e) =>
                    updateRow(i, {
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="comma separated"
                />
              </label>
              <label className="md:col-span-12 flex flex-col gap-0.5">
                <span className="text-[9px] text-muted-foreground uppercase">
                  Notes
                </span>
                <input
                  className="bg-background border border-border rounded px-2 py-1 text-[10px]"
                  value={row.notes ?? ""}
                  onChange={(e) =>
                    updateRow(i, { notes: e.target.value || null })
                  }
                />
              </label>
              <div className="md:col-span-12 flex justify-end">
                <button
                  type="button"
                  className="text-[10px] text-status-danger hover:underline"
                  onClick={() =>
                    setRows((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  Remove row
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

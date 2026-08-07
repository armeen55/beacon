"use client";

/**
 * DataTable - the ONE ranked table this surface uses for pages, searches, questions, credited sites and
 * runs. Sorting is the only thing it holds in state: every value it shows was computed on the server off
 * readings already stored, so a click here never asks anybody for anything.
 *
 * A wide table SCROLLS INSIDE ITSELF rather than pushing the page sideways, and the header stays put while
 * the rows move, because a number with its column heading off screen is a number nobody can read.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

type Cell = { text: string; sub?: string; tone?: "up" | "down" | "flat" | "own"; sort?: number; href?: string };
type Column = { key: string; label: string; numeric?: boolean; wide?: boolean };
type Row = { id: string; href?: string; cells: Cell[] };

const TONE: Record<NonNullable<Cell["tone"]>, string> = {
  up: "text-status-success", down: "text-status-danger", flat: "text-muted-foreground", own: "text-accent-primary",
};

export function DataTable({ columns, rows, empty, note, tall }: {
  columns: Column[]; rows: Row[]; empty: string; note?: string | null; tall?: boolean;
}) {
  const [by, setBy] = useState<number | null>(null);
  const [asc, setAsc] = useState(false);
  const sorted = useMemo(() => {
    if (by == null) return rows;
    const key = (r: Row): number | string => { const c = r.cells[by]; return c?.sort ?? c?.text ?? ""; };
    return [...rows].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return asc ? cmp : -cmp;
    });
  }, [rows, by, asc]);
  if (rows.length === 0) return <p className="px-1 py-3 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {note ? <p className="text-[12px] leading-relaxed text-muted-foreground">{note}</p> : null}
      <div className={`overflow-auto rounded-xl border border-border ${tall ? "max-h-[640px]" : "max-h-[420px]"}`}>
        <table className="w-full min-w-[720px] border-collapse text-left text-[12px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-surface-inset">
            <tr>
              {columns.map((c, i) => (
                <th key={c.key} scope="col" className={`whitespace-nowrap border-b border-border px-2.5 py-2 font-semibold text-foreground/70 ${c.numeric ? "text-right" : "text-left"}`}>
                  <button type="button" onClick={() => { if (by === i) setAsc(!asc); else { setBy(i); setAsc(false); } }}
                    aria-label={`Sort by ${c.label}`} className="inline-flex items-center gap-1 hover:text-foreground">
                    {c.label}<span aria-hidden className={by === i ? "opacity-80" : "opacity-25"}>{by === i && asc ? "↑" : "↓"}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface-inset/60">
                {r.cells.map((cell, i) => {
                  const col = columns[i]!;
                  const body = (
                    <>
                      <span className={`block ${col.wide ? "max-w-[320px] truncate" : ""} ${cell.tone ? TONE[cell.tone] : ""} ${i === 0 ? "font-medium text-foreground" : ""}`} title={cell.text}>{cell.text}</span>
                      {cell.sub ? <span className="block max-w-[320px] truncate text-[11px] text-muted-foreground" title={cell.sub}>{cell.sub}</span> : null}
                    </>
                  );
                  const href = cell.href ?? (i === 0 ? r.href : undefined);
                  return (
                    <td key={col.key} className={`px-2.5 py-1.5 align-top ${col.numeric ? "text-right" : "text-left"}`}>
                      {href ? <Link href={href} className="block hover:underline underline-offset-2">{body}</Link> : body}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

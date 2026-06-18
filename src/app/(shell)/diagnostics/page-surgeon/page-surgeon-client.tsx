"use client";

import { useState, useTransition } from "react";

import { runPageSurgeonBrief, type PageSurgeonRow } from "./actions";
import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" }) {
  const cls =
    tone === "good"
      ? "bg-status-success/15 text-status-success"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-surface-inset/60 text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function Brief({ d }: { d: PageAtomicDecision }) {
  const ev = d.evidence_by_source;
  const evRows = Object.entries(ev).filter(([, v]) => v);
  return (
    <div className="mt-3 space-y-3 rounded-md border border-border/40 bg-surface-raised/30 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="good">{d.recommended_atomic_action}</Pill>
        <Pill tone={d.confidence === "high" ? "good" : d.confidence === "needs_more_evidence" ? "warn" : "muted"}>
          {d.confidence}
        </Pill>
        <Pill tone={d.publishability === "staged" ? "good" : "muted"}>{d.publishability}</Pill>
        <Pill>{d.decided_by}</Pill>
      </div>

      {d.title_candidate && (
        <p>
          <span className="font-semibold text-foreground">Proposed title:</span>{" "}
          “{d.title_candidate}”
        </p>
      )}

      <p className="rounded bg-accent-primary/[0.05] p-2 leading-relaxed">
        <span className="font-semibold text-foreground">💡 Operator insight:</span>{" "}
        {d.operator_insight}
      </p>

      <div>
        <p className="font-semibold text-foreground">Why (hypothesis):</p>
        <p className="text-muted-foreground leading-relaxed">{d.hypothesis}</p>
      </div>

      {evRows.length > 0 && (
        <div>
          <p className="font-semibold text-foreground">Evidence by source:</p>
          <ul className="ml-4 list-disc text-muted-foreground">
            {evRows.map(([k, v]) => (
              <li key={k}>
                <span className="font-medium text-foreground/80">{k}:</span> {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.rejected_alternatives.length > 0 && (
        <div>
          <p className="font-semibold text-foreground">Rejected alternatives:</p>
          <ul className="ml-4 list-disc text-muted-foreground">
            {d.rejected_alternatives.map((r, i) => (
              <li key={i}>
                <span className="font-medium text-foreground/80">{r.action}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <p>
          <span className="font-semibold text-foreground">Before:</span>{" "}
          <span className="text-muted-foreground">{d.before_after_diff.before ?? "—"}</span>
        </p>
        <p>
          <span className="font-semibold text-foreground">After:</span>{" "}
          <span className="text-muted-foreground">{d.before_after_diff.after ?? "—"}</span>
        </p>
      </div>

      <p><span className="font-semibold text-foreground">Risk:</span> <span className="text-muted-foreground">{d.risk || "—"}</span></p>
      <p><span className="font-semibold text-foreground">Measurement:</span> <span className="text-muted-foreground">{d.measurement_plan}</span></p>
      <p><span className="font-semibold text-foreground">Rollback:</span> <span className="text-muted-foreground">{d.rollback_plan}</span></p>
    </div>
  );
}

function Card({ row }: { row: PageSurgeonRow }) {
  const [decision, setDecision] = useState<PageAtomicDecision | null>(row.cached);
  const [stale, setStale] = useState(row.stale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await runPageSurgeonBrief(row.canonUrl);
      if (res.ok) {
        setDecision(res.decision);
        setStale(false);
      } else {
        setError(res.error);
      }
    });
  };

  const path = row.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
  return (
    <div className="rounded-lg border border-border/60 bg-surface-inset/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">{path}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            now: “{row.currentTitle ?? "(no title)"}”
          </p>
          {row.gsc && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              “{row.gsc.topQuery}” · {row.gsc.impressions.toLocaleString()} impr ·{" "}
              {row.gsc.clicks.toLocaleString()} clicks · pos {row.gsc.position.toFixed(1)} ·{" "}
              {(row.gsc.ctr * 100).toFixed(2)}% CTR
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={run}
            disabled={pending || !row.hasOpenAi}
            className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            title={row.hasOpenAi ? "" : "OPENAI_API_KEY not set"}
          >
            {pending ? "Running…" : decision ? "Re-run" : "Run Page Surgeon"}
          </button>
          {stale && <span className="text-[10px] text-amber-600">evidence changed — re-run</span>}
          {!row.hasOpenAi && <span className="text-[10px] text-muted-foreground">no OpenAI key</span>}
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
      {decision && <Brief d={decision} />}
    </div>
  );
}

export function PageSurgeonClient({ rows }: { rows: PageSurgeonRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No pages with Google Search Console demand yet. Connect + refresh Search Console first.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <Card key={r.canonUrl} row={r} />
      ))}
    </div>
  );
}

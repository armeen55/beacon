"use client";

/**
 * ChangesListClient (2026-07-01) — the canonical Changes list. ONE compact, action-first row per
 * change; strategy control (Balanced/Growth/Clean) + status views (To do/Ready/Measuring/Results) +
 * goal filter + search, all pure client filtering over the server-built CanonicalChange[]. Advanced
 * detail (the full evidence-rich card + working actions) is reused behind progressive disclosure —
 * expand a row to reveal the existing MoveCard. No nested cards by default; no research dump up front.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { ChangesView } from "./changes-data";
import type { CanonicalChange, Strategy, Goal, StatusView } from "@/domains/changes/canonical-change";
import { EVIDENCE_LABEL, statusView } from "@/domains/changes/canonical-change";
import { rankChanges, goalMatches, inStatusView } from "@/domains/changes/strategy";
import { MoveCard } from "./today-moves-card";

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: "balanced", label: "Balanced", hint: "Best mix of upside, effort, risk, and evidence (recommended)." },
  { id: "growth", label: "Growth first", hint: "Prioritize impact, even when proof will be less controlled." },
  { id: "clean", label: "Clean tests", hint: "Only changes Beacon can measure most confidently." },
];
const TABS: { id: StatusView; label: string }[] = [
  { id: "todo", label: "To do" }, { id: "ready", label: "Ready" }, { id: "measuring", label: "Measuring" }, { id: "results", label: "Results" },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: "recommended", label: "Recommended" }, { id: "quick_wins", label: "Quick wins" }, { id: "biggest_upside", label: "Biggest upside" },
  { id: "recover_traffic", label: "Recover traffic" }, { id: "ai_visibility", label: "AI visibility" }, { id: "new_pages", label: "New pages" },
];

const STATUS_CHIP: Record<CanonicalChange["status"], { label: string; cls: string }> = {
  suggested: { label: "To do", cls: "bg-gray-100 text-gray-600" },
  ready: { label: "Ready", cls: "bg-sky-100 text-sky-700" },
  apply: { label: "Apply in Wix", cls: "bg-amber-100 text-amber-700" },
  verify: { label: "Verifying", cls: "bg-blue-100 text-blue-700" },
  measuring: { label: "Measuring", cls: "bg-emerald-100 text-emerald-700" },
  result: { label: "Result", cls: "bg-violet-100 text-violet-700" },
  blocked: { label: "Wait", cls: "bg-gray-100 text-gray-400" },
  skipped: { label: "Skipped", cls: "bg-gray-100 text-gray-400" },
};
const EVIDENCE_CLS: Record<string, string> = { strong: "text-emerald-600", directional: "text-amber-600", tracking: "text-gray-500" };

function fmt(n: number | null | undefined): string {
  if (!n) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function Row({ c, move, rank }: { c: CanonicalChange; move: ChangesView["movesById"][string] | undefined; rank: number }) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[c.status];
  const isMeasure = c.status === "measuring" || c.status === "result";
  const cta = isMeasure ? (c.status === "result" ? "View result" : "View measurement") : c.status === "apply" || c.status === "verify" ? "Apply" : "Review";
  return (
    <div className={`rounded-lg border border-gray-100 bg-white ${c.status === "blocked" ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-900">{c.pageLabel}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>
            {c.selectedForToday && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">Today</span>}
          </div>
          <div className="truncate text-xs text-gray-500">
            {c.measurementHeadline ? (
              <>
                <span className="font-medium text-gray-700">{c.measurementHeadline}</span>
                {c.status === "measuring" && c.nextCheckpoint ? <span className="text-gray-400"> · next read {c.nextCheckpoint}</span> : null}
                {c.attributionLimited ? <span className="text-amber-600"> · overlapping edit</span> : null}
              </>
            ) : (
              c.recommendation
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
            <span>{c.opportunityType}</span>
            <span>~{c.estimatedEffortMinutes} min</span>
            {c.upside ? <span className="text-sky-600">{fmt(c.upside)}/mo at stake</span> : null}
            <span className={EVIDENCE_CLS[c.evidenceStrength]}>{EVIDENCE_LABEL[c.evidenceStrength]}</span>
            {c.blockedReason ? <span className="text-gray-400" title={c.blockedReason}>⏳ wait</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMeasure ? (
            <Link href={`/proof?page=${encodeURIComponent(c.pageUrl)}`} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">{cta} →</Link>
          ) : c.status === "blocked" ? (
            <span className="text-[11px] text-gray-400" title={c.blockedReason ?? ""}>Not now</span>
          ) : (
            <button onClick={() => setOpen((o) => !o)} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">{open ? "Hide" : cta}</button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-gray-100 px-1 py-1">
          {move ? (
            <MoveCard m={move} rank={rank} />
          ) : (
            <div className="px-3 py-2 text-sm">
              {c.before != null && <div className="text-xs"><span className="text-gray-500">Current: </span>{c.before || "(none)"}</div>}
              {c.after != null && <div className="text-xs"><span className="text-gray-500">Proposed: </span><strong>{c.after}</strong></div>}
              {c.exactInstructions && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-[11px] font-mono text-gray-700">{c.exactInstructions}</pre>}
              <div className="mt-2 text-[11px] text-gray-400">{c.measurementMethod}{c.selectedForToday ? " · selected for today — apply it in the “Daily experiments” panel above" : ""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChangesListClient({ view }: { view: ChangesView }) {
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const initialTab: StatusView = view.summary.ready > 0 ? "ready" : "todo";
  const [tab, setTab] = useState<StatusView>(initialTab);
  const [goal, setGoal] = useState<Goal>("recommended");
  const [q, setQ] = useState("");

  const ranked = useMemo(() => rankChanges(view.changes, strategy), [view.changes, strategy]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ranked.filter((c) => inStatusView(c, tab) && goalMatches(c, goal) && (!needle || `${c.pageLabel} ${c.pagePath} ${c.recommendation}`.toLowerCase().includes(needle)));
  }, [ranked, tab, goal, q]);

  const s = view.summary;
  return (
    <div className="space-y-3">
      {/* Strategy */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">How should Beacon prioritize?</span>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
          {STRATEGIES.map((st) => (
            <button key={st.id} onClick={() => setStrategy(st.id)} title={st.hint}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${strategy === st.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{st.label}</button>
          ))}
        </div>
      </div>
      {/* Status tabs + goal + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === t.id ? "bg-sky-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {t.label} <span className={tab === t.id ? "text-sky-100" : "text-gray-400"}>{s[t.id]}</span>
            </button>
          ))}
        </div>
        <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700">
          {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" className="ml-auto w-40 rounded-md border border-gray-200 px-2 py-1 text-xs" />
      </div>
      {/* List */}
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          {tab === "results" ? "No measured results yet — they’ll appear here once changes mature." : tab === "measuring" ? "Nothing is measuring right now." : "Nothing matches these filters."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((c, i) => <Row key={c.id} c={c} move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}

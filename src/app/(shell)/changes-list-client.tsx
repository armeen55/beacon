"use client";

/**
 * ChangesListClient (2026-07-01; Move 3 hardening) - the canonical Changes list. ONE compact,
 * action-first row per change; strategy control + status views + goal filter + search, pure client
 * filtering over the server-built CanonicalChange[]. Advanced detail reuses the existing MoveCard
 * behind progressive disclosure. Move 3: responsive control cluster (no clip/overflow on mobile),
 * keyboard + screen-reader semantics (aria-pressed/expanded, focus rings, role=status), state shown
 * by text + border (not color alone), and cause-specific empty states.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ChangesView } from "./changes-data";
import type { CanonicalChange, Strategy, Goal, StatusView } from "@/domains/changes/canonical-change";
import { EVIDENCE_LABEL, statusView } from "@/domains/changes/canonical-change";
import { rankChanges, goalMatches, inStatusView } from "@/domains/changes/strategy";
import { MoveCard } from "./today-moves-card";
import { Sparkline } from "@/components/data/sparkline";
import { formatMetric, formatMetricCompact } from "@/lib/format-metric";

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

// State is communicated by TEXT (the chip label) + BORDER, never color alone (WCAG).
const STATUS_CHIP: Record<CanonicalChange["status"], { label: string; cls: string }> = {
  suggested: { label: "To do", cls: "border border-gray-200 bg-gray-100 text-gray-600" },
  ready: { label: "Ready", cls: "border border-sky-200 bg-sky-100 text-sky-700" },
  apply: { label: "Apply in Wix", cls: "border border-amber-200 bg-amber-100 text-amber-700" },
  verify: { label: "Verifying", cls: "border border-blue-200 bg-blue-100 text-blue-700" },
  measuring: { label: "Measuring", cls: "border border-emerald-200 bg-emerald-100 text-emerald-700" },
  result: { label: "Result", cls: "border border-violet-200 bg-violet-100 text-violet-700" },
  blocked: { label: "Wait", cls: "border border-gray-200 bg-gray-100 text-gray-500" },
  skipped: { label: "Skipped", cls: "border border-gray-200 bg-gray-100 text-gray-400" },
};
const EVIDENCE_CLS: Record<string, string> = { strong: "text-emerald-600", directional: "text-amber-600", tracking: "text-gray-500" };

// Item 55 - one identity chip per lever family so rows scan by shape, not by reading.
const FAMILY_CHIP: Record<string, { label: string; cls: string }> = {
  meta: { label: "Description", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  title: { label: "Title", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  title_meta: { label: "Title + description", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  h1: { label: "Headline", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  answer: { label: "Direct answer", cls: "bg-pink-50 text-pink-700 ring-pink-200" },
  link: { label: "Internal link", cls: "bg-teal-50 text-teal-700 ring-teal-200" },
  schema: { label: "Structured data", cls: "bg-slate-50 text-slate-600 ring-slate-200" },
  new_page: { label: "New page", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cro: { label: "Experience", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  other: { label: "Page edit", cls: "bg-gray-50 text-gray-600 ring-gray-200" },
};

// Item 57 - the goal groups the default view reads in (business language first).
const GOAL_GROUPS: { id: string; title: string; match: (c: CanonicalChange) => boolean }[] = [
  { id: "clicks", title: "Win more clicks", match: (c) => c.opportunityType === "Capture clicks" },
  { id: "ai", title: "Get cited by AI", match: (c) => c.opportunityType === "Win AI citations" },
  { id: "experience", title: "Fix the experience", match: (c) => c.opportunityType === "Fix experience" },
  { id: "pages", title: "Build new pages", match: (c) => c.opportunityType === "New page" },
];

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

// Item 18 - ONE formatter discipline: compact in chips, full number on hover (title attr).
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  return formatMetricCompact(n);
}

function Row({ c, move, rank }: { c: CanonicalChange; move: ChangesView["movesById"][string] | undefined; rank: number }) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[c.status] ?? STATUS_CHIP.suggested;
  const isMeasure = c.status === "measuring" || c.status === "result";
  const cta = isMeasure ? (c.status === "result" ? "View result" : "View measurement") : c.status === "apply" || c.status === "verify" ? "Apply" : "Review";
  const panelId = `change-detail-${c.id}`;
  const effort = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : null;
  return (
    <div className={`rounded-lg border border-gray-100 bg-white ${c.status === "blocked" ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {(() => {
              const fam = FAMILY_CHIP[c.changeFamily] ?? FAMILY_CHIP.other!;
              return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${fam.cls}`}>{fam.label}</span>;
            })()}
            <span className="min-w-0 break-words text-sm font-semibold text-gray-900">{c.pageLabel}</span>
            {move?.sparkline && move.sparkline.length >= 5 ? <Sparkline points={move.sparkline} width={56} height={14} className="inline-block opacity-70" /> : null}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>
            {c.selectedForToday && <span className="shrink-0 rounded-full border border-indigo-200 bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">Today</span>}
          </div>
          <div className="mt-0.5 break-words text-xs text-gray-500">
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
            {effort != null ? <span>~{effort} min</span> : null}
            {fmt(c.upside) ? <span className="text-sky-600" title={`${formatMetric(c.upside)} searches a month at stake`}>{fmt(c.upside)}/mo at stake</span> : null}
            {c.expectedOutcome && (c.status === "ready" || c.status === "suggested") ? <span className="text-emerald-600">{c.expectedOutcome}</span> : null}
            <span className={EVIDENCE_CLS[c.evidenceStrength] ?? "text-gray-500"}>{EVIDENCE_LABEL[c.evidenceStrength] ?? "Tracking only"}</span>
            {c.blockedReason ? <span className="text-gray-400" title={c.blockedReason}>⏳ wait</span> : null}
            {c.qualityDecision === "flagged" ? <span className="text-amber-600" title={c.qualityNote ?? "Review before shipping"}>⚠ review</span> : c.qualityDecision === "caution" ? <span className="text-amber-500" title={c.qualityNote ?? "Quality caution"}>quality caution</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMeasure ? (
            <Link href={`/proof?page=${encodeURIComponent(c.pageUrl)}`} className={`inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}>{cta} →</Link>
          ) : c.status === "blocked" ? (
            <span className="text-[11px] text-gray-400" title={c.blockedReason ?? "Not actionable right now"}>Not now</span>
          ) : (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId} className={`inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}>{open ? "Hide" : cta}</button>
          )}
        </div>
      </div>
      {open && (
        <div id={panelId} className="border-t border-gray-100 px-1 py-1">
          {move ? (
            <MoveCard m={move} rank={rank} />
          ) : (
            <div className="px-3 py-2 text-sm">
              {c.before != null && <div className="break-words text-xs"><span className="text-gray-500">Current: </span>{c.before || "(none)"}</div>}
              {c.after != null && <div className="break-words text-xs"><span className="text-gray-500">Proposed: </span><strong>{c.after}</strong></div>}
              {c.exactInstructions && <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-gray-50 p-2 text-[11px] font-mono text-gray-700">{c.exactInstructions}</pre>}
              <div className="mt-2 text-[11px] text-gray-400">{c.measurementMethod}{c.selectedForToday ? " · selected for today - apply it in the “Daily experiments” panel above" : ""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STRATEGY_IDS = new Set<string>(STRATEGIES.map((s) => s.id));
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));
const GOAL_IDS = new Set<string>(GOALS.map((g) => g.id));

export function ChangesListClient({ view }: { view: ChangesView }) {
  // Move 5 backfill - deep-link support: legacy routes (/recommendations, /experiments)
  // and Today links land here with ?status=/?strategy=/?goal=/?search=, so the list opens
  // on the right slice. Falls back to sensible defaults when a param is absent/invalid.
  const params = useSearchParams();
  const pStrategy = params.get("strategy");
  const pStatus = params.get("status");
  const pGoal = params.get("goal");
  const [strategy, setStrategy] = useState<Strategy>(pStrategy && STRATEGY_IDS.has(pStrategy) ? (pStrategy as Strategy) : "balanced");
  const initialTab: StatusView = pStatus && TAB_IDS.has(pStatus) ? (pStatus as StatusView) : view.summary.ready > 0 ? "ready" : "todo";
  const [tab, setTab] = useState<StatusView>(initialTab);
  const [goal, setGoal] = useState<Goal>(pGoal && GOAL_IDS.has(pGoal) ? (pGoal as Goal) : "recommended");
  const [q, setQ] = useState(params.get("search") ?? "");
  // Item 57 - group by GOAL is the default read ("Win more clicks" before "Ready"); picking a
  // status tab switches to the flat status view. A deep-linked ?status= starts flat.
  const [grouped, setGrouped] = useState<boolean>(!(pStatus && TAB_IDS.has(pStatus)));
  // Item 56 - "Tonight's 30 minutes": the accepted plan + top ready items that fit a 30-minute budget.
  const [tonight, setTonight] = useState(false);

  const ranked = useMemo(() => rankChanges(view.changes, strategy), [view.changes, strategy]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Item 59 - search that actually finds: page, query, why, teammate claims, verdicts, outcomes.
    const hay = (c: CanonicalChange): string => {
      const m = c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined;
      return [
        c.pageLabel, c.pagePath, c.recommendation, c.rationale, c.opportunityType, c.changeType,
        c.measurementHeadline ?? "", c.result ?? "", c.expectedOutcome ?? "",
        m?.query ?? "", m?.why ?? "", m?.rankWhy ?? "",
      ].join(" ").toLowerCase();
    };
    // Grouped (by goal) reads the actionable slice (to do + ready + apply); flat view uses the tab.
    const statusOk = (c: CanonicalChange) => (grouped ? inStatusView(c, "todo") || inStatusView(c, "ready") : inStatusView(c, tab));
    let rows = ranked.filter((c) => statusOk(c) && goalMatches(c, goal) && (!needle || hay(c).includes(needle)));
    if (tonight) {
      const actionable = rows.filter((c) => c.selectedForToday || c.status === "ready" || c.status === "apply");
      const picked: CanonicalChange[] = [];
      let budget = 30;
      for (const c of [...actionable].sort((a, b) => (b.selectedForToday ? 1 : 0) - (a.selectedForToday ? 1 : 0))) {
        const mins = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5;
        if (mins <= budget) { picked.push(c); budget -= mins; }
      }
      rows = picked;
    }
    return rows;
  }, [ranked, tab, goal, q, tonight, grouped, view.movesById]);

  const s = view.summary;
  const isFiltered = q.trim().length > 0 || goal !== "recommended";
  // Distinguish WHY a view is empty: clean-strategy eligibility vs filtered vs genuinely-empty
  // status vs (for results/measuring) cause-specific copy.
  const emptyMessage = (): { title: string; hint: string | null; action: { label: string; onClick: () => void } | null } => {
    if (strategy === "clean" && view.changes.length > 0) {
      return { title: "No clean tests are available right now.", hint: "Switch to Balanced to include changes Beacon can track directionally.", action: { label: "Switch to Balanced", onClick: () => setStrategy("balanced") } };
    }
    if (isFiltered) {
      return { title: "No changes match these filters.", hint: "Try another status, strategy, or goal.", action: { label: "Reset filters", onClick: () => { setGoal("recommended"); setQ(""); } } };
    }
    if (tab === "results") return { title: "No mature results yet.", hint: "Your active changes are still collecting data. Early checkpoints stay in Measuring.", action: null };
    if (tab === "measuring") return { title: "No changes are measuring yet.", hint: "Applied and verified changes will appear here.", action: null };
    if (tab === "ready") return { title: "No changes are fully prepared.", hint: "Prepare a recommendation from To do, or accept today’s plan above.", action: null };
    return { title: "No changes to do right now.", hint: "Once your Google + AI demand data syncs, ranked changes appear here.", action: null };
  };
  const em = emptyMessage();

  return (
    <div className="space-y-3">
      {/* Strategy */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span id="strategy-label" className="text-xs font-medium text-gray-500">How should Beacon prioritize?</span>
        <div role="group" aria-labelledby="strategy-label" className="flex flex-wrap rounded-lg border border-gray-200 p-0.5">
          {STRATEGIES.map((st) => {
            const active = strategy === st.id;
            return (
              <button key={st.id} type="button" onClick={() => setStrategy(st.id)} title={st.hint} aria-pressed={active}
                className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{st.label}</button>
            );
          })}
        </div>
      </div>
      {/* Status tabs (scrollable on mobile) + goal + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="-mx-1 max-w-full overflow-x-auto px-1">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
            <button type="button" onClick={() => setGrouped(true)} aria-pressed={grouped}
              className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${grouped ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              By goal
            </button>
            {TABS.map((t) => {
              const active = !grouped && tab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => { setTab(t.id); setGrouped(false); }} aria-pressed={active} aria-label={`${t.label}, ${s[t.id]} ${s[t.id] === 1 ? "change" : "changes"}`}
                  className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${active ? "bg-sky-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
                  {t.label} <span aria-hidden className={active ? "text-sky-100" : "text-gray-400"}>{s[t.id]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={() => setTonight((v) => !v)} aria-pressed={tonight}
          title="Just the accepted plan plus the top ready items that fit 30 minutes."
          className={`min-h-[32px] rounded-md border px-2.5 py-1 text-xs font-medium ${FOCUS} ${tonight ? "border-indigo-300 bg-indigo-600 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          Tonight&apos;s 30 minutes
        </button>
        <select aria-label="Filter by goal" value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className={`min-h-[32px] rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 ${FOCUS}`}>
          {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <input aria-label="Search pages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" className={`min-h-[32px] w-full rounded-md border border-gray-200 px-2 py-1 text-xs sm:ml-auto sm:w-44 ${FOCUS}`} />
      </div>
      {/* List */}
      {visible.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
          <p className="text-sm font-medium text-gray-600">{em.title}</p>
          {em.hint ? <p className="mt-1 text-xs text-gray-500">{em.hint}</p> : null}
          {em.action ? (
            <button type="button" onClick={em.action.onClick} className={`mt-3 inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 ${FOCUS}`}>{em.action.label}</button>
          ) : null}
        </div>
      ) : grouped && !tonight ? (
        // Item 57 - the default read: goals first, business language, status still on each row.
        <div className="space-y-4">
          {GOAL_GROUPS.map((g) => {
            const rows = visible.filter(g.match);
            if (rows.length === 0) return null;
            return (
              <section key={g.id} aria-label={g.title}>
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
                  {g.title} <span className="font-normal normal-case">· {rows.length}</span>
                </h3>
                <div className="space-y-1.5">
                  {rows.map((c, i) => <Row key={c.id} c={c} move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined} rank={i + 1} />)}
                </div>
              </section>
            );
          })}
          {(() => {
            const other = visible.filter((c) => !GOAL_GROUPS.some((g) => g.match(c)));
            if (other.length === 0) return null;
            return (
              <section aria-label="Other improvements">
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400">Other improvements · {other.length}</h3>
                <div className="space-y-1.5">
                  {other.map((c, i) => <Row key={c.id} c={c} move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined} rank={i + 1} />)}
                </div>
              </section>
            );
          })()}
        </div>
      ) : (
        <div className="space-y-1.5">
          {tonight ? (
            <p className="text-[11px] text-gray-400 tabular-nums">
              Tonight&apos;s set: {visible.length} change{visible.length === 1 ? "" : "s"}, about {visible.reduce((t, c) => t + (Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5), 0)} minutes.
            </p>
          ) : null}
          {visible.map((c, i) => <Row key={c.id} c={c} move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}

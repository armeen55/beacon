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
import { Hourglass, TriangleAlert } from "lucide-react";
import type { ChangesView } from "./changes-data";
import type { CanonicalChange, Strategy, Goal, StatusView } from "@/domains/changes/canonical-change";
import { EVIDENCE_LABEL, statusView } from "@/domains/changes/canonical-change";
import { rankChanges, goalMatches, inStatusView } from "@/domains/changes/strategy";
import { MoveCard } from "./today-moves-card";
import { Sparkline } from "@/components/data/sparkline";
import { formatMetric, formatMetricCompact } from "@/lib/format-metric";

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: "balanced", label: "Balanced", hint: "Best mix of upside, effort, risk, and evidence (recommended)." },
  { id: "growth", label: "Growth first", hint: "Prioritize impact, even when the proof will be less exact." },
  { id: "clean", label: "Clean tests", hint: "Only changes Beacon can measure most confidently." },
];
const TABS: { id: StatusView; label: string }[] = [
  { id: "todo", label: "To do" }, { id: "ready", label: "Ready" }, { id: "measuring", label: "Measuring" }, { id: "results", label: "Results" },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: "recommended", label: "Recommended" }, { id: "quick_wins", label: "Quick wins" }, { id: "biggest_upside", label: "Biggest upside" },
  { id: "recover_traffic", label: "Recover traffic" }, { id: "ai_visibility", label: "AI visibility" }, { id: "new_pages", label: "New pages" },
];

// B2 (worklist fix batch) - the status CHIP shows one of only 4 display words, never the 8-word
// internal-status vocabulary. "To do" = not yet prepared; "In progress" = Beacon or the operator
// is actively moving it (ready to ship, awaiting the Wix edit, or verifying); "Measuring";
// "Done" = a settled result. The precise underlying state is still available (used for the CTA
// label and secondary text below), just never shown as its own status-pill word. State is
// communicated by TEXT (the chip label) + BORDER, never color alone (WCAG).
const STATUS_CHIP: Record<CanonicalChange["status"], { label: string; cls: string }> = {
  suggested: { label: "To do", cls: "border border-gray-200 bg-gray-100 text-gray-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  ready: { label: "In progress", cls: "border border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" },
  apply: { label: "In progress", cls: "border border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" },
  verify: { label: "In progress", cls: "border border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300" },
  measuring: { label: "Measuring", cls: "border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" },
  result: { label: "Done", cls: "border border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300" },
  blocked: { label: "To do", cls: "border border-gray-200 bg-gray-100 text-gray-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400" },
  skipped: { label: "To do", cls: "border border-gray-200 bg-gray-100 text-gray-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500" },
};
// The precise sub-state, shown as small secondary text next to the chip ONLY for apply/verify
// (that distinction adds real action info: "awaiting your Wix edit" vs "Beacon is confirming it
// went live" - a bare "ready" or "suggested" needs no extra word beyond the chip itself).
const STATUS_DETAIL: Partial<Record<CanonicalChange["status"], string>> = {
  apply: "awaiting your Wix edit",
  verify: "confirming it's live",
};
const EVIDENCE_CLS: Record<string, string> = { strong: "text-emerald-600 dark:text-emerald-400", directional: "text-amber-600 dark:text-amber-400", tracking: "text-gray-500 dark:text-neutral-400" };

// Item 55 - one identity chip per lever family so rows scan by shape, not by reading.
const FAMILY_CHIP: Record<string, { label: string; cls: string }> = {
  meta: { label: "Description", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900" },
  title: { label: "Title", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900" },
  title_meta: { label: "Title + description", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900" },
  h1: { label: "Headline", cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900" },
  answer: { label: "Direct answer", cls: "bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:ring-pink-900" },
  link: { label: "Internal link", cls: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900" },
  schema: { label: "Structured data", cls: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-700" },
  new_page: { label: "New page", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900" },
  cro: { label: "Experience", cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900" },
  other: { label: "Page edit", cls: "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-neutral-800/60 dark:text-neutral-300 dark:ring-neutral-700" },
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

// B9 (worklist fix batch) - a raw slug ("/persian-male-names") is not a page title. Whatever
// upstream source produced it, the row must show a real title when one is available (the
// move's target query/topic reads like actual words), and otherwise humanize the slug itself
// rather than showing the bare path. The raw path stays as secondary text underneath.
function looksLikeSlug(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("/") || /^[a-z0-9]+(-[a-z0-9]+)+$/.test(t)) && !t.includes(" ");
}
function humanizeSlug(s: string): string {
  return s.replace(/^\/+/, "").replace(/[-_]+/g, " ").trim();
}
function displayPageLabel(c: CanonicalChange, move: ChangesView["movesById"][string] | undefined): { title: string; secondary: string | null } {
  if (!looksLikeSlug(c.pageLabel)) return { title: c.pageLabel, secondary: null };
  const humanQuery = move?.query && !looksLikeSlug(move.query) ? move.query : null;
  const title = humanQuery ?? humanizeSlug(c.pageLabel);
  return { title, secondary: c.pageLabel !== title ? c.pageLabel : null };
}

function Row({ c, move, rank }: { c: CanonicalChange; move: ChangesView["movesById"][string] | undefined; rank: number }) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[c.status] ?? STATUS_CHIP.suggested;
  const statusDetail = STATUS_DETAIL[c.status];
  const isMeasure = c.status === "measuring" || c.status === "result";
  // B2 - "Apply in Wix" is the precise action, spoken as the BUTTON label (not a status pill).
  const cta = isMeasure ? (c.status === "result" ? "View result" : "View measurement") : c.status === "apply" ? "Apply in Wix" : c.status === "verify" ? "Apply" : "Review";
  const panelId = `change-detail-${c.id}`;
  const effort = Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : null;
  const label = displayPageLabel(c, move);
  return (
    <div className={`rounded-lg border border-gray-100 bg-white dark:border-neutral-800 dark:bg-neutral-900 ${c.status === "blocked" ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {(() => {
              const fam = FAMILY_CHIP[c.changeFamily] ?? FAMILY_CHIP.other!;
              return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${fam.cls}`}>{fam.label}</span>;
            })()}
            <span className="min-w-0 break-words text-sm font-semibold capitalize text-gray-900 dark:text-neutral-100" title={label.secondary ?? undefined}>{label.title}</span>
            {label.secondary ? <span className="shrink-0 text-[10px] text-gray-400 dark:text-neutral-500">{label.secondary}</span> : null}
            {move?.sparkline && move.sparkline.length >= 5 ? <Sparkline points={move.sparkline} width={56} height={14} className="inline-block opacity-70" /> : null}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>
            {statusDetail ? <span className="shrink-0 text-[10px] text-gray-400 dark:text-neutral-500">{statusDetail}</span> : null}
            {c.selectedForToday && <span className="shrink-0 rounded-full border border-indigo-200 bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">Today</span>}
          </div>
          <div className="mt-0.5 break-words text-xs text-gray-500 dark:text-neutral-400">
            {c.measurementHeadline ? (
              <>
                <span className="font-medium text-gray-700 dark:text-neutral-300">{c.measurementHeadline}</span>
                {c.status === "measuring" && c.nextCheckpoint ? <span className="text-gray-400 dark:text-neutral-500"> · next read {c.nextCheckpoint}</span> : null}
                {c.attributionLimited ? <span className="text-amber-600 dark:text-amber-400"> · overlapping edit</span> : null}
              </>
            ) : (
              c.recommendation
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400 dark:text-neutral-500">
            <span>{c.opportunityType}</span>
            {effort != null ? <span>~{effort} min</span> : null}
            {fmt(c.upside) ? <span className="text-sky-600 dark:text-sky-400" title={`${formatMetric(c.upside)} searches a month at stake`}>{fmt(c.upside)} searches/mo at stake</span> : null}
            {c.expectedOutcome && (c.status === "ready" || c.status === "suggested") ? <span className="text-emerald-600 dark:text-emerald-400">{c.expectedOutcome}</span> : null}
            <span className={EVIDENCE_CLS[c.evidenceStrength] ?? "text-gray-500 dark:text-neutral-400"}>{EVIDENCE_LABEL[c.evidenceStrength] ?? "Tracking only"}</span>
            {c.blockedReason ? <span className="inline-flex items-center gap-1 text-gray-400 dark:text-neutral-500" title={c.blockedReason}><Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />wait</span> : null}
            {c.qualityDecision === "flagged" ? <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={c.qualityNote ?? "Review before shipping"}><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />Flagged</span> : c.qualityDecision === "caution" ? <span className="text-amber-500 dark:text-amber-400" title={c.qualityNote ?? "Quality caution"}>quality caution</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMeasure ? (
            <Link href={`/proof?page=${encodeURIComponent(c.pageUrl)}`} className={`inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 ${FOCUS}`}>{cta} →</Link>
          ) : c.status === "blocked" ? (
            <span className="text-[11px] text-gray-400 dark:text-neutral-500" title={c.blockedReason ?? "Not actionable right now"}>Not now</span>
          ) : (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId} className={`inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 ${FOCUS}`}>{open ? "Hide" : cta}</button>
          )}
        </div>
      </div>
      {open && (
        <div id={panelId} className="border-t border-gray-100 px-1 py-1 dark:border-neutral-800">
          {move ? (
            <MoveCard m={move} rank={rank} />
          ) : (
            <div className="px-3 py-2 text-sm">
              {c.before != null && <div className="break-words text-xs"><span className="text-gray-500 dark:text-neutral-400">Current: </span>{c.before || "(none)"}</div>}
              {c.after != null && <div className="break-words text-xs"><span className="text-gray-500 dark:text-neutral-400">Proposed: </span><strong>{c.after}</strong></div>}
              {c.exactInstructions && <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-gray-50 p-2 text-[11px] font-mono text-gray-700 dark:bg-neutral-800/60 dark:text-neutral-300">{c.exactInstructions}</pre>}
              <div className="mt-2 text-[11px] text-gray-400 dark:text-neutral-500">{c.measurementMethod}{c.selectedForToday ? " · selected for today - apply it in the “Today’s changes” panel above" : ""}</div>
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
        <span id="strategy-label" className="text-xs font-medium text-gray-500 dark:text-neutral-400">How should Beacon prioritize?</span>
        <div role="group" aria-labelledby="strategy-label" className="flex flex-wrap rounded-lg border border-gray-200 p-0.5 dark:border-neutral-700">
          {STRATEGIES.map((st) => {
            const active = strategy === st.id;
            return (
              <button key={st.id} type="button" onClick={() => setStrategy(st.id)} title={st.hint} aria-pressed={active}
                className={`min-h-[32px] rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${active ? "bg-gray-900 text-white hover:bg-gray-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300" : "text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}>{st.label}</button>
            );
          })}
        </div>
      </div>
      {/* Status tabs (scrollable on mobile) + goal + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="-mx-1 max-w-full overflow-x-auto px-1">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-neutral-700">
            <button type="button" onClick={() => setGrouped(true)} aria-pressed={grouped}
              className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${grouped ? "bg-gray-900 text-white hover:bg-gray-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300" : "text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}>
              By goal
            </button>
            {TABS.map((t) => {
              const active = !grouped && tab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => { setTab(t.id); setGrouped(false); }} aria-pressed={active} aria-label={`${t.label}, ${s[t.id]} ${s[t.id] === 1 ? "change" : "changes"}`}
                  className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${FOCUS} ${active ? "bg-sky-600 text-white hover:bg-sky-500" : "text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}>
                  {t.label} <span aria-hidden className={active ? "text-sky-100" : "text-gray-400 dark:text-neutral-500"}>{s[t.id]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={() => setTonight((v) => !v)} aria-pressed={tonight}
          title="Just the accepted plan plus the top ready items that fit 30 minutes."
          className={`min-h-[32px] rounded-md border px-2.5 py-1 text-xs font-medium ${FOCUS} ${tonight ? "border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-500 dark:border-indigo-700" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}>
          Tonight&apos;s 30 minutes
        </button>
        <select aria-label="Filter by goal" value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className={`min-h-[32px] rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 ${FOCUS}`}>
          {GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <input aria-label="Search pages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages…" className={`min-h-[32px] w-full rounded-md border border-gray-200 px-2 py-1 text-xs sm:ml-auto sm:w-44 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:placeholder:text-neutral-500 ${FOCUS}`} />
      </div>
      {/* Item 66 - the invisible gate, made visible: protected pages are trust, not absence. */}
      {s.protectedPages > 0 ? (
        <p className="text-[11px] text-gray-400 tabular-nums dark:text-neutral-500">
          {s.protectedPages} page{s.protectedPages === 1 ? " is" : "s are"} protected right now (mid-measurement or serving as comparisons). I will not suggest changes there until their results settle.
        </p>
      ) : null}
      {/* B7 (worklist fix batch) - "Ready 0" with no reason reads as broken; say why. */}
      {view.readyZeroHint ? (
        <p className="text-[11px] text-gray-400 dark:text-neutral-500">
          {view.readyZeroHint}
          {view.readyZeroHint.includes("Wix pages are mapped") ? (
            <>
              {" "}
              <Link href="/settings/connectors" className={`rounded-sm font-medium text-sky-600 underline underline-offset-2 hover:text-sky-800 dark:text-sky-400 ${FOCUS}`}>
                Check your Wix connection →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {/* List */}
      {visible.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm font-medium text-gray-600 dark:text-neutral-300">{em.title}</p>
          {em.hint ? <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">{em.hint}</p> : null}
          {em.action ? (
            <button type="button" onClick={em.action.onClick} className={`mt-3 inline-flex min-h-[34px] items-center rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 ${FOCUS}`}>{em.action.label}</button>
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
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400 dark:text-neutral-500">
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
                <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400 dark:text-neutral-500">Other improvements · {other.length}</h3>
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
            <p className="text-[11px] text-gray-400 tabular-nums dark:text-neutral-500">
              Tonight&apos;s set: {visible.length} change{visible.length === 1 ? "" : "s"}, about {visible.reduce((t, c) => t + (Number.isFinite(c.estimatedEffortMinutes) ? c.estimatedEffortMinutes : 5), 0)} minutes.
            </p>
          ) : null}
          {visible.map((c, i) => <Row key={c.id} c={c} move={c.sourceIds[0] ? view.movesById[c.sourceIds[0]] : undefined} rank={i + 1} />)}
        </div>
      )}
    </div>
  );
}

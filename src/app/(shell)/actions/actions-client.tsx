"use client";

import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateActionState, batchUpdateActionState } from "./action-state";
import { changeVerdictLabel } from "@/components/display/change-verdict-badge";
import type { ChangeVerdict } from "@/domains/attribution/types";

export type ActionCategory = "review" | "growth" | "investigate" | "wait";
export type ActionPriority = "high" | "medium" | "low";
export type OperatorState = "open" | "in_progress" | "done" | "dismissed" | "new";

export type DetailRow = {
  label: string;
  value: string;
  type?: "success" | "warning" | "danger" | "neutral";
};

export type WorkflowLink = {
  label: string;
  href: string;
  primary?: boolean;
};

export type BriefEvent = {
  topic: string;
  platform: string;
  gap: number;
  reason: string;
  resultId: string;
};

export type BriefChange = {
  id: string;
  name: string;
  description?: string;
  verdict: string;
  score: number | null;
  evidenceTier: string;
  date: string;
};

export type ExecutionBrief = {
  knownFacts: string[];
  unknowns: string[];
  bestNextMove: string;
  details: DetailRow[];
  workflows: WorkflowLink[];
  events?: BriefEvent[];
  changes?: BriefChange[];
};

export type ActionItem = {
  id: string;
  title: string;
  category: ActionCategory;
  priority: ActionPriority;
  priorityScore: number;
  why: string;
  evidence: string;
  href: string;
  destination: string;
  sourceType: "review" | "page" | "topic" | "change";
  entityId?: string;
  entityName?: string;
  brief: ExecutionBrief;
  operatorState?: OperatorState;
  operatorNote?: string | null;
  stateUpdatedAt?: string;
};

type FilterCategory = "all" | ActionCategory;
type FilterPriority = "all" | ActionPriority;

const CATEGORY_CONFIG: Record<
  ActionCategory,
  { label: string; color: string; dot: string; bgClass: string }
> = {
  review: {
    label: "Review",
    color: "text-accent-primary",
    dot: "bg-accent-primary",
    bgClass: "border-accent-primary/20 bg-accent-primary/5",
  },
  growth: {
    label: "Growth",
    color: "text-status-success",
    dot: "bg-status-success",
    bgClass: "border-status-success/20 bg-status-success/5",
  },
  investigate: {
    label: "Investigate",
    color: "text-status-warning",
    dot: "bg-status-warning",
    bgClass: "border-status-warning/20 bg-status-warning/5",
  },
  wait: {
    label: "Waiting",
    color: "text-muted-foreground",
    dot: "bg-muted-foreground/40",
    bgClass: "border-border",
  },
};

const PRIORITY_CONFIG: Record<
  ActionPriority,
  { label: string; color: string; dot: string }
> = {
  high: { label: "High", color: "text-status-danger", dot: "bg-status-danger" },
  medium: { label: "Medium", color: "text-status-warning", dot: "bg-status-warning" },
  low: { label: "Low", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

const SOURCE_LABELS: Record<ActionItem["sourceType"], string> = {
  review: "Review queue",
  page: "Pages",
  topic: "Topics",
  change: "Changes",
};

const DETAIL_TYPE_COLORS: Record<string, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  neutral: "text-muted-foreground",
};

const PLATFORM_SHORT: Record<string, string> = {
  chatgpt: "GPT",
  google_aio: "AIO",
  perplexity: "Pplx",
};

const VERDICT_COLORS: Record<string, string> = {
  validated: "text-status-success",
  partial: "text-accent-primary",
  inconclusive: "text-status-warning",
  no_impact: "text-status-danger",
  too_early: "text-muted-foreground",
};

const STATE_CONFIG: Record<
  OperatorState,
  { label: string; color: string; dot: string }
> = {
  new: { label: "Open", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  open: { label: "Open", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  in_progress: { label: "In progress", color: "text-accent-primary", dot: "bg-accent-primary" },
  done: { label: "Done", color: "text-status-success", dot: "bg-status-success" },
  dismissed: { label: "Dismissed", color: "text-muted-foreground/60", dot: "bg-muted-foreground/30" },
};

function StateControls({
  actionId,
  currentState,
  onStateChange,
}: {
  actionId: string;
  currentState: OperatorState;
  onStateChange?: (actionId: string, state: OperatorState) => void;
}) {
  const [pending, startTransition] = useTransition();

  function setState(state: OperatorState) {
    startTransition(async () => {
      await updateActionState(actionId, state);
      onStateChange?.(actionId, state);
    });
  }

  const buttons: { state: OperatorState; label: string }[] = [];
  if (currentState === "open" || currentState === "new") {
    buttons.push({ state: "in_progress", label: "Start" });
    buttons.push({ state: "done", label: "Done" });
    buttons.push({ state: "dismissed", label: "Dismiss" });
  } else if (currentState === "in_progress") {
    buttons.push({ state: "done", label: "Done" });
    buttons.push({ state: "dismissed", label: "Dismiss" });
    buttons.push({ state: "open", label: "Re-open" });
  } else if (currentState === "done") {
    buttons.push({ state: "open", label: "Re-open" });
  } else if (currentState === "dismissed") {
    buttons.push({ state: "open", label: "Re-open" });
  }

  return (
    <div className="flex items-center gap-1">
      {buttons.map((b) => (
        <button
          key={b.state}
          onClick={(e) => {
            e.stopPropagation();
            setState(b.state);
          }}
          disabled={pending}
          className={cn(
            "px-2 py-0.5 rounded text-[9px] font-medium border transition-colors",
            pending && "opacity-50",
            b.state === "done"
              ? "border-status-success/30 text-status-success hover:bg-status-success/10"
              : b.state === "in_progress"
                ? "border-accent-primary/30 text-accent-primary hover:bg-accent-primary/10"
                : b.state === "dismissed"
                  ? "border-border text-muted-foreground hover:bg-surface-inset"
                  : "border-border text-muted-foreground hover:bg-surface-inset"
          )}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

export function ActionsClient({ actions }: { actions: ActionItem[] }) {
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const saved = localStorage.getItem("beacon-actions-cat");
      if (saved && ["all", "review", "growth", "investigate", "wait"].includes(saved))
        return saved as FilterCategory;
    } catch {}
    return "all";
  });
  const [priorityFilter, setPriorityFilter] = useState<FilterPriority>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const saved = localStorage.getItem("beacon-actions-pri");
      if (saved && ["all", "high", "medium", "low"].includes(saved))
        return saved as FilterPriority;
    } catch {}
    return "all";
  });
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchPending, startBatchTransition] = useTransition();

  useEffect(() => {
    try { localStorage.setItem("beacon-actions-cat", categoryFilter); } catch {}
  }, [categoryFilter]);

  useEffect(() => {
    try { localStorage.setItem("beacon-actions-pri", priorityFilter); } catch {}
  }, [priorityFilter]);

  const filteredRef = useRef<ActionItem[]>([]);

  const handleStateChange = useCallback(
    (actionId: string, newState: OperatorState) => {
      if (newState === "done" || newState === "dismissed") {
        const currentIdx = filteredRef.current.findIndex(
          (a) => a.id === actionId
        );
        const nextItem = filteredRef.current[currentIdx + 1];
        if (nextItem) {
          setTimeout(() => setExpandedAction(nextItem.id), 150);
        } else {
          setExpandedAction(null);
        }
      }
    },
    []
  );

  const active = actions.filter(
    (a) =>
      !a.operatorState ||
      a.operatorState === "open" ||
      a.operatorState === "new" ||
      a.operatorState === "in_progress"
  );
  const done = actions.filter((a) => a.operatorState === "done");
  const dismissed = actions.filter((a) => a.operatorState === "dismissed");

  const filtered = active.filter((a) => {
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
    return true;
  });

  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);

  useEffect(() => {
    if (expandedAction) {
      const el = document.querySelector(`[data-action-id="${expandedAction}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedAction]);

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleBatch(state: OperatorState) {
    const ids = [...selectedIds];
    startBatchTransition(async () => {
      await batchUpdateActionState(ids, state);
      setSelectedIds(new Set());
    });
  }

  const categoryCounts: Record<FilterCategory, number> = {
    all: active.length,
    review: active.filter((a) => a.category === "review").length,
    growth: active.filter((a) => a.category === "growth").length,
    investigate: active.filter((a) => a.category === "investigate").length,
    wait: active.filter((a) => a.category === "wait").length,
  };

  const priorityCounts: Record<FilterPriority, number> = {
    all: active.length,
    high: active.filter((a) => a.priority === "high").length,
    medium: active.filter((a) => a.priority === "medium").length,
    low: active.filter((a) => a.priority === "low").length,
  };

  return (
    <div>
      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div
          className={cn(
            "sticky top-0 z-10 flex items-center gap-3 rounded-lg border border-accent-primary/20 bg-accent-primary/5 px-4 py-2.5 mb-3",
            batchPending && "opacity-60"
          )}
        >
          <span className="text-[12px] font-semibold">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={() => handleBatch("done")}
            disabled={batchPending}
            className="px-3 py-1 rounded text-[11px] font-medium border border-status-success/30 text-status-success hover:bg-status-success/10 transition-colors"
          >
            Done ({selectedIds.size})
          </button>
          <button
            onClick={() => handleBatch("in_progress")}
            disabled={batchPending}
            className="px-3 py-1 rounded text-[11px] font-medium border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/10 transition-colors"
          >
            Start ({selectedIds.size})
          </button>
          <button
            onClick={() => handleBatch("dismissed")}
            disabled={batchPending}
            className="px-3 py-1 rounded text-[11px] font-medium border border-border text-muted-foreground hover:bg-surface-inset transition-colors"
          >
            Dismiss ({selectedIds.size})
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
          >
            Clear
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mr-1">
            Type
          </span>
          {(
            ["all", "review", "growth", "investigate", "wait"] as const
          ).map((f) =>
            categoryCounts[f] > 0 ? (
              <button
                key={f}
                onClick={() => setCategoryFilter(f)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] font-medium transition-colors",
                  categoryFilter === f
                    ? "bg-surface-inset text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all"
                  ? `All (${categoryCounts.all})`
                  : `${f.charAt(0).toUpperCase() + f.slice(1)} (${categoryCounts[f]})`}
              </button>
            ) : null
          )}
        </div>

        <button
          onClick={() => {
            if (selectedIds.size === filtered.length) {
              setSelectedIds(new Set());
            } else {
              setSelectedIds(new Set(filtered.map((a) => a.id)));
            }
          }}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {selectedIds.size > 0 && selectedIds.size === filtered.length
            ? "Deselect all"
            : "Select all"}
        </button>

        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mr-1">
            Priority
          </span>
          {(["all", "high", "medium", "low"] as const).map((f) =>
            priorityCounts[f] > 0 ? (
              <button
                key={f}
                onClick={() => setPriorityFilter(f)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] font-medium transition-colors",
                  priorityFilter === f
                    ? "bg-surface-inset text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all"
                  ? "All"
                  : `${f.charAt(0).toUpperCase() + f.slice(1)} (${priorityCounts[f]})`}
              </button>
            ) : null
          )}
        </div>
      </div>

      {/* Active action list */}
      <div className="space-y-2">
        {filtered.map((action, index) => (
          <ActionCard
            key={action.id}
            action={action}
            rank={index + 1}
            isExpanded={expandedAction === action.id}
            onToggle={() =>
              setExpandedAction(
                expandedAction === action.id ? null : action.id
              )
            }
            selected={selectedIds.has(action.id)}
            onSelect={(checked) => toggleSelect(action.id, checked)}
            onStateChange={handleStateChange}
          />
        ))}

        {filtered.length === 0 && active.length > 0 && (
          <div className="rounded-md border border-border p-6 text-center">
            <p className="text-[12px] text-muted-foreground">
              No active actions match these filters.
            </p>
          </div>
        )}

        {active.length === 0 && (
          <div className="rounded-md border border-status-success/20 bg-status-success/5 p-6 text-center">
            <p className="text-[13px] font-semibold text-status-success">
              All actions completed or dismissed
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {done.length} done · {dismissed.length} dismissed
            </p>
          </div>
        )}
      </div>

      {/* Done section */}
      {done.length > 0 && (
        <details className="mt-6 group">
          <summary className="flex items-center gap-2 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            <span className="font-semibold">
              Completed ({done.length})
            </span>
          </summary>
          <div className="mt-2 space-y-1.5">
            {done.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                isExpanded={expandedAction === action.id}
                onToggle={() =>
                  setExpandedAction(
                    expandedAction === action.id ? null : action.id
                  )
                }
                muted
              />
            ))}
          </div>
        </details>
      )}

      {/* Dismissed section */}
      {dismissed.length > 0 && (
        <details className="mt-4 group">
          <summary className="flex items-center gap-2 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
            <span>Dismissed ({dismissed.length})</span>
          </summary>
          <div className="mt-2 space-y-1.5">
            {dismissed.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                isExpanded={expandedAction === action.id}
                onToggle={() =>
                  setExpandedAction(
                    expandedAction === action.id ? null : action.id
                  )
                }
                muted
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ActionCard({
  action,
  rank,
  isExpanded,
  onToggle,
  muted,
  selected,
  onSelect,
  onStateChange,
}: {
  action: ActionItem;
  rank?: number;
  isExpanded: boolean;
  onToggle: () => void;
  muted?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onStateChange?: (actionId: string, state: OperatorState) => void;
}) {
  const cat = CATEGORY_CONFIG[action.category];
  const pri = PRIORITY_CONFIG[action.priority];
  const opState = action.operatorState ?? "open";
  const sc = STATE_CONFIG[opState];

  return (
    <div
      data-action-id={action.id}
      className={cn(
        "rounded-lg border transition-colors",
        muted ? "border-border/50 opacity-70" : cat.bgClass,
        opState === "in_progress" && "ring-1 ring-accent-primary/30",
        selected && "ring-1 ring-accent-primary/40 bg-accent-primary/[0.03]"
      )}
    >
      {/* Collapsed row */}
      <div className="flex">
        {onSelect != null && (
          <label
            className="flex items-center pl-3 py-3 cursor-pointer shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={(e) => onSelect(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-accent-primary cursor-pointer"
            />
          </label>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "flex-1 text-left py-3 flex items-start gap-4",
            onSelect != null ? "pr-4 pl-2" : "px-4"
          )}
        >
        {rank != null && (
          <div className="flex-shrink-0 w-6 text-center pt-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
              {rank}
            </span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span
              className={`text-[9px] font-semibold uppercase tracking-wider ${cat.color}`}
            >
              {cat.label}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${pri.dot}`} />
              <span className={`text-[9px] font-medium ${pri.color}`}>
                {pri.label}
              </span>
            </span>
            <span className="text-[9px] text-muted-foreground bg-surface-inset px-1.5 py-0.5 rounded">
              {SOURCE_LABELS[action.sourceType]}
            </span>
            {opState !== "open" && (
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                <span className={`text-[9px] font-semibold ${sc.color}`}>
                  {sc.label}
                </span>
              </span>
            )}
          </div>

          <p className="text-[13px] font-semibold">{action.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {action.why}
          </p>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2 mt-0.5">
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              isExpanded && "rotate-180"
            )}
          />
        </div>
        </button>
      </div>

      {/* Expanded execution brief */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border/50">
          <div className={cn("space-y-4", rank != null && "ml-10")}>
            {/* State controls */}
            <div className="flex items-center justify-between">
              <StateControls actionId={action.id} currentState={opState} onStateChange={onStateChange} />
              {action.stateUpdatedAt && (
                <span className="text-[9px] text-muted-foreground">
                  Updated{" "}
                  {new Date(action.stateUpdatedAt).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
                  )}
                </span>
              )}
            </div>

            {/* Details grid */}
            {action.brief.details.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
                {action.brief.details.map((d, i) => (
                  <div key={i}>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">
                      {d.label}
                    </span>
                    <p
                      className={`text-[11px] font-medium ${DETAIL_TYPE_COLORS[d.type ?? "neutral"]}`}
                    >
                      {d.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Events list */}
            {action.brief.events && action.brief.events.length > 0 && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">
                  Included events
                </p>
                <div className="space-y-0.5">
                  {action.brief.events.map((e, i) => (
                    <Link
                      key={i}
                      href={`/results/${e.resultId}`}
                      className="flex items-center gap-3 rounded px-2 py-1 hover:bg-background/50 transition-colors text-[10px]"
                    >
                      <span className="text-muted-foreground truncate flex-1">
                        {e.topic}
                      </span>
                      <span className="text-muted-foreground">
                        {PLATFORM_SHORT[e.platform] ?? e.platform}
                      </span>
                      <span className="tabular-nums font-medium">
                        gap {e.gap}
                      </span>
                      <span className="text-muted-foreground/70 truncate max-w-[140px]">
                        {e.reason}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Changes list */}
            {action.brief.changes && action.brief.changes.length > 0 && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">
                  Linked changes
                </p>
                <div className="space-y-0.5">
                  {action.brief.changes.map((c, i) => (
                    <Link
                      key={i}
                      href={`/changes/${c.id}`}
                      className="flex items-center gap-3 rounded px-2 py-1 hover:bg-background/50 transition-colors text-[10px]"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="truncate font-medium block">
                          {c.name}
                        </span>
                        {c.description && (
                          <span className="text-[9px] text-muted-foreground/60 line-clamp-1 block mt-0.5">
                            {c.description}
                          </span>
                        )}
                      </div>
                      <span
                        className={`font-semibold ${VERDICT_COLORS[c.verdict] ?? "text-muted-foreground"}`}
                      >
                        {changeVerdictLabel(c.verdict as ChangeVerdict)}
                      </span>
                      {c.score != null && (
                        <span className="tabular-nums text-muted-foreground">
                          {Math.round(c.score)}
                        </span>
                      )}
                      <span className="text-muted-foreground/70">
                        {c.evidenceTier}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Known / Unknown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] text-status-success uppercase tracking-wider font-semibold mb-1">
                  What Beacon knows
                </p>
                <ul className="space-y-0.5">
                  {action.brief.knownFacts.map((f, i) => (
                    <li
                      key={i}
                      className="text-[10px] text-muted-foreground flex items-start gap-1.5"
                    >
                      <span className="h-1 w-1 rounded-full bg-status-success/60 mt-1.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[9px] text-status-warning uppercase tracking-wider font-semibold mb-1">
                  What Beacon does not know
                </p>
                <ul className="space-y-0.5">
                  {action.brief.unknowns.map((u, i) => (
                    <li
                      key={i}
                      className="text-[10px] text-muted-foreground flex items-start gap-1.5"
                    >
                      <span className="h-1 w-1 rounded-full bg-status-warning/60 mt-1.5 shrink-0" />
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Best next move */}
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                Best next move
              </p>
              <p className="text-[12px] font-medium">
                {action.brief.bestNextMove}
              </p>
            </div>

            {/* Workflow links */}
            <div className="flex items-center gap-2 flex-wrap">
              {action.brief.workflows.map((w, i) => (
                <Link
                  key={i}
                  href={w.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-surface-inset",
                    w.primary
                      ? action.priority === "high"
                        ? "border-status-danger/30 text-status-danger"
                        : action.priority === "medium"
                          ? "border-status-warning/30 text-status-warning"
                          : "border-border text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {w.label} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

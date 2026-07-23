import type { KernelRead } from "@/domains/measurement/proof-gsc";
import { verdictPhrase, windowStateLine } from "@/domains/measurement";

/** Plain-English action label from a raw action_type. */
export function plainAction(actionType: string): string {
  return (actionType || "change").replace(/_/g, " ");
}

const TONE: Record<KernelRead["verdict"], { border: string; badge: string; text: string }> = {
  stronger_improvement: { border: "border-emerald-300", badge: "bg-emerald-100 text-emerald-800", text: "text-emerald-800" },
  directional_improvement: { border: "border-emerald-200", badge: "bg-emerald-50 text-emerald-700", text: "text-emerald-700" },
  directional_decline: { border: "border-rose-200", badge: "bg-rose-50 text-rose-700", text: "text-rose-700" },
  no_clear_movement: { border: "border-border-subtle", badge: "bg-surface-inset text-muted-foreground", text: "text-muted-foreground" },
  confounded: { border: "border-amber-200", badge: "bg-amber-50 text-amber-800", text: "text-amber-800" },
  insufficient_evidence: { border: "border-border-subtle", badge: "bg-surface-inset text-muted-foreground", text: "text-muted-foreground" },
  waiting: { border: "border-sky-200", badge: "bg-sky-50 text-sky-700", text: "text-sky-700" },
};

const CONF_LABEL: Record<KernelRead["confidence"], string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

function WindowChips({ windows }: { windows: KernelRead["windows"] }) {
  return (
    <div className="mt-2 flex gap-1.5" aria-label="Measurement windows">
      {windows.map((w) => {
        const cls =
          w.state === "closed"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : w.state === "pending_data"
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-surface-inset text-muted-foreground border-border-subtle";
        return (
          <span key={w.day} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums ${cls}`}>
            {w.day}d {w.state === "closed" ? "read" : w.state === "pending_data" ? "waiting on Google" : "open"}
          </span>
        );
      })}
    </div>
  );
}

/** One measured change. Renders ONLY what the kernel read provides. */
export function ResultCard({ read }: { read: KernelRead }) {
  const actionType = read.actionType;
  const tone = TONE[read.verdict];
  const path = (() => {
    try {
      return new URL(read.page).pathname || read.path;
    } catch {
      return read.path;
    }
  })();
  return (
    <div className={`rounded-lg border ${tone.border} bg-surface-raised px-3 py-2.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">{path}</div>
          <div className="text-[11px] text-muted-foreground">{plainAction(actionType)}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
          {verdictPhrase(read.verdict)}
        </span>
      </div>
      <p className={`mt-1.5 text-[12px] ${tone.text}`}>{read.headline}</p>
      <WindowChips windows={read.windows} />
      <p className="mt-1.5 text-[10px] text-muted-foreground">{windowStateLine(read.windows)}</p>
      {read.caveats.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {read.caveats.map((c, i) => (
            <li key={i} className="text-[10px] text-amber-700">{c}</li>
          ))}
        </ul>
      ) : null}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
          {CONF_LABEL[read.confidence]} &middot; why
        </summary>
        <ul className="mt-1 space-y-0.5 pl-1">
          {read.confidenceReasons.map((r, i) => (
            <li key={i} className="text-[10px] text-muted-foreground">{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

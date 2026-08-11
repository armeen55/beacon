import type { KernelRead } from "@/domains/measurement/proof-gsc";
import { shipmentStory, type ShipmentPresentation } from "./results-presentation";

/**
 * The Results card (V1 Truth Convergence Phase 8) - the WHOLE story of one shipped change on one
 * card: did it land on your live page, where the page stood the day you marked it done, what has
 * happened since in Google and in AI answers, how sure I am, and what I take away from it.
 *
 * Every sentence comes from shipmentStory, so the screen cannot say anything a test has not read. A
 * window that belongs to more than one change is painted amber and NAMES what it shares with,
 * because a green chip over shared days would sell an overlap as a clean win.
 */

const TONE: Record<KernelRead["verdict"], { border: string; badge: string; text: string }> = {
  stronger_improvement: { border: "border-emerald-300", badge: "bg-emerald-100 text-emerald-800", text: "text-emerald-800" },
  directional_improvement: { border: "border-emerald-200", badge: "bg-emerald-50 text-emerald-700", text: "text-emerald-700" },
  directional_decline: { border: "border-rose-200", badge: "bg-rose-50 text-rose-700", text: "text-rose-700" },
  no_clear_movement: { border: "border-border-subtle", badge: "bg-surface-inset text-muted-foreground", text: "text-muted-foreground" },
  confounded: { border: "border-amber-200", badge: "bg-amber-50 text-amber-800", text: "text-amber-800" },
  insufficient_evidence: { border: "border-border-subtle", badge: "bg-surface-inset text-muted-foreground", text: "text-muted-foreground" },
  waiting: { border: "border-sky-200", badge: "bg-sky-50 text-sky-700", text: "text-sky-700" },
};

const CHIP: Record<"done" | "waiting" | "shared", string> = {
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  waiting: "bg-surface-inset text-muted-foreground border-border-subtle",
  shared: "bg-amber-50 text-amber-800 border-amber-300",
};

const STEP_TEXT: Record<"done" | "waiting" | "shared", string> = {
  done: "text-foreground", waiting: "text-muted-foreground", shared: "text-amber-800",
};

const SECTION = "mt-2.5 border-t border-border-subtle pt-2";
const HEAD = "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

function pathOf(read: KernelRead): string {
  try {
    return new URL(read.page).pathname || read.path;
  } catch {
    return read.path;
  }
}

/** One measured change, whole. Renders ONLY what the kernels provide. */
export function ResultCard({ shipment }: { shipment: ShipmentPresentation }) {
  const read = shipment.read;
  const tone = TONE[read.verdict];
  const story = shipmentStory(shipment);

  return (
    <div className={`rounded-lg border ${tone.border} bg-surface-raised px-3 py-2.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">{pathOf(read)}</div>
          <div className="text-[11px] text-muted-foreground">{story.work}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
          {story.badge}
        </span>
      </div>

      <div className={SECTION}>
        <p className={HEAD}>Did it land</p>
        <p className="mt-0.5 text-[12px] text-foreground">{story.verification.headline}</p>
        {story.verification.components.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {story.verification.components.map((line, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">{line}</li>
            ))}
          </ul>
        ) : null}
        {story.verification.checkedOn ? (
          <p className="mt-0.5 text-[10px] text-muted-foreground/80">Checked on {story.verification.checkedOn}.</p>
        ) : null}
      </div>

      {story.baseline ? (
        <div className={SECTION}>
          <p className={HEAD}>Where it started</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{story.baseline}</p>
        </div>
      ) : null}

      <div className={SECTION}>
        <p className={HEAD}>What has been read</p>
        <ol className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {story.timeline.map((s, i) => (
            <li key={`${s.label}-${i}`} className="flex items-center gap-2">
              {i > 0 ? <span aria-hidden className="text-[10px] text-muted-foreground/60">{"->"}</span> : null}
              <span className={`text-[10px] ${STEP_TEXT[s.state]}`}>
                {s.label}
                {s.when ? <span className="text-muted-foreground"> {s.when}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="What has been read so far">
          {story.chips.map((c) => (
            <span key={c.day} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums ${CHIP[c.state]}`}>
              {c.text}
            </span>
          ))}
        </div>
        {story.overlap ? <p className="mt-1 text-[11px] text-amber-800">{story.overlap}</p> : null}
      </div>

      <div className={SECTION}>
        <p className={HEAD}>In Google search</p>
        <p className={`mt-0.5 text-[12px] ${tone.text}`}>{story.search.headline}</p>
        {story.search.caveats.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {story.search.caveats.map((c, i) => (
              <li key={i} className="text-[10px] text-amber-700">{c}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {story.ai ? (
        <div className={SECTION}>
          <p className={HEAD}>In AI answers</p>
          <p className="mt-0.5 text-[12px] text-foreground">{story.ai.heading}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{story.ai.coverage}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{story.ai.line}</p>
        </div>
      ) : null}

      <div className={SECTION}>
        <p className="text-[11px] text-foreground/80">{story.learning}</p>
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
            {story.confidence} &middot; why
          </summary>
          <ul className="mt-1 space-y-0.5 pl-1">
            {read.confidenceReasons.map((r, i) => (
              <li key={i} className="text-[10px] text-muted-foreground">{r}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

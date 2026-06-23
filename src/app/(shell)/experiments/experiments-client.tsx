"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type {
  ExperimentCard,
  ExperimentStatus,
  ExperimentFamily,
} from "@/domains/insight/select-experiment-batch";

/**
 * Batch Experiment Planner client (TASK 4). Renders the selected experiment
 * cards with paste-ready copy + proof instructions, plus batch actions: copy a
 * draft, copy all ready drafts, mark one shipped (hands off to the existing
 * /proof record flow with the page prefilled), open the Workbench, or skip for
 * this session. Nothing publishes from here.
 */

const STATUS_META: Record<ExperimentStatus, { label: string; cls: string }> = {
  ready_now: { label: "Ready now", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  needs_drafting: { label: "Needs drafting", cls: "border-amber-300 bg-amber-50 text-amber-800" },
  needs_wix_mapping: { label: "Needs Wix mapping", cls: "border-sky-300 bg-sky-50 text-sky-700" },
  needs_serp_check: { label: "Needs Google results check", cls: "border-amber-300 bg-amber-50 text-amber-800" },
  manual_only: { label: "Manual edit", cls: "border-slate-300 bg-slate-50 text-slate-700" },
};

const FAMILY_LABEL: Record<ExperimentFamily, string> = {
  ctr: "Title / meta click rate",
  answer: "Answer block",
  content: "Content / sections",
  structure: "Schema / links",
  swing: "Bigger swing",
};

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function ExperimentsClient({ cards }: { cards: ExperimentCard[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => cards.filter((c) => !skipped.has(`${c.page}:${c.lever}`)),
    [cards, skipped],
  );
  const allReadyDrafts = useMemo(
    () =>
      visible
        .filter((c) => c.draft)
        .map((c) => `# ${c.pageTitle} (${c.actionType})\n${c.draft}`)
        .join("\n\n"),
    [visible],
  );

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/30 p-6 text-[13px] text-muted-foreground">
        No new experiments to plan right now. Either every high-value page already
        has an experiment measuring, or there is not enough Search data yet. Check
        back after the open proof windows close, or run a website scan to add pages.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted-foreground">
          {visible.length} experiment{visible.length === 1 ? "" : "s"} planned
        </span>
        {allReadyDrafts ? <CopyButton value={allReadyDrafts} label="Copy all ready drafts" /> : null}
        <button
          type="button"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
          className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
          {pending ? "Refreshing…" : "Refresh plan"}
        </button>
      </div>

      <ol className="space-y-3">
        {visible.map((c, i) => (
          <li key={`${c.page}:${c.lever}`}>
            <Card card={c} rank={i + 1} onSkip={() => setSkipped((s) => new Set(s).add(`${c.page}:${c.lever}`))} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Card({
  card,
  rank,
  onSkip,
}: {
  card: ExperimentCard;
  rank: number;
  onSkip: () => void;
}) {
  const sm = STATUS_META[card.status];
  return (
    <div className="rounded-xl border border-border/60 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">#{rank}</span>
        <span className="text-[14px] font-semibold text-foreground">{card.pageTitle}</span>
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {FAMILY_LABEL[card.family]}
        </span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${sm.cls}`}>
          {sm.label}
        </span>
        {card.isOptionalSwing ? (
          <span className="rounded border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700">
            Optional bigger swing
          </span>
        ) : null}
        {card.estClicksAtStake != null ? (
          <span className="text-[11px] text-muted-foreground">
            ~{card.estClicksAtStake.toLocaleString()} clicks at stake, {card.estConfidence} chance it helps
          </span>
        ) : null}
      </div>

      <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">{card.page}</p>
      <p className="mt-2 text-[12px] text-foreground/85">{card.whyNow}</p>

      {card.draft ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Paste-ready {card.actionType}
            </span>
            <CopyButton value={card.draft} />
          </div>
          <pre className="mt-0.5 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-foreground/85">
            {card.draft}
          </pre>
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px] text-amber-800">
          No drafted copy yet. Open the Workbench and draft the suggested edits, then come back to ship and measure it.
        </p>
      )}

      {card.before ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Current:</span> {card.before}
        </p>
      ) : null}
      {card.rollbackCopy ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Undo to:</span> {card.rollbackCopy}
        </p>
      ) : null}

      {card.targetQueries.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Target queries: {card.targetQueries.join(", ")}
        </p>
      ) : null}

      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        <p>Risk: {card.risk}. Measure: {card.measurementMetric}.</p>
        <p>{card.proofInstructions}</p>
        <p>{card.gscIndexingInstruction}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/proof?page=${encodeURIComponent(card.canonUrl)}`}
          prefetch={false}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
        >
          Mark shipped, record in Proof
        </Link>
        <Link
          href={card.workbenchHref}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted"
        >
          Open Workbench
        </Link>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

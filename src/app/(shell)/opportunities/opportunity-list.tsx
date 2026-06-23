"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  OpportunityItem,
  OpportunityKind,
  OpportunitySource,
} from "@/domains/insight/opportunity";
import { serpStatusChip } from "@/domains/insight/serp-guard";
import { workbenchHref } from "@/domains/insight/workbench-route";

/**
 * Plain-English, scannable map (2026-06-22 redesign). The compute layer already
 * picks ONE dominant `kind` + ONE `estClicksAtStake` per page, the old UI threw
 * that away and rendered every secondary signal as an equal jargon pill, so
 * nothing was scannable. Now: one row = one decision (title · plain chip · big
 * number · one button); all the homework (evidence, Move, SERP guard, secondary
 * kinds, confidence) lives behind a "Why" expander, collapsed by default.
 */
const KIND_META: Record<
  OpportunityKind,
  { label: string; dot: string; chip: string }
> = {
  ctr_leak: {
    label: "Shown, not clicked",
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700",
  },
  striking_distance: {
    label: "Almost on page 1",
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-700",
  },
  decay: {
    label: "Losing clicks",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700",
  },
  rising: {
    label: "Gaining clicks",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700",
  },
  friction: {
    label: "Visitors get stuck",
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700",
  },
  cannibalization: {
    label: "Pages competing",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-700",
  },
};

const SOURCE_LABEL: Record<OpportunitySource, string> = {
  gsc: "Search",
  semrush: "SEMrush",
  clarity: "Clarity",
  ga4: "Analytics",
};

type SortKey = "impact" | "ready";

export function OpportunityList({ items }: { items: OpportunityItem[] }) {
  const [sort, setSort] = useState<SortKey>("impact");

  const sorted = useMemo(() => {
    const copy = [...items];
    if (sort === "ready") {
      copy.sort((a, b) => {
        const r = Number(b.hasChangePack) - Number(a.hasChangePack);
        return r !== 0 ? r : b.estClicksAtStake - a.estClicksAtStake;
      });
    }
    // "impact" = the order the compute layer already ranked them in.
    return copy;
  }, [items, sort]);

  const summary = useMemo(() => {
    let clicks = 0;
    let ready = 0;
    for (const o of items) {
      if (o.kind !== "friction") clicks += o.estClicksAtStake;
      if (o.hasChangePack) ready += 1;
    }
    return { clicks, ready, pages: items.length };
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No opportunities detected yet. Once Search, SEMrush, and Clarity data
        sync, ranked page opportunities appear here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline strip, opens with the one number that matters. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface-inset/40 px-4 py-3">
        <div className="text-[13px] text-foreground">
          <span className="text-[17px] font-semibold tabular-nums">
            ~{summary.clicks.toLocaleString()}
          </span>{" "}
          <span className="text-muted-foreground">clicks/90d at stake across</span>{" "}
          <span className="font-semibold tabular-nums">{summary.pages}</span>{" "}
          <span className="text-muted-foreground">pages</span>
          {summary.ready > 0 ? (
            <>
              {" · "}
              <span className="font-semibold tabular-nums text-emerald-700">
                {summary.ready}
              </span>{" "}
              <span className="text-muted-foreground">ready to review</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-[12px]">
          <span className="text-muted-foreground">Sort</span>
          {(["impact", "ready"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={
                "rounded-full px-2.5 py-1 font-medium transition-colors " +
                (sort === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {k === "impact" ? "Biggest impact" : "Ready first"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {sorted.map((o) => (
          <OpportunityRow key={o.canonUrl} o={o} />
        ))}
      </div>

      <details className="text-[11px] text-muted-foreground/70">
        <summary className="cursor-pointer select-none hover:text-muted-foreground">
          How these estimates work
        </summary>
        <p className="pt-1.5">
          Estimates are directional, sized as impressions × the CTR gap;
          &ldquo;Visitors get stuck&rdquo; rows instead count Clarity dead/rage
          clicks (on-page frustration, not recoverable search clicks). A sizing,
          not a promise. &ldquo;SERP unknown&rdquo; means we haven&rsquo;t
          verified whether a SERP feature (AI Overview / featured snippet / image
          pack) owns the clicks, on top-ranked pages, verify the SERP before
          rewriting a title.
        </p>
      </details>
    </div>
  );
}

function OpportunityRow({ o }: { o: OpportunityItem }) {
  const [open, setOpen] = useState(false);
  const meta = KIND_META[o.kind];
  const isFriction = o.kind === "friction";

  return (
    <div className="rounded-lg border border-border/60 bg-background transition-colors hover:border-border">
      {/* ── Collapsed row: one decision ── */}
      <div className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-foreground">
              {o.title}
            </span>
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium " +
                meta.chip
              }
            >
              <span className={"h-1.5 w-1.5 rounded-full " + meta.dot} />
              {meta.label}
            </span>
            {o.hasChangePack ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                ✓ Ready
              </span>
            ) : null}
            {o.importance > 1.05 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                High-value
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
            {o.path}
          </p>
        </div>

        {/* Right rail: the number + the one action. */}
        <div className="flex shrink-0 items-center gap-3">
          {o.estClicksAtStake > 0 ? (
            <div className="text-right">
              <div className="text-[18px] font-semibold tabular-nums text-foreground">
                {isFriction ? "" : "~"}
                {o.estClicksAtStake.toLocaleString()}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {isFriction ? "stuck clicks" : `clicks/${o.estWindow}`}
              </div>
            </div>
          ) : null}
          <Link
            href={workbenchHref(o.path)}
            prefetch={false}
            className="whitespace-nowrap rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
          >
            {o.hasChangePack ? "Review" : "Audit"}
          </Link>
        </div>
      </div>

      {/* ── "Why" toggle ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-t border-border/40 px-4 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <span
          className={
            "inline-block transition-transform " + (open ? "rotate-90" : "")
          }
        >
          ▸
        </span>
        Why · what to do
      </button>

      {/* ── Expanded: all the homework, honest + complete ── */}
      {open ? (
        <div className="space-y-2.5 border-t border-border/40 px-4 pb-4 pt-3">
          <p className="text-[13px] text-foreground">{o.why}</p>

          <ul className="space-y-1">
            {o.evidenceBySource.map((e, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-muted-foreground">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {SOURCE_LABEL[e.source]}
                </span>
                <span>{e.line}</span>
              </li>
            ))}
          </ul>

          <p className="text-[12px] text-foreground/90">
            <span className="font-semibold">Do this:</span>{" "}
            {o.hasChangePack && o.packAction ? o.packAction : o.expectedLever}
          </p>

          {o.serpGuardLabel ? (
            <p className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              ⚠ {o.serpGuardLabel}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {o.estClicksAtStake > 0 && !isFriction ? (
              <span>
                {o.estConfidence} confidence · {o.estWindow} window
              </span>
            ) : null}
            <span>{serpStatusChip(o.serpStatus)}</span>
            {o.kinds
              .filter((k) => k !== o.kind)
              .map((k) => (
                <span key={k}>{KIND_META[k].label}</span>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

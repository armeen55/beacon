"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  OpportunityItem,
  OpportunityKind,
  OpportunitySource,
} from "@/domains/insight/opportunity";
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
  { label: string; dot: string; chip: string; hint: string }
> = {
  ctr_leak: {
    label: "Shown, not clicked",
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700",
    hint: "Lots of people see you on Google but few click. Usually the title needs work.",
  },
  striking_distance: {
    label: "Almost on page 1",
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-700",
    hint: "This page is close to the first page of Google. A small push could get it there.",
  },
  decay: {
    label: "Losing clicks",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700",
    hint: "This page is getting fewer visits from Google than it used to.",
  },
  rising: {
    label: "Gaining clicks",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700",
    hint: "This page is getting more visits from Google than it used to.",
  },
  friction: {
    label: "Visitors get stuck",
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700",
    hint: "People who land here click something that does not work, then leave.",
  },
  cannibalization: {
    label: "Your own pages fighting each other",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-700",
    hint: "Two of your own pages target the same search, so they hold each other back.",
  },
};

const SOURCE_LABEL: Record<OpportunitySource, string> = {
  gsc: "Google",
  semrush: "Keyword data",
  clarity: "Visitor behavior",
  ga4: "Visitor behavior",
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
    // audit-wave #11 (2026-06-23): sum by window — a 28-day estimate and a
    // 90-day estimate are different time spans; blending them under one "over 90
    // days" label overstated the total. Keep them separate + label each honestly.
    let clicks90 = 0;
    let clicks28 = 0;
    let ready = 0;
    for (const o of items) {
      if (o.kind !== "friction") {
        if (o.estWindow === "90d") clicks90 += o.estClicksAtStake;
        else clicks28 += o.estClicksAtStake;
      }
      if (o.hasChangePack) ready += 1;
    }
    return { clicks90, clicks28, ready, pages: items.length };
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        We don&rsquo;t have enough data yet.{" "}
        <Link href="/connections" className="font-medium text-foreground underline underline-offset-2">
          Connect Google
        </Link>{" "}
        to get started. Once your data comes in, your best page opportunities
        appear here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline strip, opens with the one number that matters. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface-inset/40 px-4 py-3">
        <div className="text-[13px] text-foreground">
          <span className="text-muted-foreground">You could win back about</span>{" "}
          <span className="text-[17px] font-semibold tabular-nums">
            {(summary.clicks90 > 0 ? summary.clicks90 : summary.clicks28).toLocaleString()}
          </span>{" "}
          <span className="text-muted-foreground">
            more visits over {summary.clicks90 > 0 ? "90" : "28"} days
          </span>
          {summary.clicks90 > 0 && summary.clicks28 > 0 ? (
            <>
              <span className="text-muted-foreground">, plus about</span>{" "}
              <span className="font-semibold tabular-nums">
                {summary.clicks28.toLocaleString()}
              </span>{" "}
              <span className="text-muted-foreground">over 28 days</span>
            </>
          ) : null}{" "}
          <span className="text-muted-foreground">across</span>{" "}
          <span className="font-semibold tabular-nums">{summary.pages}</span>{" "}
          <span className="text-muted-foreground">pages</span>
          {summary.ready > 0 ? (
            <>
              {" · "}
              <span className="font-semibold tabular-nums text-emerald-700">
                {summary.ready}
              </span>{" "}
              <span className="text-muted-foreground">already have a suggested fix ready for you</span>
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
              aria-pressed={sort === k}
              className={
                "rounded-full px-2.5 py-1 font-medium transition-colors " +
                (sort === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {sort === k ? "✓ " : ""}
              {k === "impact" ? "Biggest impact" : "Ones with a fix ready"}
            </button>
          ))}
        </div>
      </div>

      <p className="px-1 text-[12px] text-muted-foreground">
        Looking never changes your live site. You approve every change before it
        goes out.
      </p>

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
          These are rough estimates of the extra visits you could gain, based on
          your Google and visitor data. They are a guide, not a guarantee. For
          &ldquo;Visitors get stuck&rdquo; pages, the number counts people who
          clicked something that did not work, not lost visits. Before you change
          a page&rsquo;s title, it helps to check how that page currently shows up
          on Google.
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
              title={meta.hint}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium " +
                meta.chip
              }
            >
              <span className={"h-1.5 w-1.5 rounded-full " + meta.dot} />
              {meta.label}
            </span>
            {o.hasChangePack && o.packAction ? (
              <span
                title="We already have a suggested fix written for this page. Open it to look before anything changes."
                className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              >
                ✓ Fix ready
              </span>
            ) : o.importance > 1.05 ? (
              <span
                title="One of your more important pages, so a change here tends to matter more."
                className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
              >
                One of your top pages
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground/70">
            Page: {o.path}
          </p>
        </div>

        {/* Right rail: the number + the one action. */}
        <div className="flex shrink-0 items-center gap-3">
          {o.estClicksAtStake > 0 ? (
            <div className="text-right">
              <div className="text-[18px] font-semibold tabular-nums text-foreground">
                {isFriction ? "" : "about "}
                {o.estClicksAtStake.toLocaleString()}
              </div>
              <div className="text-[10px] tracking-wide text-muted-foreground">
                {isFriction
                  ? "visitors clicked something broken"
                  : `more visits over ${o.estWindow === "90d" ? "90" : "28"} days`}
              </div>
            </div>
          ) : null}
          <Link
            href={workbenchHref(o.path)}
            prefetch={false}
            className="whitespace-nowrap rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
          >
            {o.hasChangePack && o.packAction ? "See the fix" : "Look into it"}
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
          aria-hidden="true"
          className={
            "inline-block transition-transform " + (open ? "rotate-90" : "")
          }
        >
          ›
        </span>
        Why this matters and what to do
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
            <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              <p className="font-semibold">Heads up before you change the title</p>
              <p className="mt-0.5">
                Google may be showing the answer itself for this search, so
                changing the title might not win the clicks back. Check how this
                page shows up on Google first.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[10px] tracking-wide text-muted-foreground/70">
            {o.estClicksAtStake > 0 && !isFriction ? (
              <span>
                {o.estConfidence === "high"
                  ? "We're fairly confident"
                  : o.estConfidence === "medium"
                    ? "Worth a try"
                    : "A long shot"}{" "}
                · based on {o.estWindow === "90d" ? "90" : "28"} days of data
              </span>
            ) : null}
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

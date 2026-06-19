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

const KIND_META: Record<OpportunityKind, { label: string; cls: string }> = {
  ctr_leak: { label: "CTR leak", cls: "border-rose-300 bg-rose-50 text-rose-700" },
  striking_distance: { label: "Striking distance", cls: "border-blue-300 bg-blue-50 text-blue-700" },
  decay: { label: "Decaying", cls: "border-amber-300 bg-amber-50 text-amber-700" },
  rising: { label: "Rising", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  friction: { label: "Friction", cls: "border-violet-300 bg-violet-50 text-violet-700" },
};

const SOURCE_LABEL: Record<OpportunitySource, string> = {
  gsc: "Search",
  semrush: "SEMrush",
  clarity: "Clarity",
  ga4: "Analytics",
};

const FILTERS: (OpportunityKind | "all")[] = [
  "all",
  "ctr_leak",
  "striking_distance",
  "decay",
  "rising",
  "friction",
];

export function OpportunityList({ items }: { items: OpportunityItem[] }) {
  const [filter, setFilter] = useState<OpportunityKind | "all">("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) for (const k of i.kinds) c[k] = (c[k] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kinds.includes(filter))),
    [items, filter],
  );

  if (items.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No opportunities detected yet — once Search, SEMrush, and Clarity data
        sync, ranked page opportunities appear here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const n = f === "all" ? items.length : (counts[f] ?? 0);
          if (f !== "all" && n === 0) return null;
          const active = filter === f;
          const label = f === "all" ? "All" : KIND_META[f].label;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors " +
                (active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
            >
              {label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="space-y-2.5">
        {filtered.map((o) => (
          <div
            key={o.canonUrl}
            className="rounded-lg border border-border/60 bg-background p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[14px] font-semibold text-foreground">
                    {o.title}
                  </span>
                  {o.kinds.map((k) => (
                    <span
                      key={k}
                      className={
                        "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                        KIND_META[k].cls
                      }
                    >
                      {KIND_META[k].label}
                    </span>
                  ))}
                  {o.hasChangePack ? (
                    <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      ✓ Change Pack ready
                    </span>
                  ) : null}
                  {/* SERP-feature knowledge for this page (broad scan ⇒ unknown). */}
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {serpStatusChip(o.serpStatus)}
                  </span>
                </div>
                {/* Guard warning: a top-ranked low-CTR page where a SERP feature
                    may own the clicks — don't over-claim a title problem. */}
                {o.serpGuardLabel ? (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    ⚠ {o.serpGuardLabel}
                  </p>
                ) : null}
                <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                  {o.path}
                </p>
                <p className="mt-2 text-[13px] text-foreground">{o.why}</p>

                {/* Evidence by source */}
                <ul className="mt-2 space-y-1">
                  {o.evidenceBySource.map((e, i) => (
                    <li key={i} className="flex gap-2 text-[12px] text-muted-foreground">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {SOURCE_LABEL[e.source]}
                      </span>
                      <span>{e.line}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-2 text-[12px] text-foreground/80">
                  <span className="font-semibold">Move:</span>{" "}
                  {o.hasChangePack && o.packAction ? o.packAction : o.expectedLever}
                </p>
              </div>

              {/* Right rail: impact + CTA */}
              <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                {o.estClicksAtStake > 0 ? (
                  <div>
                    <div className="text-[18px] font-semibold tabular-nums text-foreground">
                      ~{o.estClicksAtStake.toLocaleString()}
                    </div>
                    {/* A number never reads as a promise — always carry the
                        window, confidence, and SERP status next to it. */}
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      est. clicks at stake over {o.estWindow}
                    </div>
                    <div className="text-[10px] tracking-wide text-muted-foreground/80">
                      {o.estConfidence} confidence · {serpStatusChip(o.serpStatus)}
                    </div>
                  </div>
                ) : null}
                {o.importance > 1.05 ? (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    high-value page
                  </span>
                ) : null}
                <Link
                  href={workbenchHref(o.path)}
                  prefetch={false}
                  className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
                >
                  {o.hasChangePack ? "Review Change Pack →" : "Run Deep Audit →"}
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="pt-1 text-[11px] text-muted-foreground/70">
        Estimates are directional — impressions × the CTR gap / search volume,
        shown with their window + confidence. An opportunity sizing, not a
        promise. &ldquo;SERP unknown&rdquo; means we haven&rsquo;t verified
        whether a SERP feature (AI Overview / featured snippet / image pack)
        owns the clicks; on top-ranked pages, verify the SERP before rewriting
        a title.
      </p>
    </div>
  );
}

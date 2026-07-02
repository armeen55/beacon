"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { runPageSurgeonBrief, type PageSurgeonRow } from "./actions";
import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";
import { dossierHref } from "@/lib/page-dossier-link";

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "warn" }) {
  const cls =
    tone === "good"
      ? "bg-status-success/15 text-status-success"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-surface-inset/60 text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

type Change = NonNullable<PageAtomicDecision["primary_atomic_change"]>;

function ChangeBlock({ c, label }: { c: Change; label: string }) {
  return (
    <div className="rounded border border-border/40 bg-surface-inset/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="good">{label}: {c.action}</Pill>
        <Pill tone={c.publishability === "staged" ? "good" : "muted"}>{c.publishability}</Pill>
        <span className="text-[10px] text-muted-foreground">step {c.dependency_order}</span>
      </div>
      <p className="mt-1.5"><span className="font-semibold text-foreground">Do:</span> {c.exact_change}</p>
      {(c.before_after.before || c.before_after.after) && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">{c.before_after.before ?? "none"}</span> {"->"} <span className="font-medium text-foreground/80">{c.before_after.after ?? "none"}</span>
        </p>
      )}
      <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Why:</span> {c.hypothesis}</p>
      {c.evidence && <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Evidence:</span> {c.evidence}</p>}
      {c.risk && <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Risk:</span> {c.risk}</p>}
      <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Measure:</span> {c.measurement}</p>
      <p className="text-muted-foreground"><span className="font-medium text-foreground/80">Rollback:</span> {c.rollback}</p>
    </div>
  );
}

function Brief({ d }: { d: PageAtomicDecision }) {
  return (
    <div className="mt-3 space-y-3 rounded-md border border-border/40 bg-surface-raised/30 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={d.recommended_atomic_action === "needs_llm_review" || d.recommended_atomic_action === "needs_more_evidence" ? "warn" : "good"}>
          {d.recommended_atomic_action}
        </Pill>
        <Pill tone={d.confidence === "high" ? "good" : d.confidence === "needs_more_evidence" ? "warn" : "muted"}>{d.confidence}</Pill>
        <Pill>{d.decided_by}</Pill>
      </div>

      {/* Source coverage: what evidence actually fed this brief */}
      <div>
        <p className="font-semibold text-foreground">Source coverage:</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {d.source_coverage.map((s) => (
            <span key={s.source} className={`rounded px-1.5 py-0.5 text-[10px] ${s.used ? "bg-status-success/15 text-status-success" : "bg-surface-inset/60 text-muted-foreground"}`} title={s.detail}>
              {s.source}: {s.used ? "✓ " : "✗ "}{s.detail}
            </span>
          ))}
        </div>
      </div>

      <p className="rounded bg-accent-primary/[0.05] p-2 leading-relaxed">
        <span className="font-semibold text-foreground">💡 Operator insight:</span> {d.operator_insight}
      </p>
      {d.what_normal_seo_misses && (
        <p className="leading-relaxed"><span className="font-semibold text-foreground">What a normal SEO misses:</span> <span className="text-muted-foreground">{d.what_normal_seo_misses}</span></p>
      )}
      {d.why_not_just_title && (
        <p className="leading-relaxed"><span className="font-semibold text-foreground">Why it's not just a title tweak:</span> <span className="text-muted-foreground">{d.why_not_just_title}</span></p>
      )}

      {d.primary_atomic_change && <ChangeBlock c={d.primary_atomic_change} label="PRIMARY" />}
      {d.supporting_atomic_changes.map((c, i) => <ChangeBlock key={i} c={c} label="supporting" />)}

      {d.wording_research.length > 0 && (
        <div>
          <p className="font-semibold text-foreground">Wording research:</p>
          <ul className="ml-4 list-disc text-muted-foreground">
            {d.wording_research.map((w, i) => (
              <li key={i}>“{w.variant}” → <span className="text-foreground/80">{w.best_placement}</span>{w.evidence ? ` (${w.evidence})` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {d.rejected_changes.length > 0 && (
        <div>
          <p className="font-semibold text-foreground">Rejected:</p>
          <ul className="ml-4 list-disc text-muted-foreground">
            {d.rejected_changes.map((r, i) => (
              <li key={i}><span className="font-medium text-foreground/80">{r.action}</span>: {r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {d.evidence_gaps.length > 0 && (
        <p className="text-[11px] text-amber-600">Evidence gaps: {d.evidence_gaps.join(" · ")}</p>
      )}
    </div>
  );
}

function Card({ row }: { row: PageSurgeonRow }) {
  const [decision, setDecision] = useState<PageAtomicDecision | null>(row.cached);
  const [stale, setStale] = useState(row.stale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await runPageSurgeonBrief(row.canonUrl);
      if (res.ok) {
        setDecision(res.decision);
        setStale(false);
      } else {
        setError(res.error);
      }
    });
  };

  const path = row.pageUrl.replace(/^https?:\/\/[^/]+/, "") || "/";
  const href = dossierHref(row.pageUrl);
  return (
    <div className="rounded-lg border border-border/60 bg-surface-inset/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {href ? (
            <Link href={href} className="block truncate text-[13px] font-semibold text-foreground underline-offset-2 hover:underline">
              {path}
            </Link>
          ) : (
            <p className="truncate text-[13px] font-semibold text-foreground">{path}</p>
          )}
          <p className="truncate text-[12px] text-muted-foreground">
            now: “{row.currentTitle ?? "(no title)"}”
          </p>
          {row.gsc && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              “{row.gsc.topQuery}” · {row.gsc.impressions.toLocaleString()} impr ·{" "}
              {row.gsc.clicks.toLocaleString()} clicks · pos {row.gsc.position.toFixed(1)} ·{" "}
              {(row.gsc.ctr * 100).toFixed(2)}% CTR
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={run}
            disabled={pending || !row.hasOpenAi}
            className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
            title={row.hasOpenAi ? "" : "OPENAI_API_KEY not set"}
          >
            {pending ? "Running…" : decision ? "Re-run" : "Run Page Surgeon"}
          </button>
          {stale && <span className="text-[10px] text-amber-600">evidence changed, re-run</span>}
          {!row.hasOpenAi && <span className="text-[10px] text-muted-foreground">no OpenAI key</span>}
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
      {decision && <Brief d={decision} />}
    </div>
  );
}

export function PageSurgeonClient({ rows }: { rows: PageSurgeonRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No pages with Google Search Console demand yet. Connect + refresh Search Console first.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <Card key={r.canonUrl} row={r} />
      ))}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import type { PageAtomicDecision } from "@/domains/recommendation-intelligence/page-surgeon/page-decision";
import { draftWorkbenchPageWithAi } from "./actions";
import { CopyButton } from "./copy-button";

/**
 * "Draft with AI" (#6) — runs the Page Surgeon analysis model on THIS page's
 * evidence and shows the drafted change + the model's reasoning. Operator-only,
 * cached server-side by evidence hash, and PURELY a draft — nothing publishes
 * from here (the operator still reviews + ships via the normal approve path).
 */
export function DraftWithAi({ path, hasOpenAi }: { path: string; hasOpenAi: boolean }) {
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<PageAtomicDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await draftWorkbenchPageWithAi(path);
      if (res.ok) setDecision(res.decision);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Drafting… (up to ~30s)" : decision ? "Re-draft with AI" : "Draft with AI"}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {hasOpenAi
            ? "Runs the analysis model on this page's evidence. Cached, so re-running an unchanged page is free. Nothing publishes."
            : "No OpenAI key set — this will use the deterministic draft (no model spend)."}
        </span>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}

      {decision ? <DecisionView decision={decision} /> : null}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "ai" | "det" | "neutral" }) {
  const cls =
    tone === "ai"
      ? "border-violet-300 bg-violet-50 text-violet-700"
      : tone === "det"
        ? "border-slate-300 bg-slate-50 text-slate-700"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function DecisionView({ decision }: { decision: PageAtomicDecision }) {
  const isLlm = decision.decided_by === "llm_judge";
  const primary = decision.primary_atomic_change;
  // The literal drafted copy lives in exact_change (title/meta/h1), or
  // artifact_text / before_after.after for content blocks.
  const draftedText = primary
    ? primary.exact_change || primary.artifact_text || primary.before_after.after || ""
    : "";

  return (
    <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/30 p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={isLlm ? "ai" : "det"}>
          {isLlm ? "AI-drafted" : "Deterministic draft (no AI key)"}
        </Badge>
        <Badge tone="neutral">{decision.recommended_atomic_action.replace(/_/g, " ")}</Badge>
        <Badge tone="neutral">{decision.confidence.replace(/_/g, " ")} confidence</Badge>
        <span className="text-[10px] text-muted-foreground">
          Draft for review — nothing publishes from here.
        </span>
      </div>

      {decision.operator_insight ? (
        <p className="text-[12px] text-foreground/85">{decision.operator_insight}</p>
      ) : null}

      {primary ? (
        <div className="rounded-md border border-border/60 bg-background p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Primary change
            </span>
            <span className="text-[13px] font-medium text-foreground">
              {primary.action.replace(/_/g, " ")}
            </span>
          </div>
          {draftedText ? (
            <div className="mt-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Proposed
                </span>
                <CopyButton value={draftedText} />
              </div>
              <pre className="mt-0.5 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-foreground/85">
                {draftedText}
              </pre>
            </div>
          ) : null}
          {primary.before_after.before ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Current: {primary.before_after.before}
            </p>
          ) : null}
          {primary.faq_items && primary.faq_items.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-[11px] text-foreground/80">
              {primary.faq_items.map((qa, i) => (
                <li key={i}>
                  <span className="font-medium">Q:</span> {qa.question}
                  <br />
                  <span className="font-medium">A:</span> {qa.answer}
                </li>
              ))}
            </ul>
          ) : null}
          {primary.hypothesis ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">Why: {primary.hypothesis}</p>
          ) : null}
          {primary.risk ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Risk: {primary.risk}</p>
          ) : null}
          {primary.measurement ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Measure: {primary.measurement}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {decision.recommended_atomic_action === "keep_current"
            ? "The model judged this page healthy for its position — keep it, monitor, revisit if rankings slip."
            : "No single drafted change — see the reasoning below."}
        </p>
      )}

      {decision.supporting_atomic_changes.length > 0 ? (
        <div className="text-[11px] text-foreground/80">
          <span className="font-medium text-muted-foreground">Supporting:</span>{" "}
          {decision.supporting_atomic_changes
            .map((c) => c.action.replace(/_/g, " "))
            .join(", ")}
        </div>
      ) : null}

      {decision.why_not_just_title ? (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">Why not just the title:</span> {decision.why_not_just_title}
        </p>
      ) : null}
      {decision.what_normal_seo_misses ? (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">What generic SEO misses:</span>{" "}
          {decision.what_normal_seo_misses}
        </p>
      ) : null}
    </div>
  );
}

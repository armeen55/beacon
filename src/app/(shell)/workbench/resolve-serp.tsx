"use client";

import { useState, useTransition } from "react";

import type {
  SerpFeature,
  SerpHypothesis,
} from "@/domains/recommendation-intelligence/page-surgeon/serp-hypothesis";
import { resolveSerpForWorkbenchPage } from "./actions";

/**
 * TASK 2 — "Resolve SERP" panel. Runs the bounded synthetic SERP hypothesis for
 * THIS locked page on demand and renders it, ALWAYS labeled synthetic + "verify
 * before title rewrite". Operator-only; nothing publishes. The broad Opportunity
 * Map never calls this. Render-only (no persistence yet).
 */

const FEATURE_LABEL: Record<SerpFeature, string> = {
  ai_overview: "AI Overview",
  featured_snippet: "Featured snippet",
  image_pack: "Image pack",
  knowledge_panel: "Knowledge panel",
  people_also_ask: "People also ask",
  video: "Video",
  local_pack: "Local pack",
  shopping: "Shopping",
  top_stories: "Top stories",
  none: "No major feature",
};

export function ResolveSerp({ path, hasOpenAi }: { path: string; hasOpenAi: boolean }) {
  const [pending, startTransition] = useTransition();
  const [hyp, setHyp] = useState<SerpHypothesis | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await resolveSerpForWorkbenchPage(path);
      if (res.ok) setHyp(res.hypothesis);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={pending || !hasOpenAi}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking SERP… (up to ~30s)" : hyp ? "Re-run SERP check" : "Resolve SERP"}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {hasOpenAi
            ? "SERP unknown. Run a synthetic hypothesis of the live SERP for this page's top queries (no live fetch, no paid API). Verify before acting."
            : "No OpenAI key set, so a SERP hypothesis cannot be generated. Check the live SERP manually."}
        </span>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50/60 px-3 py-2 text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}

      {hyp ? <HypothesisView hyp={hyp} /> : null}
    </div>
  );
}

function HypothesisView({ hyp }: { hyp: SerpHypothesis }) {
  const owns = hyp.featureLikelyOwnsAnswer;
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Synthetic SERP hypothesis
        </span>
        <span className="text-[10px] text-muted-foreground">
          Not observed data. Verify the live SERP before a title rewrite.
        </span>
      </div>

      <p className="text-[12px] text-foreground/85">{hyp.summary}</p>

      {/* The headline implication for title/meta confidence. */}
      <p
        className={
          "rounded-md px-2.5 py-1.5 text-[12px] font-medium " +
          (owns
            ? "bg-rose-50 text-rose-700"
            : "bg-emerald-50 text-emerald-700")
        }
      >
        {owns
          ? "A SERP feature likely owns these clicks. A title or meta rewrite may not recover them. Prefer a feature-appropriate move (answer block, image/structured data) and verify the live SERP first."
          : "No dominant SERP feature suspected. A title or meta rewrite is more likely to recover clicks at this rank. Still verify the live SERP before shipping."}
      </p>

      <ul className="space-y-2">
        {hyp.queries.map((q) => (
          <li key={q.query} className="rounded-md border border-border/60 bg-background p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-medium text-foreground">{q.query}</span>
              {q.featureLikelyOwnsAnswer ? (
                <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                  feature likely owns clicks
                </span>
              ) : (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  organic still serves
                </span>
              )}
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {q.confidence} confidence
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {q.likelyFeatures.map((f) => (
                <span
                  key={f}
                  className="rounded bg-surface-inset/60 px-1.5 py-0.5 text-[10px] text-foreground/70"
                >
                  {FEATURE_LABEL[f]}
                </span>
              ))}
            </div>
            {q.clickLossCause ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Why: {q.clickLossCause}</p>
            ) : null}
            {q.recommendedCheck ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground">Verify: {q.recommendedCheck}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

/**
 * WhyThisMattersAct — Act 2 body with optional LLM sharpening (Slice B,
 * 2026-06-16).
 *
 * Renders the deterministic `sentences` (the INSTANT baseline) and then,
 * AFTER mount, calls `requestLlmWhyNarrativeAction(recId)` to maybe sharpen
 * them. Contract:
 *   • Initial paint === deterministic baseline (SSR-safe; identical markup
 *     to before this component existed). The `data-recommendation-detail-why`
 *     attr stays on the first sentence in BOTH states.
 *   • The action returns null whenever `BEACON_LLM_WHY` is off (default),
 *     budget is blocked, sanitize rejects, or anything fails — so with the
 *     flag off there is ZERO visible change vs. today.
 *   • While the request is in flight, a calm "Sharpening analysis…" caption
 *     appears under the baseline (no spinner). It's removed on settle.
 *   • Read-only: the swapped-in text is display-only and is never published.
 *
 * The post-mount call NEVER blocks the page; it's a progressive
 * enhancement layered on top of fully-rendered content.
 */

import { useEffect, useState } from "react";

import { requestLlmWhyNarrativeAction as defaultRequestLlmWhyNarrativeAction } from "./llm-why-action";

export type WhyThisMattersActProps = {
  /** Route-resolvable rec id (the detail row's `id`). */
  recId: string;
  /** Deterministic baseline sentences — always rendered first. */
  sentences: string[];
  /** DI seam for tests; defaults to the real server action. */
  requestLlmWhyNarrative?: (
    recId: string,
  ) => Promise<{ sentences: string[] } | null>;
};

export function WhyThisMattersAct({
  recId,
  sentences,
  requestLlmWhyNarrative = defaultRequestLlmWhyNarrativeAction,
}: WhyThisMattersActProps) {
  // The sentences actually rendered. Starts as the deterministic baseline;
  // swapped to the LLM output only on a clean, non-null response.
  const [rendered, setRendered] = useState<string[]>(sentences);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    requestLlmWhyNarrative(recId)
      .then((res) => {
        if (cancelled) return;
        if (res && res.sentences.length > 0) {
          setRendered(res.sentences);
        }
        // null → keep the deterministic baseline (already in state).
      })
      .catch(() => {
        // Defensive: the action already catches; keep the baseline.
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
    // recId identifies the rec; sentences is the stable baseline for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recId]);

  return (
    <div className="space-y-2 max-w-2xl" data-recommendation-detail-why-act="true">
      {rendered.map((sentence, i) => (
        <p
          key={i}
          className="text-[13px] text-foreground/85 leading-relaxed"
          {...(i === 0 ? { "data-recommendation-detail-why": "true" } : {})}
        >
          {sentence}
        </p>
      ))}
      {pending && (
        <p
          className="text-[11px] italic text-muted-foreground/70"
          data-recommendation-detail-why-sharpening="true"
        >
          Sharpening analysis…
        </p>
      )}
    </div>
  );
}

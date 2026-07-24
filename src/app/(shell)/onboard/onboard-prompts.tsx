"use client";

/**
 * Step 5 body: topics and AI prompts (Slice 5). Group cards with intent coverage
 * and selected/total counts; the primary action approves exactly the recommended
 * core. Group-level toggles and an expandable group let the operator adjust
 * without ever reviewing every row. Approving navigates to connections.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateCandidatesAction, approvePromptsAction } from "./actions";
import type { OnboardingState } from "@/domains/runtime";

const BTN = "rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const GHOST = "rounded-md border border-border/60 px-4 py-2 text-[13px] font-medium hover:border-foreground/30";

export function PromptsBody({ prompts }: { prompts: OnboardingState["prompts"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const hasCandidates = prompts.candidateCount > 0;

  function build() {
    setError(null);
    start(async () => {
      const r = await generateCandidatesAction();
      if (!("ok" in r) || !r.ok) setError("error" in r ? r.error : "I could not build your prompts. Try again.");
      else router.refresh();
    });
  }
  function approveRecommended() {
    setError(null);
    start(async () => {
      const r = await approvePromptsAction({ useRecommendedDefault: true });
      if (!r.ok) setError(r.error);
      else router.push("/onboard?step=6");
    });
  }
  function approveChosenGroups() {
    setError(null);
    start(async () => {
      const r = await approvePromptsAction({ approvedGroups: [...chosen] });
      if (!r.ok) setError(r.error);
      else router.push("/onboard?step=6");
    });
  }
  function toggleGroup(slug: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  if (!hasCandidates) {
    return (
      <div className="space-y-5">
        <p className="text-[14px] text-muted-foreground">
          I will build a broad set of the questions your customers ask AI assistants, then recommend the 50 worth
          tracking first. You approve them by group in a moment, so you never read every row.
        </p>
        {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
        <button type="button" onClick={build} disabled={pending} className={BTN}>
          {pending ? "Building your prompts. This takes a moment." : "Build my prompts"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted-foreground">
        I built {prompts.candidateCount} prompts across {prompts.groups.length} topics and recommend{" "}
        {prompts.recommendedCount} to track first. Approve the recommendation, or pick topics yourself.
      </p>

      <div className="space-y-2">
        {prompts.groups.map((g) => {
          const isOpen = expanded === g.slug;
          const selected = chosen.has(g.slug);
          return (
            <div key={g.slug} className="rounded-lg border border-border/60 bg-surface">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={selected} onChange={() => toggleGroup(g.slug)} className="accent-foreground" />
                  <span>
                    <span className="block text-[13px] font-semibold">{g.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {g.recommended} of {g.total} recommended - {g.intent}
                    </span>
                  </span>
                </label>
                <button type="button" onClick={() => setExpanded(isOpen ? null : g.slug)} className="text-[12px] underline text-muted-foreground">
                  {isOpen ? "Hide" : "See prompts"}
                </button>
              </div>
              {isOpen ? (
                <ul className="border-t border-border/60 px-4 py-2 space-y-1">
                  {g.prompts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span>{p.text}</span>
                      {p.recommended ? <span className="text-[11px] text-muted-foreground">recommended</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={approveRecommended} disabled={pending} className={BTN}>
          {pending ? "Saving your prompts" : `Approve recommended (${prompts.recommendedCount})`}
        </button>
        {chosen.size > 0 ? (
          <button type="button" onClick={approveChosenGroups} disabled={pending} className={GHOST}>
            Approve {chosen.size} chosen {chosen.size === 1 ? "topic" : "topics"} instead
          </button>
        ) : null}
      </div>
    </div>
  );
}

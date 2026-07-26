"use client";

/**
 * Step 5 body: the questions I track across AI assistants. The editor itself is
 * shared with Settings (components/prompts-editor), so picking, rewording, adding
 * and counting behave identically before and after the account goes live. This
 * file owns only the two server actions: build the candidate set, and approve.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateCandidatesAction, approvePromptsAction } from "./actions";
import { PromptsEditor } from "@/components/prompts-editor";
import type { OnboardingState } from "@/domains/runtime";

const BTN = "rounded-md bg-foreground text-background px-4 py-2.5 text-[14px] font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const GHOST = "rounded-md border border-border/60 px-4 py-2 text-[13px] font-medium hover:border-foreground/30 disabled:opacity-50";

export function PromptsBody({ prompts }: { prompts: OnboardingState["prompts"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function build() {
    setError(null);
    start(async () => {
      const r = await generateCandidatesAction();
      if (!("ok" in r) || !r.ok) setError("error" in r ? r.error : "I could not build your questions. Try again.");
      else router.refresh();
    });
  }
  function submit(selection: Parameters<typeof approvePromptsAction>[0]) {
    setError(null);
    start(async () => {
      const r = await approvePromptsAction(selection);
      if (!r.ok) setError(r.error);
      else router.push("/onboard?step=6");
    });
  }

  if (prompts.candidateCount === 0) {
    return (
      <div className="space-y-5">
        <p className="text-[14px] text-muted-foreground">
          I will build a broad set of the questions your customers ask AI assistants, then recommend the 50 worth
          tracking first. You approve them in a moment, and you can add, edit, or drop any before you do.
        </p>
        {error ? <p className="text-[13px] text-rose-600" role="alert">{error}</p> : null}
        <button type="button" onClick={build} disabled={pending} className={BTN}>
          {pending ? "Building your questions. This takes a moment." : "Build my questions"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted-foreground">
        I built {prompts.candidateCount} questions across {prompts.groups.length} topics and recommend{" "}
        {prompts.recommendedCount} to track first. Approve the recommendation, or open a topic to pick, edit, and add your own.
      </p>
      <PromptsEditor
        // A fresh key on a new candidate set drops any half-finished picking from
        // the previous set, so the counter never describes questions that are gone.
        key={`${prompts.candidateCount}:${prompts.approvedCount}`}
        groups={prompts.groups}
        mode="onboarding"
        busy={pending}
        error={error}
        submitLabel="Approve my selection"
        onSubmit={(s) => submit({
          approvedIds: s.keepIds,
          edits: s.edits.map((e) => ({ fromId: e.id, text: e.newText })),
          additions: s.additions.map((a) => ({ groupSlug: a.groupSlug, text: a.text })),
        })}
        extraActions={
          <button type="button" onClick={() => submit({ useRecommendedDefault: true })} disabled={pending} className={GHOST}>
            Approve the {prompts.recommendedCount} I recommend
          </button>
        }
      />
    </div>
  );
}

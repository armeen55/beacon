"use client";

/**
 * Settings: the questions I track across AI assistants. THE fix for a stranded
 * account. Before this existed, nothing could add or change a live account's
 * tracked questions, so an account with none had research paused forever with no
 * way out. The editor is the same one onboarding uses, and a save preserves the
 * identity of every question the operator left alone.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PromptsEditor } from "@/components/prompts-editor";
import { saveTrackedQuestionsAction } from "./actions";

const GHOST = "rounded-md border border-border/60 px-4 py-2 text-[13px] font-medium hover:border-foreground/30 disabled:opacity-50";

/** I track at least this many; a recommended batch below it would only save to a refusal. */
const MIN_RECOMMENDED_BATCH = 10;

export function TrackedPromptsSection({
  active, count, recommended, unknown = false,
}: {
  active: { id: string; text: string }[];
  count: number;
  recommended: string[];
  /** TRUE when the read failed: say so and claim nothing, never a false zero. */
  unknown?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function save(selection: { keepIds: string[]; edits: { id: string; newText: string }[]; additions: string[] }) {
    setError(null); setSaved(null);
    start(async () => {
      const r = await saveTrackedQuestionsAction(selection);
      if (!r.ok) { setError(r.error); return; }
      setSaved(`Saved ${r.count} questions. Research resumes during your signed-in visits.`);
      router.refresh();
    });
  }
  if (unknown) {
    return (
      <section id="tracked-ai-prompts" className="mt-10 scroll-mt-24 space-y-3">
        <h2 className="text-[15px] font-semibold text-foreground">Questions I track across AI assistants</h2>
        <p className="text-[13px] text-muted-foreground">I could not check your tracked questions just now. Refresh this page in a moment and they will be here.</p>
      </section>
    );
  }
  return (
    <section id="tracked-ai-prompts" className="mt-10 scroll-mt-24 space-y-3">
      <h2 className="text-[15px] font-semibold text-foreground">Questions I track across AI assistants</h2>
      <p className="text-[13px] text-muted-foreground">
        {count > 0
          ? `I am tracking ${count} question${count === 1 ? "" : "s"}. Research checks them while you are signed in.`
          : "I am not tracking any questions yet, so my research is paused. Add at least 10 below and I will pick it up on your next visit."}
      </p>
      {saved ? <p className="text-[13px] text-emerald-700" role="status">{saved}</p> : null}
      {count === 0 && recommended.length >= MIN_RECOMMENDED_BATCH ? (
        <button type="button" disabled={pending} className={GHOST}
          onClick={() => save({ keepIds: [], edits: [], additions: recommended })}>
          {pending ? "Saving your questions" : `Use the ${recommended.length} I recommended`}
        </button>
      ) : null}
      <PromptsEditor
        key={`${count}:${active.map((q) => q.id).join(",")}`}
        groups={[{ slug: "tracked", name: "Tracked questions", prompts: active.map((q) => ({ ...q, recommended: true, approved: true })) }]}
        mode="settings"
        busy={pending}
        error={error}
        submitLabel="Save my questions"
        onSubmit={(s) => save({ keepIds: s.keepIds, edits: s.edits, additions: s.additions.map((a) => a.text) })}
      />
    </section>
  );
}

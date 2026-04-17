"use client";

import { useState, useTransition } from "react";
import { updateChangelogHypothesis } from "@/domains/changelog/actions";
import type { HypothesisSource } from "@/domains/changelog/types";

const SOURCE_LABEL: Record<HypothesisSource, string> = {
  inferred: "Auto-inferred from edit type",
  recommendation: "From Beacon recommendation",
  operator: "You wrote this",
};

const SOURCE_TONE: Record<HypothesisSource, string> = {
  inferred: "text-muted-foreground",
  recommendation: "text-accent-primary",
  operator: "text-foreground",
};

export function HypothesisEditor({
  changeId,
  initialHypothesis,
  initialSource,
}: {
  changeId: string;
  initialHypothesis: string | null;
  initialSource: HypothesisSource | null;
}) {
  const [hypothesis, setHypothesis] = useState(initialHypothesis ?? "");
  const [source, setSource] = useState<HypothesisSource | null>(
    initialHypothesis ? (initialSource ?? "operator") : null,
  );
  const [editing, setEditing] = useState(!initialHypothesis);
  const [draft, setDraft] = useState(initialHypothesis ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateChangelogHypothesis(changeId, draft, "operator");
      if (!r.success) {
        setError(r.error ?? "Failed to save.");
        return;
      }
      setHypothesis(draft.trim());
      setSource(draft.trim() ? "operator" : null);
      setEditing(false);
    });
  }

  function cancel() {
    setDraft(hypothesis);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="border border-border rounded-lg px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          Hypothesis
        </p>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] font-medium text-accent-primary hover:underline"
          >
            {hypothesis ? "Edit" : "Add hypothesis"}
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What outcome do you expect from this change, and why?"
            rows={3}
            disabled={pending}
            className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-[13px] leading-relaxed focus:outline-none focus:border-accent-primary/60"
          />
          {error && (
            <p className="mt-2 text-[11px] text-status-danger">{error}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-foreground text-background px-3 py-1.5 text-[11px] font-semibold hover:opacity-90 transition-opacity"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : hypothesis ? (
        <div>
          <p className="text-[13px] leading-relaxed text-foreground">
            {hypothesis}
          </p>
          {source && (
            <p className={`text-[10px] mt-1.5 ${SOURCE_TONE[source]}`}>
              {SOURCE_LABEL[source]}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground italic">
          No hypothesis recorded yet.
        </p>
      )}
    </div>
  );
}

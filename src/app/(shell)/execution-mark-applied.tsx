"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markPlanAppliedAction, captureProofAction } from "./execution-actions";

/**
 * ExecutionMarkApplied (2026-06-25, Sprint 5D/5E/5F) — operator-only. The operator
 * must EXPLICITLY confirm they manually applied + published the change (a checkbox)
 * before "Mark applied" enables — Beacon never assumes it. On confirm it records the
 * proof entry (starts measurement) + an optional manual proof note. No publish.
 */
export function ExecutionMarkApplied(props: {
  implementationPlanId: string;
  moveId: string;
  targetUrl: string;
  actionType: string;
  query: string | null;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const [visibleLive, setVisibleLive] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function apply() {
    if (!confirmed) {
      setMsg("Tick the confirmation box first.");
      return;
    }
    setMsg(null);
    start(async () => {
      const r = await markPlanAppliedAction({
        implementationPlanId: props.implementationPlanId,
        moveId: props.moveId,
        targetUrl: props.targetUrl,
        actionType: props.actionType,
        query: props.query,
        confirmedApplied: confirmed,
        notes: notes || null,
      });
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      // Best-effort manual proof note (5F).
      try {
        await captureProofAction({
          moveId: props.moveId,
          targetUrl: props.targetUrl,
          liveUrlChecked: props.targetUrl,
          visibleLive,
          notes: notes || null,
        });
      } catch {
        /* proof note is best-effort */
      }
      setMsg(`Applied ${new Date(r.appliedAt).toLocaleString()} — measuring started.`);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
      <label className="flex items-start gap-2 text-[12px] text-gray-700">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        <span>I manually applied <span className="font-medium">and published</span> this change in the CMS (Beacon did not publish it).</span>
      </label>
      <label className="mt-2 flex items-center gap-2 text-[12px] text-gray-600">
        <input type="checkbox" checked={visibleLive} onChange={(e) => setVisibleLive(e.target.checked)} />
        <span>I verified it is visible on the live URL.</span>
      </label>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note (what you changed)…"
        className="mt-2 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px]"
      />
      <button
        type="button"
        onClick={apply}
        disabled={pending || !confirmed}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Recording…" : "✓ Mark applied — start measuring"}
      </button>
      {msg ? <p className="mt-1.5 text-[11px] text-gray-600">{msg}</p> : null}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

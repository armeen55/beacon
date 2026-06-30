"use client";

/**
 * DailyExperimentsSection (2026-06-30) — the native "Plan today's experiments → Accept" UI.
 * Renders the active proof batch + protected-control warning (always), then either the empty
 * "Plan today" state, the persisted preview (exact cards + Accept/Abandon), or the accepted state.
 * Planning/accepting run server actions (never on render). No "shipped" language — proof starts only
 * after live verification (a later slice).
 */
import { useState, useTransition } from "react";
import type { DailyExperimentsView } from "./daily-experiments-data";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import { planTodayExperimentsAction, acceptDailyExperimentPlanAction, abandonPreviewPlanAction } from "./daily-experiments-actions";

const LEVER_LABEL: Record<string, string> = { meta: "Meta", internal_link: "Internal link", answer_block: "Answer block", title: "Title", h1: "H1" };

function Card({ e }: { e: PlannedExperimentRecord }) {
  return (
    <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong>{e.pageLabel}</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{LEVER_LABEL[e.lever] ?? e.lever} · {e.effortMinutes} min · {e.risk} risk</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.65 }}>{e.url} · query “{e.targetQuery}”</div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        <div><span style={{ opacity: 0.6 }}>Current: </span>{e.currentText || "(none)"}</div>
        <div><span style={{ opacity: 0.6 }}>Proposed: </span><strong>{e.proposedText}</strong></div>
        {e.detail.kind === "internal_link" && (
          <div style={{ opacity: 0.75 }}>→ link “{e.detail.anchorText}” to {e.detail.destinationUrl} · influences: {e.influencedUrls.join(", ") || "—"}</div>
        )}
        {e.detail.kind === "answer_block" && (
          <div style={{ opacity: 0.75 }}>Q: {e.detail.question} · {e.detail.operation.replace(/_/g, " ")} → {e.detail.exactInstruction.split("→").slice(-1)[0]?.trim()}</div>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
        Placement: {e.placement} · leave unchanged: {e.leaveUnchanged.join(", ")} · controls: {e.controls.length} ({e.controls.map((c) => c.controlPath).join(", ")})
      </div>
    </div>
  );
}

export function DailyExperimentsSection({ view }: { view: DailyExperimentsView }) {
  const { dashboard } = view;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<DailyExperimentPlanRecord | undefined>(dashboard.previewPlan);
  const accepted = dashboard.acceptedPlan;

  const plan = () => start(async () => {
    setMsg("Planning…");
    const r = await planTodayExperimentsAction();
    setMsg(r.ok ? `Preview ready: ${r.selected} changes (${Object.entries(r.distribution).map(([k, v]) => `${v} ${k}`).join(", ")}).` : `Could not plan: ${r.reason}`);
  });
  const accept = (p: DailyExperimentPlanRecord) => start(async () => {
    setMsg("Reserving controls…");
    const r = await acceptDailyExperimentPlanAction({ planId: p.id, inputHash: p.inputHash, idempotencyKey: `${p.id}::accept` });
    setMsg(r.ok ? `Plan accepted — ${r.reservationCount} controls reserved.` : `Accept failed: ${r.reason}${r.failures?.length ? ` (${r.failures.map((f) => `${f.url}:${f.reason}`).join("; ")})` : ""}`);
  });
  const abandon = (p: DailyExperimentPlanRecord) => start(async () => {
    const r = await abandonPreviewPlanAction({ planId: p.id });
    setMsg(r.ok ? "Preview discarded." : `Could not discard: ${r.reason}`);
    if (r.ok) setPreview(undefined);
  });

  const b = dashboard.activeProofBatch;
  return (
    <section style={{ margin: "16px 0", padding: 16, border: "1px solid var(--border, #e5e7eb)", borderRadius: 10 }}>
      <h2 style={{ margin: "0 0 8px" }}>Daily experiments</h2>

      {b && (
        <div style={{ marginBottom: 12, fontSize: 14 }}>
          <div><strong>{b.label}</strong> — {b.experimentCount} measuring · {b.controlCount} controls protected</div>
          <div style={{ opacity: 0.7 }}>Next checkpoint: {b.nextCheckpoint} · Reliable Search Console data: ~{b.reliableDataDate}</div>
          {view.protectedWarning && (
            <div style={{ marginTop: 6, padding: 8, background: "var(--warn-bg, #fff7ed)", borderRadius: 6, fontSize: 13 }}>⚠ {view.protectedWarning}</div>
          )}
        </div>
      )}

      {accepted ? (
        <div>
          <div style={{ padding: 10, background: "var(--ok-bg, #ecfdf5)", borderRadius: 6, fontSize: 14 }}>
            <strong>Plan accepted.</strong> {accepted.selected.length} changes ready to apply · controls reserved.<br />
            Nothing has been marked shipped. Proof starts only after Beacon verifies the live changes.
          </div>
          {accepted.selected.map((e) => <Card key={e.id} e={e} />)}
        </div>
      ) : preview ? (
        <div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>
            <strong>Today’s proposed batch</strong> — {preview.selected.length} low-risk changes · ~{preview.estimatedMinutes} min ·{" "}
            {Object.entries(preview.distribution.byLever).map(([k, v]) => `${v} ${LEVER_LABEL[k] ?? k}`).join(", ")}
            <div style={{ opacity: 0.7 }}>{dashboard.protectedCounts.treatments} active experiments protected · {dashboard.protectedCounts.controls} controls excluded</div>
          </div>
          {preview.selected.map((e) => <Card key={e.id} e={e} />)}
          {preview.backups.length > 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Backups: {preview.backups.map((e) => e.pageLabel).join(", ")}</div>}
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button disabled={pending} onClick={() => accept(preview)}>Accept plan</button>
            <button disabled={pending} onClick={() => plan()}>Re-plan</button>
            <button disabled={pending} onClick={() => abandon(preview)}>Discard</button>
          </div>
        </div>
      ) : (
        <button disabled={pending} onClick={plan}>Plan today’s experiments</button>
      )}

      {msg && <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{msg}</div>}
    </section>
  );
}

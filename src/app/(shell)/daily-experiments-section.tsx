"use client";

/**
 * DailyExperimentsSection (2026-06-30 → 2026-07-01) — the native Daily Experiment Cycle UI.
 * States: empty ("Plan today") → preview (8 cards + Accept) → ACCEPTED execution checklist
 * (per-item: apply in Wix → Beacon verifies live → proof starts → submit to Google). No "shipped"
 * language until Beacon confirms the change live. Planning/verification run as server actions, never
 * on render.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DailyExperimentsView } from "./daily-experiments-data";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import type { ExecutionChecklist, ExecutionItemView } from "@/domains/experiments/execution-checklist";
import type { DailyExperimentItemStatus } from "@/domains/experiments/execution-state";
import {
  planTodayExperimentsAction, acceptDailyExperimentPlanAction, abandonPreviewPlanAction,
  markDailyExperimentAppliedAction, confirmGscSubmissionAction, skipDailyExperimentItemAction, completeDailyPlanAction,
} from "./daily-experiments-actions";

/** Friendly copy for the apply-failure reasons the actions can return (beyond verification_failed). */
const APPLY_FAILURE_COPY: Record<string, string> = {
  proof_id_collision: "Another change is already recorded for this page today — can't start a second proof.",
  topology_unavailable: "Couldn't read the experiment ledger just now — try again in a moment.",
  insufficient_controls: "Not enough clean comparison pages remain to measure this honestly.",
  reservation_state_inconsistent: "This item's reserved controls are in an inconsistent state — re-plan it.",
  item_skipped: "This item was skipped.",
};

const LEVER_LABEL: Record<string, string> = { meta: "Meta", internal_link: "Internal link", answer_block: "Answer block", title: "Title", h1: "H1" };
const SEARCH_CONSOLE_URL = "https://search.google.com/search-console";

const STATUS_LABEL: Record<DailyExperimentItemStatus, string> = {
  ready_to_apply: "Ready to apply",
  verification_pending: "Verifying…",
  verification_failed: "Verification failed",
  verified_live: "Verified live",
  activation_pending: "Activating…",
  active: "Live and measuring",
  gsc_submission_pending: "Submitting…",
  gsc_submitted: "Marked submitted (self-reported)",
  skipped: "Skipped",
  rolled_back: "Rolled back",
};
const STATUS_COLOR: Record<DailyExperimentItemStatus, string> = {
  ready_to_apply: "#6b7280", verification_pending: "#2563eb", verification_failed: "#dc2626",
  verified_live: "#059669", activation_pending: "#2563eb", active: "#059669",
  gsc_submission_pending: "#2563eb", gsc_submitted: "#0d9488", skipped: "#9ca3af", rolled_back: "#9ca3af",
};

function StatusBadge({ status }: { status: DailyExperimentItemStatus }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[status], border: `1px solid ${STATUS_COLOR[status]}33`, background: `${STATUS_COLOR[status]}11`, borderRadius: 999, padding: "1px 8px" }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function copyText(text: string, onDone: (m: string) => void) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => onDone("Copied.")).catch(() => onDone("Copy failed — select the text manually."));
  } else onDone("Clipboard unavailable — select the text manually.");
}

/** Preview card (pre-acceptance). */
function PreviewCard({ e }: { e: PlannedExperimentRecord }) {
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
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>controls: {e.controls.length}</div>
    </div>
  );
}

/** One accepted item with status-driven execution actions. */
function ExecutionCard({ planId, item }: { planId: string; item: ExecutionItemView }) {
  const e = item.experiment;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<DailyExperimentItemStatus>(item.status);
  const [failure, setFailure] = useState<{ reason: string; expected?: string; observed?: string } | null>(
    item.status === "verification_failed" && item.verification && !item.verification.verified
      ? { reason: item.verification.reason, expected: item.verification.expected, observed: item.verification.observed }
      : null,
  );
  const idem = `${planId}::${e.id}`;
  const isActive = status === "active" || status === "gsc_submission_pending" || status === "gsc_submitted";

  const apply = () => start(async () => {
    setMsg("Verifying the change is live…");
    const r = await markDailyExperimentAppliedAction({ planId, experimentId: e.id, idempotencyKey: `${idem}::apply` });
    if (r.ok) {
      setStatus("active"); setFailure(null);
      setMsg(r.idempotent || r.reservationCount === 0 ? "Already verified live — proof is measuring." : `Verified live. Proof started — ${r.reservationCount} controls now measuring.`);
    } else if (r.reason === "verification_failed" && r.verification && !r.verification.verified) {
      setStatus("verification_failed");
      setFailure({ reason: r.verification.reason, expected: r.verification.expected, observed: r.verification.observed });
      setMsg(null);
    } else {
      setStatus("verification_failed");
      setFailure({ reason: APPLY_FAILURE_COPY[r.reason] ?? r.reason + (r.detail ? ` — ${r.detail}` : "") });
      setMsg(null);
    }
  });

  const submit = () => start(async () => {
    setMsg("Recording your Search Console submission…");
    const r = await confirmGscSubmissionAction({ planId, experimentId: e.id });
    if (r.ok) { setStatus("gsc_submitted"); setMsg("Marked submitted to Google."); } else setMsg(`Could not record: ${r.reason}`);
  });

  const skip = () => start(async () => {
    const r = await skipDailyExperimentItemAction({ planId, experimentId: e.id, idempotencyKey: `${idem}::skip` });
    if (r.ok) { setStatus("skipped"); setMsg(`Skipped — ${r.releasedCount ?? 0} reserved controls released.`); } else setMsg(`Could not skip: ${r.reason}`);
  });

  const detailLine =
    e.detail.kind === "internal_link" ? `→ link “${e.detail.anchorText}” to ${e.detail.destinationUrl}`
    : e.detail.kind === "answer_block" ? `Q: ${e.detail.question}`
    : null;

  return (
    <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 8, padding: 12, marginBottom: 8, opacity: status === "skipped" ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>{e.pageLabel}</strong>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{LEVER_LABEL[e.lever] ?? e.lever}</span>
          <StatusBadge status={status} />
        </span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.65 }}>{e.url} · query “{e.targetQuery}”</div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        <div><span style={{ opacity: 0.6 }}>Current: </span>{e.currentText || "(none)"}</div>
        <div><span style={{ opacity: 0.6 }}>Proposed: </span><strong>{e.proposedText}</strong></div>
        {detailLine && <div style={{ opacity: 0.75 }}>{detailLine}</div>}
      </div>
      <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap", background: "var(--code-bg, #f9fafb)", borderRadius: 6, padding: 8, fontFamily: "ui-monospace, monospace" }}>{item.instructions}</pre>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        controls: {item.activeControls > 0 ? `${item.activeControls} active` : `${item.reservedControls} reserved`} · rollback: {e.rollbackText ? "available" : "—"}
      </div>

      {failure && (
        <div style={{ marginTop: 8, padding: 8, background: "var(--err-bg, #fef2f2)", borderRadius: 6, fontSize: 13 }}>
          <strong>Could not verify this change.</strong> ({failure.reason})<br />
          {failure.expected && <>Expected: {failure.expected}<br /></>}
          {failure.observed && <>Observed: {failure.observed}<br /></>}
          Nothing was marked shipped. Fix it in Wix and retry.
        </div>
      )}

      {isActive ? (
        status === "gsc_submitted" ? (
          <div style={{ marginTop: 8, fontSize: 13, color: "#0d9488" }}>✓ Marked submitted to Google (self-reported) · proof is measuring (7 / 14 / 28-day checkpoints).</div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, color: "#059669", marginBottom: 6 }}>Verified live. Proof started — measuring at 7 / 14 / 28 days.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={pending} onClick={() => copyText(e.url, setMsg)}>Copy URL</button>
              <a href={SEARCH_CONSOLE_URL} target="_blank" rel="noopener noreferrer"><button type="button">Open Search Console</button></a>
              <button disabled={pending} onClick={submit}>Mark submitted to Google</button>
            </div>
          </div>
        )
      ) : status === "skipped" ? (
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>Skipped — its controls were released. Nothing was changed.</div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={pending} onClick={() => copyText(item.instructions, setMsg)}>Copy change</button>
          <a href={e.url} target="_blank" rel="noopener noreferrer"><button type="button">Open page</button></a>
          <button disabled={pending} onClick={apply}>{status === "verification_failed" ? "Retry verification" : "Applied in Wix"}</button>
          <button disabled={pending} onClick={skip} style={{ opacity: 0.7 }}>Skip</button>
        </div>
      )}

      {msg && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{msg}</div>}
    </div>
  );
}

function ExecutionChecklistView({ checklist }: { checklist: ExecutionChecklist }) {
  const s = checklist.summary;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const finish = () => start(async () => {
    setMsg("Closing today’s batch…");
    const r = await completeDailyPlanAction({ planId: checklist.planId });
    if (r.ok) { setMsg("Today’s batch closed. You can plan a new one."); router.refresh(); } else setMsg(`Couldn’t close: ${r.reason}`);
  });
  return (
    <div>
      <div style={{ padding: 10, background: "var(--ok-bg, #ecfdf5)", borderRadius: 6, fontSize: 14, marginBottom: 10 }}>
        <strong>Today’s experiments.</strong> {s.accepted} accepted · {s.active} active · {s.submitted} submitted to Google · {s.left} left to apply · {s.controlsProtected} controls protected.<br />
        Apply each change in Wix, then click “Applied in Wix”. Beacon verifies the live page before starting proof — nothing is marked shipped until it’s confirmed live.
      </div>
      {checklist.items.map((item) => <ExecutionCard key={item.experiment.id} planId={checklist.planId} item={item} />)}
      {s.left === 0 && s.accepted > 0 && (
        <div style={{ marginTop: 10 }}>
          <button disabled={pending} onClick={finish}>Finish today’s batch</button>
          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>Closes this plan so you can start a fresh one tomorrow. Proof keeps measuring.</span>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{msg}</div>}
    </div>
  );
}

const ACCEPT_FAILURE_COPY: Record<string, string> = {
  plan_not_found: "That plan is no longer available — click “Plan today’s experiments” to start a fresh one.",
  plan_already_accepted: "This plan is already accepted — scroll down to the checklist.",
  plan_already_abandoned: "This plan was discarded — plan a new one.",
  input_hash_changed: "The plan changed since you opened it — Beacon refreshed it; review and Accept again.",
  refresh_failed: "Couldn’t refresh the plan just now — try “Re-plan”.",
  plan_refreshed_empty: "No clean experiments are available right now — try again later.",
};

export function DailyExperimentsSection({ view }: { view: DailyExperimentsView }) {
  const { dashboard, checklist } = view;
  const router = useRouter();
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
    if (r.ok) {
      setMsg(`Plan accepted — ${r.reservationCount} controls reserved. Apply each change in Wix below.`);
      router.refresh();
    } else if (r.reason === "plan_refreshed") {
      setMsg(`This plan had timed out — Beacon refreshed today’s batch (${r.refreshedCount ?? ""} changes) with fresh comparison pages. Review the updated list and click Accept.`);
      router.refresh();
    } else if (r.failures?.length) {
      setMsg(`Couldn’t accept: ${r.failures.map((f) => `${f.url} (${f.reason})`).join("; ")}.`);
    } else {
      setMsg(ACCEPT_FAILURE_COPY[r.reason] ?? `Couldn’t accept: ${r.reason}.`);
    }
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

      {accepted && checklist ? (
        <ExecutionChecklistView checklist={checklist} />
      ) : preview ? (
        <div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>
            <strong>Today’s proposed batch</strong> — {preview.selected.length} low-risk changes · ~{preview.estimatedMinutes} min ·{" "}
            {Object.entries(preview.distribution.byLever).map(([k, v]) => `${v} ${LEVER_LABEL[k] ?? k}`).join(", ")}
            <div style={{ opacity: 0.7 }}>{dashboard.protectedCounts.treatments} active experiments protected · {dashboard.protectedCounts.controls} controls excluded</div>
          </div>
          {preview.selected.map((e) => <PreviewCard key={e.id} e={e} />)}
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

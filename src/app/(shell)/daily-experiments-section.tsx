"use client";

/**
 * DailyExperimentsSection (2026-07-01, assistant-first redesign A+B): the friendly strategist card.
 * The SCIENCE is unchanged (plan -> approve -> apply in Wix -> Beacon confirms live -> proof starts ->
 * tell Google). Only the surface changed: every card leads with "The move / Why it wins / Paste this /
 * How we track it", and the experiment/control/proof machinery lives behind a "How we know" expander.
 * Plain language, no lab jargon, no em dashes. Planning/verification run as server actions, never on render.
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
import { failureForReason } from "@/domains/diagnostics/operator-failure";
import { LEVER_LABEL, STATUS_LABEL, moveHeadline, trackingLine } from "./daily-experiments-copy";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import { teammateOf } from "@/domains/team/identity";

/** every action reason renders through the shared translator so a raw code can never reach the operator. */
const reasonCopy = (reason: string | null | undefined): string => failureForReason(reason).message;

const SEARCH_CONSOLE_URL = "https://search.google.com/search-console";

const STATUS_COLOR: Record<DailyExperimentItemStatus, string> = {
  ready_to_apply: "#6b7280", verification_pending: "#2563eb", verification_failed: "#dc2626",
  verified_live: "#059669", activation_pending: "#2563eb", active: "#059669",
  gsc_submission_pending: "#2563eb", gsc_submitted: "#0d9488", skipped: "#9ca3af", rolled_back: "#9ca3af",
};

const CARD = { border: "1px solid var(--border, #e5e7eb)", borderRadius: 12, padding: 14, marginBottom: 10 } as const;
const LABEL = { fontSize: 11, opacity: 0.5, marginTop: 10, marginBottom: 2 } as const;
const PASTE = { fontSize: 13, background: "var(--code-bg, #f9fafb)", border: "1px solid var(--border, #eee)", borderRadius: 8, padding: "8px 10px", lineHeight: 1.5, whiteSpace: "pre-wrap" as const, marginTop: 2 };

function StatusBadge({ status }: { status: DailyExperimentItemStatus }) {
  return (
    <span role="status" aria-label={`Status: ${STATUS_LABEL[status]}`} style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[status], border: `1px solid ${STATUS_COLOR[status]}33`, background: `${STATUS_COLOR[status]}11`, borderRadius: 999, padding: "1px 8px" }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function copyText(text: string, onDone: (m: string) => void) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => onDone("Copied.")).catch(() => onDone("Copy failed, select the text manually."));
  } else onDone("Clipboard unavailable, select the text manually.");
}

/** Shown under the paste box when the LLM wrote the text, so the operator knows to review it. */
function WrittenByBeacon({ e }: { e: PlannedExperimentRecord }) {
  if (e.draftSource !== "llm") return null;
  return (
    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
      Beacon wrote this{e.llmRationale ? `: ${e.llmRationale}` : ""}. Copy it and tweak as you like before you publish.
    </div>
  );
}

/** The keyword-research evidence: the page's top searches + how much real demand each has. Shown only
 *  when Beacon has cached DataForSEO demand for the page (label "competition", never "difficulty"). */
function KeywordResearch({ e }: { e: PlannedExperimentRecord }) {
  const brief = e.evidenceBrief;
  if (!brief || brief.keywords.length === 0) return null;
  const withData = brief.keywords.filter((k) => k.volume != null || k.competition != null);
  if (withData.length === 0) return null;
  return (
    <div>
      <span style={{ opacity: 0.6 }}>Keyword research: </span>
      {brief.addressableVolume != null
        ? `about ${brief.addressableVolume.toLocaleString()} searches a month across these`
        : "real search demand behind this"}
      <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
        {withData.map((k) => (
          <div key={k.term} style={{ fontSize: 12.5, opacity: 0.9 }}>
            <span style={{ fontWeight: 600 }}>{k.term}</span>
            {k.volume != null ? `: ${k.volume.toLocaleString()}/mo` : ": no volume on record"}
            {k.competition ? `, ${k.competition} competition` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The roundtable (R1): the named teammates who argued this pick, their one-line takes, any
 *  pushback, and the team's verdict. This is the REAL debate frozen at planning time - the same
 *  specialists (search demand, revenue, visitor behavior, live Google results, AI citations)
 *  whose evidence chose tonight's batch. */
function TeamRoundtable({ e }: { e: PlannedExperimentRecord }) {
  const t = e.teamReview;
  if (!t || t.voices.length === 0) return null;
  return (
    <div style={{ marginTop: 10, border: "1px solid var(--border, #e5e7eb)", borderRadius: 10, padding: "8px 10px", background: "var(--code-bg, #fafbfc)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.55 }}>Your team on this move</span>
        {t.consensusPct > 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} aria-label={`Team conviction ${t.consensusPct} percent`}>
            <span style={{ width: 56, height: 4, borderRadius: 999, background: "var(--border, #e5e7eb)", overflow: "hidden", display: "inline-block" }}>
              <span style={{ display: "block", height: "100%", width: `${t.consensusPct}%`, borderRadius: 999, background: t.consensusPct >= 75 ? "#059669" : t.consensusPct >= 50 ? "#4f46e5" : "#f59e0b" }} />
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.6 }}>
              {t.consensusPct >= 75 ? "high" : t.consensusPct >= 50 ? "medium" : "cautious"} conviction
            </span>
          </span>
        ) : null}
      </div>
      <div style={{ display: "grid", gap: 3 }}>
        {t.voices.map((v) => {
          const id = teammateOf(v.specialist);
          return (
            <div key={v.specialist} style={{ fontSize: 12.5, lineHeight: 1.45, display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: id.color, display: "inline-block" }} />
                <span style={{ fontWeight: 600, color: id.text }}>{v.label}:</span>
              </span>
              <span>{stripBannedDashes(v.claim)}</span>
            </div>
          );
        })}
        {t.objections.map((o, i) => (
          <div key={`ob-${i}`} style={{ fontSize: 12.5, lineHeight: 1.45, color: "#b45309" }}>
            <span style={{ fontWeight: 600 }}>{o.label} pushed back:</span> {stripBannedDashes(o.reason)}
          </div>
        ))}
      </div>
      {t.verdict ? (
        <div style={{ marginTop: 5, fontSize: 12.5, opacity: 0.8 }}>
          <span style={{ fontWeight: 600 }}>Verdict:</span> {stripBannedDashes(t.verdict)}
        </div>
      ) : null}
      {t.whyNot ? (
        <div style={{ marginTop: 3, fontSize: 12, opacity: 0.6 }}>
          Also weighed: {stripBannedDashes(t.whyNot)}
        </div>
      ) : null}
    </div>
  );
}

/** The live Google reaction: what shape of page wins for this search + who holds the top spots. */
function SerpReaction({ e }: { e: PlannedExperimentRecord }) {
  const serp = e.evidenceBrief?.serp;
  if (!serp || serp.winningDomains.length === 0) return null;
  return (
    <div>
      <span style={{ opacity: 0.6 }}>What wins on Google now: </span>
      {serp.format} pages, led by {serp.winningDomains.join(", ")}.
      {serp.whatToDo ? <> {stripBannedDashes(serp.whatToDo)}</> : null}
    </div>
  );
}

/** The top competitor page beating this one, and the exact thing to take from it. */
function CompetitorSteal({ e }: { e: PlannedExperimentRecord }) {
  const c = e.evidenceBrief?.competitor;
  if (!c || !c.whatToSteal) return null;
  return (
    <div>
      <span style={{ opacity: 0.6 }}>Who is beating you: </span>
      {c.domain}. Steal this: {stripBannedDashes(c.whatToSteal)}.
    </div>
  );
}

/** The optional depth: the search, the current state, the comparison pages, the measurement plan. */
function HowWeKnow({ e, steps }: { e: PlannedExperimentRecord; steps?: string }) {
  const detailLine =
    e.detail.kind === "internal_link" ? `Link "${e.detail.anchorText}" to ${e.detail.destinationUrl}`
    : e.detail.kind === "answer_block" ? `The question people ask: ${e.detail.question}`
    : null;
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.65 }}>How we know</summary>
      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85, display: "grid", gap: 4 }}>
        <div><span style={{ opacity: 0.6 }}>The search people use: </span>“{e.targetQuery}”</div>
        <KeywordResearch e={e} />
        <SerpReaction e={e} />
        <CompetitorSteal e={e} />
        <div><span style={{ opacity: 0.6 }}>On the page now: </span>{stripBannedDashes(e.currentText) || "no answer at the top"}</div>
        {detailLine && <div>{detailLine}</div>}
        {e.controls.length > 0 && (
          <div><span style={{ opacity: 0.6 }}>Compared against {e.controls.length} similar page{e.controls.length === 1 ? "" : "s"}: </span>{e.controls.map((c) => c.controlPath).join(", ")}</div>
        )}
        <div><span style={{ opacity: 0.6 }}>Left untouched: </span>{e.leaveUnchanged.join(", ")}</div>
        <div><span style={{ opacity: 0.6 }}>How I measure: </span>a first read about a week after it is live, confirmed again at two and four weeks.</div>
        {steps && <div><span style={{ opacity: 0.6 }}>Exact steps: </span>{steps}</div>}
      </div>
    </details>
  );
}

/** Preview card (before you approve). */
function PreviewCard({ e }: { e: PlannedExperimentRecord }) {
  const [msg, setMsg] = useState<string | null>(null);
  const paste = stripBannedDashes(e.proposedText);
  const why = stripBannedDashes(e.whyNow);
  return (
    <div style={CARD}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 11, opacity: 0.5 }}>The move</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{LEVER_LABEL[e.lever] ?? e.lever}</span>
      </div>
      <strong style={{ fontSize: 15 }}>{moveHeadline(e)}</strong>
      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 2 }}>{e.url}</div>

      {why ? (
        <>
          <div style={LABEL}>Why it wins</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>{why}</div>
        </>
      ) : null}
      <TeamRoundtable e={e} />

      <div style={LABEL}>Paste this</div>
      <div style={PASTE}>{paste}</div>
      <WrittenByBeacon e={e} />
      <button type="button" style={{ marginTop: 6, fontSize: 12 }} onClick={() => copyText(paste, setMsg)}>Copy</button>

      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>{trackingLine(e.controls.length)}</div>
      <HowWeKnow e={e} />
      {msg && <div role="status" aria-live="polite" style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{msg}</div>}
    </div>
  );
}

/** One approved item, with the apply -> confirm -> tell-Google flow (science unchanged). */
function ExecutionCard({ planId, item }: { planId: string; item: ExecutionItemView }) {
  const e = item.experiment;
  const paste = stripBannedDashes(e.proposedText);
  const why = stripBannedDashes(e.whyNow);
  const editable = e.lever !== "internal_link"; // a link's text is an anchor, not free copy
  const [text, setText] = useState(paste); // D-3: the operator can tweak before applying
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
    setMsg("Checking the change is live...");
    const r = await markDailyExperimentAppliedAction({ planId, experimentId: e.id, idempotencyKey: `${idem}::apply`, editedText: text });
    if (r.ok) {
      setStatus("active"); setFailure(null);
      setMsg(r.idempotent || r.reservationCount === 0 ? "Already confirmed live, tracking now." : `Confirmed live. I'm now tracking it against ${r.reservationCount} similar pages.`);
    } else if (r.reason === "verification_failed" && r.verification && !r.verification.verified) {
      setStatus("verification_failed");
      setFailure({ reason: r.verification.reason, expected: r.verification.expected, observed: r.verification.observed });
      setMsg(null);
    } else {
      setStatus("verification_failed");
      setFailure({ reason: reasonCopy(r.reason) });
      setMsg(null);
    }
  });

  const submit = () => start(async () => {
    setMsg("Noting that you asked Google to re-check...");
    const r = await confirmGscSubmissionAction({ planId, experimentId: e.id });
    if (r.ok) { setStatus("gsc_submitted"); setMsg("Noted, Google re-check recorded."); } else setMsg(reasonCopy(r.reason));
  });

  const skip = () => start(async () => {
    const r = await skipDailyExperimentItemAction({ planId, experimentId: e.id, idempotencyKey: `${idem}::skip` });
    if (r.ok) { setStatus("skipped"); setMsg(`Set aside. ${r.releasedCount ?? 0} comparison pages freed up.`); } else setMsg(reasonCopy(r.reason));
  });

  return (
    <div style={{ ...CARD, opacity: status === "skipped" ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, opacity: 0.5 }}>The move</span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{LEVER_LABEL[e.lever] ?? e.lever}</span>
          <StatusBadge status={status} />
        </span>
      </div>
      <strong style={{ fontSize: 15 }}>{moveHeadline(e)}</strong>
      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 2 }}>{e.url}</div>

      {why ? (
        <>
          <div style={LABEL}>Why it wins</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>{why}</div>
        </>
      ) : null}
      <TeamRoundtable e={e} />

      <div style={LABEL}>Paste this{editable && !isActive && status !== "skipped" ? " (edit it first if you want)" : ""}</div>
      {editable && !isActive && status !== "skipped" ? (
        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          aria-label="Proposed text, edit before you apply"
          rows={Math.min(6, Math.max(2, Math.ceil((text.length || 1) / 60)))}
          style={{ ...PASTE, width: "100%", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
        />
      ) : (
        <div style={PASTE}>{text}</div>
      )}
      <WrittenByBeacon e={e} />

      {failure && (
        <div style={{ marginTop: 8, padding: 8, background: "var(--err-bg, #fef2f2)", borderRadius: 8, fontSize: 13 }}>
          <strong>I couldn’t confirm this change on the live page.</strong> ({failure.reason})<br />
          {failure.expected && <>Expected: {failure.expected}<br /></>}
          {failure.observed && <>Found instead: {failure.observed}<br /></>}
          Nothing was recorded. Check the Wix field you edited, then try again.
        </div>
      )}

      {isActive ? (
        status === "gsc_submitted" ? (
          <div style={{ marginTop: 10, fontSize: 13, color: "#0d9488" }}>✓ Live and tracking. You told Google to re-check, so results should come in faster.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, color: "#059669", marginBottom: 6 }}>{trackingLine(item.activeControls > 0 ? item.activeControls : item.reservedControls)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={pending} aria-busy={pending} onClick={() => copyText(e.url, setMsg)}>Copy URL</button>
              <a href={SEARCH_CONSOLE_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>Open Search Console</a>
              <button type="button" disabled={pending} aria-busy={pending} onClick={submit}>I asked Google to re-check</button>
            </div>
          </div>
        )
      ) : status === "skipped" ? (
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>Set aside. Its comparison pages were freed up and nothing changed.</div>
      ) : (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={pending} aria-busy={pending} onClick={() => copyText(text, setMsg)}>Copy</button>
          <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>Open page</a>
          <button type="button" disabled={pending} aria-busy={pending} onClick={apply} style={{ minWidth: 130 }}>{pending ? "Checking the page..." : status === "verification_failed" ? "Try again" : "I did it in Wix"}</button>
          <button type="button" disabled={pending} aria-busy={pending} onClick={skip} style={{ opacity: 0.7 }}>Not now</button>
        </div>
      )}

      <HowWeKnow e={e} steps={item.instructions} />
      {msg && <div role="status" aria-live="polite" style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>{msg}</div>}
    </div>
  );
}

function ExecutionChecklistView({ checklist }: { checklist: ExecutionChecklist }) {
  const s = checklist.summary;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const finish = () => start(async () => {
    setMsg("Wrapping up today...");
    const r = await completeDailyPlanAction({ planId: checklist.planId });
    if (r.ok) { setMsg("Done for today. You can plan a new set anytime."); router.refresh(); } else setMsg(reasonCopy(r.reason));
  });
  return (
    <div>
      <div style={{ padding: 10, background: "var(--ok-bg, #ecfdf5)", borderRadius: 8, fontSize: 14, marginBottom: 10 }}>
        <strong>Today’s changes.</strong> {s.active} live and tracking, {s.submitted} sent to Google, {s.left} left to apply.<br />
        Apply each one in Wix, then click “I did it in Wix”. I’ll confirm it’s live before I start tracking, so nothing is recorded until it really shipped.
      </div>
      {checklist.items.map((item) => <ExecutionCard key={item.experiment.id} planId={checklist.planId} item={item} />)}
      {s.left === 0 && s.accepted > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" disabled={pending} aria-busy={pending} onClick={finish}>{pending ? "Wrapping up..." : "Finish for today"}</button>
          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>Closes today’s set so you can start fresh tomorrow. Tracking keeps running.</span>
        </div>
      )}
      {msg && <div role="status" aria-live="polite" style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{msg}</div>}
    </div>
  );
}

/** One honest line: everything I'm suggesting passed today's quality checks. */
function QualityLine({ summary }: { summary: DailyExperimentsView["qualitySummary"] }) {
  if (!summary || summary.total === 0) return null;
  const parts: string[] = [`✓ All ${summary.passed} passed today’s quality checks`];
  if (summary.cautioned > 0) parts.push(`${summary.cautioned} with a note`);
  if (summary.flagged > 0) parts.push(`${summary.flagged} held back`);
  return <div style={{ marginTop: 4, fontSize: 12, color: "#059669" }}>{parts.join(" · ")}</div>;
}

export function DailyExperimentsSection({ view }: { view: DailyExperimentsView }) {
  const { dashboard, checklist, qualitySummary } = view;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<DailyExperimentPlanRecord | undefined>(dashboard.previewPlan);
  const accepted = dashboard.acceptedPlan;

  const plan = () => start(async () => {
    setMsg("Thinking through today’s best moves...");
    const r = await planTodayExperimentsAction();
    setMsg(r.ok ? `Ready: ${r.selected} change${r.selected === 1 ? "" : "s"} to review below.` : reasonCopy(r.reason));
  });
  const accept = (p: DailyExperimentPlanRecord) => start(async () => {
    setMsg("Getting these ready...");
    const r = await acceptDailyExperimentPlanAction({ planId: p.id, inputHash: p.inputHash, idempotencyKey: `${p.id}::accept` });
    if (r.ok) {
      setMsg(`All set. Apply each change in Wix below, then tell me when it’s done.`);
      router.refresh();
    } else if (r.reason === "plan_refreshed") {
      setMsg(`This list had timed out, so I refreshed it (${r.refreshedCount ?? ""} changes) with fresh comparison pages. Take another look and approve.`);
      router.refresh();
    } else if (r.failures?.length) {
      setMsg(`A couple of comparison pages weren’t available: ${r.failures.map((f) => `${f.url} (${reasonCopy(f.reason)})`).join("; ")}`);
    } else {
      setMsg(reasonCopy(r.reason));
    }
  });
  const abandon = (p: DailyExperimentPlanRecord) => start(async () => {
    const r = await abandonPreviewPlanAction({ planId: p.id });
    setMsg(r.ok ? "Cleared." : reasonCopy(r.reason));
    if (r.ok) setPreview(undefined);
  });

  const b = dashboard.activeProofBatch;
  return (
    <section style={{ margin: "16px 0", padding: 16, border: "1px solid var(--border, #e5e7eb)", borderRadius: 12 }}>
      <h2 style={{ margin: "0 0 8px" }}>Today’s changes</h2>

      {b && (
        <div style={{ marginBottom: 12, fontSize: 14 }}>
          <div><strong>{b.label}</strong> is live. I’m tracking {b.experimentCount} change{b.experimentCount === 1 ? "" : "s"} against {b.controlCount} similar page{b.controlCount === 1 ? "" : "s"}.</div>
          <div style={{ opacity: 0.7 }}>First results around {b.nextCheckpoint}. Reliable Google data around {b.reliableDataDate}.</div>
          {view.protectedWarning && (
            <div style={{ marginTop: 6, padding: 8, background: "var(--warn-bg, #fff7ed)", borderRadius: 8, fontSize: 13 }}>⚠ {view.protectedWarning}</div>
          )}
        </div>
      )}

      {accepted && checklist ? (
        <ExecutionChecklistView checklist={checklist} />
      ) : preview ? (
        <div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>
            <strong>Here’s what I’d do today.</strong> {preview.selected.length} change{preview.selected.length === 1 ? "" : "s"}, about {preview.estimatedMinutes} min. Review and approve the ones you like.
            <QualityLine summary={qualitySummary} />
          </div>
          {preview.selected.map((e) => <PreviewCard key={e.id} e={e} />)}
          {preview.backups.length > 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>A few more in reserve: {preview.backups.map((e) => e.pageLabel).join(", ")}</div>}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => accept(preview)} style={{ minWidth: 130 }}>{pending ? "Working..." : "Approve these"}</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => plan()}>Suggest different ones</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => abandon(preview)}>Clear</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={pending} aria-busy={pending} onClick={plan}>{pending ? "Thinking..." : "Show me today’s changes"}</button>
      )}

      {msg && <div role="status" aria-live="polite" style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{msg}</div>}
    </section>
  );
}

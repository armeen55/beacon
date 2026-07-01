"use client";

/**
 * DailyExperimentsSection (2026-07-01, assistant-first redesign A+B): the friendly strategist card.
 * The SCIENCE is unchanged (plan -> approve -> apply in Wix -> Beacon confirms live -> proof starts ->
 * tell Google). Only the surface changed: every card leads with "The move / Why it wins / Paste this /
 * How we track it", and the experiment/control/proof machinery lives behind a "How we know" expander.
 * Plain language, no lab jargon, no em dashes. Planning/verification run as server actions, never on render.
 * Styling (FINAL_PREMIUM_PLAN items 11+12): the app's Tailwind design language (rounded-2xl cards,
 * a 15/13/11/10 type scale, tabular-nums metrics); identity/meter colors stay inline because they are data.
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

const STATUS_BADGE: Record<DailyExperimentItemStatus, string> = {
  ready_to_apply: "bg-gray-50 text-gray-600 ring-gray-200",
  verification_pending: "bg-blue-50 text-blue-700 ring-blue-200",
  verification_failed: "bg-red-50 text-red-700 ring-red-200",
  verified_live: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  activation_pending: "bg-blue-50 text-blue-700 ring-blue-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  gsc_submission_pending: "bg-blue-50 text-blue-700 ring-blue-200",
  gsc_submitted: "bg-teal-50 text-teal-700 ring-teal-200",
  skipped: "bg-gray-50 text-gray-400 ring-gray-200",
  rolled_back: "bg-gray-50 text-gray-400 ring-gray-200",
};

/** Shared design tokens (Tailwind class strings, same language as today-moves-card). */
const CARD_CLS = "mb-3 rounded-2xl border border-gray-200 bg-white p-4";
const LABEL_CLS = "text-[10px] font-semibold uppercase tracking-wide text-gray-400";
const PASTE_CLS = "whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-[13px] font-medium leading-relaxed text-gray-800";
const BTN_PRIMARY = "rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-60";
const BTN_SECONDARY = "rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60";
const BTN_GHOST = "text-xs font-medium text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-60";
const BTN_SMALL = "mt-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60";
const LINK_CLS = "text-[13px] font-medium text-gray-600 underline underline-offset-2 transition-colors hover:text-gray-900";

function StatusBadge({ status }: { status: DailyExperimentItemStatus }) {
  return (
    <span role="status" aria-label={`Status: ${STATUS_LABEL[status]}`} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_BADGE[status]}`}>
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
    <div className="mt-1 text-[11px] text-gray-400">
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
    <div className="tabular-nums">
      <span className="text-gray-400">Keyword research: </span>
      {brief.addressableVolume != null
        ? `about ${brief.addressableVolume.toLocaleString()} searches a month across these`
        : "real search demand behind this"}
      <div className="mt-1 grid gap-0.5">
        {withData.map((k) => (
          <div key={k.term} className="text-gray-600">
            <span className="font-semibold text-gray-700">{k.term}</span>
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
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={LABEL_CLS}>Your team on this move</span>
        {t.consensusPct > 0 ? (
          <span className="inline-flex items-center gap-1.5" aria-label={`Team conviction ${t.consensusPct} percent`}>
            <span className="inline-block h-1 w-14 overflow-hidden rounded-full bg-gray-200">
              <span className="block h-full rounded-full" style={{ width: `${t.consensusPct}%`, background: t.consensusPct >= 75 ? "#059669" : t.consensusPct >= 50 ? "#4f46e5" : "#f59e0b" }} />
            </span>
            <span className="text-[10px] font-semibold text-gray-400">
              {t.consensusPct >= 75 ? "high" : t.consensusPct >= 50 ? "medium" : "cautious"} conviction
            </span>
          </span>
        ) : null}
      </div>
      <div className="grid gap-1">
        {t.voices.map((v) => {
          const id = teammateOf(v.specialist);
          return (
            <div key={v.specialist} className="flex items-baseline gap-1.5 text-[13px] leading-relaxed text-gray-700">
              <span className="inline-flex shrink-0 items-center gap-1">
                <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: id.color }} />
                <span className="font-semibold" style={{ color: id.text }}>{v.label}:</span>
              </span>
              <span>{stripBannedDashes(v.claim)}</span>
            </div>
          );
        })}
        {t.objections.map((o, i) => (
          <div key={`ob-${i}`} className="text-[13px] leading-relaxed text-amber-700">
            <span className="font-semibold">{o.label} pushed back:</span> {stripBannedDashes(o.reason)}
          </div>
        ))}
      </div>
      {t.verdict ? (
        <div className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
          <span className="font-semibold">Verdict:</span> {stripBannedDashes(t.verdict)}
        </div>
      ) : null}
      {t.whyNot ? (
        <div className="mt-1 text-[11px] text-gray-400">
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
      <span className="text-gray-400">What wins on Google now: </span>
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
      <span className="text-gray-400">Who is beating you: </span>
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
    <details className="mt-3">
      <summary className="cursor-pointer text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-600">How we know</summary>
      <div className="mt-2 grid gap-1 text-[13px] leading-relaxed text-gray-700 tabular-nums">
        <div><span className="text-gray-400">The search people use: </span>“{e.targetQuery}”</div>
        <KeywordResearch e={e} />
        <SerpReaction e={e} />
        <CompetitorSteal e={e} />
        <div><span className="text-gray-400">On the page now: </span>{stripBannedDashes(e.currentText) || "no answer at the top"}</div>
        {detailLine && <div>{detailLine}</div>}
        {e.controls.length > 0 && (
          <div><span className="text-gray-400">Compared against {e.controls.length} similar page{e.controls.length === 1 ? "" : "s"}: </span>{e.controls.map((c) => c.controlPath).join(", ")}</div>
        )}
        <div><span className="text-gray-400">Left untouched: </span>{e.leaveUnchanged.join(", ")}</div>
        <div><span className="text-gray-400">How I measure: </span>a first read about a week after it is live, confirmed again at two and four weeks.</div>
        {steps && <div><span className="text-gray-400">Exact steps: </span>{steps}</div>}
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
    <div className={CARD_CLS}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={LABEL_CLS}>The move</span>
        <span className="text-[11px] text-gray-400">{LEVER_LABEL[e.lever] ?? e.lever}</span>
      </div>
      <strong className="mt-1 block text-[15px] font-semibold leading-snug text-gray-900">{moveHeadline(e)}</strong>
      <div className="mt-0.5 text-[11px] text-gray-400">{e.url}</div>

      {why ? (
        <>
          <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Why it wins</div>
          <div className="text-[13px] leading-relaxed text-gray-700">{why}</div>
        </>
      ) : null}
      <TeamRoundtable e={e} />

      <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Paste this</div>
      <div className={PASTE_CLS}>{paste}</div>
      <WrittenByBeacon e={e} />
      <button type="button" className={BTN_SMALL} onClick={() => copyText(paste, setMsg)}>Copy</button>

      <div className="mt-3 text-[13px] leading-relaxed text-gray-600 tabular-nums">{trackingLine(e.controls.length)}</div>
      <HowWeKnow e={e} />
      {msg && <div role="status" aria-live="polite" className="mt-2 text-[11px] text-gray-500">{msg}</div>}
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
      setMsg(r.idempotent || r.reservationCount === 0 ? "Already confirmed live, tracking now." : `Confirmed live on your site. I am now comparing it against ${r.reservationCount} similar pages and will report the first read in about a week.`);
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
    <div className={`${CARD_CLS}${status === "skipped" ? " opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL_CLS}>The move</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">{LEVER_LABEL[e.lever] ?? e.lever}</span>
          <StatusBadge status={status} />
        </span>
      </div>
      <strong className="mt-1 block text-[15px] font-semibold leading-snug text-gray-900">{moveHeadline(e)}</strong>
      <div className="mt-0.5 text-[11px] text-gray-400">{e.url}</div>

      {why ? (
        <>
          <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Why it wins</div>
          <div className="text-[13px] leading-relaxed text-gray-700">{why}</div>
        </>
      ) : null}
      <TeamRoundtable e={e} />

      <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Paste this{editable && !isActive && status !== "skipped" ? " (edit it first if you want)" : ""}</div>
      {editable && !isActive && status !== "skipped" ? (
        <textarea
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          aria-label="Proposed text, edit before you apply"
          rows={Math.min(6, Math.max(2, Math.ceil((text.length || 1) / 60)))}
          className={`${PASTE_CLS} w-full resize-y`}
        />
      ) : (
        <div className={PASTE_CLS}>{text}</div>
      )}
      <WrittenByBeacon e={e} />

      {failure && (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[13px] leading-relaxed text-red-800">
          <strong>I couldn’t confirm this change on the live page.</strong> ({failure.reason})<br />
          {failure.expected && <>Expected: {failure.expected}<br /></>}
          {failure.observed && <>Found instead: {failure.observed}<br /></>}
          Nothing was recorded. Check the Wix field you edited, then try again.
        </div>
      )}

      {isActive ? (
        status === "gsc_submitted" ? (
          <div className="mt-3 text-[13px] text-teal-600">✓ Live and tracking. You told Google to re-check, so results should come in faster.</div>
        ) : (
          <div className="mt-3">
            <div className="mb-1.5 text-[13px] text-emerald-600 tabular-nums">{trackingLine(item.activeControls > 0 ? item.activeControls : item.reservedControls)}</div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} aria-busy={pending} onClick={() => copyText(e.url, setMsg)} className={BTN_SECONDARY}>Copy URL</button>
              <a href={SEARCH_CONSOLE_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>Open Search Console</a>
              <button type="button" disabled={pending} aria-busy={pending} onClick={submit} className={BTN_SECONDARY}>I asked Google to re-check</button>
            </div>
          </div>
        )
      ) : status === "skipped" ? (
        <div className="mt-3 text-[13px] text-gray-500">Set aside. Its comparison pages were freed up and nothing changed.</div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} aria-busy={pending} onClick={() => copyText(text, setMsg)} className={BTN_SECONDARY}>Copy</button>
          <a href={e.url} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>Open page</a>
          <button type="button" disabled={pending} aria-busy={pending} onClick={apply} className={`${BTN_PRIMARY} min-w-[130px]`}>{pending ? "Checking the page..." : status === "verification_failed" ? "Try again" : "I did it in Wix"}</button>
          <button type="button" disabled={pending} aria-busy={pending} onClick={skip} className={BTN_GHOST}>Not now</button>
        </div>
      )}

      <HowWeKnow e={e} steps={item.instructions} />
      {msg && <div role="status" aria-live="polite" className="mt-2 text-[11px] text-gray-500">{msg}</div>}
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
      <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm leading-relaxed text-emerald-900 tabular-nums">
        <strong>Today’s changes.</strong> {s.active} live and tracking, {s.submitted} sent to Google, {s.left} left to apply.<br />
        Apply each one in Wix, then click “I did it in Wix”. I’ll confirm it’s live before I start tracking, so nothing is recorded until it really shipped.
      </div>
      {checklist.items.map((item) => <ExecutionCard key={item.experiment.id} planId={checklist.planId} item={item} />)}
      {s.left === 0 && s.accepted > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} aria-busy={pending} onClick={finish} className={BTN_PRIMARY}>{pending ? "Wrapping up..." : "Finish for today"}</button>
          <span className="text-[11px] text-gray-400">Closes today’s set so you can start fresh tomorrow. Tracking keeps running.</span>
        </div>
      )}
      {msg && <div role="status" aria-live="polite" className="mt-3 text-[13px] text-gray-500">{msg}</div>}
    </div>
  );
}

/** One honest line: everything I'm suggesting passed today's quality checks. */
function QualityLine({ summary }: { summary: DailyExperimentsView["qualitySummary"] }) {
  if (!summary || summary.total === 0) return null;
  const parts: string[] = [`✓ All ${summary.passed} passed today’s quality checks`];
  if (summary.cautioned > 0) parts.push(`${summary.cautioned} with a note`);
  if (summary.flagged > 0) parts.push(`${summary.flagged} held back`);
  return <div className="mt-1 text-[11px] font-medium text-emerald-600 tabular-nums">{parts.join(" · ")}</div>;
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
    <section className="my-4 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-[15px] font-semibold text-gray-900">Today’s changes</h2>

      {b && (
        <div className="mb-3 text-sm leading-relaxed text-gray-700 tabular-nums">
          <div><strong>{b.label}</strong> is live. I’m tracking {b.experimentCount} change{b.experimentCount === 1 ? "" : "s"} against {b.controlCount} similar page{b.controlCount === 1 ? "" : "s"}.</div>
          <div className="text-gray-500">First results around {b.nextCheckpoint}. Reliable Google data around {b.reliableDataDate}.</div>
          {view.protectedWarning && (
            <div className="mt-1.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">⚠ {view.protectedWarning}</div>
          )}
        </div>
      )}

      {accepted && checklist ? (
        <ExecutionChecklistView checklist={checklist} />
      ) : preview ? (
        <div>
          <div className="mb-2 text-sm leading-relaxed text-gray-700 tabular-nums">
            <strong>Here’s what I’d do today.</strong> {preview.selected.length} change{preview.selected.length === 1 ? "" : "s"}, about {preview.estimatedMinutes} min. Review and approve the ones you like.
            <QualityLine summary={qualitySummary} />
          </div>
          {preview.selected.map((e) => <PreviewCard key={e.id} e={e} />)}
          {preview.backups.length > 0 && <div className="text-[11px] text-gray-400">A few more in reserve: {preview.backups.map((e) => e.pageLabel).join(", ")}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => accept(preview)} className={`${BTN_PRIMARY} min-w-[130px]`}>{pending ? "Working..." : "Approve these"}</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => plan()} className={BTN_SECONDARY}>Suggest different ones</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => abandon(preview)} className={BTN_GHOST}>Clear</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={pending} aria-busy={pending} onClick={plan} className={BTN_PRIMARY}>{pending ? "Thinking..." : "Show me today’s changes"}</button>
      )}

      {msg && <div role="status" aria-live="polite" className="mt-3 text-[13px] text-gray-500">{msg}</div>}
    </section>
  );
}

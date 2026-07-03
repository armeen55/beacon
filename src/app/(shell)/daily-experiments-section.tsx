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
import Link from "next/link";
import type { DailyExperimentsView } from "./daily-experiments-data";
import { stageDailyPickInWixAction } from "./stage-in-wix-actions";
import { stageRouteForLever, type StagingAvailability } from "@/domains/push/stage-route";
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
import { humanizeDebateLine } from "@/domains/demand-graph/debate-summary";
import { teammateOf } from "@/domains/team/identity";
import { Sparkline, type SparkPoint } from "@/components/data/sparkline";
import { dossierHref } from "@/lib/page-dossier-link";
import { plainPageParts } from "@/lib/plain-language";
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { SectionHeader } from "@/components/ui/section-header";

/** every action reason renders through the shared translator so a raw code can never reach the operator. */
const reasonCopy = (reason: string | null | undefined): string => failureForReason(reason).message;

const SEARCH_CONSOLE_URL = "https://search.google.com/search-console";

// Each execution-item status maps onto one of the six Pill intents: not-yet-applied states are
// neutral, anything Beacon is actively checking or a page is mid-apply on is measuring/blue,
// a failed verification is attention/red, a confirmed-live or fully-tracked state is live/green,
// and "told Google" (the last, most-done step) earns the one celebratory won treatment.
const STATUS_INTENT: Record<DailyExperimentItemStatus, PillIntent> = {
  ready_to_apply: "neutral",
  verification_pending: "measuring",
  verification_failed: "attention",
  verified_live: "live",
  activation_pending: "measuring",
  active: "live",
  gsc_submission_pending: "measuring",
  gsc_submitted: "won",
  skipped: "neutral",
  rolled_back: "neutral",
};

/** Shared design tokens (Tailwind class strings, same language as today-moves-card). Card
 *  itself supplies the border/background token classes; this is layered on top of <Card>
 *  for the spacing + the slightly larger corner radius these cards have always used. */
const CARD_CLS = "mb-3 rounded-2xl p-4";
const LABEL_CLS = "text-meta font-semibold uppercase tracking-wide text-muted-foreground";
const PASTE_CLS = "whitespace-pre-wrap rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5 text-sub font-medium leading-relaxed text-foreground-secondary";
const BTN_PRIMARY = "rounded-lg bg-foreground px-3.5 py-1.5 text-body font-semibold text-background transition-colors hover:opacity-90 disabled:opacity-60";
const BTN_SECONDARY = "rounded-lg border border-border bg-card px-3.5 py-1.5 text-body font-semibold text-foreground-secondary transition-colors hover:bg-surface-raised disabled:opacity-60";
const BTN_GHOST = "text-body font-medium text-muted-foreground transition-colors hover:text-foreground-secondary disabled:opacity-60";
const BTN_SMALL = "mt-2 rounded-md border border-border bg-card px-2.5 py-1 text-meta font-semibold text-foreground-secondary transition-colors hover:bg-surface-raised disabled:opacity-60";
const LINK_CLS = "text-sub font-medium text-foreground-secondary underline underline-offset-2 transition-colors hover:text-foreground";

function StatusBadge({ status }: { status: DailyExperimentItemStatus }) {
  return (
    <Pill intent={STATUS_INTENT[status]} role="status" aria-label={`Status: ${STATUS_LABEL[status]}`}>
      {STATUS_LABEL[status]}
    </Pill>
  );
}

function copyText(text: string, onDone: (m: string) => void) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => onDone("Copied.")).catch(() => onDone("Copy failed, select the text manually."));
  } else onDone("Clipboard unavailable, select the text manually.");
}

// BEACON_500 item 74: the structured drafter (src/domains/llm/structured-drafter.ts)
// prepends this exact sentence to an atomic-edit rationale when a confident house
// pattern backed the draft. Detecting the prefix here (rather than re-deriving the
// aggregate client-side) keeps this component a pure renderer of whatever the drafter
// already decided, with zero new fields threaded through daily-plan-types.ts.
export const FEW_SHOT_PREFIX = "I wrote this the way your last winners were written:";

/** Splits an llmRationale that may carry the item-74 few-shot sentence prepended to the
 *  model's own one-line rationale. Returns { fewShotLine, rest } - fewShotLine is null
 *  when the prefix is absent (the common case: no confident pattern cell yet). Exported
 *  for a direct unit-test pin (daily-experiments-section.test.ts) since this component
 *  otherwise has no test coverage of its own. */
export function splitFewShotLine(rationale: string | undefined): { fewShotLine: string | null; rest: string | undefined } {
  if (!rationale || !rationale.startsWith(FEW_SHOT_PREFIX)) return { fewShotLine: null, rest: rationale };
  const end = rationale.indexOf(". ");
  if (end === -1) return { fewShotLine: rationale, rest: undefined };
  return { fewShotLine: rationale.slice(0, end + 1), rest: rationale.slice(end + 2).trim() || undefined };
}

/** Shown under the paste box when the LLM wrote the text, so the operator knows to review it. */
function WrittenByBeacon({ e }: { e: PlannedExperimentRecord }) {
  if (e.draftSource !== "llm") return null;
  const { fewShotLine, rest } = splitFewShotLine(e.llmRationale);
  return (
    <div className="mt-1 space-y-0.5">
      <div className="text-meta text-muted-foreground">
        Beacon wrote this{rest ? `: ${rest}` : ""}. Copy it and tweak as you like before you publish.
      </div>
      {fewShotLine && (
        <div className="text-meta text-muted-foreground">{fewShotLine}</div>
      )}
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
      <span className="text-muted-foreground">Keyword research: </span>
      {brief.addressableVolume != null
        ? `about ${brief.addressableVolume.toLocaleString()} searches a month across these`
        : "real search demand behind this"}
      <div className="mt-1 grid gap-0.5">
        {withData.map((k) => (
          <div key={k.term} className="text-foreground-secondary">
            <span className="font-semibold text-foreground-secondary">{k.term}</span>
            {k.volume != null ? `: ${k.volume.toLocaleString()}/mo` : ": no volume on record"}
            {k.competition ? `, ${k.competition} competition` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The roundtable (R1, redesigned per item 14): the named teammates who argued this pick render
 *  as a real team thread - avatar chip on the left, the take as a speech line, pushback offset
 *  like a reply, the verdict as a distinct closing line. This is the REAL debate frozen at
 *  planning time - the same specialists (search demand, revenue, visitor behavior, live Google
 *  results, AI citations) whose evidence chose tonight's batch. Persisted records may carry
 *  older template strings, so every dynamic line runs through humanizeDebateLine too. */
function TeamRoundtable({ e }: { e: PlannedExperimentRecord }) {
  const t = e.teamReview;
  if (!t || t.voices.length === 0) return null;
  const clean = (s: string) => stripBannedDashes(humanizeDebateLine(s));
  const strategist = teammateOf("llm");
  return (
    <div className="mt-3 rounded-xl border border-border-subtle bg-surface-raised/60 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={LABEL_CLS}>Your team on this move</span>
        {t.consensusPct > 0 ? (
          <span className="inline-flex items-center gap-1.5" aria-label={`Team conviction ${t.consensusPct} percent`}>
            <span className="inline-block h-1 w-14 overflow-hidden rounded-full bg-status-neutral-bg">
              <span className="block h-full rounded-full" style={{ width: `${t.consensusPct}%`, background: t.consensusPct >= 75 ? "#059669" : t.consensusPct >= 50 ? "#4f46e5" : "#f59e0b" }} />
            </span>
            <span className="text-meta font-semibold text-muted-foreground">
              {t.consensusPct >= 75 ? "high" : t.consensusPct >= 50 ? "medium" : "cautious"} conviction
            </span>
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        {t.voices.map((v, i) => {
          const id = teammateOf(v.specialist);
          const initial = id.short.length <= 2 ? id.short : id.short.slice(0, 1);
          return (
            <div key={`${v.specialist}-${i}`} className="flex items-start gap-2 text-sub leading-relaxed text-foreground-secondary">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-meta font-bold"
                style={{ background: id.bg, color: id.text, boxShadow: `0 0 0 1px ${id.color}` }}
              >
                {initial}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold" style={{ color: id.text }}>{v.label}</span>
                  {v.confidencePct > 0 ? (
                    <span
                      aria-label={`${v.label} conviction ${v.confidencePct} percent`}
                      className="inline-block h-[2px] w-14 max-w-[56px] overflow-hidden rounded-full bg-status-neutral-bg"
                    >
                      <span className="block h-full rounded-full" style={{ width: `${v.confidencePct}%`, background: id.color }} />
                    </span>
                  ) : null}
                </span>
                <span className="block">{clean(v.claim)}</span>
              </span>
            </div>
          );
        })}
        {t.objections.map((o, i) => (
          <div key={`ob-${i}`} className="ml-7 border-l-2 border-status-warning/30 pl-2 text-sub leading-relaxed text-status-warning">
            <span className="font-semibold">{o.label} pushed back:</span> {clean(o.reason)}
          </div>
        ))}
        {/* Item 33 - disagreement is a feature: when voices conflicted, say how it resolved.
            Styled as the quiet footer of the reply thread. */}
        {t.objections.length > 0 && t.voices.length > 0 ? (
          <div className="ml-7 border-l-2 border-border-subtle pl-2 text-meta leading-relaxed text-muted-foreground">
            {clean(t.voices[0]!.label)} says go, {clean(t.objections[0]!.label)} raised a concern.
            The team went ahead because the concern stayed below the veto line, it lowered this pick&apos;s priority instead of blocking it.
          </div>
        ) : null}
      </div>
      {t.verdict ? (
        <div className="mt-2 border-t border-border pt-1.5 text-sub leading-relaxed text-foreground-secondary">
          <span className="font-semibold" style={{ color: strategist.text }}>Verdict:</span> {clean(t.verdict)}
        </div>
      ) : null}
      {t.whyNot ? (
        <div className="mt-1 text-meta text-muted-foreground">
          Also weighed: {clean(t.whyNot)}
        </div>
      ) : null}
      {/* Item 37 - a thin debate is explained, never hidden: name the silent teammates and why. */}
      {t.silent ? (
        <div className="mt-1 text-meta text-muted-foreground">{clean(t.silent)}</div>
      ) : null}
    </div>
  );
}

/** Item 12 - the final review's one-line caution. Renders ONLY when the review flagged a real
 *  concern (silence otherwise); it never blocks or hides the move, the operator still decides. */
function FinalReviewCaution({ e }: { e: PlannedExperimentRecord }) {
  const c = e.teamCheck;
  if (!c || c.verdict !== "concern" || !c.concern) return null;
  return (
    <div className="mt-2 rounded-xl border border-status-warning/20 bg-status-warning-bg px-3 py-2 text-sub leading-relaxed text-status-warning">
      One caution from the final review: {stripBannedDashes(c.concern)}
    </div>
  );
}

/** Items 31 + 34: what to expect if it works, and what would change our mind (the exit plan).
 *  Both deterministic, persisted on the plan record; self-hides for pre-field plans.
 *  Item 35: when this pick's page is thin on traffic, the honest power line rides right here too,
 *  next to the forecast it qualifies, never buried in an expander. */
function ExpectationLines({ e }: { e: PlannedExperimentRecord }) {
  const x = e.expectations;
  const power = e.power && e.power.band !== "well_powered" ? e.power : null;
  if (!x && !power) return null;
  return (
    <div className="mt-2 grid gap-1 text-sub leading-relaxed text-foreground-secondary tabular-nums">
      {x?.forecast ? <div><span className="font-semibold text-muted-foreground">If it works: </span>{stripBannedDashes(x.forecast).replace(/^If this works: /, "")}</div> : null}
      {power ? (
        <div className={power.band === "underpowered" ? "text-status-warning" : "text-muted-foreground"}>
          <span className="font-semibold">{power.band === "underpowered" ? "Slot spent elsewhere: " : "Takes longer to prove: "}</span>
          {stripBannedDashes(power.sentence)}
        </div>
      ) : null}
      {x ? <div><span className="font-semibold text-muted-foreground">What would change our mind: </span>{stripBannedDashes(x.changeOurMind)}</div> : null}
    </div>
  );
}

/** Item 47 (2026-07-02): what the ledger has already learned about moves like this one, shown
 *  right on the pick card (not buried in the expander) since it is part of why tonight picked
 *  this over another candidate. Absent when the tag is neutral (no settled bucket cleared the
 *  sample bar yet) - a fresh tenant with no history shows nothing here, exactly as before. */
function LearnedPriorTag({ e }: { e: PlannedExperimentRecord }) {
  const p = e.learnedPrior;
  if (!p || !p.tag) return null;
  const positive = p.multiplier > 1;
  return (
    <div className={`mt-2 text-meta font-medium ${positive ? "text-status-success" : "text-status-warning"}`}>
      {stripBannedDashes(p.tag)}
    </div>
  );
}

/** The live Google reaction: what shape of page wins for this search + who holds the top spots. */
function SerpReaction({ e }: { e: PlannedExperimentRecord }) {
  const serp = e.evidenceBrief?.serp;
  if (!serp || serp.winningDomains.length === 0) return null;
  return (
    <div>
      <span className="text-muted-foreground">What wins on Google now: </span>
      {serp.format} pages, led by {serp.winningDomains.join(", ")}.
      {serp.whatToDo ? <> {stripBannedDashes(serp.whatToDo)}</> : null}
      {serp.rankMovement ? <> {stripBannedDashes(serp.rankMovement)}</> : null}
      {/* Item 25: the featured-snippet/PAA steal fact, only when a real weak-owner
          candidate exists for this pick's search. Honest silence otherwise. */}
      {serp.featureSteal ? <> {stripBannedDashes(serp.featureSteal.sentence)}</> : null}
    </div>
  );
}

/** The top competitor page beating this one, and the exact thing to take from it. */
function CompetitorSteal({ e }: { e: PlannedExperimentRecord }) {
  const c = e.evidenceBrief?.competitor;
  if (!c || !c.whatToSteal) return null;
  return (
    <div>
      <span className="text-muted-foreground">Who is beating you: </span>
      {c.domain}. Steal this: {stripBannedDashes(c.whatToSteal)}.
    </div>
  );
}

/** Item 26: AI reaches this page but never quotes it, and the exact patterns it is missing. */
function CitabilityEvidence({ e }: { e: PlannedExperimentRecord }) {
  const c = e.evidenceBrief?.citability;
  if (!c || !c.evidenceLine) return null;
  return (
    <div>
      <span className="text-muted-foreground">AI citability: </span>
      {stripBannedDashes(c.evidenceLine)}
    </div>
  );
}

/** Item 46 (CARRY-OVER 115): honest degradation - one of the voices behind this pick was reading
 *  from a stale or dead data source, so "how we know" says so plainly instead of presenting every
 *  number as equally live. Absent when every voice's source was fresh. */
function StaleSourceNote({ e }: { e: PlannedExperimentRecord }) {
  const s = e.evidenceBrief?.staleSource;
  if (!s) return null;
  return (
    <div className="text-status-warning">
      <span className="font-semibold">Heads up: </span>
      {stripBannedDashes(s.sentence)}
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
      <summary className="cursor-pointer text-meta font-medium text-muted-foreground transition-colors hover:text-foreground-secondary">How we know</summary>
      <div className="mt-2 grid gap-1 text-sub leading-relaxed text-foreground-secondary tabular-nums">
        <div><span className="text-muted-foreground">The search people use: </span>“{e.targetQuery}”</div>
        <StaleSourceNote e={e} />
        <KeywordResearch e={e} />
        <SerpReaction e={e} />
        <CompetitorSteal e={e} />
        <CitabilityEvidence e={e} />
        <div><span className="text-muted-foreground">On the page now: </span>{stripBannedDashes(e.currentText) || "no answer at the top"}</div>
        {detailLine && <div>{detailLine}</div>}
        {e.controls.length > 0 && (
          <div><span className="text-muted-foreground">Compared against {e.controls.length} similar page{e.controls.length === 1 ? "" : "s"}: </span>{e.controls.map((c) => c.controlPath).join(", ")}</div>
        )}
        <div><span className="text-muted-foreground">Left untouched: </span>{plainPageParts(e.leaveUnchanged)}</div>
        <div><span className="text-muted-foreground">How I measure: </span>a first read about a week after it is live, confirmed again at two and four weeks.</div>
        {steps && <div><span className="text-muted-foreground">Exact steps: </span>{steps}</div>}
      </div>
    </details>
  );
}

/** Preview card (before you approve). */
function PreviewCard({ e, spark }: { e: PlannedExperimentRecord; spark?: SparkPoint[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const paste = stripBannedDashes(e.proposedText);
  const why = stripBannedDashes(e.whyNow);
  return (
    <Card padding="none" className={CARD_CLS}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={LABEL_CLS}>The move</span>
        <span className="text-meta text-muted-foreground">{LEVER_LABEL[e.lever] ?? e.lever}{e.expectations ? ` · ${e.expectations.effort}` : ""}</span>
      </div>
      <strong className="mt-1 block text-section font-semibold leading-snug text-foreground">{moveHeadline(e)}</strong>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        {(() => {
          const href = dossierHref(e.canonicalUrl || e.url);
          return href ? (
            <Link href={href} className="underline underline-offset-2 hover:text-foreground-secondary">{e.url}</Link>
          ) : (
            <span>{e.url}</span>
          );
        })()}
        {spark && spark.length >= 5 ? <Sparkline points={spark} width={64} height={16} className="inline-block opacity-75" /> : null}
      </div>

      {why ? (
        <>
          <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Why it wins</div>
          <div className="text-sub leading-relaxed text-foreground-secondary">{why}</div>
        </>
      ) : null}
      <LearnedPriorTag e={e} />
      <TeamRoundtable e={e} />
      <ExpectationLines e={e} />
      <FinalReviewCaution e={e} />

      <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Paste this</div>
      <div className={PASTE_CLS}>{paste}</div>
      <WrittenByBeacon e={e} />
      <button type="button" className={BTN_SMALL} onClick={() => copyText(paste, setMsg)}>Copy</button>

      <div className="mt-3 text-sub leading-relaxed text-foreground-secondary tabular-nums">{trackingLine(e.controls.length)}</div>
      <HowWeKnow e={e} />
      {msg && <div role="status" aria-live="polite" className="mt-2 text-meta text-muted-foreground">{msg}</div>}
    </Card>
  );
}

/** One approved item, with the apply -> confirm -> tell-Google flow (science unchanged).
 *  Item 15: when the site is armed and the change has a one-click path, "Stage in Wix"
 *  puts it into Wix through the existing publish rails; the paste flow stays the
 *  visible fallback and the confirm-live science is untouched. */
function ExecutionCard({ planId, item, spark, staging, wixEditorUrl }: { planId: string; item: ExecutionItemView; spark?: SparkPoint[]; staging?: StagingAvailability; wixEditorUrl?: string | null }) {
  const e = item.experiment;
  const paste = stripBannedDashes(e.proposedText);
  const why = stripBannedDashes(e.whyNow);
  const editable = e.lever !== "internal_link"; // a link's text is an anchor, not free copy
  const [text, setText] = useState(paste); // D-3: the operator can tweak before applying
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<DailyExperimentItemStatus>(item.status);
  // Item 15 - one-click staging state. canStage only OFFERS the button; the server
  // action re-checks every gate and fails closed to the paste instruction.
  const canStage = Boolean(staging?.enabled) && stageRouteForLever(e.lever) != null;
  const [stagedReceipt, setStagedReceipt] = useState<string | null>(null);
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

  // Item 15 - stage the change in Wix through the existing armed-publish rails.
  // The receipt renders on the card; the confirm-live step (the science) is unchanged.
  const stage = () => start(async () => {
    setMsg("Putting this change into Wix...");
    const r = await stageDailyPickInWixAction({ planId, experimentId: e.id, editedText: text });
    if (r.staged) { setStagedReceipt(r.receiptLine); setMsg(null); }
    else setMsg(r.receiptLine);
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
    <Card padding="none" className={`${CARD_CLS}${status === "skipped" ? " opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL_CLS}>The move</span>
        <span className="flex items-center gap-2">
          <span className="text-meta text-muted-foreground">{LEVER_LABEL[e.lever] ?? e.lever}{e.expectations ? ` · ${e.expectations.effort}` : ""}</span>
          <StatusBadge status={status} />
        </span>
      </div>
      <strong className="mt-1 block text-section font-semibold leading-snug text-foreground">{moveHeadline(e)}</strong>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        {(() => {
          const href = dossierHref(e.canonicalUrl || e.url);
          return href ? (
            <Link href={href} className="underline underline-offset-2 hover:text-foreground-secondary">{e.url}</Link>
          ) : (
            <span>{e.url}</span>
          );
        })()}
        {spark && spark.length >= 5 ? <Sparkline points={spark} width={64} height={16} className="inline-block opacity-75" /> : null}
      </div>

      {why ? (
        <>
          <div className={`mt-3 mb-1 ${LABEL_CLS}`}>Why it wins</div>
          <div className="text-sub leading-relaxed text-foreground-secondary">{why}</div>
        </>
      ) : null}
      <LearnedPriorTag e={e} />
      <TeamRoundtable e={e} />
      <ExpectationLines e={e} />
      <FinalReviewCaution e={e} />

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
        <div className="mt-3 rounded-xl border border-status-danger/20 bg-status-danger-bg px-3 py-2.5 text-sub leading-relaxed text-status-danger">
          <strong>I couldn’t confirm this change on the live page.</strong> ({failure.reason})<br />
          {failure.expected && <>Expected: {failure.expected}<br /></>}
          {failure.observed && <>Found instead: {failure.observed}<br /></>}
          Nothing was recorded. Check the Wix field you edited, then try again.
        </div>
      )}

      {/* Item 67 - undo is always one click away: the old text is saved and copyable. */}
      {isActive && e.rollbackText ? (
        <button
          type="button"
          className={BTN_SMALL}
          onClick={() => copyText(stripBannedDashes(e.rollbackText), setMsg)}
          title="Copies the text this page had BEFORE the change, so you can paste it back in your site editor. I never auto-revert a live page."
        >
          Roll back: copy the old text
        </button>
      ) : null}
      {isActive ? (
        status === "gsc_submitted" ? (
          <div className="mt-3 text-sub text-status-info">✓ Live and tracking. You told Google to re-check, so results should come in faster.</div>
        ) : (
          <div className="mt-3">
            <div className="mb-1.5 text-sub text-status-success tabular-nums">{trackingLine(item.activeControls > 0 ? item.activeControls : item.reservedControls)}</div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} aria-busy={pending} onClick={() => copyText(e.url, setMsg)} className={BTN_SECONDARY}>Copy URL</button>
              <a href={SEARCH_CONSOLE_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>Open Search Console</a>
              <button type="button" disabled={pending} aria-busy={pending} onClick={submit} className={BTN_SECONDARY}>I asked Google to re-check</button>
            </div>
          </div>
        )
      ) : status === "skipped" ? (
        <div className="mt-3 text-sub text-muted-foreground">Set aside. Its comparison pages were freed up and nothing changed.</div>
      ) : (
        <>
          {/* Item 15 - the staging receipt: the change is in Wix, the old version is saved. */}
          {stagedReceipt ? (
            <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-status-success/20 bg-status-success-bg px-3 py-2.5 text-sub leading-relaxed text-status-success">
              {stagedReceipt} Click &ldquo;Check it is live&rdquo; and I start tracking.
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canStage ? (
              <button type="button" disabled={pending} aria-busy={pending} onClick={stage} className={`${BTN_PRIMARY} min-w-[120px]`}>{pending ? "Working..." : "Stage in Wix"}</button>
            ) : null}
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => copyText(text, setMsg)} className={BTN_SECONDARY}>Copy</button>
            <a href={e.url} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>Open page</a>
            {/* Item 45 - deep link into the Wix editor for this page's mapped CMS
                item (or its Stores product editor). Null renders nothing. */}
            {wixEditorUrl ? (
              <a href={wixEditorUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>Open in Wix</a>
            ) : null}
            <button type="button" disabled={pending} aria-busy={pending} onClick={apply} className={canStage ? BTN_SECONDARY : `${BTN_PRIMARY} min-w-[130px]`}>{pending ? "Checking the page..." : status === "verification_failed" ? "Try again" : stagedReceipt ? "Check it is live" : "I did it in Wix"}</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={skip} className={BTN_GHOST}>Not now</button>
          </div>
          {canStage ? (
            <div className="mt-1.5 text-meta text-muted-foreground">Stage in Wix makes the change for you and saves the old version first, or copy and paste it yourself.</div>
          ) : null}
        </>
      )}

      <HowWeKnow e={e} steps={item.instructions} />
      {msg && <div role="status" aria-live="polite" className="mt-2 text-meta text-muted-foreground">{msg}</div>}
    </Card>
  );
}

function ExecutionChecklistView({ checklist, sparklineByUrl, staging, wixEditorUrlByUrl }: { checklist: ExecutionChecklist; sparklineByUrl: Record<string, SparkPoint[]>; staging?: StagingAvailability; wixEditorUrlByUrl?: Record<string, string> }) {
  const s = checklist.summary;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // Item 44 - tonight's batch progress: one segment per approved change.
  const total = s.accepted;
  const applied = total - s.left;
  const finish = () => start(async () => {
    setMsg("Wrapping up today...");
    const r = await completeDailyPlanAction({ planId: checklist.planId });
    if (r.ok) { setMsg("Done for today. You can plan a new set anytime."); router.refresh(); } else setMsg(reasonCopy(r.reason));
  });
  return (
    <div>
      {total > 0 ? (
        <div className="mb-3 tabular-nums">
          <div className="mb-1 text-meta font-semibold text-muted-foreground">Tonight: {applied} of {total} applied</div>
          <div className="flex gap-[2px]" role="img" aria-label={`Tonight: ${applied} of ${total} applied`}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`h-[6px] flex-1 rounded-full ${i < applied ? "bg-status-success" : "bg-status-neutral-bg"}`} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-3 rounded-xl border border-status-success/20 bg-status-success-bg px-3 py-2.5 text-body leading-relaxed text-status-success tabular-nums">
        <strong>Today’s changes.</strong> {s.active} live and tracking, {s.submitted} sent to Google, {s.left} left to apply.<br />
        {/* A10 (operator-experience fix batch, 2026-07-02) - once nothing is left to apply, the
            "Apply each one in Wix..." instructions are nagging, not helpful. Say the done state
            plainly instead. */}
        {s.left > 0
          ? "Apply each one in Wix, then click “I did it in Wix”. I’ll confirm it’s live before I start tracking, so nothing is recorded until it really shipped."
          : "All applied. I am watching the results."}
        {/* Item 15 - the quiet nudge: publishing is possible here but not armed yet. */}
        {staging && staging.wixTarget && !staging.armed && s.left > 0 ? (
          <div className="mt-1.5 text-meta font-normal text-status-success/80">
            I can put these into Wix for you.{" "}
            <Link href="/settings/connectors" className="font-semibold underline underline-offset-2">Turn on publishing</Link>{" "}
            and each change becomes one click.
          </div>
        ) : null}
        {s.left > 0 ? (
          <div className="mt-1.5">
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => {
                // Item 60 - one numbered checklist of every pending paste, in list order.
                const pendingItems = checklist.items.filter((it) => !["active", "gsc_submission_pending", "gsc_submitted", "skipped"].includes(it.status));
                const text = pendingItems
                  .map((it, i) => {
                    const e = it.experiment;
                    return `${i + 1}. ${e.url}\n   Change (${LEVER_LABEL[e.lever] ?? e.lever}): ${stripBannedDashes(e.proposedText)}`;
                  })
                  .join("\n\n");
                copyText(text, setMsg);
              }}
            >
              Copy all {s.left} pending paste{s.left === 1 ? "" : "s"} as a checklist
            </button>
          </div>
        ) : null}
      </div>
      {checklist.items.map((item) => <ExecutionCard key={item.experiment.id} planId={checklist.planId} item={item} spark={sparklineByUrl[item.experiment.url]} staging={staging} wixEditorUrl={wixEditorUrlByUrl?.[item.experiment.url]} />)}
      {/* Item 62 - the sticky batch bar: while tonight's items are pending, the count
          follows the operator down the page so finishing never falls off-screen. */}
      {s.left > 0 ? (
        <div className="sticky bottom-3 z-10 mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur">
          <span className="text-sub font-semibold text-foreground-secondary tabular-nums">
            Tonight: {s.left} left to apply
          </span>
          <span className="flex flex-1 gap-0.5" aria-hidden>
            {Array.from({ length: s.accepted }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < s.accepted - s.left ? "bg-status-success" : "bg-status-neutral-bg"}`} />
            ))}
          </span>
          <span className="text-meta text-muted-foreground tabular-nums">about {s.left} minute{s.left === 1 ? "" : "s"}</span>
        </div>
      ) : null}
      {s.left === 0 && s.accepted > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} aria-busy={pending} onClick={finish} className={BTN_PRIMARY}>{pending ? "Wrapping up..." : "Finish for today"}</button>
          <span className="text-meta text-muted-foreground">Closes today’s set so you can start fresh tomorrow. Tracking keeps running.</span>
        </div>
      )}
      {msg && <div role="status" aria-live="polite" className="mt-3 text-sub text-muted-foreground">{msg}</div>}
    </div>
  );
}

/** One honest line: everything I'm suggesting passed today's quality checks. */
function QualityLine({ summary }: { summary: DailyExperimentsView["qualitySummary"] }) {
  if (!summary || summary.total === 0) return null;
  const parts: string[] = [`✓ All ${summary.passed} passed today’s quality checks`];
  if (summary.cautioned > 0) parts.push(`${summary.cautioned} with a note`);
  if (summary.flagged > 0) parts.push(`${summary.flagged} held back`);
  return (
    <>
      <div className="mt-1 text-meta font-medium text-status-success tabular-nums">{parts.join(" · ")}</div>
      {/* N9 - self-hiding: only renders when a page's own sources disagree (Search Console vs
          Analytics, a live check vs Search Console's own ranking, or a dead page still getting
          clicks). Absent on every ordinary night. */}
      {summary.paused > 0 && (
        <div className="mt-0.5 text-meta font-medium text-status-warning tabular-nums">
          ⏸ {summary.paused} paused until the data agrees - checking again nightly
        </div>
      )}
    </>
  );
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
    // id: the item-56 "Pages fading" row in the Demand band deep-links here ("See tonight's picks").
    <section id="daily-experiments" className="my-4 rounded-2xl border border-border bg-card p-4">
      <SectionHeader title="Today’s changes" className="mb-2" />

      {b && (
        <div className="mb-3 text-body leading-relaxed text-foreground-secondary tabular-nums">
          <div><strong>{b.label}</strong> is live. I’m tracking {b.experimentCount} change{b.experimentCount === 1 ? "" : "s"} against {b.controlCount} similar page{b.controlCount === 1 ? "" : "s"}.</div>
          <div className="text-muted-foreground">First results around {b.nextCheckpoint}. Reliable Google data around {b.reliableDataDate}.</div>
          {view.protectedWarning && (
            <div className="mt-1.5 rounded-xl border border-status-warning/20 bg-status-warning-bg px-3 py-2 text-sub text-status-warning">⚠ {view.protectedWarning}</div>
          )}
        </div>
      )}

      {accepted && checklist ? (
        <ExecutionChecklistView checklist={checklist} sparklineByUrl={view.sparklineByUrl} staging={view.staging} wixEditorUrlByUrl={view.wixEditorUrlByUrl} />
      ) : preview ? (
        <div>
          <div className="mb-2 text-body leading-relaxed text-foreground-secondary tabular-nums">
            <strong>Here’s what I’d do today.</strong> {preview.selected.length} change{preview.selected.length === 1 ? "" : "s"}, about {preview.estimatedMinutes} min. Review and approve the ones you like.
            <QualityLine summary={qualitySummary} />
          </div>
          {preview.selected.map((e) => <PreviewCard key={e.id} e={e} spark={view.sparklineByUrl[e.url]} />)}
          {preview.backups.length > 0 && <div className="text-meta text-muted-foreground">A few more in reserve: {preview.backups.map((e) => e.pageLabel).join(", ")}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => accept(preview)} className={`${BTN_PRIMARY} min-w-[130px]`}>{pending ? "Working..." : "Approve these"}</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => plan()} className={BTN_SECONDARY}>Suggest different ones</button>
            <button type="button" disabled={pending} aria-busy={pending} onClick={() => abandon(preview)} className={BTN_GHOST}>Clear</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={pending} aria-busy={pending} onClick={plan} className={BTN_PRIMARY}>{pending ? "Thinking..." : "Show me today’s changes"}</button>
      )}

      {msg && <div role="status" aria-live="polite" className="mt-3 text-sub text-muted-foreground">{msg}</div>}
    </section>
  );
}

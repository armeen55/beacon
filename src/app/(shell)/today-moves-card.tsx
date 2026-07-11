"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CornerDownRight,
  RefreshCw,
  Sparkles,
  Swords,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { respondToRecommendation } from "./recommendation-actions";
import { draftMoveAnswerBlockAction, draftMoveFaqAction, sharpenMovesWithTeardownAction } from "./today-moves-actions";
import { getCompetitorAnswerAlignmentForClient } from "@/domains/ai-visibility/answer-alignment-actions";
import { stageMoveInWixAction } from "./stage-in-wix-actions";
import type { TodayMove } from "./today-moves-data";
import { teammateOf } from "@/domains/team/identity";
import { Sparkline } from "@/components/data/sparkline";
import { formatMetric, formatMetricCompact } from "@/lib/format-metric";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";
import { LearnedMoveLine } from "./learned-move-line";
import { rankToVisits } from "@/domains/serp/rank-to-visits";
import { dossierHref } from "@/lib/page-dossier-link";
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

/**
 * today-moves-card (2026-06-24) - the interactive §7 Move card. One-tap "Ship it"
 * records an accepted response (the same server action /recommendations uses) with
 * optimistic UI: the card flips to a celebratory "shipping → measuring" state
 * instantly, the action persists + revalidates "/", and the loader then drops the
 * Move on the next render. "Not now" snoozes it. Pure presentation + one action;
 * no Wix, no new writes beyond the existing response store.
 */

// The action-category identity bar (citation/clicks/experience/page) is a deliberate
// exception to the token system: each category needs its OWN distinguishable hue so the
// left-edge bar reads as "which kind of move" at a glance, and four categories don't fit
// the six verdict-based Pill intents. Kept as a one-off gradient per FP6b instructions.
const TONE: Record<
  TodayMove["actionTone"],
  { bar: string; ring: string; dot: string; btn: string }
> = {
  citation: {
    bar: "bg-gradient-to-b from-violet-500 to-indigo-500",
    ring: "hover:ring-accent-primary-muted",
    dot: "bg-violet-500",
    btn: "bg-violet-600 hover:bg-violet-500",
  },
  clicks: {
    bar: "bg-gradient-to-b from-sky-500 to-blue-600",
    ring: "hover:ring-accent-primary-muted",
    dot: "bg-sky-500",
    btn: "bg-accent-primary hover:opacity-90",
  },
  experience: {
    bar: "bg-gradient-to-b from-amber-400 to-orange-500",
    ring: "hover:ring-status-warning/30",
    dot: "bg-amber-500",
    btn: "bg-orange-600 hover:bg-orange-500",
  },
  page: {
    bar: "bg-gradient-to-b from-emerald-400 to-green-600",
    ring: "hover:ring-status-success/30",
    dot: "bg-emerald-500",
    btn: "bg-status-success hover:opacity-90",
  },
};

/** The action-category label chip (e.g. "Add an answer block") next to the rank badge -
 *  identity, not a verdict, so it rides the same per-category color as the TONE bar above
 *  rather than a Pill intent. */
const TONE_PILL_CLS: Record<TodayMove["actionTone"], string> = {
  citation: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  clicks: "bg-accent-primary-light text-accent-primary ring-1 ring-accent-primary-muted",
  experience: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  page: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

/** Item 23 - shared visible keyboard-focus ring for every interactive element on the card. */
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

// Confidence is a forecast, not a verdict - "won" stays reserved for a proven result. High
// confidence borrows the same soft-green "live" tone, medium borrows "waiting" amber, and
// low borrows plain "neutral" gray, matching the original hue intent through Pill's intents.
const CONF: Record<TodayMove["confidence"], { label: string; intent: PillIntent }> = {
  high: { label: "High confidence", intent: "live" },
  medium: { label: "Medium confidence", intent: "waiting" },
  low: { label: "Worth a look", intent: "neutral" },
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** G3 (Wave 4) - the honest-absence CTA for "Your gap": reuses the existing,
 *  already-wired teardown refresh (`sharpenMovesWithTeardownAction`, the same action
 *  behind the Today page's "Sharpen with teardown" button) instead of a new action -
 *  no new fetch engine, just the existing one triggered from this card. Read-only
 *  against competitors; operator-gated server-side. No `useRouter` here on purpose -
 *  MoveCard renders in a plain renderToStaticMarkup test harness with no app-router
 *  context, and the server action's own `revalidatePath` already means the row shows
 *  the fresh comparison the next time its detail is reopened. */
function CompareAgainstWinnersButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => {
          setMsg(null);
          start(async () => {
            try {
              const r = await sharpenMovesWithTeardownAction({ limit: 12 });
              if (r.status === "off") {
                setMsg("Operator only.");
                return;
              }
              setMsg(`Read ${r.audited} competitor page${r.audited === 1 ? "" : "s"}. Reopen this to see it.`);
            } catch {
              setMsg("Could not read the winners right now, try again.");
            }
          });
        }}
        disabled={pending}
        className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground-secondary hover:bg-card ${FOCUS}`}
      >
        {pending ? "Reading the winners…" : "Compare against the winners"}
      </button>
      {msg ? <span className="text-meta text-muted-foreground">{msg}</span> : null}
    </div>
  );
}

/** Friendly labels for the ActionPack evidence-source provenance chips (the
 *  "Ranked by …" transparency the customer card now shows, not just diagnostics). */
const SOURCE_LABEL: Record<string, string> = {
  gsc: "Google Search",
  ga4: "Analytics",
  clarity: "Clarity UX",
  profound: "AI citations",
  dataforseo: "Live Google check",
  competitor_teardown: "Competitor teardown",
  rank_revenue: "Demand graph",
};

export function MoveCard({
  m,
  rank,
  onAction,
}: {
  m: TodayMove;
  rank: number;
  /** D6 (daily ritual loop) - fires once the underlying action actually persisted (ship,
   *  stage-in-Wix, or snooze), so a wrapping list can advance to the next best row and bump
   *  its session counter. Optional and additive: every existing caller that doesn't pass it
   *  behaves exactly as before. */
  onAction?: (action: "shipped" | "snoozed") => void;
}) {
  // Defensive: an unexpected actionTone/confidence must never crash the card.
  const tone = TONE[m.actionTone] ?? TONE.clicks;
  const conf = CONF[m.confidence] ?? CONF.medium;
  const [state, setState] = useState<"idle" | "shipped" | "snoozed">("idle");
  const [pending, startTransition] = useTransition();
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedPrepared, setCopiedPrepared] = useState(false);
  const [copiedTitle, setCopiedTitle] = useState<number | null>(null);
  const copyPrepared = () => {
    if (!m.preparedDraftText) return;
    navigator.clipboard
      ?.writeText(m.preparedDraftText)
      .then(() => {
        setCopiedPrepared(true);
        setTimeout(() => setCopiedPrepared(false), 1800);
      })
      .catch(() => {});
  };
  const copyTitle = (i: number, text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedTitle(i);
        setTimeout(() => setCopiedTitle(null), 1500);
      })
      .catch(() => {});
  };

  // BEACON 500 item 71: "the N words that beat you" - the literal passage the AI
  // answer shares with the cited competitor's page. Lazy, one fetch per card, only
  // when there is already a real teardown to enrich ($0 deterministic compute,
  // cached server-side by content hash - a re-render never re-runs the work).
  const [stealPassage, setStealPassage] = useState<{ text: string; engine: string | null } | null>(null);
  useEffect(() => {
    if (!m.whoCited || !m.competitorSteal) return;
    let cancelled = false;
    getCompetitorAnswerAlignmentForClient(m.id, m.whoCited, m.query)
      .then((alignment) => {
        if (cancelled) return;
        const top = alignment?.passages[0];
        if (top) setStealPassage({ text: top.pageSentence, engine: alignment?.engine ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.whoCited, m.competitorSteal, m.query]);

  // On-demand LLM answer-block draft (off unless BEACON_LLM_PROVIDER=openai; the
  // action is operator-gated + budget-gated + safety-firewalled). Fires only on click.
  const [aiStatus, setAiStatus] = useState<
    "idle" | "pending" | "ok" | "off" | "blocked" | "rejected" | "error"
  >(m.savedAnswerBlock ? "ok" : "idle"); // hydrate a previously-generated+saved draft
  const [aiText, setAiText] = useState(m.savedAnswerBlock ?? "");
  const [aiCopied, setAiCopied] = useState(false);
  const aiGenerate = () => {
    setAiStatus("pending");
    startTransition(async () => {
      try {
        const r = await draftMoveAnswerBlockAction({
          recId: m.id,
          query: m.query,
          pageLabel: m.pageLabel,
          brief: m.answerBrief,
          outline: m.outline,
          faqs: m.faqs,
        });
        if (r.status === "ok") {
          setAiText(r.text);
          setAiStatus("ok");
        } else if (r.status === "off") setAiStatus("off");
        else if (r.status === "blocked_budget") setAiStatus("blocked");
        else if (r.status === "rejected") setAiStatus("rejected");
        else setAiStatus("error");
      } catch {
        setAiStatus("error");
      }
    });
  };
  const copyAi = () => {
    navigator.clipboard?.writeText(aiText).then(() => {
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1800);
    }).catch(() => {});
  };

  // On-demand FAQPage JSON-LD (LLM answers the grounded fanout questions).
  const [faqStatus, setFaqStatus] = useState<
    "idle" | "pending" | "ok" | "off" | "blocked" | "rejected" | "error"
  >(m.savedFaqJsonLd ? "ok" : "idle"); // hydrate a previously-generated+saved FAQ schema
  const [faqJsonLd, setFaqJsonLd] = useState(m.savedFaqJsonLd ?? "");
  const [faqCopied, setFaqCopied] = useState(false);
  const [cannibalCopied, setCannibalCopied] = useState(false);
  const faqGenerate = () => {
    setFaqStatus("pending");
    startTransition(async () => {
      try {
        const r = await draftMoveFaqAction({ recId: m.id, query: m.query, pageLabel: m.pageLabel, faqs: m.faqs });
        if (r.status === "ok") {
          setFaqJsonLd(r.jsonLd);
          setFaqStatus("ok");
        } else setFaqStatus(r.status === "blocked_budget" ? "blocked" : r.status === "off" ? "off" : r.status === "rejected" ? "rejected" : "error");
      } catch {
        setFaqStatus("error");
      }
    });
  };
  const copyFaq = () => {
    navigator.clipboard?.writeText(faqJsonLd).then(() => {
      setFaqCopied(true);
      setTimeout(() => setFaqCopied(false), 1800);
    }).catch(() => {});
  };

  const hasDraft = Boolean(m.answerBrief || m.faqs.length || m.draftTitle || m.outline.length);
  const buildPasteBlock = (): string => {
    const lines: string[] = [`# ${titleCase(m.query)}  (${m.pageLabel})`];
    if (m.draftTitle) lines.push(`\nTitle: ${m.draftTitle}`);
    if (m.draftMeta) lines.push(`Meta: ${m.draftMeta}`);
    if (m.answerBrief) lines.push(`\nAnswer block (write an 80-150 word direct answer citing 1-2 sources):\n${m.answerBrief}`);
    if (m.outline.length) lines.push(`\nSections to cover:\n${m.outline.map((o) => `- ${o}`).join("\n")}`);
    if (m.faqs.length) lines.push(`\nFAQ to answer:\n${m.faqs.map((q) => `- ${q}`).join("\n")}`);
    if (m.schema.length) lines.push(`\nSchema to add: ${m.schema.join(", ")}`);
    return lines.join("\n");
  };
  const copyDraft = () => {
    navigator.clipboard
      ?.writeText(buildPasteBlock())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  const ship = () => {
    setState("shipped"); // optimistic
    startTransition(async () => {
      try {
        await respondToRecommendation(m.id, "accepted", { targetPageUrl: m.targetUrl, actionType: m.action, query: m.query });
        onAction?.("shipped");
      } catch {
        setState("idle"); // revert on failure
      }
    });
  };

  // Item 15 - "Stage in Wix": one click puts a pushable change into Wix through
  // the existing armed-publish rails (snapshot first, daily cap, Ritz blocked).
  // Only offered when the loader says the site is armed + this change is
  // pushable; the server action re-checks every gate and fails closed to paste.
  const canStage = Boolean(m.staging?.enabled) && !m.alreadyMeasuring && !m.pageMeasuring;
  const [stagedLine, setStagedLine] = useState<string | null>(null);
  const [stageMsg, setStageMsg] = useState<string | null>(null);
  const stage = () => {
    startTransition(async () => {
      setStageMsg(null);
      try {
        const r = await stageMoveInWixAction({ moveId: m.id });
        if (r.staged) {
          setStagedLine(r.receiptLine);
          // Record the same accepted response "Ship it" records, so the loop
          // (confirm live -> measure) continues unchanged. Best-effort: the
          // stage already landed and is snapshot-protected.
          try {
            await respondToRecommendation(m.id, "accepted", { targetPageUrl: m.targetUrl, actionType: m.action, query: m.query });
          } catch { /* the queue can still be actioned from /recommendations */ }
          setState("shipped");
          onAction?.("shipped");
        } else {
          setStageMsg(r.receiptLine);
        }
      } catch {
        setStageMsg("I could not stage this one in Wix, so copy and paste it yourself.");
      }
    });
  };
  const snooze = () => {
    setState("snoozed"); // optimistic
    startTransition(async () => {
      try {
        await respondToRecommendation(m.id, "deferred", { targetPageUrl: m.targetUrl });
        onAction?.("snoozed");
      } catch {
        setState("idle");
      }
    });
  };

  if (state === "shipped") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-status-success/30 bg-status-success-bg px-5 py-4 text-body text-status-success transition-all">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-success text-background">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex-1">
          <div className="font-semibold">{stagedLine ? "Staged in Wix" : "Shipped"} - {titleCase(m.query)}</div>
          {stagedLine ? (
            <div role="status" className="text-meta text-status-success">{stagedLine}</div>
          ) : null}
          <div className="text-meta text-status-success">
            Once it&apos;s live on the page,{" "}
            <Link href={`/results?page=${encodeURIComponent(m.targetUrl)}`} className={`rounded-sm font-semibold underline hover:opacity-80 ${FOCUS}`}>
              confirm it&apos;s live →
            </Link>{" "}
            so Beacon can measure the lift.
          </div>
        </div>
      </div>
    );
  }
  if (state === "snoozed") {
    return (
      <Card variant="quiet" padding="none" className="flex items-center justify-between rounded-2xl px-5 py-3 text-body text-muted-foreground">
        <span>Snoozed “{titleCase(m.query)}”.</span>
        <button onClick={() => setState("idle")} className={`rounded-sm text-meta font-medium text-foreground-secondary hover:text-foreground ${FOCUS}`}>
          Undo
        </button>
      </Card>
    );
  }

  // At-a-glance preparedness (operator Phase 4: show preparedStatus on every card).
  // HONESTY GATE: when a prepared draft exists, its deterministic quality verdict wins
  // over the lifecycle status - a "ready_to_review" pack whose draft is generic/thin/
  // off-topic must NOT show "Prepared". Only a quality-ready draft earns the green pill.
  const q = m.preparedQuality;
  const qualityHidesReady = q && q.status !== "ready";
  // B2 (worklist fix batch) - at most ONE quality pill word ("Needs review"). The precise
  // reason (generic / off-topic / too thin) stays in the expanded detail text below
  // (q.reasons[0]), not as its own list-level pill vocabulary word.
  const preparedPill: { label: string; intent: PillIntent } | null = qualityHidesReady
    ? { label: "Needs review", intent: "waiting" }
    : m.preparedStatus === "ready_to_review" || m.preparedStatus === "draft_ready" || m.preparedStatus === "proof_ready"
      ? { label: "Prepared", intent: "live" }
      : m.preparedStatus === "failed"
        ? { label: "Needs review", intent: "waiting" }
        : m.preparedStatus === "shipped" || m.preparedStatus === "measuring" || m.preparedStatus === "won" || m.preparedStatus === "lost"
          ? null
          : { label: "Ready to draft", intent: "neutral" };

  const proofPillIntent: PillIntent =
    m.proofStatus === "won" ? "won" : m.proofStatus === "measuring" ? "measuring" : "neutral";

  return (
    <Card
      padding="none"
      className={cn(
        "group relative overflow-hidden rounded-2xl p-5 pl-6 shadow-sm ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg",
        tone.ring,
        pending ? "opacity-60" : "",
      )}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${tone.bar}`} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-meta font-semibold text-background">{rank}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${TONE_PILL_CLS[m.actionTone]}`}>{m.actionLabel}</span>
        <Pill intent={conf.intent}>{conf.label}</Pill>
        {preparedPill ? <Pill intent={preparedPill.intent}>{preparedPill.label}</Pill> : null}
        {m.proofStatus ? (
          <Pill intent={proofPillIntent} title="From Results - the last shipped change on this page">
            {m.alreadyMeasuring ? "Already measuring" : m.pageMeasuring ? "Page measuring" : m.proofLabel}
          </Pill>
        ) : null}
        {m.proofStatus === "measuring" && m.targetUrl && m.targetUrl !== "needs_new_page" ? (
          <Link
            href={`/results?page=${encodeURIComponent(m.targetUrl)}`}
            className={`rounded-sm text-meta font-medium text-status-info underline underline-offset-2 hover:opacity-80 ${FOCUS}`}
          >
            View in Results →
          </Link>
        ) : null}
        {m.demand != null && m.demand > 0 ? (
          <Pill intent="neutral">
            {fmtNum(m.demand)} {m.demandBasis === "ai_attention" ? "AI demand" : "monthly demand"}
          </Pill>
        ) : null}
      </div>

      {/* P6 - compounding-edit guard: a page mid-measurement loses proof clarity if you
          ship again now. Name the checkpoint; "Ship anyway" below is already demoted. */}
      {(m.alreadyMeasuring || m.pageMeasuring) ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-status-warning-bg px-2.5 py-1.5 text-meta font-medium text-status-warning ring-1 ring-status-warning/20">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            This page is mid-measurement{m.proofNextCheckpoint ? ` (next read ~${m.proofNextCheckpoint})` : ""} - shipping another change now muddies the proof. Wait for the read, or use “Ship anyway” below.
          </span>
        </p>
      ) : null}

      <h3 className="mt-3 text-section font-semibold leading-snug tracking-tight text-foreground">{titleCase(m.query)}</h3>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        {(() => {
          const href = dossierHref(m.targetUrl);
          return href ? (
            <Link href={href} className={`underline underline-offset-2 hover:text-foreground-secondary ${FOCUS}`}>on {m.pageLabel}</Link>
          ) : (
            <span>on {m.pageLabel}</span>
          );
        })()}
        {m.sparkline && m.sparkline.length >= 5 ? (
          <Sparkline points={m.sparkline} width={72} height={18} className="inline-block align-middle opacity-80" />
        ) : null}
        {m.rankWhy ? <span className="text-muted-foreground/70">· ranked here: {m.rankWhy}</span> : null}
      </p>
      <p className="mt-2 text-body leading-relaxed text-foreground-secondary">{m.why}</p>

      <LearnedMoveLine tag={m.learnedTag} />

      {/* Page-specific learning caution (2026-06-28) - this page's own shipped change
          held-while-measuring / no-lift / lifted. Links to Results when evidence-backed. */}
      {m.outcomeCaution?.label ? (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-meta font-medium ring-1 ${
              m.outcomeCaution.kind === "lifted"
                ? "bg-status-success-bg text-status-success ring-status-success/20"
                : m.outcomeCaution.kind === "no_lift"
                  ? "bg-status-neutral-bg text-status-neutral ring-status-neutral/20"
                  : "bg-status-info-bg text-status-info ring-status-info/20"
            }`}
            title={m.outcomeCaution.reason ?? undefined}
          >
            <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden /> {m.outcomeCaution.label}
          </span>
          {m.outcomeCaution.evidence.length && m.targetUrl && m.targetUrl !== "needs_new_page" ? (
            <Link
              href={`/results?page=${encodeURIComponent(m.targetUrl)}`}
              className={`rounded-sm text-meta font-medium text-status-info underline underline-offset-2 hover:opacity-80 ${FOCUS}`}
            >
              View in Results →
            </Link>
          ) : null}
          {/* After a no-lift loss, the deterministic "try a different lever" next action
              so the settled failure becomes a better next move, not just a demote. */}
          {m.outcomeCaution.nextLever ? (
            <span className="flex w-full items-start gap-1 text-meta leading-snug text-muted-foreground">
              <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {m.outcomeCaution.nextLever}
            </span>
          ) : null}
        </span>
      ) : null}

      {/* PageResearchPack v1 (2026-06-29) - the per-page "what should this page own"
          research summary: intent ownership (own vs cross-link sibling) + the proof-aware
          primary lever + proof-blocked levers. The senior-strategist read, up top. */}
      {m.researchPack && (m.researchPack.own.length || m.researchPack.sibling.length || m.researchPack.primaryLever) ? (() => {
        const LL: Record<string, string> = {
          title_meta: "sharpen title & meta",
          answer_block: "add an answer block",
          internal_links: "add internal links",
          content_depth: "deepen the content",
          ux_fix: "fix the page UX",
          schema: "add schema",
          wait: "wait for measurement",
        };
        const lab = (l: string) => LL[l] ?? l;
        // Map the raw SERP-format slug to plain words - never render the bare
        // slug ("table"/"ugc") to a paying customer.
        const FORMAT_PLAIN: Record<string, string> = {
          table: "a comparison table",
          list: "a scannable list",
          ugc: "real user answers",
          faq: "an FAQ",
          guide: "a step-by-step guide",
          product: "a product or shop page",
          mixed: "a clear answer plus structured sections",
        };
        const fmtPlain = (f: string) => FORMAT_PLAIN[f] ?? f;
        const rp = m.researchPack;
        return (
          <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2">
            <div className="text-meta font-semibold uppercase tracking-wide text-violet-600">Research - what this page should own</div>
            {typeof rp.addressableVolume === "number" && rp.addressableVolume > 0 ? (
              <p className="mt-1 text-body text-violet-900">
                <span className="font-semibold">Addressable demand:</span>{" "}
                <span title={`${formatMetric(rp.addressableVolume)} searches a month across this page's queries`}>~{formatMetricCompact(rp.addressableVolume)} searches/mo</span>
              </p>
            ) : null}
            {rp.serpPattern ? (
              <p className="mt-1 text-meta text-violet-800">
                <span className="font-semibold">What Google is rewarding:</span> {fmtPlain(rp.serpPattern.format)}: {stripBannedDashes(rp.serpPattern.elementImplication)}
                {rp.serpPattern.winningDomains.length ? <span className="text-violet-500"> · winners: {rp.serpPattern.winningDomains.join(", ")}</span> : null}
              </p>
            ) : null}
            {rp.own.length ? (
              <p className="mt-1 text-body text-violet-900"><span className="font-semibold">Own:</span> {rp.own.join(", ")}</p>
            ) : null}
            {rp.sibling.length ? (
              <p className="mt-0.5 text-body text-violet-700"><span className="font-semibold">Cross-link, don&apos;t merge:</span> {rp.sibling.join(", ")}</p>
            ) : null}
            {rp.onPagePlan?.doFirst ? (
              <div className="mt-1.5 border-t border-violet-100 pt-1.5">
                <p className="text-meta text-violet-900"><ChevronRight className="inline-block h-3.5 w-3.5" aria-hidden /> <span className="font-semibold">Do first:</span> {rp.onPagePlan.doFirst.recommendation}</p>
                <p className="text-meta text-violet-500">{rp.onPagePlan.doFirst.evidence}</p>
                {rp.onPagePlan.sections.length ? (
                  <p className="mt-1 text-meta text-violet-800"><span className="font-medium">Add sections:</span> {rp.onPagePlan.sections.map((s) => s.recommendation).join(" ")}</p>
                ) : null}
                {rp.onPagePlan.faqs.length ? (
                  <p className="mt-0.5 text-meta text-violet-800"><span className="font-medium">FAQ targets:</span> {rp.onPagePlan.faqs.map((f) => f.recommendation).join(" ")}</p>
                ) : null}
                {rp.onPagePlan.warnings.length ? (
                  <p className="mt-1 text-meta text-status-warning"><TriangleAlert className="inline-block h-3.5 w-3.5" aria-hidden /> {rp.onPagePlan.warnings[0]}</p>
                ) : null}
              </div>
            ) : rp.primaryLever ? (
              <p className="mt-1 text-meta text-violet-800"><ChevronRight className="inline-block h-3.5 w-3.5" aria-hidden /> Do first: <span className="font-medium">{lab(rp.primaryLever.lever)}</span></p>
            ) : null}
            {rp.blockedLevers.length ? (
              <p className="mt-0.5 text-meta text-muted-foreground"><X className="inline-block h-3.5 w-3.5" aria-hidden /> Skip (proof says flat): {rp.blockedLevers.map((b) => lab(b.lever)).join(", ")}</p>
            ) : null}
          </div>
        );
      })() : null}

      {/* Connectedness (2026-06-28) - the canonical ActionPack evidence provenance
          + cached DataForSEO SERP verdict, threaded onto the card operators use
          (was computed on the pack but never shown outside diagnostics). */}
      {(m.sourceChips?.length || m.dataforseoVerdict || m.competitorInformed) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.competitorInformed ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-meta font-bold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200"
              title={`This draft was rewritten using ${m.competitorInformed.domain} - the page that currently wins this topic.`}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden /> Competitor-informed
            </span>
          ) : null}
          {m.dataforseoVerdict ? (
            <Pill
              intent={m.dataforseoVerdict.verdict === "build" ? "live" : m.dataforseoVerdict.verdict === "wait" ? "waiting" : "neutral"}
              className="font-bold uppercase tracking-wide"
              title={m.dataforseoVerdict.topDomains.length ? `Google top results: ${m.dataforseoVerdict.topDomains.join(", ")}` : undefined}
            >
              Google: {m.dataforseoVerdict.verdict}
              {m.dataforseoVerdict.overlap > 0 ? (
                <span className="font-medium normal-case"> · {m.dataforseoVerdict.overlap} AI-cited rival{m.dataforseoVerdict.overlap === 1 ? "" : "s"} rank</span>
              ) : null}
            </Pill>
          ) : null}
          {(m.sourceChips ?? []).map((s) => (
            <Pill key={s} intent="neutral">
              {SOURCE_LABEL[s] ?? s}
            </Pill>
          ))}
        </div>
      ) : null}

      {/* RANK-3: the honest live Google-results winnability line. Held moves get the
          warning treatment (I am holding this), winnable moves the success
          treatment (worth doing). Tokens only (status-warning / status-success),
          no raw palette - design-system-guard enforces it. Only renders when a
          live Google-results check produced a verdict.
          #17 contradiction fix: while this page is mid-measurement the card already
          shows the amber "wait, do not ship" banner above, so a green "worth doing"
          line here would contradict it. Suppress the non-held (success) line while
          measuring; keep the amber held line, which agrees with "wait". */}
      {m.winnabilityLine && (m.winnabilityHeld || !(m.alreadyMeasuring || m.pageMeasuring)) ? (
        <div
          className={
            m.winnabilityHeld
              ? "mt-2 flex items-start gap-1.5 rounded-lg border border-status-warning/25 bg-status-warning-bg px-3 py-2 text-body text-status-warning"
              : "mt-2 flex items-start gap-1.5 rounded-lg border border-status-success/25 bg-status-success-bg px-3 py-2 text-body text-status-success"
          }
        >
          {m.winnabilityHeld ? (
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Zap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{stripBannedDashes(m.winnabilityLine)}</span>
        </div>
      ) : null}

      {m.preparedChecklist ? (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {m.preparedChecklist.readyToReview ? (
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-meta font-bold uppercase tracking-wide text-background">Ready to review</span>
            ) : m.preparedStale ? (
              <Pill intent="waiting" className="font-semibold">Re-prepare (data changed)</Pill>
            ) : null}
            {(
              [
                ["Google checked", m.preparedChecklist.googleChecked],
                ["AI checked", m.preparedChecklist.aiChecked],
                ["Competitors read", m.preparedChecklist.competitorsRead],
                // "Draft prepared" only counts a QUALITY-passing draft - a generic/thin
                // draft must not show ✓ here while the pill says "Generic draft".
                ["Draft prepared", m.preparedChecklist.draftPrepared && (!q || q.copyAllowed)],
                ["Proof plan ready", m.preparedChecklist.proofPlanReady && (!q || q.copyAllowed)],
              ] as const
            ).map(([label, ok]) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium ${ok ? "bg-status-success-bg text-status-success ring-1 ring-status-success/20" : "bg-status-neutral-bg text-muted-foreground"}`}
              >
                {ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />} {label}
              </span>
            ))}
          </div>
          {m.preparedDraftText ? (
            (() => {
              const copyOk = q ? q.copyAllowed : true;
              const label =
                m.preparedDraftKind === "atomic_edit" ? "Prepared title" : "Prepared answer block";
              return (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-meta font-semibold uppercase tracking-wide text-indigo-500">
                      {label}{copyOk ? " - paste-ready" : ""}
                    </div>
                    {copyOk ? (
                      <button
                        type="button"
                        onClick={copyPrepared}
                        className={`inline-flex items-center gap-1 rounded border border-indigo-200 bg-card px-1.5 py-0.5 text-meta font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 ${FOCUS}`}
                      >
                        {copiedPrepared ? <>Copied<Check className="h-3.5 w-3.5" aria-hidden /></> : "Copy"}
                      </button>
                    ) : null}
                  </div>
                  {q && q.status !== "ready" && q.reasons[0] ? (
                    <p className="mt-0.5 text-meta text-status-warning">{q.reasons[0]}</p>
                  ) : null}
                  {m.competitorInformed ? (
                    <p className="mt-0.5 text-meta text-violet-700">Improved using the page that currently wins: {m.competitorInformed.domain}</p>
                  ) : null}
                  <p className={`mt-0.5 rounded-lg p-2 text-meta leading-relaxed ring-1 ${copyOk ? "bg-card text-foreground-secondary ring-indigo-100" : "bg-surface-inset text-muted-foreground ring-border"}`}>{m.preparedDraftText}</p>
                </div>
              );
            })()
          ) : null}
          {m.preparedExperiment ? (
            <p className="mt-1.5 text-meta text-muted-foreground">
              <span className="font-semibold text-foreground-secondary">What we expect:</span> {m.preparedExperiment}
            </p>
          ) : null}
        </div>
      ) : null}

      {m.debate && m.debate.voices.length > 0 ? (
        <details open className="mt-3 rounded-xl border border-border bg-card px-3 py-2">
          <summary className={`cursor-pointer list-none rounded text-meta font-semibold text-foreground-secondary hover:text-foreground ${FOCUS}`}>
            <ChevronDown className="inline-block h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Your team on this move
            <span className="ml-1.5 font-normal text-muted-foreground">{m.debate.headline}</span>
          </summary>
          <div className="mt-2 space-y-1.5">
            {m.debate.voices.map((v) => (
              <div key={v.specialist} className="flex items-baseline gap-2 text-meta">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-meta font-semibold"
                  style={{ background: teammateOf(v.specialist).bg, color: teammateOf(v.specialist).text }}
                >{v.label}</span>
                <span className="text-foreground-secondary">{v.claim}</span>
                <span className="ml-auto shrink-0 text-meta text-muted-foreground">{v.confidencePct}%</span>
              </div>
            ))}
            {m.debate.objections.map((o, i) => (
              <div key={`obj-${i}`} className="flex items-baseline gap-2 text-meta">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-semibold ${o.severity === "veto" ? "bg-status-danger-bg text-status-danger" : "bg-status-warning-bg text-status-warning"}`}>
                  {o.severity === "veto" ? "Blocks" : "Caution"} · {o.label}
                </span>
                <span className="text-foreground-secondary">{o.reason}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-surface-raised px-3 py-2.5">
          <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">Who AI cites now</div>
          <div className="mt-0.5 text-body font-medium text-foreground-secondary">
            {m.whoCited ? (
              m.whoCited
            ) : m.looselyMatched ? (
              <span className="text-muted-foreground">AI cites a tangential page - confirm with a quick search</span>
            ) : (
              <span className="text-status-success">Open - no one owns this yet</span>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-surface-raised px-3 py-2.5">
          <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">What wins</div>
          <div className="mt-0.5 text-body font-medium text-foreground-secondary">
            {m.whatWins ? stripBannedDashes(m.whatWins) : <span className="text-muted-foreground">Add a clear, quotable answer up top</span>}
          </div>
          {m.competitorSteal ? (
            <div className="mt-1 text-meta text-muted-foreground">
              <span className="font-semibold text-foreground-secondary">Steal this:</span> {stripBannedDashes(m.competitorSteal)}
            </div>
          ) : null}
          {stealPassage ? (
            <div className="mt-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-meta leading-relaxed text-foreground-secondary">
              <span className="font-semibold text-foreground-secondary">The exact words the AI used: </span>
              &quot;{stripBannedDashes(stealPassage.text)}&quot;
              {stealPassage.engine ? <span className="text-muted-foreground"> ({stealPassage.engine})</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* G3 (Wave 4, 2026-07-11) - "Who wins this topic now": the deduped Google+AI
          winner list the engine already computes (fuseTeardownTargets) but never
          rendered anywhere - the operator had to piece it together by hand. Render-only
          over already-persisted evidence; collapsed by default so it never competes
          with the single "What wins" line above for attention. Self-hides entirely
          when there is no competitor/Google evidence to fuse. */}
      {m.winners && m.winners.length > 0 ? (() => {
        // Defensive cap: buildWinnersPanel already caps at 5, sliced again here so the
        // card can never balloon into a second SERP even if an upstream caller changes.
        const winners = m.winners.slice(0, 5);
        return (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
          <summary className={`cursor-pointer text-meta font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground ${FOCUS}`}>
            Who wins this topic now ({winners.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {winners.map((w) => (
              <li key={w.domain} className="rounded-lg bg-card px-2.5 py-2 ring-1 ring-border">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-foreground-secondary">{w.domain}</span>
                  {w.overlap ? (
                    // "live" (not "won") - this describes the winner's citation
                    // strength, not a proven win for the operator's own move. Matches
                    // the SAME green treatment the dataforseoVerdict pill above already
                    // uses for "Google confirms an AI-cited rival ranks."
                    <Pill intent="live">Google AND AI pick this one</Pill>
                  ) : w.sources.includes("google") ? (
                    <Pill intent="neutral">Ranks in Google results</Pill>
                  ) : (
                    <Pill intent="neutral">AI cites this page</Pill>
                  )}
                  {w.collectedLabel ? <span className="text-meta text-muted-foreground">{w.collectedLabel}</span> : null}
                </div>
                <div className="mt-0.5 text-meta text-foreground-secondary">
                  {w.whyPlain ?? <span className="text-muted-foreground">I have not read this page yet</span>}
                </div>
              </li>
            ))}
          </ul>
        </details>
        );
      })() : null}

      {/* G9 (Wave 4, 2026-07-11) - "What else I considered": the router's own
          debate (MoveRouterDecision.appliedObjections + .dissenting) already
          decides this Move by ruling alternatives out and hearing dissenting
          teammates, but that argument never rendered anywhere - the operator
          had to reconstruct WHY the chosen action beat the alternatives by hand.
          Render-only over the already-persisted decision; collapsed by default,
          same as the winners panel above, so it never competes with the primary
          action for attention. Self-hides entirely when the move has no vetoed
          alternative and no dissenting voice (honest absence, not a placeholder -
          this is supplementary reasoning, not a primary field). */}
      {m.whatElseIConsidered && (m.whatElseIConsidered.alternatives.length > 0 || m.whatElseIConsidered.dissentLine) ? (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
          <summary className={`cursor-pointer text-meta font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground ${FOCUS}`}>
            What else I considered
          </summary>
          <ul className="mt-2 space-y-1.5">
            {m.whatElseIConsidered.alternatives.slice(0, 3).map((line, i) => (
              <li key={`alt-${i}`} className="text-meta text-foreground-secondary">
                {line}
              </li>
            ))}
            {m.whatElseIConsidered.dissentLine ? (
              <li className="text-meta text-foreground-secondary">{m.whatElseIConsidered.dissentLine}</li>
            ) : null}
          </ul>
        </details>
      ) : null}

      {m.ga4 || m.friction ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {m.ga4 ? (
            <Pill intent="live">
              {(m.ga4.sessions ?? 0).toLocaleString()} visits / 28d
              {(m.ga4.conversions ?? 0) > 0 ? ` · ${(m.ga4.conversions ?? 0).toLocaleString()} conversions` : ""} (GA4)
            </Pill>
          ) : null}
          {m.friction ? (
            <Pill
              intent="waiting"
              title={`Microsoft Clarity: ${m.friction.deadPct ?? 0}% of sessions had dead clicks, ${m.friction.ragePct ?? 0}% rage clicks - visitors are hitting friction on this page.`}
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {m.friction.deadPct ?? 0}% dead clicks{(m.friction.ragePct ?? 0) > 0 ? ` · ${m.friction.ragePct ?? 0}% rage` : ""} (Clarity)
            </Pill>
          ) : null}
        </div>
      ) : null}

      {m.topQueries.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-meta font-semibold uppercase tracking-wide text-status-info">Ranks for</span>
          {m.topQueries.map((q) => (
            <Pill
              key={q.query}
              intent={q.strikingDistance ? "waiting" : "measuring"}
              title={
                q.strikingDistance
                  ? `Striking distance - ranks position ${q.position.toFixed(1)} for ${q.impressions.toLocaleString()} monthly impressions; climbing a few spots captures outsized clicks.`
                  : `${q.impressions.toLocaleString()} impressions · ${q.clicks.toLocaleString()} clicks · avg position ${q.position.toFixed(1)}`
              }
            >
              {q.strikingDistance ? <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              <span className="font-medium">{q.query}</span>
              <span>
                pos {q.position.toFixed(1)} · {fmtNum(q.impressions)} impr
              </span>
            </Pill>
          ))}
        </div>
      ) : null}

      {/* P19 rank-to-visits clarity line (2026-07-03) - turns the top
          striking-distance query's rank + monthly impressions the card already
          shows into a concrete "worth about N more visits a month" for climbing
          to #3. Display-only, reuses the pure rankToVisits scorer; renders
          nothing (byte-identical) when no query has a real rank + impressions to
          size a genuine move up from. */}
      {(() => {
        const seed = m.topQueries.find((q) => q.strikingDistance);
        if (!seed) return null;
        const r = rankToVisits({
          currentPosition: seed.position,
          targetPosition: 3,
          monthlyImpressions: seed.impressions,
        });
        if (r.monthlyGain == null || r.monthlyGain <= 0) return null;
        return (
          <p className="mt-1.5 text-meta text-muted-foreground">
            <span className="font-semibold text-foreground-secondary">Worth it:</span>{" "}
            {r.sentence}
          </p>
        );
      })()}

      {m.declines.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-meta font-semibold uppercase tracking-wide text-status-danger">Losing ground</span>
          {m.declines.map((d) => (
            <Pill
              key={d.query}
              intent="attention"
              title={`Clicks fell ${d.dropPct}% (${d.priorClicks.toLocaleString()} → ${d.recentClicks.toLocaleString()}) vs the prior 28 days${d.positionSlip >= 1 ? `; slipped ${d.positionSlip.toFixed(1)} positions` : ""}.`}
            >
              <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-medium">{d.query}</span>
              <span>−{d.dropPct}% clicks</span>
            </Pill>
          ))}
        </div>
      ) : null}

      {m.cannibalization.length > 0 ? (
        <div className="mt-3 rounded-xl border border-status-warning/20 bg-status-warning-bg px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta font-semibold uppercase tracking-wide text-status-warning">Competing with yourself</span>
            {m.cannibalization.map((c) => {
              // Show a DISTINCT competing page, never "iran animals vs your iran
              // animals" - that collision happens when the other page's label equals
              // the query. Fall back to an honest count when every other page collides.
              const distinct = c.otherPages.find((o) => o.toLowerCase() !== c.query.toLowerCase()) ?? null;
              return (
                <span
                  key={c.query}
                  className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-0.5 text-meta text-status-warning ring-1 ring-status-warning/20"
                  title={c.fix}
                >
                  <Swords className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="font-medium">{c.query}</span>
                  <span>
                    {distinct
                      ? `vs your ${distinct}${c.otherPages.length > 1 ? ` +${c.otherPages.length - 1}` : ""}`
                      : `· split across ${c.otherPages.length + 1} of your pages`}
                  </span>
                </span>
              );
            })}
          </div>
          {/* The consolidation ACTION for the top case, in plain language. When the
              Research Pack above already classified these as cross-link SIBLINGS, defer
              to it - never show "fold X into it" while the research module says
              "cross-link, don't merge" (that contradiction is the boy/girl-names bug). */}
          {m.researchPack?.sibling?.length ? (
            <p className="mt-1.5 text-body text-status-warning">Keep these as separate pages and cross-link them (below) - don&apos;t merge. See &ldquo;what this page should own&rdquo; above.</p>
          ) : (
            <p className="mt-1.5 text-body text-status-warning">{m.cannibalization[0]!.fix}</p>
          )}
          {m.cannibalization[0]!.linkSnippet ? (
            <div className="mt-1.5 flex items-center gap-2">
              <code className="truncate rounded bg-card px-2 py-1 text-meta text-status-warning ring-1 ring-status-warning/20">
                {m.cannibalization[0]!.linkSnippet}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(m.cannibalization[0]!.linkSnippet!).then(() => {
                    setCannibalCopied(true);
                    setTimeout(() => setCannibalCopied(false), 1800);
                  }).catch(() => {});
                }}
                className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-status-warning px-2 py-1 text-meta font-semibold text-background hover:opacity-90 ${FOCUS}`}
              >
                {cannibalCopied ? <>Copied<Check className="h-3.5 w-3.5" aria-hidden /></> : "Copy link"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {m.yourGap ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-status-danger/20 bg-status-danger-bg px-3 py-2">
          <span className="mt-0.5 text-meta font-semibold uppercase tracking-wide text-status-danger">Your gap</span>
          <span className="text-body font-medium text-status-danger">{m.yourGap}</span>
        </div>
      ) : !m.whatWins ? (
        // G3 (Wave 4) - honest absence: no teardown has run for this move at all, so
        // there is no real comparison to state as "your gap" (never a fabricated one).
        // Only shows when whatWins is ALSO absent - if a teardown ran and simply found
        // nothing notable, yourGap stays silently empty (that's a real result, not a
        // missing comparison), so this line never contradicts a completed teardown.
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2">
          <span className="text-body text-muted-foreground">I have not compared this page against the winners yet.</span>
          <CompareAgainstWinnersButton />
        </div>
      ) : null}

      {m.outline.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">Cover</span>
          {m.outline.map((o) => (
            <Pill key={o} intent="neutral">{o}</Pill>
          ))}
        </div>
      ) : null}

      {m.titleVariants.length > 0 ? (
        <div className="mt-4 rounded-xl border border-status-info/20 bg-status-info-bg p-3">
          <div className="text-meta font-semibold uppercase tracking-wide text-status-info/70">
            Title options · pick one, copy, paste
          </div>
          <ul className="mt-2 space-y-1.5">
            {m.titleVariants.map((v, i) => (
              <li
                key={v.title}
                className="rounded-lg bg-card px-2.5 py-1.5 ring-1 ring-border"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-meta text-foreground-secondary" title={v.title}>
                    {i === 0 ? <span className="mr-1 text-meta font-bold text-status-info">BEST</span> : null}
                    {v.title}
                  </span>
                  <button
                    onClick={() => copyTitle(i, v.title)}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground px-2 py-0.5 text-meta font-semibold text-background transition-colors hover:opacity-80 ${FOCUS}`}
                  >
                    {copiedTitle === i ? <>Copied<Check className="h-3.5 w-3.5" aria-hidden /></> : "Copy"}
                  </button>
                </div>
                {v.reason ? (
                  <p className="mt-0.5 text-meta leading-snug text-muted-foreground">{v.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {m.also.length > 0 ? (
        <p className="mt-3 text-meta text-muted-foreground">
          <span className="font-semibold text-muted-foreground">While you&apos;re on this page, also:</span>{" "}
          {m.also.join(" · ")}
        </p>
      ) : null}

      {m.proof ? (
        <p className="mt-3 flex items-start gap-1.5 text-meta text-muted-foreground">
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
          {m.proof}
        </p>
      ) : null}

      {showDraft && hasDraft ? (
        <div className="mt-3 rounded-xl border border-border bg-surface-raised/80 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
              Paste-ready draft · grounded, no AI guesses
            </span>
            <button
              onClick={copyDraft}
              className={`inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-meta font-semibold text-background transition-colors hover:opacity-80 ${FOCUS}`}
            >
              {copied ? <>Copied<Check className="h-3.5 w-3.5" aria-hidden /></> : "Copy draft"}
            </button>
          </div>
          <dl className="space-y-2 text-meta">
            {m.draftTitle ? (
              <div>
                <dt className="font-semibold text-muted-foreground">Title</dt>
                <dd className="text-foreground-secondary">{m.draftTitle}</dd>
              </div>
            ) : null}
            {m.answerBrief ? (
              <div>
                <dt className="font-semibold text-muted-foreground">Answer block</dt>
                <dd className="text-foreground-secondary">{m.answerBrief}</dd>
              </div>
            ) : null}
            {m.faqs.length ? (
              <div>
                <dt className="font-semibold text-muted-foreground">FAQ to answer</dt>
                <dd>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-foreground-secondary">
                    {m.faqs.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {m.schema.length ? (
              <div>
                <dt className="font-semibold text-muted-foreground">Schema to add</dt>
                <dd className="text-foreground-secondary">{m.schema.join(", ")}</dd>
              </div>
            ) : null}
          </dl>

          {m.actionTone === "citation" ? (
            <div className="mt-3 border-t border-border pt-3">
              {aiStatus === "ok" ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-meta font-semibold uppercase tracking-wide text-violet-500">
                      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden /> AI-written answer block
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={aiGenerate}
                        disabled={pending}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta font-medium text-muted-foreground hover:text-violet-600 disabled:opacity-60 ${FOCUS}`}
                        title="Generate a fresh draft"
                      >
                        {pending ? "…" : <><RefreshCw className="h-3.5 w-3.5" aria-hidden />Regenerate</>}
                      </button>
                      <button
                        onClick={copyAi}
                        className={`inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-meta font-semibold text-background transition-colors hover:bg-violet-500 ${FOCUS}`}
                      >
                        {aiCopied ? <>Copied<Check className="h-3.5 w-3.5" aria-hidden /></> : "Copy"}
                      </button>
                    </div>
                  </div>
                  <p className="rounded-lg bg-card p-2.5 text-body leading-relaxed text-foreground-secondary ring-1 ring-violet-100">
                    {aiText}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={aiGenerate}
                    disabled={pending || aiStatus === "pending"}
                    className={`inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-body font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60 ${FOCUS}`}
                  >
                    {aiStatus === "pending" ? "Writing…" : <><Sparkles className="h-3.5 w-3.5" aria-hidden />Draft with AI</>}
                  </button>
                  {aiStatus === "off" ? (
                    <span className="text-meta text-muted-foreground">AI drafting is off - using the outline above.</span>
                  ) : aiStatus === "blocked" ? (
                    <span className="text-meta text-status-warning">Monthly AI budget reached.</span>
                  ) : aiStatus === "rejected" ? (
                    <span className="text-meta text-status-warning">Draft failed the fact-safety check - use the outline.</span>
                  ) : aiStatus === "error" ? (
                    <span className="text-meta text-muted-foreground">Couldn&apos;t draft right now - use the outline.</span>
                  ) : null}
                </div>
              )}

              {m.faqs.length > 0 ? (
                <div className="mt-3">
                  {faqStatus === "ok" ? (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-meta font-semibold uppercase tracking-wide text-violet-500"><Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden /> FAQ schema (JSON-LD)</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={faqGenerate}
                            disabled={pending}
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta font-medium text-muted-foreground hover:text-violet-600 disabled:opacity-60 ${FOCUS}`}
                            title="Generate a fresh FAQ schema"
                          >
                            {pending ? "…" : <><RefreshCw className="h-3.5 w-3.5" aria-hidden />Regenerate</>}
                          </button>
                          <button onClick={copyFaq} className={`inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-meta font-semibold text-background hover:bg-violet-500 ${FOCUS}`}>
                            {faqCopied ? <>Copied<Check className="h-3.5 w-3.5" aria-hidden /></> : "Copy JSON-LD"}
                          </button>
                        </div>
                      </div>
                      <pre className="max-h-44 overflow-auto rounded-lg bg-foreground p-2.5 text-meta leading-relaxed text-background">{faqJsonLd}</pre>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={faqGenerate}
                        disabled={pending || faqStatus === "pending"}
                        className={`inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-body font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60 ${FOCUS}`}
                      >
                        {faqStatus === "pending" ? "Generating…" : <><Sparkles className="h-3.5 w-3.5" aria-hidden />Generate FAQ schema</>}
                      </button>
                      {faqStatus === "off" ? (
                        <span className="text-meta text-muted-foreground">AI drafting is off.</span>
                      ) : faqStatus === "blocked" ? (
                        <span className="text-meta text-status-warning">Monthly AI budget reached.</span>
                      ) : faqStatus === "rejected" || faqStatus === "error" ? (
                        <span className="text-meta text-muted-foreground">Couldn&apos;t generate - try later.</span>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3 border-t border-border-subtle pt-3">
        {/* Item 15 - the primary apply affordance becomes "Stage in Wix" when the
            site is armed and this change is pushable; Ship it stays as the manual
            fallback ("I did it myself"). */}
        {canStage ? (
          <button
            onClick={stage}
            disabled={pending}
            className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-body font-semibold text-background transition-colors disabled:opacity-60 ${tone.btn} ${FOCUS}`}
            title="I make this change in Wix for you and save the old version first, so one click restores it."
          >
            <Zap className="h-3.5 w-3.5" aria-hidden />Stage in Wix
          </button>
        ) : null}
        {/* Already mid-measurement on this exact page+action: a second ship would
            contaminate the open proof window - demote Ship, don't block it. */}
        <button
          onClick={ship}
          disabled={pending}
          className={
            m.alreadyMeasuring || m.pageMeasuring || canStage
              ? `inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3.5 py-1.5 text-body font-semibold text-foreground-secondary transition-colors hover:bg-surface-raised disabled:opacity-60 ${FOCUS}`
              : `inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-body font-semibold text-background transition-colors disabled:opacity-60 ${tone.btn} ${FOCUS}`
          }
          title={
            m.alreadyMeasuring
              ? "This page+change is already measuring - shipping again would muddy the proof window"
              : m.pageMeasuring
                ? "This page is mid-measurement on another change - a second change muddies the open proof window"
                : canStage
                  ? "Applied the change yourself? Click this and I start the measure loop."
                  : undefined
          }
        >
          {m.alreadyMeasuring || m.pageMeasuring ? "Ship anyway" : canStage ? "I did it myself" : <><Zap className="h-3.5 w-3.5" aria-hidden />Ship it</>}
        </button>
        {hasDraft ? (
          <button
            onClick={() => setShowDraft((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-sm text-body font-medium text-foreground-secondary hover:text-foreground ${FOCUS}`}
          >
            {showDraft ? "Hide draft" : "See the draft"}
          </button>
        ) : null}
        <Link href="/recommendations" className={`inline-flex items-center gap-1 rounded-sm text-body font-medium text-foreground-secondary hover:text-foreground ${FOCUS}`}>
          Open in queue →
        </Link>
        <a href={m.targetUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 rounded-sm text-body font-medium text-muted-foreground hover:text-foreground-secondary ${FOCUS}`}>
          View page<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
        {/* Item 45 - deep link straight into the Wix editor for this page's mapped
            CMS item (or its Stores product editor). Null renders nothing: never a
            dead link. Read-only affordance, no auto-action. */}
        {m.wixEditorUrl ? (
          <a href={m.wixEditorUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 rounded-sm text-body font-medium text-muted-foreground hover:text-foreground-secondary ${FOCUS}`}>
            Open in Wix<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
        <button onClick={snooze} disabled={pending} className={`ml-auto rounded-sm text-body font-medium text-muted-foreground hover:text-foreground-secondary disabled:opacity-60 ${FOCUS}`}>
          Not now
        </button>
        <button
          onClick={() => {
            setState("snoozed"); // optimistic collapse (reuses the snoozed shell)
            startTransition(async () => {
              try {
                await respondToRecommendation(m.id, "dismissed", { targetPageUrl: m.targetUrl });
              } catch {
                setState("idle");
              }
            });
          }}
          disabled={pending}
          className={`rounded-sm text-body font-medium text-muted-foreground/70 hover:text-status-danger disabled:opacity-60 ${FOCUS}`}
          title="Permanently remove this move"
        >
          Not relevant
        </button>
      </div>

      {/* Item 15 - the paste flow stays the visible fallback next to staging. */}
      {canStage ? (
        <p className="mt-1.5 text-meta text-muted-foreground">
          Stage in Wix makes this change for you and saves the old version first, or copy and paste it yourself and click I did it myself.
        </p>
      ) : null}
      {stageMsg ? (
        <p role="status" aria-live="polite" className="mt-1.5 text-meta text-status-warning">{stageMsg}</p>
      ) : null}
      {/* Item 15 - quiet nudge: this change is pushable, but publishing is not armed. */}
      {m.staging?.nudge && !canStage ? (
        <p className="mt-1.5 text-meta text-muted-foreground">
          I can put this change into Wix for you.{" "}
          <Link href="/settings/connectors" className={`rounded-sm font-medium underline underline-offset-2 hover:text-foreground-secondary ${FOCUS}`}>
            Turn on publishing
          </Link>{" "}
          and it becomes one click.
        </p>
      ) : null}
    </Card>
  );
}

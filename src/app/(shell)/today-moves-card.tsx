"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { respondToRecommendation } from "./recommendation-actions";
import { draftMoveAnswerBlockAction, draftMoveFaqAction } from "./today-moves-actions";
import type { TodayMove } from "./today-moves-data";

/**
 * today-moves-card (2026-06-24) — the interactive §7 Move card. One-tap "Ship it"
 * records an accepted response (the same server action /recommendations uses) with
 * optimistic UI: the card flips to a celebratory "shipping → measuring" state
 * instantly, the action persists + revalidates "/", and the loader then drops the
 * Move on the next render. "Not now" snoozes it. Pure presentation + one action;
 * no Wix, no new writes beyond the existing response store.
 */

const TONE: Record<
  TodayMove["actionTone"],
  { bar: string; pill: string; ring: string; dot: string; btn: string }
> = {
  citation: {
    bar: "bg-gradient-to-b from-violet-500 to-indigo-500",
    pill: "bg-violet-50 text-violet-700 ring-violet-200",
    ring: "hover:ring-violet-200",
    dot: "bg-violet-500",
    btn: "bg-violet-600 hover:bg-violet-500",
  },
  clicks: {
    bar: "bg-gradient-to-b from-sky-500 to-blue-600",
    pill: "bg-sky-50 text-sky-700 ring-sky-200",
    ring: "hover:ring-sky-200",
    dot: "bg-sky-500",
    btn: "bg-blue-600 hover:bg-blue-500",
  },
  experience: {
    bar: "bg-gradient-to-b from-amber-400 to-orange-500",
    pill: "bg-amber-50 text-amber-700 ring-amber-200",
    ring: "hover:ring-amber-200",
    dot: "bg-amber-500",
    btn: "bg-orange-600 hover:bg-orange-500",
  },
  page: {
    bar: "bg-gradient-to-b from-emerald-400 to-green-600",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ring: "hover:ring-emerald-200",
    dot: "bg-emerald-500",
    btn: "bg-emerald-600 hover:bg-emerald-500",
  },
};

const CONF: Record<TodayMove["confidence"], { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  medium: { label: "Medium confidence", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  low: { label: "Worth a look", cls: "bg-gray-100 text-gray-600 ring-gray-200" },
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** Friendly labels for the ActionPack evidence-source provenance chips (the
 *  "Ranked by …" transparency the customer card now shows, not just diagnostics). */
const SOURCE_LABEL: Record<string, string> = {
  gsc: "Google Search",
  ga4: "Analytics",
  clarity: "Clarity UX",
  profound: "AI citations",
  dataforseo: "Live SERP",
  competitor_teardown: "Competitor teardown",
  rank_revenue: "Demand graph",
};

export function MoveCard({ m, rank }: { m: TodayMove; rank: number }) {
  const tone = TONE[m.actionTone];
  const conf = CONF[m.confidence];
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
    if (m.answerBrief) lines.push(`\nAnswer block (write a 40–60 word direct answer):\n${m.answerBrief}`);
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
      } catch {
        setState("idle"); // revert on failure
      }
    });
  };
  const snooze = () => {
    setState("snoozed"); // optimistic
    startTransition(async () => {
      try {
        await respondToRecommendation(m.id, "deferred", { targetPageUrl: m.targetUrl });
      } catch {
        setState("idle");
      }
    });
  };

  if (state === "shipped") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 text-sm text-emerald-800 transition-all">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
        <div className="flex-1">
          <div className="font-semibold">Shipped — {titleCase(m.query)}</div>
          <div className="text-xs text-emerald-700">
            Once it&apos;s live on the page,{" "}
            <Link href={`/proof?page=${encodeURIComponent(m.targetUrl)}`} className="font-semibold underline hover:text-emerald-900">
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
      <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-5 py-3 text-sm text-gray-500">
        <span>Snoozed “{titleCase(m.query)}”.</span>
        <button onClick={() => setState("idle")} className="text-xs font-medium text-gray-600 hover:text-gray-900">
          Undo
        </button>
      </div>
    );
  }

  // At-a-glance preparedness (operator Phase 4: show preparedStatus on every card).
  // HONESTY GATE: when a prepared draft exists, its deterministic quality verdict wins
  // over the lifecycle status — a "ready_to_review" pack whose draft is generic/thin/
  // off-topic must NOT show "Prepared". Only a quality-ready draft earns the green pill.
  const q = m.preparedQuality;
  const qualityHidesReady = q && q.status !== "ready";
  const preparedPill: { label: string; cls: string } | null = qualityHidesReady
    ? q!.status === "useful_but_needs_review"
      ? { label: "Needs review", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
      : { label: q!.status === "generic_rejected" ? "Generic draft" : q!.status === "relevance_rejected" ? "Topic mismatch" : q!.status === "too_thin" ? "Too thin" : "Needs work", cls: "bg-gray-100 text-gray-500 ring-gray-200" }
    : m.preparedStatus === "ready_to_review" || m.preparedStatus === "draft_ready" || m.preparedStatus === "proof_ready"
      ? { label: "Prepared", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
      : m.preparedStatus === "failed"
        ? { label: "Needs review", cls: "bg-amber-50 text-amber-700 ring-amber-200" }
        : m.preparedStatus === "shipped" || m.preparedStatus === "measuring" || m.preparedStatus === "won" || m.preparedStatus === "lost"
          ? null
          : { label: "Ready to draft", cls: "bg-indigo-50 text-indigo-600 ring-indigo-200" };

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 pl-6 shadow-sm ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg ${tone.ring} ${pending ? "opacity-60" : ""}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${tone.bar}`} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">{rank}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${tone.pill}`}>{m.actionLabel}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${conf.cls}`}>{conf.label}</span>
        {preparedPill ? (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${preparedPill.cls}`}>{preparedPill.label}</span>
        ) : null}
        {m.proofStatus ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
              m.proofStatus === "won"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : m.proofStatus === "measuring"
                  ? "bg-sky-50 text-sky-700 ring-sky-200"
                  : "bg-gray-100 text-gray-500 ring-gray-200"
            }`}
            title="From Results — the last shipped change on this page"
          >
            {m.alreadyMeasuring ? "Already measuring" : m.pageMeasuring ? "Page measuring" : m.proofLabel}
          </span>
        ) : null}
        {m.proofStatus === "measuring" && m.targetUrl && m.targetUrl !== "needs_new_page" ? (
          <Link
            href={`/proof?page=${encodeURIComponent(m.targetUrl)}`}
            className="text-[11px] font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
          >
            View in Results →
          </Link>
        ) : null}
        {m.demand != null && m.demand > 0 ? (
          <span className="rounded-full bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
            {fmtNum(m.demand)} {m.demandBasis === "ai_attention" ? "AI demand" : "monthly demand"}
          </span>
        ) : null}
      </div>

      {/* P6 — compounding-edit guard: a page mid-measurement loses proof clarity if you
          ship again now. Name the checkpoint; "Ship anyway" below is already demoted. */}
      {(m.alreadyMeasuring || m.pageMeasuring) ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-100">
          <span>⚠</span>
          <span>
            This page is mid-measurement{m.proofNextCheckpoint ? ` (next read ~${m.proofNextCheckpoint})` : ""} — shipping another change now muddies the proof. Wait for the read, or use “Ship anyway” below.
          </span>
        </p>
      ) : null}

      <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-gray-900">{titleCase(m.query)}</h3>
      <p className="mt-0.5 text-xs text-gray-400">
        on {m.pageLabel}
        {m.rankWhy ? <span className="text-gray-300"> · ranked here: {m.rankWhy}</span> : null}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{m.why}</p>

      {m.learnedTag ? (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">
          🧠 {m.learnedTag}
        </p>
      ) : null}

      {/* Page-specific learning caution (2026-06-28) — this page's own shipped change
          held-while-measuring / no-lift / lifted. Links to Results when evidence-backed. */}
      {m.outcomeCaution?.label ? (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${
              m.outcomeCaution.kind === "lifted"
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : m.outcomeCaution.kind === "no_lift"
                  ? "bg-gray-100 text-gray-600 ring-gray-200"
                  : "bg-sky-50 text-sky-700 ring-sky-100"
            }`}
            title={m.outcomeCaution.reason ?? undefined}
          >
            🧠 {m.outcomeCaution.label}
          </span>
          {m.outcomeCaution.evidence.length && m.targetUrl && m.targetUrl !== "needs_new_page" ? (
            <Link
              href={`/proof?page=${encodeURIComponent(m.targetUrl)}`}
              className="text-[11px] font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
            >
              View in Results →
            </Link>
          ) : null}
          {/* After a no-lift loss, the deterministic "try a different lever" next action
              so the settled failure becomes a better next move, not just a demote. */}
          {m.outcomeCaution.nextLever ? (
            <span className="w-full text-[11px] leading-snug text-gray-500">↳ {m.outcomeCaution.nextLever}</span>
          ) : null}
        </span>
      ) : null}

      {/* PageResearchPack v1 (2026-06-29) — the per-page "what should this page own"
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
        const rp = m.researchPack;
        return (
          <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">Research — what this page should own</div>
            {typeof rp.addressableVolume === "number" && rp.addressableVolume > 0 ? (
              <p className="mt-1 text-xs text-violet-900">
                <span className="font-semibold">Addressable demand:</span>{" "}
                ~{rp.addressableVolume >= 1000 ? `${(rp.addressableVolume / 1000).toFixed(1).replace(/\.0$/, "")}k` : rp.addressableVolume} searches/mo <span className="text-violet-500">(DataForSEO)</span>
              </p>
            ) : null}
            {rp.serpPattern ? (
              <p className="mt-1 text-[11px] text-violet-800">
                <span className="font-semibold">SERP rewards:</span> {rp.serpPattern.format} — {rp.serpPattern.elementImplication}
                {rp.serpPattern.winningDomains.length ? <span className="text-violet-500"> · winners: {rp.serpPattern.winningDomains.join(", ")}</span> : null}
              </p>
            ) : null}
            {rp.own.length ? (
              <p className="mt-1 text-xs text-violet-900"><span className="font-semibold">Own:</span> {rp.own.join(", ")}</p>
            ) : null}
            {rp.sibling.length ? (
              <p className="mt-0.5 text-xs text-violet-700"><span className="font-semibold">Cross-link, don&apos;t merge:</span> {rp.sibling.join(", ")}</p>
            ) : null}
            {rp.onPagePlan?.doFirst ? (
              <div className="mt-1.5 border-t border-violet-100 pt-1.5">
                <p className="text-[11px] text-violet-900">▸ <span className="font-semibold">Do first:</span> {rp.onPagePlan.doFirst.recommendation}</p>
                <p className="text-[10px] text-violet-500">{rp.onPagePlan.doFirst.evidence}</p>
                {rp.onPagePlan.sections.length ? (
                  <p className="mt-1 text-[11px] text-violet-800"><span className="font-medium">Add sections:</span> {rp.onPagePlan.sections.map((s) => s.recommendation).join(" ")}</p>
                ) : null}
                {rp.onPagePlan.faqs.length ? (
                  <p className="mt-0.5 text-[11px] text-violet-800"><span className="font-medium">FAQ targets:</span> {rp.onPagePlan.faqs.map((f) => f.recommendation).join(" ")}</p>
                ) : null}
                {rp.onPagePlan.warnings.length ? (
                  <p className="mt-1 text-[11px] text-amber-700">⚠ {rp.onPagePlan.warnings[0]}</p>
                ) : null}
              </div>
            ) : rp.primaryLever ? (
              <p className="mt-1 text-[11px] text-violet-800">▸ Do first: <span className="font-medium">{lab(rp.primaryLever.lever)}</span></p>
            ) : null}
            {rp.blockedLevers.length ? (
              <p className="mt-0.5 text-[11px] text-gray-500">✕ Skip (proof says flat): {rp.blockedLevers.map((b) => lab(b.lever)).join(", ")}</p>
            ) : null}
          </div>
        );
      })() : null}

      {/* Connectedness (2026-06-28) — the canonical ActionPack evidence provenance
          + cached DataForSEO SERP verdict, threaded onto the card operators use
          (was computed on the pack but never shown outside diagnostics). */}
      {(m.sourceChips?.length || m.dataforseoVerdict || m.competitorInformed) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.competitorInformed ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200"
              title={`This draft was rewritten using ${m.competitorInformed.domain} — the page that currently wins this topic.`}
            >
              ✦ Competitor-informed
            </span>
          ) : null}
          {m.dataforseoVerdict ? (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                m.dataforseoVerdict.verdict === "build"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : m.dataforseoVerdict.verdict === "wait"
                    ? "bg-amber-50 text-amber-700 ring-amber-200"
                    : "bg-gray-100 text-gray-500 ring-gray-200"
              }`}
              title={m.dataforseoVerdict.topDomains.length ? `Google top results: ${m.dataforseoVerdict.topDomains.join(", ")}` : undefined}
            >
              Google: {m.dataforseoVerdict.verdict}
              {m.dataforseoVerdict.overlap > 0 ? (
                <span className="font-medium normal-case"> · {m.dataforseoVerdict.overlap} AI-cited rival{m.dataforseoVerdict.overlap === 1 ? "" : "s"} rank</span>
              ) : null}
            </span>
          ) : null}
          {(m.sourceChips ?? []).map((s) => (
            <span key={s} className="inline-flex items-center rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
              {SOURCE_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      ) : null}

      {m.preparedChecklist ? (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {m.preparedChecklist.readyToReview ? (
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Ready to review</span>
            ) : m.preparedStale ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">Re-prepare (data changed)</span>
            ) : null}
            {(
              [
                ["Google checked", m.preparedChecklist.googleChecked],
                ["AI checked", m.preparedChecklist.aiChecked],
                ["Competitors read", m.preparedChecklist.competitorsRead],
                // "Draft prepared" only counts a QUALITY-passing draft — a generic/thin
                // draft must not show ✓ here while the pill says "Generic draft".
                ["Draft prepared", m.preparedChecklist.draftPrepared && (!q || q.copyAllowed)],
                ["Proof plan ready", m.preparedChecklist.proofPlanReady && (!q || q.copyAllowed)],
              ] as const
            ).map(([label, ok]) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${ok ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-gray-100 text-gray-400"}`}
              >
                {ok ? "✓" : "○"} {label}
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
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-indigo-500">
                      {label}{copyOk ? " — paste-ready" : ""}
                    </div>
                    {copyOk ? (
                      <button
                        type="button"
                        onClick={copyPrepared}
                        className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
                      >
                        {copiedPrepared ? "Copied ✓" : "Copy"}
                      </button>
                    ) : null}
                  </div>
                  {q && q.status !== "ready" && q.reasons[0] ? (
                    <p className="mt-0.5 text-[10px] text-amber-700">{q.reasons[0]}</p>
                  ) : null}
                  {m.competitorInformed ? (
                    <p className="mt-0.5 text-[10px] text-violet-700">Improved using the page that currently wins: {m.competitorInformed.domain}</p>
                  ) : null}
                  <p className={`mt-0.5 rounded-lg p-2 text-[12px] leading-relaxed ring-1 ${copyOk ? "bg-white text-gray-800 ring-indigo-100" : "bg-gray-50 text-gray-500 ring-gray-200"}`}>{m.preparedDraftText}</p>
                </div>
              );
            })()
          ) : null}
          {m.preparedExperiment ? (
            <p className="mt-1.5 text-[10px] text-gray-500">
              <span className="font-semibold text-gray-600">Experiment:</span> {m.preparedExperiment}
            </p>
          ) : null}
        </div>
      ) : null}

      {m.debate && m.debate.voices.length > 0 ? (
        <details className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <summary className="cursor-pointer list-none text-[12px] font-semibold text-gray-700">
            <span className="text-gray-400">▸ </span>Why Beacon recommends this
            <span className="ml-1.5 font-normal text-gray-400">— {m.debate.headline}</span>
          </summary>
          <div className="mt-2 space-y-1.5">
            {m.debate.voices.map((v) => (
              <div key={v.specialist} className="flex items-baseline gap-2 text-[12px]">
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{v.label}</span>
                <span className="text-gray-700">{v.claim}</span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-400">{v.confidencePct}%</span>
              </div>
            ))}
            {m.debate.objections.map((o, i) => (
              <div key={`obj-${i}`} className="flex items-baseline gap-2 text-[12px]">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${o.severity === "veto" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                  {o.severity === "veto" ? "Blocks" : "Caution"} · {o.label}
                </span>
                <span className="text-gray-600">{o.reason}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Who AI cites now</div>
          <div className="mt-0.5 text-sm font-medium text-gray-700">
            {m.whoCited ? (
              m.whoCited
            ) : m.looselyMatched ? (
              <span className="text-gray-500">AI cites a tangential page — confirm with a quick search</span>
            ) : (
              <span className="text-emerald-600">Open — no one owns this yet</span>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">What wins</div>
          <div className="mt-0.5 text-sm font-medium text-gray-700">
            {m.whatWins ? m.whatWins : <span className="text-gray-400">Add a clear, quotable answer up top</span>}
          </div>
        </div>
      </div>

      {m.ga4 || m.friction ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {m.ga4 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-100">
              {m.ga4.sessions.toLocaleString()} visits / 28d
              {m.ga4.conversions > 0 ? ` · ${m.ga4.conversions.toLocaleString()} conversions` : ""} (GA4)
            </span>
          ) : null}
          {m.friction ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-100"
              title={`Microsoft Clarity: ${m.friction.deadPct}% of sessions had dead clicks, ${m.friction.ragePct}% rage clicks — visitors are hitting friction on this page.`}
            >
              ⚠ {m.friction.deadPct}% dead clicks{m.friction.ragePct > 0 ? ` · ${m.friction.ragePct}% rage` : ""} (Clarity)
            </span>
          ) : null}
        </div>
      ) : null}

      {m.topQueries.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-500">Ranks for</span>
          {m.topQueries.map((q, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ring-1 ${
                q.strikingDistance
                  ? "bg-amber-50 text-amber-800 ring-amber-200"
                  : "bg-sky-50 text-sky-800 ring-sky-100"
              }`}
              title={
                q.strikingDistance
                  ? `Striking distance — ranks position ${q.position.toFixed(1)} for ${q.impressions.toLocaleString()} monthly impressions; climbing a few spots captures outsized clicks.`
                  : `${q.impressions.toLocaleString()} impressions · ${q.clicks.toLocaleString()} clicks · avg position ${q.position.toFixed(1)}`
              }
            >
              {q.strikingDistance ? <span aria-hidden>↑</span> : null}
              <span className="font-medium">{q.query}</span>
              <span className={q.strikingDistance ? "text-amber-600" : "text-sky-500"}>
                pos {q.position.toFixed(1)} · {fmtNum(q.impressions)} impr
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {m.declines.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">Losing ground</span>
          {m.declines.map((d, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800 ring-1 ring-rose-100"
              title={`Clicks fell ${d.dropPct}% (${d.priorClicks.toLocaleString()} → ${d.recentClicks.toLocaleString()}) vs the prior 28 days${d.positionSlip >= 1 ? `; slipped ${d.positionSlip.toFixed(1)} positions` : ""}.`}
            >
              <span aria-hidden>↓</span>
              <span className="font-medium">{d.query}</span>
              <span className="text-rose-500">−{d.dropPct}% clicks</span>
            </span>
          ))}
        </div>
      ) : null}

      {m.cannibalization.length > 0 ? (
        <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50/50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">Competing with yourself</span>
            {m.cannibalization.map((c, i) => {
              // Show a DISTINCT competing page, never "iran animals vs your iran
              // animals" — that collision happens when the other page's label equals
              // the query. Fall back to an honest count when every other page collides.
              const distinct = c.otherPages.find((o) => o.toLowerCase() !== c.query.toLowerCase()) ?? null;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] text-orange-800 ring-1 ring-orange-100"
                  title={c.fix}
                >
                  <span aria-hidden>⚔</span>
                  <span className="font-medium">{c.query}</span>
                  <span className="text-orange-500">
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
              to it — never show "fold X into it" while the research module says
              "cross-link, don't merge" (that contradiction is the boy/girl-names bug). */}
          {m.researchPack?.sibling?.length ? (
            <p className="mt-1.5 text-xs text-orange-700">Keep these as separate pages and cross-link them (below) — don&apos;t merge. See &ldquo;what this page should own&rdquo; above.</p>
          ) : (
            <p className="mt-1.5 text-xs text-orange-700">{m.cannibalization[0]!.fix}</p>
          )}
          {m.cannibalization[0]!.linkSnippet ? (
            <div className="mt-1.5 flex items-center gap-2">
              <code className="truncate rounded bg-white px-2 py-1 text-[10px] text-orange-900 ring-1 ring-orange-100">
                {m.cannibalization[0]!.linkSnippet}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(m.cannibalization[0]!.linkSnippet!).then(() => {
                    setCannibalCopied(true);
                    setTimeout(() => setCannibalCopied(false), 1800);
                  }).catch(() => {});
                }}
                className="shrink-0 rounded-md bg-orange-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-orange-500"
              >
                {cannibalCopied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {m.yourGap ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-400">Your gap</span>
          <span className="text-sm font-medium text-rose-700">{m.yourGap}</span>
        </div>
      ) : null}

      {m.outline.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Cover</span>
          {m.outline.map((o, i) => (
            <span key={i} className="rounded-md bg-white px-2 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200">{o}</span>
          ))}
        </div>
      ) : null}

      {m.titleVariants.length > 0 ? (
        <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700/70">
            Title options · pick one, copy, paste
          </div>
          <ul className="mt-2 space-y-1.5">
            {m.titleVariants.map((v, i) => (
              <li
                key={i}
                className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-gray-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-800" title={v.title}>
                    {i === 0 ? <span className="mr-1 text-[10px] font-bold text-sky-600">BEST</span> : null}
                    {v.title}
                  </span>
                  <button
                    onClick={() => copyTitle(i, v.title)}
                    className="shrink-0 rounded-md bg-gray-900 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-gray-700"
                  >
                    {copiedTitle === i ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                {v.reason ? (
                  <p className="mt-0.5 text-[10px] leading-snug text-gray-400">{v.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {m.also.length > 0 ? (
        <p className="mt-3 text-xs text-gray-500">
          <span className="font-semibold text-gray-400">While you&apos;re on this page, also:</span>{" "}
          {m.also.join(" · ")}
        </p>
      ) : null}

      {m.proof ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
          {m.proof}
        </p>
      ) : null}

      {showDraft && hasDraft ? (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/80 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Paste-ready draft · grounded, no AI guesses
            </span>
            <button
              onClick={copyDraft}
              className="rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-gray-700"
            >
              {copied ? "Copied ✓" : "Copy draft"}
            </button>
          </div>
          <dl className="space-y-2 text-xs">
            {m.draftTitle ? (
              <div>
                <dt className="font-semibold text-gray-500">Title</dt>
                <dd className="text-gray-800">{m.draftTitle}</dd>
              </div>
            ) : null}
            {m.answerBrief ? (
              <div>
                <dt className="font-semibold text-gray-500">Answer block</dt>
                <dd className="text-gray-800">{m.answerBrief}</dd>
              </div>
            ) : null}
            {m.faqs.length ? (
              <div>
                <dt className="font-semibold text-gray-500">FAQ to answer</dt>
                <dd>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-700">
                    {m.faqs.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {m.schema.length ? (
              <div>
                <dt className="font-semibold text-gray-500">Schema to add</dt>
                <dd className="text-gray-700">{m.schema.join(", ")}</dd>
              </div>
            ) : null}
          </dl>

          {m.actionTone === "citation" ? (
            <div className="mt-3 border-t border-gray-200 pt-3">
              {aiStatus === "ok" ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                      ✨ AI-written answer block
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={aiGenerate}
                        disabled={pending}
                        className="rounded-md px-1.5 py-1 text-[11px] font-medium text-gray-400 hover:text-violet-600 disabled:opacity-60"
                        title="Generate a fresh draft"
                      >
                        {pending ? "…" : "↻ Regenerate"}
                      </button>
                      <button
                        onClick={copyAi}
                        className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-violet-500"
                      >
                        {aiCopied ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <p className="rounded-lg bg-white p-2.5 text-xs leading-relaxed text-gray-800 ring-1 ring-violet-100">
                    {aiText}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={aiGenerate}
                    disabled={pending || aiStatus === "pending"}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60"
                  >
                    {aiStatus === "pending" ? "Writing…" : "✨ Draft with AI"}
                  </button>
                  {aiStatus === "off" ? (
                    <span className="text-[11px] text-gray-400">AI drafting is off — using the outline above.</span>
                  ) : aiStatus === "blocked" ? (
                    <span className="text-[11px] text-amber-600">Monthly AI budget reached.</span>
                  ) : aiStatus === "rejected" ? (
                    <span className="text-[11px] text-amber-600">Draft failed the fact-safety check — use the outline.</span>
                  ) : aiStatus === "error" ? (
                    <span className="text-[11px] text-gray-400">Couldn&apos;t draft right now — use the outline.</span>
                  ) : null}
                </div>
              )}

              {m.faqs.length > 0 ? (
                <div className="mt-3">
                  {faqStatus === "ok" ? (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">✨ FAQ schema (JSON-LD)</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={faqGenerate}
                            disabled={pending}
                            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-gray-400 hover:text-violet-600 disabled:opacity-60"
                            title="Generate a fresh FAQ schema"
                          >
                            {pending ? "…" : "↻ Regenerate"}
                          </button>
                          <button onClick={copyFaq} className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500">
                            {faqCopied ? "Copied ✓" : "Copy JSON-LD"}
                          </button>
                        </div>
                      </div>
                      <pre className="max-h-44 overflow-auto rounded-lg bg-gray-900 p-2.5 text-[10px] leading-relaxed text-gray-100">{faqJsonLd}</pre>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={faqGenerate}
                        disabled={pending || faqStatus === "pending"}
                        className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60"
                      >
                        {faqStatus === "pending" ? "Generating…" : "✨ Generate FAQ schema"}
                      </button>
                      {faqStatus === "off" ? (
                        <span className="text-[11px] text-gray-400">AI drafting is off.</span>
                      ) : faqStatus === "blocked" ? (
                        <span className="text-[11px] text-amber-600">Monthly AI budget reached.</span>
                      ) : faqStatus === "rejected" || faqStatus === "error" ? (
                        <span className="text-[11px] text-gray-400">Couldn&apos;t generate — try later.</span>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
        {/* Already mid-measurement on this exact page+action: a second ship would
            contaminate the open proof window — demote Ship, don't block it. */}
        <button
          onClick={ship}
          disabled={pending}
          className={
            m.alreadyMeasuring || m.pageMeasuring
              ? "inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60"
              : `inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60 ${tone.btn}`
          }
          title={
            m.alreadyMeasuring
              ? "This page+change is already measuring — shipping again would muddy the proof window"
              : m.pageMeasuring
                ? "This page is mid-measurement on another change — a second change muddies the open proof window"
                : undefined
          }
        >
          {m.alreadyMeasuring || m.pageMeasuring ? "Ship anyway" : "⚡ Ship it"}
        </button>
        {hasDraft ? (
          <button
            onClick={() => setShowDraft((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            {showDraft ? "Hide draft" : "See the draft"}
          </button>
        ) : null}
        <Link href="/recommendations" className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
          Open in queue →
        </Link>
        <a href={m.targetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-700">
          View page ↗
        </a>
        <button onClick={snooze} disabled={pending} className="ml-auto text-xs font-medium text-gray-400 hover:text-gray-700 disabled:opacity-60">
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
          className="text-xs font-medium text-gray-300 hover:text-rose-500 disabled:opacity-60"
          title="Permanently remove this move"
        >
          Not relevant
        </button>
      </div>
    </div>
  );
}

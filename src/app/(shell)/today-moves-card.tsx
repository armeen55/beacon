"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { respondToRecommendation } from "./recommendation-actions";
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

export function MoveCard({ m, rank }: { m: TodayMove; rank: number }) {
  const tone = TONE[m.actionTone];
  const conf = CONF[m.confidence];
  const [state, setState] = useState<"idle" | "shipped" | "snoozed">("idle");
  const [pending, startTransition] = useTransition();
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);

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
        await respondToRecommendation(m.id, "accepted", { targetPageUrl: m.targetUrl });
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
        <div>
          <div className="font-semibold">Shipped — {titleCase(m.query)}</div>
          <div className="text-xs text-emerald-700">Beacon is measuring it now. You&apos;ll see the result in Proof.</div>
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

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 pl-6 shadow-sm ring-1 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg ${tone.ring} ${pending ? "opacity-60" : ""}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${tone.bar}`} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">{rank}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${tone.pill}`}>{m.actionLabel}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${conf.cls}`}>{conf.label}</span>
        {m.demand != null && m.demand > 0 ? (
          <span className="rounded-full bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">
            {fmtNum(m.demand)} {m.demandBasis === "ai_attention" ? "AI demand" : "monthly demand"}
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-gray-900">{titleCase(m.query)}</h3>
      <p className="mt-0.5 text-xs text-gray-400">on {m.pageLabel}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{m.why}</p>

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

      {m.outline.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Cover</span>
          {m.outline.map((o, i) => (
            <span key={i} className="rounded-md bg-white px-2 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200">{o}</span>
          ))}
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
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
        <button
          onClick={ship}
          disabled={pending}
          className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60 ${tone.btn}`}
        >
          ⚡ Ship it
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
      </div>
    </div>
  );
}

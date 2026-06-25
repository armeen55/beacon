"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { draftMoveAnswerBlockAction } from "./today-moves-actions";
import type { NewPageOpportunity } from "./today-newpages-data";

/**
 * today-newpages-card (2026-06-24) — interactive "New page to build" card. Adds an
 * on-demand "✨ Draft the opening" that writes a real 40–60 word opener for a page
 * that doesn't exist yet — reusing the gated/safe answer-block drafter (OFF unless
 * BEACON_LLM_PROVIDER=openai; operator-gated; budget + fact-safety firewalled).
 */

const TIER: Record<NewPageOpportunity["tier"], { label: string; cls: string }> = {
  hot: { label: "Hot", cls: "bg-rose-50 text-rose-600 ring-rose-200" },
  warm: { label: "Warm", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  emerging: { label: "Emerging", cls: "bg-gray-100 text-gray-500 ring-gray-200" },
};

export function NewPageCard({ o }: { o: NewPageOpportunity }) {
  const tier = TIER[o.tier];
  const [aiStatus, setAiStatus] = useState<
    "idle" | "pending" | "ok" | "off" | "blocked" | "rejected" | "error"
  >("idle");
  const [aiText, setAiText] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    setAiStatus("pending");
    startTransition(async () => {
      try {
        const r = await draftMoveAnswerBlockAction({
          query: o.topic,
          pageLabel: o.topic,
          brief: `Write the opening paragraph for a NEW encyclopedia/content page about "${o.topic}". Define the topic directly and factually so a reader (and an AI assistant) gets the answer up top.`,
          outline: o.whatWins ? [`Match the depth of cited pages: ${o.whatWins}`] : [],
          faqs: [],
        });
        if (r.status === "ok") {
          setAiText(r.text);
          setAiStatus("ok");
        } else setAiStatus(r.status === "blocked_budget" ? "blocked" : r.status === "off" ? "off" : r.status === "rejected" ? "rejected" : "error");
      } catch {
        setAiStatus("error");
      }
    });
  };
  const copy = () => {
    navigator.clipboard?.writeText(aiText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            New page
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${tier.cls}`}>{tier.label}</span>
        </div>
        <h3 className="mt-2.5 text-[15px] font-semibold leading-snug tracking-tight text-gray-900">{o.topic}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
          {o.competitorCount > 0 ? (
            <>
              <span className="font-medium text-gray-700">{o.competitorCount}</span> competitor page
              {o.competitorCount === 1 ? "" : "s"} get cited for this — you have no page yet.
            </>
          ) : (
            <>There&apos;s demand for this and none of your pages covers it yet.</>
          )}
        </p>
        {o.topCompetitor ? <p className="mt-1 text-[11px] text-gray-400">e.g. {o.topCompetitor}</p> : null}
        {o.whatWins ? (
          <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">What the cited page has</div>
            <div className="mt-0.5 text-[11px] leading-snug text-gray-600">{o.whatWins}</div>
          </div>
        ) : null}
        {aiStatus === "ok" ? (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-500">✨ AI-drafted opening</span>
              <button onClick={copy} className="rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-violet-500">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="rounded-lg bg-white p-2 text-[11px] leading-relaxed text-gray-800 ring-1 ring-violet-100">{aiText}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/pages"
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
        >
          Plan this page →
        </Link>
        {aiStatus !== "ok" ? (
          <button
            onClick={generate}
            disabled={pending || aiStatus === "pending"}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60"
          >
            {aiStatus === "pending" ? "Writing…" : "✨ Draft the opening"}
          </button>
        ) : null}
        {aiStatus === "off" ? (
          <span className="text-[10px] text-gray-400">AI drafting is off</span>
        ) : aiStatus === "blocked" ? (
          <span className="text-[10px] text-amber-600">budget reached</span>
        ) : aiStatus === "rejected" || aiStatus === "error" ? (
          <span className="text-[10px] text-gray-400">try again later</span>
        ) : null}
      </div>
    </div>
  );
}

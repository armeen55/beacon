"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { draftMoveAnswerBlockAction } from "./today-moves-actions";
import { validateCreatePageWithSerpAction, type SerpValidationResponse } from "./serp-actions";
import type { NewPageOpportunity } from "./today-newpages-data";
import { BriefButton } from "./diagnostics/profound-intelligence/brief-button";

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

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  build: { label: "BUILD", cls: "bg-emerald-600 text-white" },
  wait: { label: "WAIT", cls: "bg-amber-100 text-amber-800 ring-1 ring-amber-200" },
  reject: { label: "SKIP", cls: "bg-gray-200 text-gray-600" },
};

export function NewPageCard({ o, ownDomain, enableAeoBrief = false }: { o: NewPageOpportunity; ownDomain: string; enableAeoBrief?: boolean }) {
  const tier = TIER[o.tier];
  const [aiStatus, setAiStatus] = useState<
    "idle" | "pending" | "ok" | "off" | "blocked" | "rejected" | "error"
  >(o.savedOpening ? "ok" : "idle"); // hydrate a previously-generated+saved opening
  const [aiText, setAiText] = useState(o.savedOpening ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // Phase 4: on-demand live-SERP validation (DataForSEO) → BUILD/WAIT/SKIP verdict.
  const [serp, setSerp] = useState<SerpValidationResponse | null>(null);
  const [serpPending, startSerp] = useTransition();
  const validate = () => {
    startSerp(async () => {
      try {
        setSerp(
          await validateCreatePageWithSerpAction({
            topic: o.topic,
            ownDomain,
            profoundDomains: o.competitorDomains,
            searchVolume: o.searchVolume,
          }),
        );
      } catch {
        setSerp({ ok: false, reason: "Validation failed — try again." });
      }
    });
  };

  // What to show: a just-run live verdict wins; else the PRECOMPUTED verdict
  // (from "Prepare top N") so the card arrives "Google checked" with no click.
  const live = serp && serp.ok && (serp.status === "ok" || serp.status === "cache_hit") ? serp.validation : null;
  const shown = live
    ? {
        verdict: live.verdict,
        confidence: live.confidence,
        contentDomainCount: live.contentDomainCount,
        marketplaceUgcCount: live.marketplaceUgcCount,
        profoundOverlapCount: live.profoundOverlapCount,
        ownAlreadyRanks: live.ownAlreadyRanks,
        topDomains: live.topDomains,
        reason: live.reasons[0] ?? "",
        prepared: false,
      }
    : o.preparedVerdict
    ? { ...o.preparedVerdict, prepared: true }
    : null;

  const generate = () => {
    setAiStatus("pending");
    startTransition(async () => {
      try {
        const r = await draftMoveAnswerBlockAction({
          recId: o.id, // persist so the opening survives reload (move_drafts)
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
        {o.searchVolume && o.searchVolume > 0 ? (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 ring-1 ring-sky-100">
            {o.searchVolume.toLocaleString()} monthly searches (SEMrush)
          </p>
        ) : null}
        {o.topCompetitor ? <p className="mt-1 text-[11px] text-gray-400">e.g. {o.topCompetitor}</p> : null}
        {o.aeoReceipt ? (
          <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/60 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">✦ AI-validated</div>
            <p className="mt-1 text-[11px] leading-snug text-gray-700">
              AI asks: <span className="font-medium text-gray-900">“{o.aeoReceipt.topPrompt}”</span>
            </p>
            {o.aeoReceipt.fanoutCount > 0 ? (
              <p className="mt-0.5 text-[10px] text-gray-500">
                Fans out into {o.aeoReceipt.fanoutCount} related question{o.aeoReceipt.fanoutCount === 1 ? "" : "s"}
              </p>
            ) : null}
            <p className="mt-0.5 text-[10px] text-gray-500">AI cites: {o.aeoReceipt.citedDomains.join(", ")}</p>
            <p className="mt-0.5 text-[10px] font-medium text-violet-700">
              {o.aeoReceipt.ownAbsent ? "Iranopedia not cited yet" : "Your page: cited"}
            </p>
            {enableAeoBrief ? (
              <BriefButton
                input={{
                  prompt: o.aeoReceipt.topPrompt,
                  fanoutQueries: o.aeoReceipt.fanoutQueries,
                  competitorPages: o.aeoReceipt.competitorPages,
                  ownCitedUrls: o.aeoReceipt.ownCitedUrls,
                  recommendedMove: "create_page",
                  tags: [],
                }}
              />
            ) : null}
          </div>
        ) : null}
        {o.whatWins ? (
          <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">What the cited page has</div>
            <div className="mt-0.5 text-[11px] leading-snug text-gray-600">{o.whatWins}</div>
          </div>
        ) : null}
        {shown ? (
          (() => {
            const vs = VERDICT_STYLE[shown.verdict] ?? VERDICT_STYLE.wait;
            return (
              <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${vs.cls}`}>{vs.label}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{shown.confidence} confidence</span>
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                    ✓ Google checked{shown.prepared ? "" : " · just now"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-gray-700">{shown.reason}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                  <span>{shown.contentDomainCount}/10 content</span>
                  {shown.marketplaceUgcCount > 0 ? <span>{shown.marketplaceUgcCount} marketplace</span> : null}
                  {shown.profoundOverlapCount > 0 ? <span className="font-semibold text-emerald-700">{shown.profoundOverlapCount} AI-cited overlap</span> : null}
                  {shown.ownAlreadyRanks ? <span className="font-semibold text-amber-700">you already rank</span> : null}
                </div>
                {shown.topDomains.length > 0 ? (
                  <p className="mt-1 truncate text-[10px] text-gray-400">SERP: {shown.topDomains.slice(0, 5).join(", ")}</p>
                ) : null}
              </div>
            );
          })()
        ) : serp && !serp.ok ? (
          <p className="mt-2 text-[10px] text-gray-400">{serp.reason}</p>
        ) : serp && serp.ok ? (
          <p className="mt-2 text-[10px] text-gray-400">
            {serp.status === "dry_run" ? "Dry-run — set DATAFORSEO_DRY_RUN=false to validate live." : serp.status === "capped" ? "SERP budget cap reached." : serp.status === "disabled" ? "DataForSEO not connected." : "No SERP result."}
          </p>
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
        <button
          onClick={validate}
          disabled={serpPending}
          title="Run a live Google SERP check (DataForSEO) and verdict this page: build, wait, or skip"
          className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-60"
        >
          {serpPending ? "Checking SERP…" : shown ? "↻ Re-check SERP" : "Validate with live SERP"}
        </button>
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

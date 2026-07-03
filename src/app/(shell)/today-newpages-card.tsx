"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { draftMoveAnswerBlockAction } from "./today-moves-actions";
import { validateCreatePageWithSerpAction, type SerpValidationResponse } from "./serp-actions";
import { draftFullPageAction } from "./today-newpages-draft-actions";
import type { NewPageOpportunity } from "./today-newpages-data";
import { BriefButton } from "./diagnostics/profound-intelligence/brief-button";
import type { AssembledDraftPage } from "@/domains/llm/draft-full-page";
import { plainSchemaTypes, plainSerpReason } from "@/lib/plain-language";
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";

/**
 * today-newpages-card (2026-06-24) — interactive "New page to build" card. Adds an
 * on-demand "✨ Draft the opening" that writes a real 40–60 word opener for a page
 * that doesn't exist yet — reusing the gated/safe answer-block drafter (OFF unless
 * BEACON_LLM_PROVIDER=openai; operator-gated; budget + fact-safety firewalled).
 *
 * FP6b-2 (2026-07-02) - migrated onto the FP6a design system (Card/Pill + tokens
 * + the five-size type scale). Violet (AI-drafted opening/brief) and indigo (the
 * full-page draft) stay as deliberate identity colors, matching the precedent
 * set in today-moves-card.tsx: those two accents mark "AI generated this" and
 * do not correspond to any of the six Pill verdict intents.
 */

const TIER: Record<NewPageOpportunity["tier"], { label: string; intent: PillIntent }> = {
  hot: { label: "Hot", intent: "attention" },
  warm: { label: "Warm", intent: "waiting" },
  emerging: { label: "Emerging", intent: "neutral" },
};

const VERDICT_STYLE: Record<string, { label: string; intent: PillIntent }> = {
  build: { label: "BUILD", intent: "live" },
  wait: { label: "WAIT", intent: "waiting" },
  reject: { label: "SKIP", intent: "neutral" },
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
        setSerp({ ok: false, reason: "Validation failed, try again." });
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

  const [briefCopied, setBriefCopied] = useState(false);
  const copyBrief = () => {
    const b = o.preparedBrief;
    if (!b) return;
    const text = [
      `Title: ${b.title}`,
      `Meta: ${b.meta}`,
      "",
      `Opening:\n${b.opening}`,
      b.outline.length ? `\nOutline:\n${b.outline.map((s) => `- ${s}`).join("\n")}` : "",
      b.faqQuestions.length ? `\nFAQ:\n${b.faqQuestions.map((q) => `- ${q}`).join("\n")}` : "",
      b.schemaTypes.length ? `\nBehind-the-scenes labels AI reads: ${plainSchemaTypes(b.schemaTypes)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard?.writeText(text).then(() => {
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 1800);
    }).catch(() => {});
  };

  // BEACON 500 item 55 - "Draft the full page": one operator click walks the
  // brief's outline section by section and assembles a paste-ready page. Bounded
  // to one page per click, budget-gated + fail-closed inside the action.
  const [fullPage, setFullPage] = useState<AssembledDraftPage | null>(o.fullPageDraft);
  const [fullPageStatus, setFullPageStatus] = useState<"idle" | "pending" | "ok" | "off" | "budget" | "error">(
    o.fullPageDraft ? "ok" : "idle",
  );
  const [fullPageReceipt, setFullPageReceipt] = useState<{ costUsd: number; persisted: boolean } | null>(null);
  const [fullPagePending, startFullPage] = useTransition();
  const [fullPageOpen, setFullPageOpen] = useState(false);
  const [fullPageCopied, setFullPageCopied] = useState(false);

  const draftFullPage = () => {
    const brief = o.preparedBrief;
    if (!brief) return;
    setFullPageStatus("pending");
    startFullPage(async () => {
      try {
        const r = await draftFullPageAction({
          recId: o.id,
          topic: o.topic,
          brief: {
            proposedTitle: brief.title,
            metaDescription: brief.meta,
            openingAnswer: brief.opening,
            outline: brief.outline,
            faqQuestions: brief.faqQuestions,
          },
          grounding: {
            topic: o.topic,
            competitorWhatWins: o.whatWins ?? null,
            fanoutQuestions: o.aeoReceipt?.fanoutQueries ?? [],
            evidenceFacts: [o.gapEvidence, o.wikiGapEvidence].filter((s): s is string => !!s),
          },
        });
        if (r.ok) {
          setFullPage(r.page);
          setFullPageReceipt({ costUsd: r.costUsd, persisted: r.persisted });
          setFullPageStatus("ok");
          setFullPageOpen(true);
        } else {
          setFullPageStatus(r.reason.toLowerCase().includes("budget") ? "budget" : r.reason.toLowerCase().includes("off") ? "off" : "error");
        }
      } catch {
        setFullPageStatus("error");
      }
    });
  };
  const copyFullPage = () => {
    if (!fullPage) return;
    navigator.clipboard?.writeText(fullPage.markdown).then(() => {
      setFullPageCopied(true);
      setTimeout(() => setFullPageCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <Card padding="none" className="group flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Pill intent="live">New page</Pill>
          <Pill intent={tier.intent}>{tier.label}</Pill>
        </div>
        <h3 className="mt-2.5 text-sub font-semibold leading-snug tracking-tight text-foreground">{o.topic}</h3>
        {o.alsoCovers && o.alsoCovers.length > 0 ? (
          <p className="mt-1 text-meta text-muted-foreground">
            Also covers: {o.alsoCovers.slice(0, 3).join(", ")}
            {o.alsoCovers.length > 3 ? ` +${o.alsoCovers.length - 3}` : ""}
          </p>
        ) : null}
        <p className="mt-1.5 text-body leading-relaxed text-foreground-secondary">
          {/* A7 (operator-experience fix batch, 2026-07-02) - the "get cited for this, you have
              no page yet" sentence now lives once in the section subhead above; each card only
              names its own count so the boilerplate stops repeating verbatim across cards. */}
          {o.competitorCount > 0 ? (
            <>
              <span className="font-medium text-foreground">{o.competitorCount}</span> competitor page
              {o.competitorCount === 1 ? "" : "s"} cite this topic.
            </>
          ) : (
            <>There&apos;s demand for this and none of your pages covers it yet.</>
          )}
        </p>
        {o.keywordMatch && o.searchVolume && o.searchVolume > 0 ? (
          <p className="mt-1.5" title={`DataForSEO cached search volume, matched ${o.keywordMatch.confidence}`}>
            <Pill intent={o.keywordMatch.confidence === "weak" ? "neutral" : "measuring"}>
              {o.searchVolume.toLocaleString()}/mo {o.keywordMatch.confidence === "weak" ? "≈ via" : "via"} “{o.keywordMatch.keyword}”
            </Pill>
          </p>
        ) : null}
        {o.topCompetitor ? <p className="mt-1 text-meta text-muted-foreground">e.g. {o.topCompetitor}</p> : null}
        {o.gapEvidence ? (
          <p
            className="mt-1.5 rounded-md bg-surface-raised px-2 py-1 text-meta leading-snug text-foreground-secondary"
            title="From the competitor keyword gap check (Google index data, cached 30 days)"
          >
            {o.gapEvidence}
          </p>
        ) : null}
        {o.wikiGapEvidence ? (
          <p
            className="mt-1.5 rounded-md bg-status-warning-bg px-2 py-1 text-meta leading-snug text-status-warning"
            title="From the beat-Wikipedia check (Wikipedia's free API, cached 30 days)"
          >
            {o.wikiGapEvidence}
          </p>
        ) : null}
        {o.aeoReceipt ? (
          <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/60 px-2.5 py-2">
            <div className="text-meta font-semibold uppercase tracking-wide text-violet-700">✦ AI-validated</div>
            <p className="mt-1 text-body leading-snug text-foreground-secondary">
              AI asks: <span className="font-medium text-foreground">“{o.aeoReceipt.topPrompt}”</span>
            </p>
            {o.aeoReceipt.fanoutCount > 0 ? (
              <p className="mt-0.5 text-meta text-muted-foreground">
                Fans out into {o.aeoReceipt.fanoutCount} related question{o.aeoReceipt.fanoutCount === 1 ? "" : "s"}
              </p>
            ) : null}
            <p className="mt-0.5 text-meta text-muted-foreground">AI cites: {o.aeoReceipt.citedDomains.join(", ")}</p>
            <p className="mt-0.5 text-meta font-medium text-violet-700">
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
        {o.preparedBrief ? (
          (() => {
            const q = o.briefQuality;
            const ready = !q || q.status === "ready";
            const needsReview = q?.status === "useful_but_needs_review";
            const copyOk = q ? q.copyAllowed : true;
            const cls = ready
              ? "border-status-success/20 bg-status-success-bg"
              : needsReview
                ? "border-status-warning/20 bg-status-warning-bg"
                : "border-border bg-surface-raised";
            const heading = ready ? "✦ Page brief ready" : needsReview ? "Brief drafted, needs review" : "Brief needs work";
            const headCls = ready ? "text-status-success" : needsReview ? "text-status-warning" : "text-muted-foreground";
            return (
          <div className={`mt-2 rounded-lg border px-2.5 py-2 ${cls}`}>
            <div className="flex items-center justify-between">
              <span className={`text-meta font-semibold uppercase tracking-wide ${headCls}`}>{heading}</span>
              {copyOk ? (
                <button onClick={copyBrief} className="rounded-md bg-status-success px-2 py-0.5 text-meta font-semibold text-background hover:opacity-90">
                  {briefCopied ? "Copied ✓" : "Copy brief"}
                </button>
              ) : null}
            </div>
            {q && q.status !== "ready" && q.reasons[0] ? (
              <p className={`mt-0.5 text-meta ${needsReview ? "text-status-warning" : "text-muted-foreground"}`}>{q.reasons[0]}</p>
            ) : null}
            {o.briefFromRelated ? (
              <p className="mt-0.5 text-meta text-muted-foreground">Brief from a related topic in this group, adapt the title/slug.</p>
            ) : null}
            <p className="mt-1 text-body font-semibold leading-snug text-foreground">{o.preparedBrief.title}</p>
            <p className="mt-0.5 text-meta leading-snug text-muted-foreground">{o.preparedBrief.meta}</p>
            <p className="mt-1 rounded bg-card p-1.5 text-body leading-relaxed text-foreground-secondary ring-1 ring-status-success/15">{o.preparedBrief.opening}</p>
            {o.preparedBrief.outline.length > 0 ? (
              <div className="mt-1.5">
                <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">Outline</div>
                <ul className="mt-0.5 space-y-0.5">
                  {o.preparedBrief.outline.slice(0, 6).map((h, i) => (
                    <li key={i} className="text-meta leading-snug text-foreground-secondary">• {h}</li>
                  ))}
                  {o.preparedBrief.outline.length > 6 ? (
                    <li className="text-meta text-muted-foreground">+{o.preparedBrief.outline.length - 6} more sections</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {o.preparedBrief.faqQuestions.length > 0 ? (
              <p className="mt-1 text-meta text-muted-foreground">{o.preparedBrief.faqQuestions.length} FAQ question{o.preparedBrief.faqQuestions.length === 1 ? "" : "s"} drafted</p>
            ) : null}
            {o.preparedBrief.schemaTypes.length > 0 ? (
              <p className="mt-0.5 text-meta text-muted-foreground">Behind-the-scenes labels AI reads: {plainSchemaTypes(o.preparedBrief.schemaTypes)}</p>
            ) : null}
          </div>
            );
          })()
        ) : null}
        {fullPage ? (
          <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setFullPageOpen((v) => !v)}
                className="text-meta font-semibold uppercase tracking-wide text-indigo-700"
              >
                {fullPageOpen ? "▾" : "▸"} Full page drafted ({fullPage.stats.sectionsDrafted}/{fullPage.stats.sectionsDrafted + fullPage.stats.sectionsFallback} sections)
              </button>
              <button onClick={copyFullPage} className="rounded-md bg-indigo-600 px-2 py-0.5 text-meta font-semibold text-background hover:bg-indigo-500">
                {fullPageCopied ? "Copied ✓" : "Copy full page"}
              </button>
            </div>
            {fullPageReceipt ? (
              <p className="mt-1 text-meta text-muted-foreground">
                Spent ${fullPageReceipt.costUsd.toFixed(3)}
                {fullPageReceipt.persisted ? " · saved" : " · not saved (too large)"}
                {fullPage.stats.sectionsFallback > 0 ? ` · ${fullPage.stats.sectionsFallback} section${fullPage.stats.sectionsFallback === 1 ? "" : "s"} needs a rewrite` : ""}
              </p>
            ) : fullPage.stats.sectionsFallback > 0 ? (
              <p className="mt-1 text-meta text-status-warning">
                {fullPage.stats.sectionsFallback} section{fullPage.stats.sectionsFallback === 1 ? "" : "s"} could not be drafted confidently. See the stub below.
              </p>
            ) : null}
            {fullPageOpen ? (
              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto rounded bg-card p-2 ring-1 ring-indigo-100">
                {fullPage.sections.map((s, i) => (
                  <div key={i}>
                    <p className="text-body font-semibold text-foreground">{s.heading}</p>
                    <p className="mt-0.5 text-meta leading-relaxed text-foreground-secondary">{s.body}</p>
                    <p className="mt-0.5 text-meta text-muted-foreground">
                      Sources: {s.sources.map((src) => src.detail).join("; ")}
                    </p>
                  </div>
                ))}
                {fullPage.sourcesAppendix.length > 0 ? (
                  <div className="border-t border-border-subtle pt-1.5">
                    <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">Sources appendix</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {fullPage.sourcesAppendix.map((s) => (
                        <li key={s.n} className="text-meta text-muted-foreground">
                          {s.n}. ({s.kind}) {s.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {o.whatWins ? (
          <div className="mt-2 rounded-lg bg-surface-raised px-2.5 py-1.5">
            <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">What the cited page has</div>
            <div className="mt-0.5 text-body leading-snug text-foreground-secondary">{o.whatWins}</div>
          </div>
        ) : null}
        {o.infoGain ? (
          <div className="mt-2 rounded-lg bg-surface-raised px-2.5 py-1.5">
            <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
              {o.infoGain.verdict === "adds_something" ? "What this page adds" : "Overlap check"}
            </div>
            <div className="mt-0.5 text-body leading-snug text-foreground-secondary">{o.infoGain.sentence}</div>
          </div>
        ) : null}
        {shown ? (
          (() => {
            const vs = VERDICT_STYLE[shown.verdict] ?? VERDICT_STYLE.wait;
            return (
              <div className="mt-2 rounded-lg border border-status-info/15 bg-status-info-bg px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill intent={vs.intent} className="font-bold tracking-wide">{vs.label}</Pill>
                  <span className="text-meta font-medium uppercase tracking-wide text-muted-foreground">{shown.confidence} confidence</span>
                  <Pill intent="live">✓ Google checked{shown.prepared ? "" : " · just now"}</Pill>
                </div>
                <p className="mt-1 text-body leading-snug text-foreground-secondary">{plainSerpReason(shown.reason)}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
                  <span>{shown.contentDomainCount}/10 content</span>
                  {/* B10 (worklist fix batch) - plain labels, not unlabeled counts. */}
                  {shown.marketplaceUgcCount > 0 ? <span>{shown.marketplaceUgcCount} shopping site{shown.marketplaceUgcCount === 1 ? "" : "s"} rank{shown.marketplaceUgcCount === 1 ? "s" : ""} here</span> : null}
                  {shown.profoundOverlapCount > 0 ? <span className="font-semibold text-status-success">cited by AI alongside {shown.profoundOverlapCount} rival{shown.profoundOverlapCount === 1 ? "" : "s"}</span> : null}
                  {shown.ownAlreadyRanks ? <span className="font-semibold text-status-warning">you already rank</span> : null}
                </div>
                {shown.topDomains.length > 0 ? (
                  <p className="mt-1 truncate text-meta text-muted-foreground">SERP: {shown.topDomains.slice(0, 5).join(", ")}</p>
                ) : null}
              </div>
            );
          })()
        ) : serp && !serp.ok ? (
          <p className="mt-2 text-meta text-muted-foreground">{serp.reason}</p>
        ) : serp && serp.ok ? (
          <p className="mt-2 text-meta text-muted-foreground">
            {serp.status === "dry_run" ? "Dry run, set DATAFORSEO_DRY_RUN=false to validate live." : serp.status === "capped" ? "SERP budget cap reached." : serp.status === "disabled" ? "DataForSEO not connected." : "No SERP result."}
          </p>
        ) : null}
        {/* Prefer the full create_page_brief over a standalone saved opening: when a
            quality-ready brief exists, its opening is canonical — don't also show the
            older savedOpening (avoids a redundant or worse second opening). */}
        {aiStatus === "ok" &&
        !(o.preparedBrief && (o.briefQuality?.status === "ready" || o.briefQuality?.status === "useful_but_needs_review")) ? (
          (() => {
            const oq = o.openingQuality;
            const copyOk = oq ? oq.copyAllowed : true;
            const flagged = oq && oq.status !== "ready";
            return (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className={`text-meta font-semibold uppercase tracking-wide ${flagged ? "text-status-warning" : "text-violet-500"}`}>
                    {flagged ? "Draft opening, needs review" : "Draft opening"}
                  </span>
                  {copyOk ? (
                    <button onClick={copy} className="rounded-md bg-violet-600 px-2 py-0.5 text-meta font-semibold text-background hover:bg-violet-500">
                      {copied ? "Copied ✓" : "Copy"}
                    </button>
                  ) : null}
                </div>
                {flagged && oq!.reasons[0] ? <p className="mb-1 text-meta text-status-warning">{oq!.reasons[0]}</p> : null}
                <p className={`rounded-lg p-2 text-body leading-relaxed ring-1 ${copyOk ? "bg-card text-foreground-secondary ring-violet-100" : "bg-surface-raised text-muted-foreground ring-border"}`}>{aiText}</p>
              </div>
            );
          })()
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/changes#new-pages"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-body font-semibold text-foreground-secondary transition-colors hover:border-status-success/40 hover:bg-status-success-bg hover:text-status-success"
        >
          Plan this page →
        </Link>
        <button
          onClick={validate}
          disabled={serpPending}
          title="Run a live Google SERP check (DataForSEO) and verdict this page: build, wait, or skip"
          className="inline-flex items-center gap-1 rounded-lg border border-status-info/20 bg-status-info-bg px-2.5 py-1.5 text-body font-semibold text-status-info transition-colors hover:opacity-80 disabled:opacity-60"
        >
          {serpPending ? "Checking SERP…" : shown ? "↻ Re-check SERP" : "Validate with live SERP"}
        </button>
        {aiStatus !== "ok" ? (
          <button
            onClick={generate}
            disabled={pending || aiStatus === "pending"}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-body font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-60"
          >
            {aiStatus === "pending" ? "Writing…" : "✨ Draft the opening"}
          </button>
        ) : null}
        {aiStatus === "off" ? (
          <span className="text-meta text-muted-foreground">AI drafting is off</span>
        ) : aiStatus === "blocked" ? (
          <span className="text-meta text-status-warning">budget reached</span>
        ) : aiStatus === "rejected" || aiStatus === "error" ? (
          <span className="text-meta text-muted-foreground">try again later</span>
        ) : null}
        {o.preparedBrief && (o.briefQuality?.status === "ready" || o.briefQuality?.status === "useful_but_needs_review" || !o.briefQuality) ? (
          <button
            onClick={draftFullPage}
            disabled={fullPagePending || fullPageStatus === "pending"}
            title="Walk the brief section by section into a paste-ready page with sources (up to 8 sections, about $0.02 to $0.05, one page per click)"
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-body font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-60"
          >
            {fullPageStatus === "pending" ? "Drafting page…" : fullPage ? "↻ Redraft full page" : "Draft the full page (~$0.02-0.05)"}
          </button>
        ) : null}
        {fullPageStatus === "off" ? (
          <span className="text-meta text-muted-foreground">AI drafting is off</span>
        ) : fullPageStatus === "budget" ? (
          <span className="text-meta text-status-warning">budget reached</span>
        ) : fullPageStatus === "error" ? (
          <span className="text-meta text-muted-foreground">try again later</span>
        ) : null}
      </div>
    </Card>
  );
}

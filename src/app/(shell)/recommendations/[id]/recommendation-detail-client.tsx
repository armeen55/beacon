/**
 * RecommendationDetailClient — Bundle 2B premium brief page.
 *
 * Renders one `RecommendationActionRow` as a 5-act narrative:
 *
 *   Act 1 — Recommendation       (what Beacon recommends)
 *   Act 2 — Why this matters     (one paragraph; never a JSON dump)
 *   Act 3 — Evidence             (customer-safe chips + counts only)
 *   Act 4 — Measurement plan     (what Beacon will watch + window)
 *   Act 5 — Next step            (inline action surface + back to list)
 *
 * Open-only first pass: every action CTA links back into the legacy
 * /recommendations?legacy=1 view at the row's #rec-<sourceRecommendationId>
 * anchor. The legacy drawer remains the authoritative accept / defer /
 * dismiss surface. Bundle 2C (or later) will wire those actions in
 * directly when the operator says it's safe.
 *
 * Customer-vocabulary contract:
 *   - Never renders raw IDs, hashes, resolver tiers, evidence_tier
 *     labels, raw enum keys, or score numbers.
 *   - Status / confidence labels drawn from the operator-locked
 *     vocabulary tables (mirrors the v2 card).
 *   - Evidence summary uses the cleaned `evidenceSummary` /
 *     `detail.why` / `detail.measurementPlan` strings already produced
 *     by the action-row builder.
 *
 * Pure presentation. Server actions are NOT invoked from this client.
 */

import Link from "next/link";

import type { PageSurgeonForUrl } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import { PageSurgeonPanel } from "./page-surgeon-panel";

import {
  ACTION_ROW_TYPE_LABEL,
  ACTION_ROW_PRIORITY_LABEL,
  ACTION_ROW_STATUS_LABEL,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import {
  isIndexingDirectiveActionType,
  INDEXING_DIRECTIVE_CAVEAT,
} from "@/domains/recommendations/action-types";
import { buildCopyTile } from "@/domains/recommendations/suggested-copy-adapters";
import { deriveRecQaDisplay } from "@/domains/recommendations/recommendation-qa";
import { checkWhyDisplaySafe } from "@/domains/recommendations/why-display-guard";
import { filterDisplaySafeEvidenceLines } from "@/domains/recommendations/evidence-line-display-guard";
import {
  buildWhyInput,
  composeWhyThisMatters,
} from "@/domains/recommendations/why-this-matters-narrative";
import { cn } from "@/lib/utils";
import { RecommendationDetailActions } from "./recommendation-detail-actions";
import { WhyThisMattersAct } from "./why-this-matters-act";
import { StrategistAct } from "./strategist-act";
import { SuggestedCopyAct } from "./suggested-copy-act";
import { parseGscEvidenceStats } from "@/components/recommendations/v2/recommendation-v2-card";

// ─────────────────────────────────────────────────────────────────────
// Style tables (mirror the v2 card's vocabulary so the brief feels
// continuous with the card stack)
// ─────────────────────────────────────────────────────────────────────

const STATUS_PILL_TONE: Record<ActionRowStatus, string> = {
  new: "bg-accent-primary/10 text-accent-primary",
  accepted: "bg-status-info/10 text-status-info",
  shipped: "bg-status-success/10 text-status-success",
  measuring: "bg-status-warning/10 text-status-warning",
  needs_review: "bg-muted-foreground/10 text-muted-foreground",
  needs_fresh_edit: "bg-muted-foreground/10 text-muted-foreground",
  dismissed: "bg-muted-foreground/10 text-muted-foreground",
  deferred: "bg-muted-foreground/10 text-muted-foreground",
};

const STATUS_LABEL_OVERRIDE: Partial<Record<ActionRowStatus, string>> = {
  new: "Suggested",
  deferred: "Snoozed",
};

function statusLabel(status: ActionRowStatus): string {
  return STATUS_LABEL_OVERRIDE[status] ?? ACTION_ROW_STATUS_LABEL[status];
}

const CONFIDENCE_DOT: Record<RecommendationActionRow["derivedConfidence"], string> = {
  strong_evidence: "bg-status-success",
  moderate_evidence: "bg-status-warning",
  needs_review: "bg-muted-foreground/40 ring-1 ring-muted-foreground/40",
};

const CONFIDENCE_LABEL: Record<RecommendationActionRow["derivedConfidence"], string> = {
  strong_evidence: "High confidence",
  moderate_evidence: "Medium confidence",
  needs_review: "Needs more evidence",
};

const CONFIDENCE_DESCRIPTION: Record<
  RecommendationActionRow["derivedConfidence"],
  string
> = {
  strong_evidence:
    "Multiple grounding signals support this — Beacon thinks it's worth shipping.",
  moderate_evidence:
    "Some signals are present, but the picture isn't fully clear yet.",
  needs_review:
    "Beacon needs more evidence before this should be shipped. Use your judgment.",
};

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export type RecommendationDetailClientProps = {
  row: RecommendationActionRow;
  changelogId: string | null;
  promptTextById: Record<string, string>;
  /** Slice 4.5.G-B.1 — active tracked-entity competitor names for
   *  the render-time `why`-display guard. Optional; when omitted or
   *  empty, competitor-name detection is inactive but UUID + long-
   *  hex + internal-token detection still fires. */
  competitorNames?: ReadonlyArray<string>;
  /** Approve & Push exposure (2026-06-16) — server-computed publish
   *  authorization for the current tenant; threaded to the action row. */
  canPublish?: boolean;
  /** Page Surgeon bridge (operator-only, read-only) — the evidence-based plan
   *  for this rec's target page. null in customer mode / when unavailable. */
  pageSurgeon?: PageSurgeonForUrl | null;
};

export function RecommendationDetailClient({
  row,
  changelogId,
  promptTextById,
  competitorNames,
  canPublish = false,
  pageSurgeon = null,
}: RecommendationDetailClientProps) {
  const target =
    row.targetUrl && row.targetUrl !== "needs_new_page" ? row.targetUrl : null;
  const targetLabel = row.targetLabel;
  // Slice 4.5.G-B.1 — render-time guard on the customer-visible
  // `why` field. Replaces unguarded `evidenceSummary || detail.why`
  // with a guarded sibling; blocked inputs render the calm fallback
  // instead of the raw leaked text.
  const rawWhy =
    row.evidenceSummary?.trim() || row.detail.why?.trim() || null;
  const whyGuard = checkWhyDisplaySafe(rawWhy, { competitorNames });
  const why = rawWhy === null
    ? null
    : whyGuard.ok
      ? whyGuard.text
      : whyGuard.fallback;
  // #296 — when the lead summary IS the structured GSC line, render it as
  // a scannable stat strip in the header instead of a prose sentence.
  const gscStats = parseGscEvidenceStats(row.evidenceSummary);
  // 2026-06-15 — per-query "why this, why now" evidence (exact query +
  // impressions + rank + click-through vs typical + recoverable visits),
  // built from the rec's GSC signal. Empty when no quotable query.
  //
  // Expert-rec-engine Slice 1 (2026-06-16): every evidence-line surface now
  // passes the SAME display guard as `why` (uuid / internal-token / competitor
  // / white-labeled vendor). A line that would leak is SUPPRESSED, not rendered
  // — closing the audit's BUG #5 (these lines previously rendered unguarded).
  const evGuard = { competitorNames };
  const gscEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.gscEvidenceLines,
    evGuard,
  );
  // 2026-06-15 follow-up — SEMrush evidence (exact search volume + keyword
  // difficulty + current rank), built from the rec's SEMrush signal. Default
  // [] mirrors the GSC guard so a row without it never crashes.
  const semrushEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.semrushEvidenceLines,
    evGuard,
  );
  // 2026-06-15 — Microsoft Clarity friction evidence (rage-clicks / page
  // errors) + AI-answer gap evidence (white-label). Same [] guard; dormant
  // until those sources are connected.
  const clarityEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.clarityEvidenceLines,
    evGuard,
  );
  const aeoEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.aeoEvidenceLines,
    evGuard,
  );
  const measurementPlan = row.detail.measurementPlan?.trim() || null;
  const competitor = row.detail.topCompetitor;
  const observationCount = row.detail.observationCount;
  const promptCount = row.detail.affectedPromptCount;

  // Act 3 evidence tile for Google Search demand (2026-06-16). Reduce the
  // parsed GSC stats to ONE headline tile: impressions as the value (the
  // demand magnitude), with clicks / position / CTR in the hint. Null when
  // this rec carries no GSC stat line.
  const gscDemandTile: { value: string; hint: string } | null = (() => {
    if (!gscStats || gscStats.length === 0) return null;
    const byKey = (k: string) => gscStats.find((s) => s.key === k)?.value;
    const impressions = byKey("impressions");
    if (!impressions) return null;
    const parts: string[] = [];
    const clicks = byKey("clicks");
    const pos = byKey("position");
    const ctr = byKey("ctr");
    if (clicks) parts.push(`${clicks} clicks`);
    if (pos) parts.push(`avg position ${pos}`);
    if (ctr) parts.push(`${ctr} CTR`);
    const tail = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
    return {
      value: `${impressions} impressions`,
      hint: `Google Search, last 90 days${tail}.`,
    };
  })();

  // Any non-AEO grounding present? Post-pivot the evidence grid must not
  // claim "no signals" when GSC / SEMrush / Clarity / AI-answer grounding
  // exists (it just isn't prompt/observation/competitor shaped).
  const hasGroundingEvidence =
    promptCount > 0 ||
    observationCount > 0 ||
    !!competitor ||
    gscDemandTile != null ||
    gscEvidenceLines.length > 0 ||
    semrushEvidenceLines.length > 0 ||
    clarityEvidenceLines.length > 0 ||
    aeoEvidenceLines.length > 0;

  // Top affected prompts — render up to 3 prompt-text snippets when
  // available. Falls back to the count alone when the lookup is missing.
  const affectedPromptTexts = (() => {
    const texts: string[] = [];
    for (const ref of row.detail.evidenceRefs) {
      if (texts.length >= 3) break;
      // SpecificEditEvidenceRef shape varies; we look for { promptId }
      // entries since that's the field promptTextById is keyed on.
      const promptId =
        (ref as { promptId?: string | null }).promptId ?? null;
      if (!promptId) continue;
      const text = promptTextById[promptId];
      if (typeof text === "string" && text.trim().length > 0) {
        texts.push(text.trim());
      }
    }
    return texts;
  })();

  // Act 2 narrative synthesis (2026-06-16) — replace the thin single
  // `why` line + generic confidence hedge with a SPECIFIC, grounded,
  // multi-sentence "why this matters" built from the evidence the row
  // already carries (exact query, competitor share, the gap the edit
  // closes, on-page friction). Pure helper; feeds the ALREADY-GUARDED
  // `why` so no new unguarded text is introduced. Honest + white-label:
  // it omits any clause whose data is absent and never names the
  // answer-engine vendor.
  //
  // The input assembly is lifted into `buildWhyInput` (shared with the
  // LLM server action) so the deterministic baseline AND the optional
  // LLM sharpening start from byte-identical input. This is the INSTANT
  // baseline; `WhyThisMattersAct` then post-mount-enhances it via the
  // flagged LLM path (no-op when BEACON_LLM_WHY is off).
  const whyThisMatters = composeWhyThisMatters(
    buildWhyInput(row, promptTextById, competitorNames),
  );

  // Bundle 2C (2026-05-11) — legacy-anchor and open-change hrefs moved
  // into RecommendationDetailActions where they sit alongside the inline
  // action buttons. The client component below renders them as secondary
  // CTAs in the final act.

  // Recommendation Execution Layer v1 Phase A (2026-05-13) — decide
  // whether to render the Suggested Copy act between Evidence and
  // Measurement. When the adapter returns a tile (supported action type
  // + non-empty proposed_text + passes display guard), we add Act 4 and
  // shift Measurement → Act 5, Next → Act 6. When the adapter returns
  // null, the existing acts keep their original indices.
  const showSuggestedCopy = buildCopyTile(row) !== null;
  const measurementIndex = showSuggestedCopy ? 5 : 4;
  const nextStepIndex = showSuggestedCopy ? 6 : 5;

  // RENDER ENFORCEMENT (2026-06-16) — the deterministic QA verdict (attached to
  // every row by `buildRecommendationActionRows`) decides the customer-visible
  // status. A capped/rejected fresh suggestion must NOT read "Suggested": the
  // header pill shows "Rejected by QA" / "Needs more evidence" / "Needs review"
  // in a cautionary tone. The CTA gating lives in RecommendationDetailActions.
  const detailIsSuggestion =
    row.status === "new" ||
    row.status === "needs_review" ||
    row.status === "needs_fresh_edit";
  const qaDisplay = deriveRecQaDisplay({
    qaVerdict: row.detail?.qaVerdict ?? null,
    isSuggestion: detailIsSuggestion,
  });
  const headerStatusLabel = qaDisplay.statusOverride ?? statusLabel(row.status);

  return (
    <div
      className="max-w-4xl space-y-6"
      data-recommendations-detail-layout="v2-brief"
      data-recommendation-detail-status={row.status}
    >
      {/* Back link */}
      <Link
        href="/recommendations?v2=1"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        data-recommendations-detail-back="true"
      >
        ← Recommendations
      </Link>

      {/* Header: status + confidence + headline + target */}
      <header
        className="space-y-3"
        data-recommendation-detail-header="true"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
              qaDisplay.statusOverride
                ? "bg-status-warning/10 text-status-warning"
                : STATUS_PILL_TONE[row.status],
            )}
            data-recommendation-detail-status-pill="true"
            data-recommendation-detail-status-override={
              qaDisplay.statusOverride ? "true" : undefined
            }
          >
            {headerStatusLabel}
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80"
            data-recommendation-detail-confidence={row.derivedConfidence}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                CONFIDENCE_DOT[row.derivedConfidence],
              )}
            />
            {CONFIDENCE_LABEL[row.derivedConfidence]}
          </span>
        </div>
        <h1
          className="text-[20px] font-semibold text-foreground leading-tight"
          data-recommendation-detail-title="true"
        >
          {row.title}
        </h1>
        <p className="text-[12px] leading-snug">
          <span className="text-muted-foreground">→</span>{" "}
          {target ? (
            <span
              className="text-accent-primary font-mono tabular-nums break-all"
              data-recommendation-detail-target-url="true"
            >
              {shortUrl(target)}
            </span>
          ) : (
            <span
              className="text-muted-foreground"
              data-recommendation-detail-target-label="true"
            >
              {targetLabel}
            </span>
          )}
        </p>
        {gscStats ? (
          <div
            className="flex flex-wrap items-baseline gap-x-5 gap-y-1"
            data-recommendation-detail-gsc-stats="true"
          >
            {gscStats.map((stat) => (
              <span
                key={stat.key}
                className="inline-flex items-baseline gap-1"
                data-recommendation-detail-gsc-stat={stat.key}
              >
                <span className="text-[15px] font-semibold tabular-nums text-foreground">
                  {stat.value}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {stat.label}
                </span>
              </span>
            ))}
            <span className="text-[11px] text-muted-foreground/60 w-full">
              Last 90 days, Google Search
            </span>
          </div>
        ) : (
          why && (
            <p
              className="text-[13px] text-foreground/85 leading-relaxed max-w-2xl"
              data-recommendation-detail-lead="true"
            >
              {why}
            </p>
          )
        )}
        {/* 2026-06-15 — the specific "why this, why now" sentence(s) with
            the actual numbers (exact query, times shown, rank,
            click-through vs typical, recoverable visits). Rendered only
            when the GSC signal carried a quotable query. */}
        {gscEvidenceLines.length > 0 && (
          <ul
            className="space-y-1.5 max-w-2xl"
            data-recommendation-detail-gsc-evidence="true"
          >
            {gscEvidenceLines.map((line) => (
              <li
                key={line.key}
                className="text-[13px] text-foreground/85 leading-relaxed"
                data-recommendation-detail-gsc-evidence-line={line.key}
              >
                {line.detail ?? `${line.value} — ${line.label}`}
              </li>
            ))}
          </ul>
        )}
        {/* 2026-06-15 follow-up — SEMrush "why this, why now": the specific
            keyword, its monthly search volume, its difficulty (when known),
            and the current rank. Rendered only when the SEMrush signal carried
            a striking-distance keyword. Reuses the GSC list UI. */}
        {semrushEvidenceLines.length > 0 && (
          <ul
            className="space-y-1.5 max-w-2xl"
            data-recommendation-detail-semrush-evidence="true"
          >
            {semrushEvidenceLines.map((line) => (
              <li
                key={line.key}
                className="text-[13px] text-foreground/85 leading-relaxed"
                data-recommendation-detail-semrush-evidence-line={line.key}
              >
                {line.detail ?? `${line.value} — ${line.label}`}
              </li>
            ))}
          </ul>
        )}
        {/* 2026-06-15 — Microsoft Clarity "why this, why now": on-page
            friction (rage-clicks / page errors) as a percent of sessions.
            Rendered only when the Clarity signal carried friction above the
            sourced thresholds. Reuses the GSC list UI. */}
        {clarityEvidenceLines.length > 0 && (
          <ul
            className="space-y-1.5 max-w-2xl"
            data-recommendation-detail-clarity-evidence="true"
          >
            {clarityEvidenceLines.map((line) => (
              <li
                key={line.key}
                className="text-[13px] text-foreground/85 leading-relaxed"
                data-recommendation-detail-clarity-evidence-line={line.key}
              >
                {line.detail ?? `${line.value} — ${line.label}`}
              </li>
            ))}
          </ul>
        )}
        {/* 2026-06-15 — AI-answer gap "why this, why now" (white-label): AI
            assistants answer this topic citing a rival across ~N answers
            while you're absent. Rendered only when the rec carries
            answer-engine gap evidence. Reuses the GSC list UI. */}
        {aeoEvidenceLines.length > 0 && (
          <ul
            className="space-y-1.5 max-w-2xl"
            data-recommendation-detail-aeo-evidence="true"
          >
            {aeoEvidenceLines.map((line) => (
              <li
                key={line.key}
                className="text-[13px] text-foreground/85 leading-relaxed"
                data-recommendation-detail-aeo-evidence-line={line.key}
              >
                {line.detail ?? `${line.value} — ${line.label}`}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* #310 (2026-06-14) — indexing-safety caveat. Crawl/index
          directives (robots.txt, meta noindex, canonical, redirect) can
          DEINDEX a live site if applied wrong. The brief carries an
          inline Accept action in its final act, so the owner could act on
          one of these rows without the warning — surface it at the top of
          the brief. Benign rows (FAQ / schema / copy / sitemap) render no
          caveat. */}
      {isIndexingDirectiveActionType(row.detail.editActionType) && (
        <p
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.08] px-4 py-3 text-[13px] leading-relaxed text-status-warning"
          role="alert"
          data-recommendation-detail-indexing-caveat="true"
        >
          <span aria-hidden="true">⚠️ </span>
          {INDEXING_DIRECTIVE_CAVEAT}
        </p>
      )}

      {/* Act 1 — Recommendation */}
      <Act
        index={1}
        label="What Beacon suggests"
        dataAttr="act-recommendation"
      >
        <div className="space-y-2 text-[13px]">
          <p>
            <span className="text-muted-foreground">What:</span>{" "}
            <span className="font-medium text-foreground">{row.title}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Where:</span>{" "}
            <span className="text-foreground">
              {target ? shortUrl(target) : targetLabel}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Type:</span>{" "}
            <span className="text-foreground">
              {ACTION_ROW_TYPE_LABEL[row.actionType]}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">Priority:</span>{" "}
            <span className="text-foreground">
              {ACTION_ROW_PRIORITY_LABEL[row.priority]}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">Status:</span>{" "}
            <span className="text-foreground">{headerStatusLabel}</span>
          </p>
        </div>
      </Act>

      {/* Act 2 — Why this matters. 2026-06-16: synthesized from the
          evidence the row already carries (exact query, competitor
          share, the gap the edit closes, on-page friction) into 1–4
          short stacked paragraphs that read like an SEO's analysis,
          instead of the old single `why` line + generic hedge. The
          first sentence keeps the `data-recommendation-detail-why`
          attr; the confidence explainer below it keeps the honest
          "needs more evidence" caution ONLY when needs_review — for
          moderate/strong the narrative itself carries the conviction so
          the generic hedge is dropped.

          Slice B (2026-06-16): `WhyThisMattersAct` renders the
          deterministic sentences INSTANTLY, then post-mount calls the
          flagged LLM path (BEACON_LLM_WHY) to SHARPEN them. When the
          flag is off the action always returns null → byte-for-byte
          today's output. Read-only enhancement; never published. */}
      <Act
        index={2}
        label="Why this matters"
        dataAttr="act-why"
      >
        <WhyThisMattersAct
          recId={row.id}
          sentences={whyThisMatters}
        />
        {row.derivedConfidence === "needs_review" && (
          <p
            className="mt-3 text-[12px] leading-relaxed text-muted-foreground"
            data-recommendation-detail-confidence-explainer="true"
          >
            {CONFIDENCE_DESCRIPTION.needs_review}
          </p>
        )}
      </Act>

      {/* PHASE I (2026-06-16) — senior-strategist analysis panel. ON BY
          DEFAULT (no flag); a progressive enhancement layered
          AFTER mount on top of the deterministic brief: the LLM provides the
          expert reasoning (opportunity / why-now / best-move / why-this-beats-
          alternatives / expected outcome / risks) while the DETERMINISTIC gate
          (intent-fit + evidence + safety) sets the confidence verdict and can
          reject — the LLM cannot override it. Renders NOTHING when the flag is
          off or anything fails, so today's brief is unchanged. Read-only;
          never published. */}
      <StrategistAct recId={row.id} />

      {/* Act 3 — Evidence */}
      <Act
        index={3}
        label="Evidence"
        dataAttr="act-evidence"
      >
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          data-recommendation-detail-evidence-grid="true"
        >
          {promptCount > 0 && (
            <EvidenceTile
              label="Prompts affected"
              value={`${promptCount}`}
              hint={
                promptCount === 1
                  ? "1 tracked prompt grounds this recommendation."
                  : `${promptCount} tracked prompts ground this recommendation.`
              }
              dataAttr="prompts"
            />
          )}
          {observationCount > 0 && (
            <EvidenceTile
              label="AI answers analyzed"
              value={`${observationCount}`}
              hint={
                observationCount === 1
                  ? "Beacon read 1 AI answer to ground this."
                  : `Beacon read ${observationCount} AI answers to ground this.`
              }
              dataAttr="ai-answers"
            />
          )}
          {competitor && (
            <EvidenceTile
              label="Competitor pressure"
              value={truncate(competitor.name, 24)}
              hint={`${Math.round(competitor.primaryPct * 100)}% of analyzed AI answers cite this competitor.`}
              dataAttr="competitor"
            />
          )}
          {/* Google Search demand (2026-06-16) — post-pivot, GSC is the
              primary SEO grounding. The evidence grid used to count ONLY
              AEO chips (prompts / AI answers / competitor), so a
              GSC-grounded rec (e.g. a title rewrite off real search demand)
              fell through to the "no specific grounding signals" empty state
              even though the headline + Act 2 show rich GSC numbers. Surface
              the search demand as a first-class evidence tile. */}
          {gscDemandTile && (
            <EvidenceTile
              label="Google Search demand"
              value={gscDemandTile.value}
              hint={gscDemandTile.hint}
              dataAttr="gsc-demand"
            />
          )}
          {semrushEvidenceLines.length > 0 && (
            <EvidenceTile
              label="Keyword rankings"
              value={`${semrushEvidenceLines.length}`}
              hint={
                semrushEvidenceLines.length === 1
                  ? "1 ranked keyword grounds this recommendation."
                  : `${semrushEvidenceLines.length} ranked keywords ground this recommendation.`
              }
              dataAttr="semrush"
            />
          )}
          {row.detail.evidenceDepth >= 4 && (
            <EvidenceTile
              label="Applies to this page"
              value="Strong"
              hint="Multiple grounding signals point at the same page."
              dataAttr="depth"
            />
          )}
        </ul>

        {affectedPromptTexts.length > 0 && (
          <div
            className="mt-4 rounded-md border border-border/40 bg-surface-inset/30 px-4 py-3"
            data-recommendation-detail-prompt-snippets="true"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Top affected prompts
            </p>
            <ul className="mt-2 space-y-1.5">
              {affectedPromptTexts.map((t, i) => (
                <li
                  key={i}
                  className="text-[12px] text-foreground/90 leading-snug"
                >
                  &ldquo;{t}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        )}

        {!hasGroundingEvidence && (
          <p
            className="text-[12px] text-muted-foreground leading-relaxed"
            data-recommendation-detail-evidence-empty="true"
          >
            No specific grounding signals are available for this
            recommendation yet. Beacon may surface more as new readings land.
          </p>
        )}
      </Act>

      {/* Act 4 — Suggested copy. Renders only when the adapter returns a
          tile (supported action type + non-empty proposed_text + passes
          display-safety guard). When suppressed, Measurement keeps its
          original Act 4 numbering via `measurementIndex`. */}
      {showSuggestedCopy && (
        <SuggestedCopyAct
          row={row}
          index={4}
          competitorNames={competitorNames}
        />
      )}

      {/* Act 5 — Measurement plan (Act 4 when Suggested copy is suppressed). */}
      <Act
        index={measurementIndex}
        label="How Beacon will measure it"
        dataAttr="act-measurement"
      >
        {measurementPlan ? (
          <p
            className="text-[13px] text-foreground/85 leading-relaxed max-w-2xl"
            data-recommendation-detail-measurement="true"
          >
            {measurementPlan}
          </p>
        ) : row.status === "dismissed" || row.status === "deferred" ? (
          // QA polish (2026-05-11): dismissed / snoozed rows aren't in
          // flight, so the "Beacon will watch the page after the change
          // ships" fallback reads as a non-sequitur. Suppress it; the
          // status pill above is enough context for the operator.
          <p
            className="text-[13px] text-muted-foreground leading-relaxed max-w-2xl"
            data-recommendation-detail-measurement-suppressed="true"
          >
            Measurement will resume if this recommendation is reopened.
          </p>
        ) : (
          <p
            className="text-[13px] text-foreground/85 leading-relaxed max-w-2xl"
            data-recommendation-detail-measurement="true"
          >
            {/* Trust audit fix D (2026-06-16): only claim AI-citation tracking
                when this rec actually has AI-answer evidence. A GSC/search move
                with no AI signal is measured by Google Search performance. */}
            {observationCount > 0 || aeoEvidenceLines.length > 0 ? (
              <>
                Beacon will watch this page&apos;s AI-answer citation rate on the
                affected prompts after the change ships, and surface the result
                on{" "}
              </>
            ) : (
              <>
                Beacon will re-check this page in Google Search — impressions,
                clicks, and average position — after the change ships, and
                surface the result on{" "}
              </>
            )}
            <Link
              href="/proof"
              className="text-accent-primary hover:underline"
            >
              Results
            </Link>
            .
          </p>
        )}
        <p
          className="mt-3 text-[12px] text-muted-foreground"
          data-recommendation-detail-current-status="true"
        >
          Current status: <span className="text-foreground">{headerStatusLabel}</span>.
          {(row.status === "accepted" ||
            row.status === "measuring" ||
            row.status === "shipped") &&
            " Beacon is watching impact."}
        </p>
      </Act>

      {/* Final act — Next step (Act 6 when Suggested copy renders, Act 5
          otherwise). Bundle 2C (2026-05-11): inline action surface
          replaces the prior read-only escape-hatch list. Each button
          calls the SAME server action the legacy table calls; the
          legacy drawer remains a one-click fallback for transitions
          v2 doesn't surface yet (e.g., Regenerate for needs_fresh_edit). */}
      <Act
        index={nextStepIndex}
        label="What to do next"
        dataAttr="act-next"
      >
        <RecommendationDetailActions
          row={row}
          changelogId={changelogId}
          canPublish={canPublish}
          pageSurgeonSupersedes={pageSurgeon?.status === "pack"}
        />
      </Act>

      <PageSurgeonPanel pageSurgeon={pageSurgeon} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function Act({
  index,
  label,
  dataAttr,
  children,
}: {
  index: number;
  label: string;
  dataAttr: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5"
      data-recommendation-detail-act={dataAttr}
      data-recommendation-detail-act-index={index}
    >
      <header className="flex items-baseline gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          Step {index}
        </span>
        <h2 className="text-[14px] font-semibold text-foreground">
          {label}
        </h2>
      </header>
      {children}
    </section>
  );
}

function EvidenceTile({
  label,
  value,
  hint,
  dataAttr,
}: {
  label: string;
  value: string;
  hint: string;
  dataAttr: string;
}) {
  return (
    <li
      className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5"
      data-recommendation-detail-evidence-tile={dataAttr}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </p>
      <p className="mt-1 text-[16px] font-semibold tabular-nums leading-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground/85 leading-snug">
        {hint}
      </p>
    </li>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

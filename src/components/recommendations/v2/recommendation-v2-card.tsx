/**
 * RecommendationV2Card — premium card for the /recommendations?v2=1 stack.
 *
 * Bundle 2A of the maximum-depth UI/product audit (plan file:
 * `~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`). Replaces the
 * legacy table row + drawer with a self-contained card that surfaces:
 *   • status + confidence at a glance
 *   • the recommendation as a plain-English headline
 *   • the target page (mono path) when one exists
 *   • a one-line "evidence summary" already produced by the action-row builder
 *   • up to 3 evidence chips derived from already-loaded fields
 *   • one primary CTA ("Review →" linking back into legacy view at the row's
 *     #rec anchor — the legacy drawer remains the authoritative accept /
 *     defer / dismiss surface for this first pass)
 *
 * Pure presentation. Zero data plumbing changes; consumes
 * `RecommendationActionRow` from the existing
 * `buildRecommendationActionRows` helper, the same shape the legacy
 * `RecommendationsClient` table renders. Open-only for Bundle 2A — no
 * action mutation, no new server action wiring.
 *
 * Customer-vocabulary contract (forbidden-vocabulary guardrail):
 *   • Never renders raw schema fields, IDs, hashes, resolver tiers,
 *     stable keys, evidence_tier labels, raw enum keys, or score numbers.
 *   • Confidence renders as plain English ("High", "Medium", "Lower
 *     confidence — optional"). Status pills use the operator-friendly
 *     labels already locked in `ACTION_ROW_STATUS_LABEL`.
 */

import Link from "next/link";

import {
  ACTION_ROW_TYPE_LABEL,
  ACTION_ROW_STATUS_LABEL,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import {
  isIndexingDirectiveActionType,
  INDEXING_DIRECTIVE_CAVEAT,
} from "@/domains/recommendations/action-types";
import { checkWhyDisplaySafe } from "@/domains/recommendations/why-display-guard";
import { filterDisplaySafeEvidenceLines } from "@/domains/recommendations/evidence-line-display-guard";
import { deriveRecQaDisplay } from "@/domains/recommendations/recommendation-qa";
import { classifyRecProvenance } from "@/domains/recommendations/rec-provenance";
import { cn } from "@/lib/utils";
import { buildRecommendationDetailHref } from "./recommendation-route-id";

// ─────────────────────────────────────────────────────────────────────
// Pill + dot tone tables (operator-locked vocabulary)
// ─────────────────────────────────────────────────────────────────────

const STATUS_PILL_TONE: Record<ActionRowStatus, string> = {
  new: "bg-accent-primary/10 text-accent-primary",
  accepted: "bg-status-success/10 text-status-success",
  shipped: "bg-status-success/10 text-status-success",
  measuring: "bg-status-warning/10 text-status-warning",
  needs_review: "bg-muted-foreground/10 text-muted-foreground",
  needs_fresh_edit: "bg-muted-foreground/10 text-muted-foreground",
  dismissed: "bg-muted-foreground/10 text-muted-foreground",
  deferred: "bg-muted-foreground/10 text-muted-foreground",
};

// Customer-friendly relabel layered over the operator-locked status
// labels. The operator-locked labels still apply elsewhere; v2 cards
// soften two of them ("New" → "Suggested", "Deferred" → "Snoozed")
// so the customer reads the page as a strategic queue rather than a
// task tracker.
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
  strong_evidence: "High",
  moderate_evidence: "Medium",
  // 2026-06-14 — softened from "Needs more evidence" to a non-blocking,
  // optional framing so a low-confidence card doesn't read as scary on
  // an action the owner is invited to take.
  needs_review: "Lower confidence, optional",
};

// ─────────────────────────────────────────────────────────────────────
// Evidence chips — derived from already-loaded RecommendationActionRow
// fields. Returns at most 3 chips per the audit's card spec.
// ─────────────────────────────────────────────────────────────────────

type Chip = { key: string; label: string; tone: "neutral" | "accent" | "success" };

export function deriveEvidenceChips(row: RecommendationActionRow): Chip[] {
  const chips: Chip[] = [];

  // Chip 1 — action-type label (always present). Operator-locked
  // single-word taxonomy (FAQ, Schema, Section, Page, …).
  chips.push({
    key: "type",
    label: ACTION_ROW_TYPE_LABEL[row.actionType],
    tone: "neutral",
  });

  // Chip 2 — affected prompt count, when the row has at least one
  // tracked prompt grounding it.
  const promptCount = row.detail.affectedPromptCount;
  if (promptCount > 0) {
    chips.push({
      key: "prompts",
      label: `${promptCount} prompt${promptCount === 1 ? "" : "s"} affected`,
      tone: "accent",
    });
  }

  // Chip 3 — competitor pressure OR evidence-depth chip OR AI-drafted
  // chip, in priority order. Only one survives so total chip count
  // stays at 3.
  const competitor = row.detail.topCompetitor;
  if (competitor) {
    chips.push({
      key: "competitor",
      label: `Beat ${truncate(competitor.name, 18)}`,
      tone: "accent",
    });
    return chips.slice(0, 3);
  }

  // audit-wave7 #8: don't render the "Applies to this page" success chip when
  // the deterministic QA page-topic-fit gate says this page does NOT fit the
  // query (shouldUseQueryForOptimization === false) — a direct contradiction
  // with the verdict the card itself surfaces.
  const fitOk =
    row.detail.qaVerdict?.intentFit?.shouldUseQueryForOptimization !== false;
  if (row.detail.evidenceDepth >= 4 && fitOk) {
    chips.push({
      key: "depth",
      label: "Applies to this page",
      tone: "success",
    });
    return chips.slice(0, 3);
  }

  if (row.editSource === "openai") {
    chips.push({
      key: "drafted",
      label: "Suggested edit",
      tone: "neutral",
    });
  }

  return chips.slice(0, 3);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// ─────────────────────────────────────────────────────────────────────
// #296 — Google Search stat strip. When the row's one-line evidence
// summary IS the structured 90-day GSC line (built in
// `buildEvidenceSummary`: "X clicks · Y impressions · Z% CTR · avg
// position N (90-day Google Search)"), surface those four numbers as
// small scannable stats instead of a prose paragraph. Pure display:
// the data is already on the row — no new plumbing. Returns null when
// the summary isn't the GSC line, so non-GSC rows keep their prose.
// ─────────────────────────────────────────────────────────────────────

export type GscStat = { key: string; label: string; value: string };

const GSC_EVIDENCE_RE =
  /^([\d,]+)\s+clicks\s+·\s+([\d,]+)\s+impressions\s+·\s+([\d.]+)%\s+CTR\s+·\s+avg position\s+([\d.]+)\s+\(90-day Google Search\)$/;

export function parseGscEvidenceStats(
  summary: string | null | undefined,
): GscStat[] | null {
  if (!summary) return null;
  const m = GSC_EVIDENCE_RE.exec(summary.trim());
  if (!m) return null;
  const [, clicks, impressions, ctrPct, pos] = m;
  return [
    { key: "impressions", label: "times shown on Google", value: impressions },
    { key: "clicks", label: "visits from Google", value: clicks },
    { key: "position", label: "average Google rank", value: pos },
    { key: "ctr", label: "click rate", value: `${ctrPct}%` },
  ];
}

const CHIP_TONE_CLASS: Record<Chip["tone"], string> = {
  neutral: "border-border/60 bg-surface-inset/40 text-muted-foreground",
  accent: "border-accent-primary/30 bg-accent-primary/[0.06] text-accent-primary",
  success: "border-status-success/30 bg-status-success/[0.06] text-status-success",
};

// ─────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────

export type RecommendationV2CardProps = {
  row: RecommendationActionRow;
  /** One-tap slice (2026-06-12): when provided, the card renders a
   *  primary "Accept" button that invokes this handler (the parent
   *  wires the existing acceptRecommendation server action). The
   *  card stays presentation-only — pending/done state is driven by
   *  `acceptState`. */
  onAccept?: () => void;
  /** Armed publishing (2026-06-16): when provided, the primary CTA becomes
   *  "Accept & publish" — one click accepts AND publishes the edit live (the
   *  parent wires acceptAndPublishRecommendation; the server re-checks the
   *  armed + QA + structural gates). Only set by the parent when this row is
   *  armed-eligible (safe, mapped, high-confidence, live target). Falls back to
   *  the staged `onAccept` when undefined. */
  onAcceptAndPublish?: () => void;
  acceptState?: "idle" | "pending" | "accepted" | "error";
  /** #316 — the actual error text from a failed Accept (the server action
   *  returns `{error}`). Rendered on the error state so the owner can see
   *  WHAT failed instead of a generic line. Optional. */
  acceptError?: string;
  /** #316 — retry the Accept for this specific card. When provided, the
   *  error state renders a "Try again" button so a failed card isn't a
   *  dead end. Defaults to `onAccept` semantics in the parent. */
  onRetry?: () => void;
  /** When provided, "Review" links to a custom href. Defaults to the
   *  Bundle 2B detail page at `/recommendations/<encoded-row-id>`,
   *  which renders the 5-act brief for this row. */
  reviewHref?: string;
  className?: string;
  /** Slice 4.5.G-B.1 — active tracked-entity competitor names for the
   *  render-time `why`-display guard. Threaded from the parent
   *  list/v2 client. Optional; UUID + long-hex + internal-token
   *  detection still fires when this is empty or omitted. */
  competitorNames?: ReadonlyArray<string>;
  /** Bulk-select slice (2026-06-14): when true, the card renders a
   *  selection checkbox in the header so power users can batch-accept.
   *  Only the parent's actionable cards opt in (already-accepted /
   *  dismissed rows never pass this). Presentation-only — `selected`
   *  drives the checked state, `onToggleSelect` reports the toggle. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Bulk-select slice — keyboard focus highlight. When true the card
   *  draws a subtle accent focus ring so the j/k "focused card" is
   *  visible. Drives no behavior on its own; the parent owns the
   *  keyboard map. */
  isFocused?: boolean;
  /** PSQ (operator-only) — this row's page has a QA-passed Page Surgeon pack.
   *  Renders a "Page Surgeon ready" badge. Absent/false in customer view. */
  pageSurgeonReady?: boolean;
  /** PSQ (operator-only) — the operator's latest review verdict for this page's
   *  pack. Renders a reviewed badge + a "Reopen review" affordance. */
  pageSurgeonReviewVerdict?: "approve" | "reject" | "needs_edit" | null;
  /** Phase 1 cross-surface agreement — when a Change Pack exists for this page,
   *  its primary action is the canonical headline (the SAME one Today + the
   *  Opportunity Map show). It supersedes the legacy `row.title` as the card's
   *  primary truth; the legacy task text demotes to a secondary line. Null ⇒
   *  no pack ⇒ legacy title stays primary. */
  pageSurgeonHeadline?: string | null;
};

export function RecommendationV2Card({
  row,
  reviewHref,
  className,
  competitorNames,
  onAccept,
  onAcceptAndPublish,
  acceptState = "idle",
  acceptError,
  onRetry,
  selectable = false,
  selected = false,
  onToggleSelect,
  isFocused = false,
  pageSurgeonReady = false,
  pageSurgeonReviewVerdict = null,
  pageSurgeonHeadline = null,
}: RecommendationV2CardProps) {
  const chips = deriveEvidenceChips(row);
  // PS2 — provenance label so an old single-field deterministic suggestion is
  // never mistaken for an evidence-rich one (Basic vs Signal-backed vs AI-drafted).
  const provenance = classifyRecProvenance(row.editSource);
  const target = row.targetUrl && row.targetUrl !== "needs_new_page"
    ? row.targetUrl
    : null;
  const targetLabel = row.targetLabel;
  // Bundle 2B (2026-05-10) / 2026-05-13 cleanup: default CTA is the
  // v2 detail page at `/recommendations/<encoded-row-id>`. Accept /
  // defer / dismiss are wired inline on the detail page (Bundle 2C),
  // and the detail page no longer carries a customer-facing
  // "Open legacy review" fallback — v2 is legacy-hop-free.
  const href = reviewHref ?? buildRecommendationDetailHref(row);

  // One-line "why this matters" — prefer the rec's `evidenceSummary`
  // (already a clean one-liner produced by the action-row builder).
  // Fall back to the cleaned `why` when present. Never displays raw
  // confidence-reason paragraphs.
  //
  // Slice 4.5.G-B.1 — render-time guard. Blocked inputs fall back
  // to the calm operator-readable string from `why-display-guard`.
  const rawWhy =
    row.evidenceSummary?.trim() ||
    row.detail.why?.trim() ||
    null;
  const whyGuard = checkWhyDisplaySafe(rawWhy, { competitorNames });
  const why = rawWhy === null
    ? null
    : whyGuard.ok
      ? whyGuard.text
      : whyGuard.fallback;

  // #296 — when the evidence summary IS the structured GSC line, render
  // it as a scannable stat strip instead of a prose paragraph.
  const gscStats = parseGscEvidenceStats(row.evidenceSummary);

  // 2026-06-15 — per-query "why this, why now" evidence (exact search
  // query + how often the page showed up + current rank + recoverable
  // visits), built from the rec's GSC signal. Shown UNDER the page-level
  // stat strip so the owner sees the specific number that drives the card.
  //
  // Expert-rec-engine Slice 1 (2026-06-16): each evidence-line surface passes
  // the same display guard as `why` (uuid / internal-token / competitor /
  // white-labeled vendor); a leaking line is SUPPRESSED (audit BUG #5).
  const evGuard = { competitorNames };
  const gscEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.gscEvidenceLines,
    evGuard,
  );
  // 2026-06-15 follow-up — SEMrush evidence (exact search volume + keyword
  // difficulty + current rank), built from the rec's SEMrush signal.
  // Default [] mirrors the GSC guard so a row without it never crashes.
  const semrushEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.semrushEvidenceLines,
    evGuard,
  );
  // 2026-06-15 — Microsoft Clarity friction evidence (rage-clicks / page
  // errors) + AI-answer gap evidence (white-label). Same [] guard so a row
  // without either never crashes; dormant until those sources are connected.
  const clarityEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.clarityEvidenceLines,
    evGuard,
  );
  const aeoEvidenceLines = filterDisplaySafeEvidenceLines(
    row.detail.aeoEvidenceLines,
    evGuard,
  );
  // GQA (2026-06-16) — the deterministic generation-time QA verdict. Drives a
  // compact "match + push" caption so the LIST shows the expert read (push
  // readiness + an honest caution when the match/evidence is weak) before the
  // operator clicks in. The confidence pill above is already downgraded on a
  // confident mismatch by the row builder.
  const qa = row.detail.qaVerdict ?? null;
  // RENDER ENFORCEMENT (2026-06-16): the QA verdict gates the visible status
  // pill + the primary CTA + the pushability — a capped/rejected rec can't
  // show "Suggested" + "Accept" + "Paste-ready".
  const isSuggestion =
    row.status === "new" ||
    row.status === "needs_review" ||
    row.status === "needs_fresh_edit";
  const qaDisplay = deriveRecQaDisplay({ qaVerdict: qa, isSuggestion });
  const qaPushLabel = qa == null ? null : qaDisplay.pushLabel;
  const qaCaution =
    qa != null && (qa.confidence === "rejected" || qa.confidence === "low" || qa.confidence === "needs_more_evidence")
      ? qa.confidenceReason
      : null;

  return (
    <article
      className={cn(
        "rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 transition-colors hover:border-accent-primary/40 hover:bg-surface-inset/50",
        selected && "border-accent-primary/50 bg-accent-primary/[0.04]",
        isFocused && "ring-2 ring-accent-primary/50 ring-offset-1 ring-offset-background",
        className,
      )}
      data-recommendation-v2-card="true"
      data-recommendation-v2-status={row.status}
      data-recommendation-v2-selected={selectable ? String(selected) : undefined}
      data-recommendation-v2-focused={isFocused ? "true" : undefined}
    >
      {/* Header — [checkbox] status pill (left) · confidence (right) */}
      <header className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          {selectable && (
            <label
              className="inline-flex items-center cursor-pointer"
              data-recommendation-v2-select-label="true"
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                className="h-3.5 w-3.5 rounded border-border/70 text-accent-primary focus:ring-accent-primary/50 cursor-pointer"
                data-recommendation-v2-select="true"
                aria-label={`Select recommendation: ${row.title}`}
              />
            </label>
          )}
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
              // QA override (Rejected by QA / Needs more evidence / Needs review)
              // gets a cautionary tone, not the accent "Suggested" tone.
              qaDisplay.statusOverride
                ? "bg-status-warning/10 text-status-warning"
                : STATUS_PILL_TONE[row.status],
            )}
            data-recommendation-v2-status-pill="true"
            data-recommendation-v2-status-override={qaDisplay.statusOverride ? "true" : undefined}
          >
            {/* #196 — the status pill is otherwise a bare word ("Accepted")
                floating in the card header; a visually-hidden "Status:"
                prefix gives screen-reader users the meaning, so the state
                isn't conveyed by the pill's color/position alone.
                2026-06-16: the QA verdict overrides "Suggested" when the
                deterministic gate capped/rejected the rec. */}
            <span className="sr-only">Status: </span>
            {qaDisplay.statusOverride ?? statusLabel(row.status)}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80"
          data-recommendation-v2-confidence={row.derivedConfidence}
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
      </header>

      {/* Headline — when a Page Surgeon pack exists, ITS primary action is the
          ONE canonical headline (same as Today + the Opportunity Map). We do
          NOT also render the older legacy composer's task for the page: it's a
          DIFFERENT, weaker-engine action, and showing both made the card read
          as if it contradicted itself (operator-reported 2026-06-22 — e.g.
          headline "Add a direct answer block" with "Legacy task: Rewrite the
          title" under it). The superseded task still lives in the detail page's
          history; the card stays a single, unambiguous decision. */}
      <h3 className="mt-3 text-[15px] font-semibold text-foreground leading-snug">
        {pageSurgeonHeadline?.trim() || row.title}
      </h3>

      {/* Target — render the resolved URL (mono, accent) when present;
          otherwise fall back to the "Homepage" / "New page" label. */}
      <p className="mt-1 text-[11px] leading-snug">
        <span className="text-muted-foreground">→</span>{" "}
        {target ? (
          <span
            className="text-accent-primary font-mono tabular-nums break-all"
            data-recommendation-v2-target-url="true"
          >
            {shortUrl(target)}
          </span>
        ) : (
          <span className="text-muted-foreground" data-recommendation-v2-target-label="true">
            {targetLabel}
          </span>
        )}
      </p>

      {/* #296 — Google Search stat strip (scannable) replaces the prose
          GSC sentence when the evidence summary is the structured GSC
          line. Plain-labeled, compact, tabular-nums for alignment. */}
      {gscStats ? (
        <div
          className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1"
          data-recommendation-v2-gsc-stats="true"
        >
          {gscStats.map((stat) => (
            <span
              key={stat.key}
              className="inline-flex items-baseline gap-1"
              data-recommendation-v2-gsc-stat={stat.key}
            >
              <span className="text-[13px] font-semibold tabular-nums text-foreground">
                {stat.value}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {stat.label}
              </span>
            </span>
          ))}
          <span className="text-[10px] text-muted-foreground/70 w-full">
            Last 90 days on Google
          </span>
        </div>
      ) : (
        /* Why this matters — one line */
        why && (
          <p
            className="mt-3 text-[12px] text-foreground/85 leading-relaxed"
            data-recommendation-v2-why="true"
          >
            {why}
          </p>
        )
      )}

      {/* 2026-06-15 — per-query evidence: the SPECIFIC search query, how
          often the page showed up for it, the current rank, and the
          recoverable visits. Honest: rendered only when the GSC signal
          carried a quotable query. */}
      {gscEvidenceLines.length > 0 && (
        <ul
          className="mt-2.5 space-y-1"
          data-recommendation-v2-gsc-evidence="true"
        >
          {gscEvidenceLines.map((line) => (
            <li
              key={line.key}
              className="text-[11px] leading-snug"
              data-recommendation-v2-gsc-evidence-line={line.key}
            >
              <span className="font-semibold text-foreground">
                {line.value}
              </span>{" "}
              <span className="text-muted-foreground">{line.label}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 2026-06-15 follow-up — SEMrush evidence: the SPECIFIC keyword, its
          monthly search volume, its difficulty (when known), and the current
          rank. Honest: rendered only when the SEMrush signal carried a
          striking-distance keyword. Reuses the same list UI as the GSC lines. */}
      {semrushEvidenceLines.length > 0 && (
        <ul
          className="mt-2.5 space-y-1"
          data-recommendation-v2-semrush-evidence="true"
        >
          {semrushEvidenceLines.map((line) => (
            <li
              key={line.key}
              className="text-[11px] leading-snug"
              data-recommendation-v2-semrush-evidence-line={line.key}
            >
              <span className="font-semibold text-foreground">
                {line.value}
              </span>{" "}
              <span className="text-muted-foreground">{line.label}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 2026-06-15 — Microsoft Clarity friction evidence: rage-clicks /
          page errors as a percent of sessions. Honest: rendered only when
          the Clarity signal carried friction above the sourced thresholds.
          Reuses the same list UI as the GSC / SEMrush lines. */}
      {clarityEvidenceLines.length > 0 && (
        <ul
          className="mt-2.5 space-y-1"
          data-recommendation-v2-clarity-evidence="true"
        >
          {clarityEvidenceLines.map((line) => (
            <li
              key={line.key}
              className="text-[11px] leading-snug"
              data-recommendation-v2-clarity-evidence-line={line.key}
            >
              <span className="font-semibold text-foreground">
                {line.value}
              </span>{" "}
              <span className="text-muted-foreground">{line.label}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 2026-06-15 — AI-answer gap evidence (white-label): AI assistants
          answer this topic citing a rival across ~N answers while you're
          absent. Honest: rendered only when the rec carries answer-engine
          gap evidence. Reuses the same list UI. */}
      {aeoEvidenceLines.length > 0 && (
        <ul
          className="mt-2.5 space-y-1"
          data-recommendation-v2-aeo-evidence="true"
        >
          {aeoEvidenceLines.map((line) => (
            <li
              key={line.key}
              className="text-[11px] leading-snug"
              data-recommendation-v2-aeo-evidence-line={line.key}
            >
              <span className="font-semibold text-foreground">
                {line.value}
              </span>{" "}
              <span className="text-muted-foreground">{line.label}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Evidence chips — max 3 */}
      {chips.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          data-recommendation-v2-chips="true"
        >
          {chips.map((chip) => (
            <span
              key={chip.key}
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium",
                CHIP_TONE_CLASS[chip.tone],
              )}
              data-recommendation-v2-chip={chip.key}
            >
              {chip.label}
            </span>
          ))}
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium",
              provenance.tone === "success" ? "border-status-success/40 bg-status-success/10 text-status-success"
              : provenance.tone === "info" ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
              : provenance.tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
              : "border-border/60 bg-surface-inset/40 text-muted-foreground",
            )}
            data-recommendation-v2-chip="provenance"
            title={provenance.isBasic ? "Basic deterministic suggestion (legacy generator)" : "Backed by a specific signal/source"}
          >
            {provenance.label}
          </span>
          {pageSurgeonReady && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium border-accent-primary/50 bg-accent-primary/10 text-accent-primary"
              data-recommendation-v2-chip="ps-ready"
              title="A full, checked draft is ready for this page"
            >
              Detailed draft ready
            </span>
          )}
          {pageSurgeonReviewVerdict && (
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium",
                pageSurgeonReviewVerdict === "approve" ? "border-status-success/40 bg-status-success/10 text-status-success"
                : pageSurgeonReviewVerdict === "needs_edit" ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                : "border-red-500/40 bg-red-500/10 text-red-600",
              )}
              data-recommendation-v2-chip="ps-review"
            >
              {pageSurgeonReviewVerdict === "approve" ? "Approved" : pageSurgeonReviewVerdict === "needs_edit" ? "Needs edit" : "Rejected"}
            </span>
          )}
        </div>
      )}

      {/* GQA (2026-06-16) — compact QA caption: the push readiness every row
          carries, plus an HONEST caution when the deterministic verdict found
          the match/evidence weak (so the list reads expert before the operator
          clicks in). The confidence pill above is already downgraded on a
          confident mismatch. Renders only when the row carries a QA verdict. */}
      {qa && (qaPushLabel || qaCaution) && (
        <div
          className="mt-2.5 flex flex-col gap-0.5 text-[11px] leading-snug"
          data-recommendation-v2-qa="true"
          data-recommendation-v2-qa-confidence={qa.confidence}
        >
          {qaPushLabel && (
            <span
              className="font-medium text-muted-foreground"
              data-recommendation-v2-qa-push={qa.pushReadiness}
            >
              {qaPushLabel}
            </span>
          )}
          {qaCaution && (
            <span
              className="text-status-warning"
              data-recommendation-v2-qa-caution="true"
            >
              ⚠ {qaCaution}
            </span>
          )}
        </div>
      )}

      {/* #310 (2026-06-14) — indexing-safety caveat. Crawl/index
          directives (robots.txt, meta noindex, canonical, redirect) can
          DEINDEX a live site if applied wrong. The card carries the
          inline Accept CTA below, so the owner could act on one of these
          rows without seeing the legacy drawer's warning — surface it
          here too, immediately before the CTA. Benign rows (FAQ / schema
          / copy / sitemap) render no caveat. */}
      {isIndexingDirectiveActionType(row.detail.editActionType) && (
        <p
          className="mt-3 rounded border border-status-warning/40 bg-status-warning/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-status-warning"
          role="alert"
          data-recommendation-v2-indexing-caveat="true"
        >
          <span aria-hidden="true">⚠️ </span>
          {INDEXING_DIRECTIVE_CAVEAT}
        </p>
      )}

      {/* CTA — one-tap slice (2026-06-12): Accept is the primary
          action when wired; Review (the 5-act brief) stays one click
          away for owners who want the full why before deciding. */}
      <div className="mt-4 flex items-center gap-3 text-[12px] font-semibold">
        {/* #318 — single-card Accept feedback was silent to assistive
            tech (only the bulk bar had a live region). Mirror the accept
            state into an sr-only role="status" so the label swap
            Accept → Accepting… → Accepted, and any error, are announced. */}
        {(onAccept != null || onAcceptAndPublish != null) && (
          <span className="sr-only" role="status" aria-live="polite">
            {acceptState === "accepted"
              ? onAcceptAndPublish != null
                ? "Recommendation published to your site."
                : "Recommendation accepted."
              : acceptState === "pending"
                ? onAcceptAndPublish != null
                  ? "Publishing recommendation…"
                  : "Accepting recommendation…"
                : acceptState === "error"
                  ? `Couldn't ${onAcceptAndPublish != null ? "publish" : "accept"}: ${acceptError ?? "something went wrong."}`
                  : ""}
          </span>
        )}
        {/* RENDER ENFORCEMENT (2026-06-16): Accept is the primary CTA ONLY
            when the deterministic QA verdict approves. A capped/rejected rec
            shows "Review only" (the brief) instead — never a one-tap Accept.
            ARMED PUBLISHING: when the site is armed and this row is safe +
            mapped + high-confidence, the parent passes onAcceptAndPublish and
            the primary CTA becomes one-click "Accept & publish" (live). */}
        {onAcceptAndPublish != null ? (
          <button
            type="button"
            onClick={onAcceptAndPublish}
            disabled={acceptState === "pending" || acceptState === "accepted"}
            className={
              acceptState === "accepted"
                ? "rounded-md bg-status-success/15 px-3 py-1.5 text-status-success cursor-default"
                : "rounded-md bg-accent-primary px-3 py-1.5 text-white hover:bg-accent-primary/90 disabled:opacity-60"
            }
            data-recommendation-v2-cta="accept-and-publish"
            data-accept-state={acceptState}
          >
            {acceptState === "accepted"
              ? "Published ✓"
              : acceptState === "pending"
                ? "Publishing…"
                : "Publish to my site"}
          </button>
        ) : onAccept != null && qaDisplay.actionable ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={acceptState === "pending" || acceptState === "accepted"}
            className={
              acceptState === "accepted"
                ? "rounded-md bg-status-success/15 px-3 py-1.5 text-status-success cursor-default"
                : "rounded-md bg-accent-primary px-3 py-1.5 text-white hover:bg-accent-primary/90 disabled:opacity-60"
            }
            data-recommendation-v2-cta="accept"
            data-accept-state={acceptState}
          >
            {acceptState === "accepted"
              ? "Done ✓"
              : acceptState === "pending"
                ? "Saving…"
                : "Make this change"}
          </button>
        ) : null}
        {/* #316 — failed Accept: surface the ACTUAL error (not a generic
            line) AND a per-card retry so one failure among many is both
            attributable and recoverable. */}
        {acceptState === "error" && (
          <span
            className="flex items-center gap-2 font-normal"
            data-recommendation-v2-accept-error="true"
          >
            <span className="text-status-danger">
              {acceptError ?? "Something went wrong."}
            </span>
            {onRetry != null && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-status-danger/40 px-2 py-1 text-status-danger hover:bg-status-danger/[0.06]"
                data-recommendation-v2-cta="retry-accept"
              >
                Try again
              </button>
            )}
          </span>
        )}
        <Link
          href={href}
          prefetch={false}
          className="text-accent-primary hover:underline"
          data-recommendation-v2-cta={
            onAccept != null && qaDisplay.actionable ? "review" : "primary"
          }
        >
          {qaDisplay.actionable ? "Review →" : "View details →"}
        </Link>
        {(pageSurgeonReviewVerdict === "approve" || pageSurgeonReviewVerdict === "needs_edit") && (
          <Link
            href={`${href}#page-surgeon`}
            prefetch={false}
            className="text-muted-foreground hover:underline"
            data-recommendation-v2-cta="ps-reopen"
          >
            Reopen review ↻
          </Link>
        )}
      </div>
    </article>
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

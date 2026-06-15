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
import { checkWhyDisplaySafe } from "@/domains/recommendations/why-display-guard";
import { cn } from "@/lib/utils";
import { buildRecommendationDetailHref } from "./recommendation-route-id";

// ─────────────────────────────────────────────────────────────────────
// Pill + dot tone tables (operator-locked vocabulary)
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
  needs_review: "Lower confidence — optional",
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

  if (row.detail.evidenceDepth >= 4) {
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
  acceptState?: "idle" | "pending" | "accepted" | "error";
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
};

export function RecommendationV2Card({
  row,
  reviewHref,
  className,
  competitorNames,
  onAccept,
  acceptState = "idle",
}: RecommendationV2CardProps) {
  const chips = deriveEvidenceChips(row);
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

  return (
    <article
      className={cn(
        "rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5 transition-colors hover:border-accent-primary/40 hover:bg-surface-inset/50",
        className,
      )}
      data-recommendation-v2-card="true"
      data-recommendation-v2-status={row.status}
    >
      {/* Header — status pill (left) · confidence (right) */}
      <header className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
            STATUS_PILL_TONE[row.status],
          )}
          data-recommendation-v2-status-pill="true"
        >
          {statusLabel(row.status)}
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

      {/* Headline */}
      <h3 className="mt-3 text-[15px] font-semibold text-foreground leading-snug">
        {row.title}
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

      {/* Why this matters — one line */}
      {why && (
        <p
          className="mt-3 text-[12px] text-foreground/85 leading-relaxed"
          data-recommendation-v2-why="true"
        >
          {why}
        </p>
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
        </div>
      )}

      {/* CTA — one-tap slice (2026-06-12): Accept is the primary
          action when wired; Review (the 5-act brief) stays one click
          away for owners who want the full why before deciding. */}
      <div className="mt-4 flex items-center gap-3 text-[12px] font-semibold">
        {onAccept != null && (
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
              ? "Accepted ✓"
              : acceptState === "pending"
                ? "Accepting…"
                : "Accept"}
          </button>
        )}
        {acceptState === "error" && (
          <span className="text-status-danger font-normal">
            Something went wrong — try again.
          </span>
        )}
        <Link
          href={href}
          prefetch={false}
          className="text-accent-primary hover:underline"
          data-recommendation-v2-cta={onAccept != null ? "review" : "primary"}
        >
          Review →
        </Link>
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

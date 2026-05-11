/**
 * RecommendationDetailClient — Bundle 2B premium brief page.
 *
 * Renders one `RecommendationActionRow` as a 5-act narrative:
 *
 *   Act 1 — Recommendation       (what Beacon recommends)
 *   Act 2 — Why this matters     (one paragraph; never a JSON dump)
 *   Act 3 — Evidence             (customer-safe chips + counts only)
 *   Act 4 — Measurement plan     (what Beacon will watch + window)
 *   Act 5 — Next step            (Open legacy review + back to list)
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

import {
  ACTION_ROW_TYPE_LABEL,
  ACTION_ROW_PRIORITY_LABEL,
  ACTION_ROW_STATUS_LABEL,
  type ActionRowStatus,
  type RecommendationActionRow,
} from "@/domains/recommendations/recommendation-action-rows";
import { cn } from "@/lib/utils";

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
};

export function RecommendationDetailClient({
  row,
  changelogId,
  promptTextById,
}: RecommendationDetailClientProps) {
  const target =
    row.targetUrl && row.targetUrl !== "needs_new_page" ? row.targetUrl : null;
  const targetLabel = row.targetLabel;
  const why = row.evidenceSummary?.trim() || row.detail.why?.trim() || null;
  const measurementPlan = row.detail.measurementPlan?.trim() || null;
  const competitor = row.detail.topCompetitor;
  const observationCount = row.detail.observationCount;
  const promptCount = row.detail.affectedPromptCount;

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

  const legacyHref = `/recommendations?legacy=1#rec-${encodeURIComponent(row.sourceRecommendationId)}`;
  const changeHref = changelogId ? `/changes/${changelogId}` : null;

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
              STATUS_PILL_TONE[row.status],
            )}
            data-recommendation-detail-status-pill="true"
          >
            {statusLabel(row.status)}
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
        {why && (
          <p
            className="text-[13px] text-foreground/85 leading-relaxed max-w-2xl"
            data-recommendation-detail-lead="true"
          >
            {why}
          </p>
        )}
      </header>

      {/* Act 1 — Recommendation */}
      <Act
        index={1}
        label="Recommendation"
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
            <span className="text-foreground">{statusLabel(row.status)}</span>
          </p>
        </div>
      </Act>

      {/* Act 2 — Why this matters */}
      <Act
        index={2}
        label="Why this matters"
        dataAttr="act-why"
      >
        <p
          className="text-[13px] text-foreground/85 leading-relaxed max-w-2xl"
          data-recommendation-detail-why="true"
        >
          {why ??
            "Beacon needs more evidence before this should be shipped."}
        </p>
        <p
          className={cn(
            "mt-3 text-[12px] leading-relaxed",
            row.derivedConfidence === "strong_evidence"
              ? "text-status-success"
              : row.derivedConfidence === "moderate_evidence"
                ? "text-status-warning"
                : "text-muted-foreground",
          )}
          data-recommendation-detail-confidence-explainer="true"
        >
          {CONFIDENCE_DESCRIPTION[row.derivedConfidence]}
        </p>
      </Act>

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
          {row.detail.evidenceDepth >= 4 && (
            <EvidenceTile
              label="Page-level pattern"
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

        {promptCount === 0 &&
          observationCount === 0 &&
          !competitor && (
            <p
              className="text-[12px] text-muted-foreground leading-relaxed"
              data-recommendation-detail-evidence-empty="true"
            >
              No specific grounding signals are available for this
              recommendation yet. Beacon may surface more as new AI
              readings land.
            </p>
          )}
      </Act>

      {/* Act 4 — Measurement plan */}
      <Act
        index={4}
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
        ) : (
          <p
            className="text-[13px] text-foreground/85 leading-relaxed max-w-2xl"
            data-recommendation-detail-measurement="true"
          >
            Beacon will watch this page&apos;s citation rate on the affected
            prompts after the change ships, and surface the result on{" "}
            <Link
              href="/changes"
              className="text-accent-primary hover:underline"
            >
              /changes
            </Link>
            .
          </p>
        )}
        <p
          className="mt-3 text-[12px] text-muted-foreground"
          data-recommendation-detail-current-status="true"
        >
          Current status: <span className="text-foreground">{statusLabel(row.status)}</span>.
          {(row.status === "accepted" ||
            row.status === "measuring" ||
            row.status === "shipped") &&
            " Beacon is watching impact."}
        </p>
      </Act>

      {/* Act 5 — Next step */}
      <Act
        index={5}
        label="What to do next"
        dataAttr="act-next"
      >
        <div className="flex flex-wrap items-center gap-3 text-[13px] font-semibold">
          <Link
            href={legacyHref}
            className="inline-flex items-center gap-1 text-accent-primary hover:underline"
            data-recommendation-detail-cta="legacy-review"
          >
            Open legacy review →
          </Link>
          {changeHref && (
            <Link
              href={changeHref}
              className="inline-flex items-center gap-1 text-accent-primary hover:underline"
              data-recommendation-detail-cta="open-change"
            >
              Open change →
            </Link>
          )}
          <Link
            href="/recommendations?v2=1"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            data-recommendation-detail-cta="back-to-list"
          >
            Back to recommendations
          </Link>
        </div>
        <p
          className="mt-3 text-[11px] text-muted-foreground/80 leading-relaxed max-w-2xl"
          data-recommendation-detail-next-explainer="true"
        >
          Accept, defer, and dismiss live in the legacy review drawer for
          now. The brief view is read-only; coming changes will move those
          actions inline.
        </p>
      </Act>
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
          Act {index}
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

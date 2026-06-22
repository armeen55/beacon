/**
 * AI Visibility hero — UX.6.3 (2026-05-08).
 *
 * Promotes the visibility section into a true hero. Sits at the top
 * of the visibility-headline section above the chart + leaderboard
 * pair so the operator gets the answer to Beacon's core question
 * ("How visible are we in AI answers, are we improving, and who is
 * beating us?") in one scan, before drilling into the chart for
 * detail.
 *
 * Pure presentation. The component receives ALREADY-DERIVED numbers
 * from the parent and does no math beyond formatting / layout. Math
 * + data source unchanged from prior surfaces — UX.6.3 only changes
 * how the existing numbers are arranged + labeled.
 *
 * Relationship to Command Center:
 *   - Command Center NextBestActionCard owns "what to do next".
 *   - Command Center BrainStatusCard owns brain readiness grade.
 *   - Command Center LatestReadingCard owns poll-status badges
 *     (did the poll happen? per-platform "ok / partial / failed").
 *   - AI Visibility hero owns the CORE METRIC: how visible are we?
 *     Per-platform "primary %" here is a different number from CC's
 *     poll-status — primary % = % of answers naming brand first;
 *     poll-status = did today's reading complete. They don't fight.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";

export type AIVisibilityHeroProps = {
  /** Tenant brand display name. */
  brandName: string;
  /** Latest composite visibility score (0..100). Null when no sampled data. */
  score: number | null;
  /**
   * Δ in percentage points within the selected window: latest sampled
   * day minus earliest sampled day. Matches the chart's "within this
   * window" delta semantic (Phase 2B follow-up, 2026-05-13). Null
   * when there are fewer than two sampled days in the window — matches
   * the honest-no-data treatment the leaderboard uses.
   */
  delta: number | null;
  /** Window length used for the delta semantic label, in calendar days. */
  windowDays: number;
  /** Brand's current rank in the leaderboard (1-indexed). Null when no data. */
  rank: number | null;
  /** Total ranked entities in the leaderboard (incl. owned). */
  totalRanked: number;
  /**
   * Closest competitor by rank — the one immediately ahead OR behind
   * the brand. Null when no competitors are tracked or scored.
   */
  closestChallenger: { name: string; score: number } | null;
  /** Sampled-day count in the current window. */
  currentSampledDays: number;
  /** Latest sampled day's date (YYYY-MM-DD UTC). Null when no data. */
  latestReadingDate: string | null;
  /** ChatGPT primary-recommendation rate as a 0..100 percentage. Null when unknown. */
  chatgptPrimaryPct: number | null;
  /** Perplexity primary-recommendation rate as a 0..100 percentage. */
  perplexityPrimaryPct: number | null;
  /**
   * Cross-platform sample state. "full" → both platforms sampled at
   * full-day target; "partial" → at least one short of full;
   * undefined → don't show the badge.
   */
  sampleState?: "full" | "partial";
  /**
   * Freshness/cache hardening (2026-05-13). Subtle pill rendered next
   * to the AI Visibility section header. Optional — when undefined,
   * the pill is not rendered. Status drives tone; label drives copy.
   */
  freshness?: {
    status: "fresh" | "stale" | "rebuilding" | "empty";
    label: string;
  };
  /**
   * #372 — in-page anchor for the "Why this number?" link. ONLY pass
   * this when the consuming surface actually mounts the matching jump
   * target (the legacy `/today` mounts `<TodayMetricsDisclosure>` with
   * id="today-metrics-disclosure"). The v2 command center does NOT mount
   * that disclosure, so it leaves this undefined and the link is omitted
   * — otherwise "Why this number?" was a dead anchor that scrolled
   * nowhere on the live v2 dashboard.
   */
  whyThisNumberHref?: string;
  className?: string;
};

/**
 * Format an ISO YYYY-MM-DD as a customer-safe short date,
 * "May 8". Uses UTC interpretation (matches the rest of /today).
 */
function formatShortDate(iso: string): string {
  // Construct as UTC noon to avoid timezone slippage on day boundaries.
  const d = new Date(`${iso}T12:00:00.000Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function AIVisibilityHero(props: AIVisibilityHeroProps) {
  const {
    brandName,
    score,
    delta,
    windowDays,
    rank,
    totalRanked,
    closestChallenger,
    currentSampledDays,
    latestReadingDate,
    chatgptPrimaryPct,
    perplexityPrimaryPct,
    sampleState,
    freshness,
    whyThisNumberHref,
    className,
  } = props;

  const hasScore = score !== null && Number.isFinite(score);
  const hasRank = rank !== null && Number.isFinite(rank);
  // Honesty fix (2026-06-15): a RANK is only meaningful when there is a real
  // competitive field to rank against. `totalRanked` includes the owned brand,
  // so `totalRanked < 2` means "only you are tracked" — claiming "#1" there is
  // a "#1 of 1" non-claim that erodes trust (the hero used to say "#1 across
  // tracked AI answers" while simultaneously showing "No competitor in range
  // yet"). Gate every rank claim on a real competitive field.
  const hasCompetitiveRank = hasRank && totalRanked >= 2;

  // Bundle 2 hosted-verification fix (2026-05-11): when the brand
  // name resolves to the second-person pronoun "You" (the fallback
  // when no real brand is configured), the third-person verb forms
  // ("You is", "You appears") read as a typo. Pluralize the verb
  // for the second-person case so any subject — "Ritz Builders is",
  // "You are" — stays grammatical. Pure-projection helper; no other
  // copy or behavior changes.
  const subjectIsSecondPerson = brandName.trim().toLowerCase() === "you";
  const verbIs = subjectIsSecondPerson ? "are" : "is";
  const verbAppears = subjectIsSecondPerson ? "appear" : "appears";

  // audit-4: honesty gate. With NO sampled AI-answer data at all (no score AND
  // zero sampled days — e.g. a tenant with no AI-answer source connected and no
  // reading yet), the old lead asserted active tracking that isn't happening.
  // State the absence instead; don't claim a live capability the tenant hasn't
  // turned on.
  const hasSampledData = hasScore || currentSampledDays > 0;

  // Lead sentence — "You are #N across tracked AI answers." for the
  // second-person fallback; "Ritz Builders is #N..." for any real brand.
  // Operator-locked copy. Avoids superlatives Beacon can't claim.
  const leadSentence = (() => {
    if (!hasSampledData) {
      return `No AI answers sampled for ${brandName} yet. Connect an AI-answer source to start tracking.`;
    }
    if (!hasCompetitiveRank) {
      return `${brandName} ${verbIs} being tracked across AI answers.`;
    }
    return `${brandName} ${verbIs} #${rank} across tracked AI answers.`;
  })();

  return (
    <section
      className={cn(
        "rounded-lg border border-foreground/10 bg-surface-inset/30 px-5 pt-5 pb-4 space-y-4",
        className,
      )}
      data-today-section="ai-visibility-hero"
      aria-label="AI Visibility hero"
    >
      {/* Header — owns the section's executive copy.
          Pre-UX.6.3 a separate <header> rendered "AI Visibility / How
          often {brand} appears..." above the chart+leaderboard pair.
          The hero card subsumes that header so the section reads as
          one coherent block instead of three stacked elements. */}
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            AI Visibility
          </p>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {hasSampledData
              ? `How often ${brandName} ${verbAppears} across tracked AI answers.`
              : `AI answers Beacon has sampled for ${brandName}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Freshness pill (2026-05-13). Subtle, always rendered when
              status is known so the operator can scan "is this current
              data?" without clicking anything. Tone:
                fresh      → muted neutral (no alarm)
                stale      → amber warning (older than expected)
                rebuilding → muted accent (refresh in flight)
                empty      → muted neutral with "no data" copy
              The status is NOT a UI gate; the chart still renders
              whatever data the read model returned. */}
          {freshness && freshness.status !== "empty" && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                freshness.status === "fresh"
                  ? "border-border/60 bg-surface-raised/40 text-muted-foreground"
                  : freshness.status === "rebuilding"
                    ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                    : "border-status-warning/40 bg-status-warning/10 text-status-warning",
              )}
              data-today-hero-freshness={freshness.status}
              title={`Latest data: ${freshness.label}`}
            >
              {freshness.label}
            </span>
          )}
          {freshness && freshness.status === "empty" && (
            <span
              className="rounded-full border border-border/60 bg-surface-raised/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground"
              data-today-hero-freshness="empty"
              title="No snapshots have been recorded yet for this tenant."
            >
              {freshness.label}
            </span>
          )}
          {sampleState && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                sampleState === "full"
                  ? "border-status-success/40 bg-status-success/10 text-status-success"
                  : "border-status-warning/40 bg-status-warning/10 text-status-warning",
              )}
              data-today-hero-sample-state={sampleState}
            >
              {sampleState === "full" ? "Full sample" : "Partial sample"}
            </span>
          )}
        </div>
      </header>

      {/* Lead sentence — answer-first framing, premium executive copy. */}
      <p
        className="text-[15px] font-semibold text-foreground leading-snug"
        data-today-hero-lead="true"
      >
        {leadSentence}
      </p>

      {/* 4-card metric strip — instantly scannable. Score / Rank /
          Closest challenger / Sample. All numbers here are derived
          from existing visibility data in the parent — no new math. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Score card */}
        <MetricCard
          label="Visibility score"
          dataAttr="score"
          headline={hasScore ? `${score!.toFixed(1)}%` : "-"}
          sub={
            hasScore && delta !== null
              ? {
                  // Phase 2B follow-up (2026-05-13) — copy aligned with
                  // chart's "within this window" semantic so the same
                  // delta number with the same meaning shows in both
                  // surfaces.
                  text: `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts in this window`,
                  tone:
                    delta > 0
                      ? "positive"
                      : delta < 0
                        ? "negative"
                        : "neutral",
                }
              : hasScore
                ? { text: `in this window, limited data`, tone: "neutral" }
                : { text: "Awaiting sampled data", tone: "neutral" }
          }
        />

        {/* Rank card */}
        {/* QA polish (2026-05-12) — pre-fix subtext "of N ranked"
            implied the entire market had only N companies (e.g.
            "#1 of 5 ranked" reads as "1 of 5 in the market" when
            really 5 is the count of TRACKED brands cited by AI).
            New subtext makes the tracked-set framing explicit so
            the rank doesn't make the market look artificially
            tiny. `totalRanked` includes the owned brand, so
            "tracked brands" is the technically-accurate noun
            (the spec's documented alternative to "tracked
            competitors"). */}
        <MetricCard
          label="Rank"
          dataAttr="rank"
          headline={hasCompetitiveRank ? `#${rank}` : "-"}
          sub={
            hasCompetitiveRank
              ? {
                  text: "among tracked brands cited by AI",
                  tone: "neutral",
                }
              : hasRank
                ? { text: "No competitors tracked yet", tone: "neutral" }
                : { text: "Awaiting leaderboard", tone: "neutral" }
          }
        />

        {/* Closest challenger card */}
        <MetricCard
          label="Closest challenger"
          dataAttr="closest-challenger"
          headline={closestChallenger ? truncate(closestChallenger.name, 24) : "-"}
          sub={
            closestChallenger
              ? {
                  // Window-average mention rate — a DIFFERENT formula/window than
                  // the brand hero's latest-day score, so label it so the two
                  // numbers aren't read as directly comparable.
                  text: `${closestChallenger.score.toFixed(1)}% mention rate (window avg)`,
                  tone: "neutral",
                }
              : { text: "No competitor in range yet", tone: "neutral" }
          }
        />

        {/* Sample card */}
        <MetricCard
          label="Sample"
          dataAttr="sample"
          headline={
            currentSampledDays > 0
              ? `${currentSampledDays} day${currentSampledDays === 1 ? "" : "s"}`
              : "-"
          }
          sub={
            latestReadingDate
              ? {
                  text: `Latest ${formatShortDate(latestReadingDate)}`,
                  tone: "neutral",
                }
              : { text: "Awaiting first reading", tone: "neutral" }
          }
        />
      </div>

      {/* Per-platform footer — small metadata strip. Distinguishes
          from the Command Center's LatestReadingCard which surfaces
          poll-health (did the poll happen?), not visibility primary
          rate (% of answers naming brand first). */}
      {(chatgptPrimaryPct !== null || perplexityPrimaryPct !== null) && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground/80"
          data-today-hero-platforms="true"
        >
          {chatgptPrimaryPct !== null && (
            <span data-today-hero-platform="chatgpt">
              <span className="font-semibold text-foreground/90">ChatGPT</span>{" "}
              {chatgptPrimaryPct}% primary
            </span>
          )}
          {chatgptPrimaryPct !== null && perplexityPrimaryPct !== null && (
            <span aria-hidden="true">·</span>
          )}
          {perplexityPrimaryPct !== null && (
            <span data-today-hero-platform="perplexity">
              <span className="font-semibold text-foreground/90">
                Perplexity
              </span>{" "}
              {perplexityPrimaryPct}% primary
            </span>
          )}
          {/* #372 — only render the in-page jump when the consuming
              surface actually mounts the disclosure target. The v2
              command center never mounts <TodayMetricsDisclosure>, so it
              omits whyThisNumberHref and this dead anchor disappears
              instead of scrolling nowhere. */}
          {whyThisNumberHref && (
            <Link
              href={whyThisNumberHref}
              className="ml-auto text-accent-primary hover:underline"
            >
              Why this number?
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Internal: single metric card.
// ─────────────────────────────────────────────────────────────────────

type MetricSubTone = "positive" | "negative" | "neutral";

function MetricCard({
  label,
  headline,
  sub,
  dataAttr,
}: {
  label: string;
  headline: string;
  sub: { text: string; tone: MetricSubTone };
  dataAttr: string;
}) {
  const subToneClass =
    sub.tone === "positive"
      ? "text-status-success"
      : sub.tone === "negative"
        ? "text-status-danger"
        : "text-muted-foreground/80";
  // a11y #387 — the sub line carried good/bad meaning by color alone.
  // Add a ▲/▼ glyph (neutral = none) so direction reads without color,
  // and an aria-label spelling out the direction for screen readers
  // (mirrors the kpi-card.tsx treatment). aria-hidden on the glyph
  // keeps it from being double-announced.
  const arrow =
    sub.tone === "positive" ? "▲" : sub.tone === "negative" ? "▼" : "";
  const directionWord =
    sub.tone === "positive" ? "up" : sub.tone === "negative" ? "down" : "";
  const subAriaLabel = directionWord
    ? `${directionWord}: ${sub.text}`
    : undefined;
  return (
    <div
      className="rounded-md border border-foreground/5 bg-background/40 px-3 py-2.5"
      data-today-hero-metric={dataAttr}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-bold tabular-nums leading-tight">
        {headline}
      </p>
      <p
        className={cn("mt-0.5 text-[11px] leading-snug", subToneClass)}
        aria-label={subAriaLabel}
      >
        {arrow && <span aria-hidden="true">{arrow} </span>}
        {sub.text}
      </p>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

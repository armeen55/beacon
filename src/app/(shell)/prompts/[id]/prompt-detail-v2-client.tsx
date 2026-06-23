/**
 * PromptDetailV2Client — /prompts/[id] 5-act proof brief.
 *
 * Bundle (2026-05-11) per the maximum-depth UI audit. Mirrors the
 * Changes detail pattern shipped earlier today. Replaces the
 * legacy data-rich drilldown (so-what header + ActionBridge +
 * PlatformSplit + PrimaryAnswerBlock + CompetitorList +
 * DescriptorCloud + AnswerShapeCallout + RawEvidence) with a
 * customer-shaped 5-act narrative:
 *
 *   Header  → back link + prompt text + ONE customer-safe category
 *             pill + one-line summary + per-platform badges
 *   Act 1   → What you're tracking (prompt + category + why-it-
 *             matters when present)
 *   Act 2   → Where you stand (per-platform status cards with
 *             optional sparkline)
 *   Act 3   → Who else gets cited (competitors, or calm empty)
 *   Act 4   → What changed recently (humanized movements, or
 *             calm fallback)
 *   Act 5   → What to do next (next-action CTAs)
 *
 * Pure presentation. The server `page.tsx` resolves data + calls
 * `projectPromptDrilldownToBrief`. No new fetches here, no server-
 * action wiring, no domain logic changes.
 *
 * Customer-vocabulary contract:
 *   • No raw enum names, IDs, hashes, internal subsystem terms.
 *   • Platform labels branded ("ChatGPT", "Perplexity", "Google
 *     AI Overviews").
 *   • Result pill uses the v2A 5-set category vocabulary.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";
import type {
  PromptsV2BriefCta,
  PromptsV2BriefCompetitor,
  PromptsV2BriefMovement,
  PromptsV2BriefPlatform,
  PromptsV2BriefProps,
} from "@/domains/prompts/v2-brief-projection";
import type {
  PromptPrimaryShare,
  PromptPrimaryShareCard,
} from "@/domains/daily-metric-snapshots/prompt-primary-share";

import { PromptsV2PlatformBadge } from "@/components/prompts/v2/prompts-v2-platform-badge";

/**
 * Section 6 C5 (2026-05-15) — per-platform primary-share extension.
 * The C5 server loader computes this server-side via
 * `computePromptPrimaryShare` (14-day aggregate) and passes both
 * platform cards alongside the existing brief props. Each card is
 * null when no eligible snapshot rows exist; the renderer hides the
 * sub-line entirely in that case. v1 path NEVER receives this prop
 * (the page wires it inside the v2 branch only). Mathematical
 * equivalence + the source-swap contract are pinned at
 * `tests/domains/daily-metric-snapshots/prompt-primary-share.test.ts`
 * + `tests/architecture/prompt-primary-share-source.test.ts`.
 */
export type PromptDetailV2ClientProps = PromptsV2BriefProps & {
  /**
   * Optional in the type so the existing legacy test fixture
   * (`tests/app/prompts/prompt-detail-v2-client.test.tsx`) that
   * predates C5 keeps passing without modification. In production,
   * the page loader ALWAYS supplies this prop (the v2 branch at
   * `prompts/[id]/page.tsx` computes it via the server-bound
   * `computePromptPrimaryShare`). When omitted, the client treats
   * both platforms as "no eligible data" and hides the sub-line —
   * same visual outcome as a real null result for that prompt.
   */
  promptPrimary?: PromptPrimaryShare;
};

const EMPTY_PROMPT_PRIMARY: PromptPrimaryShare = {
  chatgpt: null,
  perplexity: null,
};

const CATEGORY_PILL_TONE: Record<
  PromptsV2BriefProps["header"]["category"]["tone"],
  string
> = {
  success: "border-status-success/35 bg-status-success/[0.08] text-status-success",
  warning: "border-status-warning/35 bg-status-warning/[0.08] text-status-warning",
  danger: "border-status-danger/35 bg-status-danger/[0.08] text-status-danger",
  info: "border-accent-primary/35 bg-accent-primary/[0.06] text-accent-primary",
  muted: "border-border/60 bg-surface-inset/60 text-muted-foreground",
};

export function PromptDetailV2Client(props: PromptDetailV2ClientProps) {
  const {
    promptId,
    header,
    whyItMatters,
    platforms,
    competitors,
    recentMovement,
    nextActions,
    promptPrimary = EMPTY_PROMPT_PRIMARY,
  } = props;

  return (
    <div
      className="max-w-3xl space-y-6"
      data-prompt-detail-layout="v2-prompt-brief"
      data-prompt-detail-id={promptId}
    >
      {/* Header */}
      <header data-prompt-detail-header="true">
        <Link
          href="/prompts?v2=1"
          className="inline-flex items-center text-[12px] font-medium text-muted-foreground hover:text-foreground"
          data-prompt-detail-back="true"
        >
          ← Prompts
        </Link>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1
              className="text-[18px] font-semibold tracking-tight text-foreground leading-snug break-words"
              data-prompt-detail-title="true"
            >
              {header.promptText || "Untitled prompt"}
            </h1>
          </div>
          <span
            data-prompt-detail-pill={header.category.kind}
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0",
              CATEGORY_PILL_TONE[header.category.tone],
            )}
          >
            {header.category.label}
          </span>
        </div>
        {header.summary && (
          <p
            className="mt-2 text-[12.5px] leading-relaxed text-foreground/80"
            data-prompt-detail-summary="true"
          >
            {header.summary}
          </p>
        )}
        {header.platformBadges.length > 0 && (
          <ul
            className="mt-3 flex flex-wrap gap-1.5"
            data-prompt-detail-header-platforms="true"
            aria-label="Per-platform answer state"
          >
            {header.platformBadges.map((badge) => (
              <li key={badge.platform}>
                <PromptsV2PlatformBadge badge={badge} />
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Act 1 — What you're tracking */}
      <Act number={1} label="What you're tracking">
        <p
          className="text-[13.5px] leading-relaxed text-foreground"
          data-prompt-detail-act1-text="true"
        >
          {header.promptText}
        </p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Beacon classifies this prompt as{" "}
          <span className="font-medium text-foreground">
            {header.category.label}
          </span>
          .
        </p>
        {whyItMatters ? (
          <p
            className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground"
            data-prompt-detail-act1-why="true"
          >
            {whyItMatters}
          </p>
        ) : (
          <p
            className="mt-2 text-[12px] leading-relaxed text-muted-foreground italic"
            data-prompt-detail-act1-why-empty="true"
          >
            Beacon tracks every AI reading this prompt gets each time you refresh your connected data.
          </p>
        )}
      </Act>

      {/* Act 2 — Where you stand */}
      <Act number={2} label="Where you stand">
        {platforms.length === 0 ? (
          <p
            className="text-[12.5px] leading-relaxed text-muted-foreground"
            data-prompt-detail-act2-empty="true"
          >
            No platform readings yet. Beacon is still gathering data on this
            prompt.
          </p>
        ) : (
          <ul
            className="grid gap-2 sm:grid-cols-2"
            data-prompt-detail-act2-platforms="true"
          >
            {platforms.map((p) => (
              <PlatformCard
                key={p.platform}
                platform={p}
                primary={primaryShareForPlatform(p.platform, promptPrimary)}
              />
            ))}
          </ul>
        )}
      </Act>

      {/* Act 3 — Other businesses AI recommends */}
      <Act number={3} label="Other businesses AI recommends">
        {competitors.length === 0 ? (
          <p
            className="text-[12.5px] leading-relaxed text-muted-foreground"
            data-prompt-detail-act3-empty="true"
          >
            No consistent competitor pattern yet.
          </p>
        ) : (
          <ul
            className="space-y-2"
            data-prompt-detail-act3-competitors="true"
          >
            {competitors.map((c) => (
              <CompetitorRow key={c.name} competitor={c} />
            ))}
          </ul>
        )}
      </Act>

      {/* Act 4 — What changed recently */}
      <Act number={4} label="What changed recently">
        {recentMovement.length === 0 ? (
          <p
            className="text-[12.5px] leading-relaxed text-muted-foreground"
            data-prompt-detail-act4-empty="true"
          >
            Beacon is still gathering readings for this prompt.
          </p>
        ) : (
          <ul
            className="space-y-2"
            data-prompt-detail-act4-movements="true"
          >
            {recentMovement.map((m, i) => (
              <MovementRow key={`${m.kind}-${m.date}-${i}`} movement={m} />
            ))}
          </ul>
        )}
      </Act>

      {/* Act 5 — What to do next */}
      <Act number={5} label="What to do next">
        <div
          className="flex flex-wrap items-center gap-3"
          data-prompt-detail-act5-ctas="true"
        >
          {nextActions.map((cta, i) => (
            <NextActionLink key={`${cta.kind}-${i}`} cta={cta} />
          ))}
        </div>
      </Act>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Act wrapper — semantic h2 heading (same pattern as Changes brief)
// ─────────────────────────────────────────────────────────────────────

function Act({
  number,
  label,
  children,
}: {
  number: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-surface-base px-4 py-4"
      data-prompt-detail-act={`act-${number}`}
      aria-labelledby={`prompt-detail-act-${number}-heading`}
    >
      <h2
        id={`prompt-detail-act-${number}-heading`}
        className="text-[14px] font-semibold tracking-tight text-foreground"
        data-prompt-detail-act-heading={`act-${number}`}
      >
        {label}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-platform card (Act 2)
// ─────────────────────────────────────────────────────────────────────

const PLATFORM_STATE_TONE: Record<
  PromptsV2BriefPlatform["state"],
  string
> = {
  primary: "border-status-success/30 bg-status-success/[0.04]",
  cited: "border-accent-primary/30 bg-accent-primary/[0.04]",
  mentioned: "border-status-warning/30 bg-status-warning/[0.04]",
  absent: "border-status-danger/30 bg-status-danger/[0.04]",
  no_data: "border-border/60 bg-surface-inset/30",
};

function PlatformCard({
  platform,
  primary,
}: {
  platform: PromptsV2BriefPlatform;
  /**
   * Section 6 C5 — per-platform primary-share aggregate. `null` when
   * no eligible snapshot rows exist (sub-line hidden); `claimable`
   * renders the full "N of M readings in the last 14 days (P%)"
   * line; `still_learning` renders the calm fallback.
   */
  primary: PromptPrimaryShareCard | null;
}) {
  return (
    <li
      data-prompt-detail-platform={platform.platform}
      data-prompt-detail-platform-state={platform.state}
      className={cn(
        "rounded-md border px-3 py-3",
        PLATFORM_STATE_TONE[platform.state],
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">
          {platform.label}
        </span>
        <span className="text-[11px] font-medium text-foreground/75">
          {platform.microcopy}
        </span>
      </div>
      <p
        className="mt-1 text-[12px] leading-snug text-foreground/80"
        data-prompt-detail-platform-detail="true"
      >
        {platform.detail}
      </p>
      {primary !== null && (
        <p
          className="mt-1 text-[11.5px] leading-snug text-foreground/70"
          data-prompt-detail-v2-primary-share-card={platform.platform}
          data-prompt-detail-v2-primary-share-status={primary.sample_status}
        >
          {primary.sample_status === "claimable"
            ? `Primary recommendation: ${primary.count} of ${primary.total} readings in the last 14 days (${primary.pct}%)`
            : "Primary recommendation: still gathering readings"}
        </p>
      )}
      {platform.sparkline && platform.sparkline.length > 1 && (
        <Sparkline points={platform.sparkline} />
      )}
    </li>
  );
}

/**
 * Section 6 C5 — map the v2 brief's lowercase platform key
 * (`"chatgpt"` / `"perplexity"` / others) to the C5 helper's
 * `PromptPrimaryShare` shape. Other platforms (e.g., `google_aio`)
 * intentionally return `null` because Section 6 D6 locks Google AI
 * Overviews out of customer UI; future platform additions land in
 * `PromptPrimaryShareHeroPlatform` first.
 */
function primaryShareForPlatform(
  platformKey: string,
  primaryShare: PromptPrimaryShare,
): PromptPrimaryShareCard | null {
  if (platformKey === "chatgpt") return primaryShare.chatgpt;
  if (platformKey === "perplexity") return primaryShare.perplexity;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Competitor row (Act 3)
// ─────────────────────────────────────────────────────────────────────

function CompetitorRow({ competitor }: { competitor: PromptsV2BriefCompetitor }) {
  return (
    <li
      data-prompt-detail-competitor={competitor.name}
      className="rounded-md border border-border/40 bg-surface-base px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">
          {competitor.name}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {competitor.appearances}/{competitor.totalObservations}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
        {competitor.summary}
      </p>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Movement row (Act 4)
// ─────────────────────────────────────────────────────────────────────

const MOVEMENT_TONE_BORDER: Record<PromptsV2BriefMovement["tone"], string> = {
  success: "border-l-status-success/60",
  danger: "border-l-status-danger/60",
  muted: "border-l-border",
};

const MOVEMENT_TONE_DOT: Record<PromptsV2BriefMovement["tone"], string> = {
  success: "bg-status-success",
  danger: "bg-status-danger",
  muted: "bg-muted-foreground/60",
};

function MovementRow({ movement }: { movement: PromptsV2BriefMovement }) {
  return (
    <li
      data-prompt-detail-movement-kind={movement.kind}
      data-prompt-detail-movement-tone={movement.tone}
      className={cn(
        "rounded-md border border-border/60 bg-surface-inset/30 px-3 py-2 border-l-[3px]",
        MOVEMENT_TONE_BORDER[movement.tone],
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            MOVEMENT_TONE_DOT[movement.tone],
          )}
        />
        <span className="text-[12.5px] font-medium text-foreground">
          {movement.label}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {movement.date}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        {movement.summary}
      </p>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Act 5 — next-action CTA
// ─────────────────────────────────────────────────────────────────────

function NextActionLink({ cta }: { cta: PromptsV2BriefCta }) {
  const isPrimary = cta.emphasis === "primary";
  return (
    <Link
      href={cta.href}
      data-prompt-detail-cta={cta.kind}
      data-prompt-detail-cta-emphasis={cta.emphasis}
      className={cn(
        "inline-flex items-center rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
        isPrimary
          ? "bg-accent-primary text-accent-primary-foreground hover:bg-accent-primary/90"
          : "border border-border/60 text-foreground/80 hover:bg-surface-inset/50",
      )}
    >
      {cta.label}
      {isPrimary && <span className="ml-1">→</span>}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sparkline — same shape as Changes detail
// ─────────────────────────────────────────────────────────────────────

function Sparkline({
  points,
}: {
  points: ReadonlyArray<{ date: string; count: number }>;
}) {
  const max = Math.max(0, ...points.map((p) => p.count));
  const min = Math.min(0, ...points.map((p) => p.count));
  const range = max - min || 1;
  const width = 180;
  const height = 28;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.count - min) / range) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="mt-2" data-prompt-detail-platform-sparkline="true">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-accent-primary"
        aria-label="Daily readings"
      >
        <path d={path} stroke="currentColor" strokeWidth={1.5} fill="none" />
      </svg>
    </div>
  );
}

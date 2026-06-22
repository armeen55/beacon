/**
 * Beacon Command Center — UX.2 (2026-05-07).
 *
 * Top-of-page executive summary above the existing /today layout.
 * Five cards: Brain status, Latest reading, Top movement, Next best
 * action, plus a small operator-only link to /diagnostics/brain.
 *
 * Pure presentation — receives all data via props from the resolver.
 * No data fetch, no client interactivity, no event handlers. Empty
 * states render gracefully when their data slice is null.
 *
 * Customer-safe copy: every visible string is operator-readable but
 * customer-friendly. NEVER mentions cron / 07:00 UTC / GitHub /
 * Supabase / schema / SQL / raw UUIDs.
 */

import Link from "next/link";
import type {
  CommandCenterData,
  CommandCenterGrade,
} from "@/domains/today/command-center-data";
import type { PollHealthSnapshot } from "@/domains/observations/poll-health";
import type { TodayPrimaryAction } from "@/app/(shell)/today-shared-types";

export type CommandCenterUrlMovement = {
  /** Operator-readable page label (NOT a UUID). */
  pagePath: string;
  /** Pre-formatted delta label, e.g. "+12%" or "+1.4/day". */
  deltaLabel: string;
  /** Operator-readable change context, e.g. "May 5". */
  changeDate: string | null;
} | null;

export function CommandCenter({
  brain,
  manifest,
  pollHealth,
  primaryAction,
  topMovement,
  isOperator,
}: {
  brain: CommandCenterData["brain"];
  manifest: CommandCenterData["manifest"];
  pollHealth: PollHealthSnapshot | null;
  primaryAction: TodayPrimaryAction | null;
  topMovement: CommandCenterUrlMovement;
  isOperator: boolean;
}) {
  return (
    <section
      className="space-y-3"
      data-today-section="command-center"
      aria-label="Beacon Command Center"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
          Beacon Command Center
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Today at a glance
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BrainStatusCard brain={brain} manifest={manifest} />
        <LatestReadingCard
          pollHealth={pollHealth}
          manifest={manifest}
          promptCount={primaryActionPromptCountFallback(brain, manifest)}
        />
        <TopMovementCard movement={topMovement} />
        <NextBestActionCard action={primaryAction} />
      </div>

      {isOperator ? (
        <div className="flex items-center justify-end gap-3 pt-1">
          <Link
            href="/diagnostics/brain"
            className="text-[11px] text-muted-foreground/70 hover:text-foreground/80 transition-colors"
            aria-label="Operator brain diagnostics"
            data-command-center-operator-link="true"
          >
            internal: brain diagnostics →
          </Link>
          <Link
            href="/diagnostics/indexability"
            className="text-[11px] text-muted-foreground/70 hover:text-foreground/80 transition-colors"
            aria-label="Operator indexability diagnostics"
            data-command-center-operator-link="true"
            data-command-center-operator-link-target="indexability"
          >
            internal: indexability diagnostics →
          </Link>
        </div>
      ) : null}
    </section>
  );
}

// ── Card 1: Brain status ──────────────────────────────────────────────

function BrainStatusCard({
  brain,
  manifest,
}: {
  brain: CommandCenterData["brain"];
  manifest: CommandCenterData["manifest"];
}) {
  if (!brain) {
    // UX.5B.4 (2026-05-07) — premium empty state vocabulary.
    return (
      <Card title="Brain readiness">
        <EmptyState>Waiting for your next reading.</EmptyState>
        <p className="text-[11px] text-muted-foreground/80 pt-2 leading-relaxed">
          Beacon scores its own brain once enough readings stack up, refresh your connected data to add the next one.
        </p>
      </Card>
    );
  }

  const description = humanizeOneLine(brain.oneLine);
  const sourceLine = manifest
    ? `${manifest.sourceObservationCount.toLocaleString()} readings analyzed.`
    : "";

  return (
    <Card title="Brain readiness">
      <div className="flex items-baseline gap-3">
        <span className="text-[28px] font-semibold tabular-nums leading-none">
          {brain.grade}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {gradeLabel(brain.grade)}
        </span>
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground pt-2">
        {description}
      </p>
      {brain.sections.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-3 text-[11px]">
          {brain.sections.map((s) => (
            <div key={s.label} className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd className="font-mono tabular-nums">{s.grade}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {sourceLine ? (
        <p className="text-[11px] text-muted-foreground pt-3">{sourceLine}</p>
      ) : null}
    </Card>
  );
}

// ── Card 2: Latest reading ────────────────────────────────────────────

function LatestReadingCard({
  pollHealth,
  manifest,
  promptCount,
}: {
  pollHealth: PollHealthSnapshot | null;
  manifest: CommandCenterData["manifest"];
  promptCount: number | null;
}) {
  if (!pollHealth || pollHealth.platforms.length === 0) {
    // UX.5B.4 (2026-05-07) — premium empty state vocabulary.
    return (
      <Card title="Latest reading">
        <EmptyState>No reading yet.</EmptyState>
        <p className="text-[11px] text-muted-foreground/80 pt-2 leading-relaxed">
          Connect your data sources and click Refresh to see your first dashboard.
        </p>
      </Card>
    );
  }

  // Format date as "May 7" without exposing UTC.
  const readingDate = pollHealth.date
    ? formatHumanDate(pollHealth.date)
    : null;

  return (
    <Card title="Latest reading">
      <div className="text-[12px] text-muted-foreground">
        {readingDate ? `Last read ${readingDate}.` : "Reading in progress."}
      </div>
      <ul className="space-y-1.5 pt-2 text-[12px]">
        {pollHealth.platforms.map((p) => (
          <li
            key={p.platform}
            className="flex items-center justify-between gap-3"
          >
            <span className="capitalize">{platformLabel(p.platform)}</span>
            <PlatformBadge
              status={p.status}
              samplingStatus={p.samplingStatus}
              count={p.observationsWritten}
            />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3 pt-3 text-[11px]">
        {promptCount !== null && promptCount > 0 ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-muted-foreground">Prompts</span>
            <span className="font-mono tabular-nums">{promptCount}</span>
          </div>
        ) : null}
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">Updates</span>
          <span>when you refresh</span>
        </div>
      </div>
      {manifest?.builtAt ? (
        <p className="text-[11px] text-muted-foreground pt-3">
          Intelligence index refreshed {formatHumanDate(manifest.builtAt)}.
        </p>
      ) : null}
    </Card>
  );
}

// ── Card 3: Top movement ──────────────────────────────────────────────

function TopMovementCard({ movement }: { movement: CommandCenterUrlMovement }) {
  if (!movement) {
    // UX.5B.4 (2026-05-07) — premium empty state vocabulary.
    return (
      <Card title="Top movement">
        <EmptyState>Watching for movement.</EmptyState>
        <p className="text-[11px] text-muted-foreground/80 pt-2 leading-relaxed">
          We&apos;ll spotlight your biggest mover once a few days
          of readings stack up.
        </p>
      </Card>
    );
  }
  const positive = !movement.deltaLabel.startsWith("-");
  return (
    <Card title="Top movement">
      <div className="space-y-2">
        <div className="flex items-baseline gap-3">
          <span
            className={
              "text-[24px] font-semibold tabular-nums leading-none " +
              (positive ? "text-emerald-600" : "text-rose-600")
            }
          >
            {movement.deltaLabel}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {positive ? "rising" : "falling"} citations
          </span>
        </div>
        <p className="text-[12px] leading-relaxed">
          <span className="text-muted-foreground">Page:</span>{" "}
          <span className="font-mono break-all">{stripProtocol(movement.pagePath)}</span>
        </p>
        {movement.changeDate ? (
          <p className="text-[11px] text-muted-foreground">
            Linked to a change shipped {movement.changeDate}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

// ── Card 4: Next best action ──────────────────────────────────────────

/**
 * UX.6.2 (2026-05-07) — duplication cleanup.
 *
 * Pre-fix this card rendered the same multi-line rationale that the
 * Action Queue's primary ActionCard ALSO renders below the fold —
 * the operator saw the same paragraph twice on /today. Now the card
 * is a true SUMMARY: title + target page + evidence strength +
 * one-line reason + CTA. The Action Queue stays the workbench (full
 * body, full evidence). The CTA still routes to /recommendations
 * detail (`action.href`).
 *
 * The one-line reason is derived from `action.rationale` by taking
 * its leading sentence. Pre-fix used `line-clamp-3` to visually clip
 * a 3-line paragraph; we now extract a real single sentence and
 * truncate to ~110 chars so the card reads as a SUMMARY shape, not
 * a clipped paragraph.
 */
function summarizeRationale(rationale: string): string {
  const trimmed = rationale.trim();
  if (trimmed.length === 0) return "";
  // First sentence — cut on ". " (period+space) to avoid splitting on
  // decimals / abbreviations that lack the trailing space. Falls back
  // to the full rationale when no sentence break exists.
  const sentenceEnd = trimmed.indexOf(". ");
  const firstSentence =
    sentenceEnd > 0 ? trimmed.slice(0, sentenceEnd + 1) : trimmed;
  // Hard cap so a long single sentence doesn't push the card past
  // ~3 lines (the prior line-clamp-3 footprint).
  const MAX = 110;
  if (firstSentence.length <= MAX) return firstSentence;
  return firstSentence.slice(0, MAX - 1).trimEnd() + "…";
}

function NextBestActionCard({ action }: { action: TodayPrimaryAction | null }) {
  if (!action) {
    // UX.5B.4 (2026-05-07) — premium empty state vocabulary.
    return (
      <Card title="Next best action">
        <EmptyState>No action queued yet.</EmptyState>
        <p className="text-[11px] text-muted-foreground/80 pt-2 leading-relaxed">
          Beacon will surface one as new readings come in, refresh your connected data to add the next one.
        </p>
      </Card>
    );
  }
  const oneLineReason = summarizeRationale(action.rationale);
  return (
    <Card title="Next best action">
      <p className="text-[13px] font-medium leading-tight">{action.headline}</p>
      {oneLineReason && (
        <p className="text-[12px] text-muted-foreground pt-1.5 leading-snug line-clamp-1"
           data-next-best-action-reason="one-line">
          {oneLineReason}
        </p>
      )}
      <div className="flex items-center gap-3 pt-3 text-[11px]">
        <ConfidencePill confidence={action.confidence} />
        {action.targetPagePath ? (
          <span className="font-mono text-muted-foreground truncate">
            {action.targetPagePath}
          </span>
        ) : null}
      </div>
      <div className="pt-3">
        <Link
          href={action.href}
          className="inline-flex items-center gap-1 rounded-md bg-foreground text-background px-3 py-1.5 text-[12px] font-medium hover:opacity-90"
          data-next-best-action-cta="open-recommendation"
        >
          Open recommendation →
        </Link>
      </div>
      {/* UX.6.2 — explicit "summary, full body below" pointer so the
          operator understands the relationship between this card
          and the Action Queue's primary ActionCard rendered below. */}
      <p className="text-[10px] text-muted-foreground/70 pt-1.5 leading-relaxed"
         data-next-best-action-pointer="full-body-below">
        Full evidence in the action queue below.
      </p>
    </Card>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-surface-inset/30 p-4 space-y-1 min-h-[180px]">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
        {title}
      </p>
      <div className="pt-1">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] leading-relaxed text-muted-foreground">{children}</p>
  );
}

function PlatformBadge({
  status,
  samplingStatus,
  count,
}: {
  status: "ok" | "partial" | "failed" | "pending";
  samplingStatus: "full" | "partial" | "proof" | "empty";
  count: number;
}) {
  const tone =
    status === "ok" && samplingStatus === "full"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : status === "ok" && samplingStatus === "partial"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : status === "ok"
          ? "text-foreground/70 bg-foreground/5 border-foreground/10"
          : status === "partial"
            ? "text-amber-700 bg-amber-50 border-amber-200"
            : status === "failed"
              ? "text-rose-700 bg-rose-50 border-rose-200"
              : "text-muted-foreground bg-foreground/5 border-foreground/10";
  const label =
    status === "ok" && samplingStatus === "full"
      ? `Full · ${count}`
      : status === "ok" && samplingStatus === "partial"
        ? `Partial · ${count}`
        : status === "ok" && samplingStatus === "proof"
          ? `Sample · ${count}`
          : status === "partial"
            ? `Partial · ${count}`
            : status === "failed"
              ? "Retry pending"
              : status === "pending"
                ? "Pending"
                : `${count}`;
  return (
    <span
      className={
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums " +
        tone
      }
    >
      {label}
    </span>
  );
}

function ConfidencePill({
  confidence,
}: {
  confidence: "high" | "medium" | "low";
}) {
  const tone =
    confidence === "high"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : confidence === "medium"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-foreground/60 bg-foreground/5 border-foreground/10";
  const label =
    confidence === "high"
      ? "Strong evidence"
      : confidence === "medium"
        ? "Moderate evidence"
        : "Light evidence";
  return (
    <span
      className={
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium " +
        tone
      }
    >
      {label}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function gradeLabel(grade: CommandCenterGrade): string {
  switch (grade) {
    case "A":
      return "Excellent";
    case "B":
      return "Solid";
    case "C":
      return "Watching";
    case "D":
      return "Needs attention";
    case "F":
      return "Action required";
  }
}

/**
 * Trim methodology-y phrasing from the brain-health one-liner if it
 * sneaks through. The current report's `one_line_summary` is already
 * customer-safe ("Brain is solid with one or two non-blocking gaps...");
 * this function is defense-in-depth.
 */
function humanizeOneLine(text: string): string {
  if (!text) return "Brain readings are coming in.";
  // The brain-health one-liner sometimes ends with "Address fixes
  // below in order." which references a section that's not on this
  // surface. Strip that suffix.
  return text.replace(/\s*Address fixes below in order\.?\s*$/i, "").trim();
}

function platformLabel(p: "perplexity" | "chatgpt"): string {
  if (p === "chatgpt") return "ChatGPT";
  return "Perplexity";
}

/** Strip http(s):// + trailing slash for cleaner page-path display. */
function stripProtocol(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

/**
 * Format an ISO date or full ISO timestamp as "May 7" (Mon DD).
 * Operator-friendly, locale-stable, no "UTC" tail.
 */
function formatHumanDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getUTCDate();
    return `${month} ${day}`;
  } catch {
    return iso;
  }
}

/**
 * Best-effort prompt count surface for the Latest Reading card.
 * Uses the manifest's `sourceObservationCount` denominator only as a
 * backup label when nothing else is wired through. This avoids
 * threading another field through the whole today-data resolver.
 */
function primaryActionPromptCountFallback(
  brain: CommandCenterData["brain"],
  _manifest: CommandCenterData["manifest"],
): number | null {
  // The manifest's sourceObservationCount is the running total, not
  // a per-day prompt count — leave null and let the resolver pass a
  // real count via prop in a follow-up. For now, we surface the
  // poll-health platform totals via the badges already.
  if (!brain) return null;
  return null;
}

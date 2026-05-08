/**
 * Recommendations Executive Strip — UX.3 (2026-05-07).
 *
 * Top-of-page summary above the existing /recommendations table.
 * Four cards:
 *   1. Total recommendations monitored
 *   2. Need-review count (rows where derived === "needs_review")
 *   3. Top opportunity (highest-priority pending row)
 *   4. Evidence-strength distribution (Strong / Moderate / Needs more)
 *
 * Plus a one-line "Why ranked here?" disclosure.
 *
 * Pure presentation. Receives all data via props. No mutations, no
 * paid APIs, no client interactivity beyond the Open-recommendation
 * link click.
 *
 * Customer-safe copy: every string is operator-friendly + never
 * mentions cron / Supabase / GitHub / schema / UUID / SQL.
 */

import Link from "next/link";

export type ExecutiveStripRow = {
  /** Stable id used for the deep link. */
  id: string;
  /** Operator-readable headline ("Add cost section to kitchen page"). */
  title: string;
  /** Operator-readable target page label, e.g. "/services/kitchen-remodel". */
  targetLabel: string;
  /** Derived confidence (already customer-safe). */
  derived: "strong_evidence" | "moderate_evidence" | "needs_review";
  /** 1-based rank from the recommendations table (1 = highest priority). */
  rank: number;
  /** Rec status — used to skip already-shipped/dismissed when picking top. */
  status:
    | "new"
    | "accepted"
    | "shipped"
    | "measuring"
    | "needs_review"
    | "needs_fresh_edit"
    | "deferred"
    | "dismissed";
};

export type EvidenceDistribution = {
  strong: number;
  moderate: number;
  needsMore: number;
};

export function ExecutiveStrip({
  rows,
  topPick,
  evidence,
}: {
  /** Total queue (used for "monitored" count + need-review count). */
  rows: ReadonlyArray<ExecutiveStripRow>;
  /** Top pending opportunity, or null when the queue is empty. */
  topPick: ExecutiveStripRow | null;
  /** Pre-computed evidence distribution across all pending rows. */
  evidence: EvidenceDistribution;
}) {
  const total = rows.length;
  const needReview = rows.filter(
    (r) => r.derived === "needs_review" && !isTerminalStatus(r.status),
  ).length;

  return (
    <section
      className="mb-4 space-y-2"
      data-recommendations-executive-strip="true"
      aria-label="Recommendations summary"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card title="Monitored">
          <Big>{total.toLocaleString()}</Big>
          <Sub>
            {total === 1 ? "recommendation" : "recommendations"} in queue
          </Sub>
        </Card>

        <Card title="Need review">
          <Big tone={needReview > 0 ? "warn" : "muted"}>
            {needReview}
          </Big>
          <Sub>
            {needReview === 0
              ? "None waiting on more evidence"
              : "More evidence needed before shipping"}
          </Sub>
        </Card>

        <Card title="Top opportunity">
          {topPick ? (
            <>
              <p
                className="text-[12px] font-medium leading-tight line-clamp-2"
                data-rec-strip-top-title="true"
              >
                {topPick.title}
              </p>
              <p className="text-[11px] text-muted-foreground pt-1 truncate font-mono">
                {topPick.targetLabel}
              </p>
              <div className="pt-2">
                <Link
                  href={`/recommendations#rec-${topPick.id}`}
                  className="text-[11px] underline"
                  data-rec-strip-top-link="true"
                >
                  Open recommendation →
                </Link>
              </div>
            </>
          ) : (
            <Sub>
              Nothing pending right now. New recommendations land after
              the next daily reading.
            </Sub>
          )}
        </Card>

        <Card title="Evidence strength">
          {evidence.strong + evidence.moderate + evidence.needsMore === 0 ? (
            <Sub>No pending recommendations to score yet.</Sub>
          ) : (
            <>
              <EvidenceBar
                strong={evidence.strong}
                moderate={evidence.moderate}
                needsMore={evidence.needsMore}
              />
              <dl className="grid grid-cols-3 gap-2 pt-2 text-[10px]">
                <div className="flex items-baseline gap-1">
                  <dt className="text-muted-foreground">Strong</dt>
                  <dd className="font-mono tabular-nums">{evidence.strong}</dd>
                </div>
                <div className="flex items-baseline gap-1">
                  <dt className="text-muted-foreground">Moderate</dt>
                  <dd className="font-mono tabular-nums">
                    {evidence.moderate}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1">
                  <dt className="text-muted-foreground">Thin</dt>
                  <dd className="font-mono tabular-nums">
                    {evidence.needsMore}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </Card>
      </div>

      <p
        className="text-[11px] leading-relaxed text-muted-foreground"
        data-rec-strip-rank-explainer="true"
      >
        <span className="font-medium text-foreground/80">Why this order?</span>{" "}
        Ranked by evidence depth, prompts affected, owned-page match,
        and engine confidence. The top row is what Beacon thinks moves
        the most visibility today.
      </p>
    </section>
  );
}

// ── Building blocks ───────────────────────────────────────────────────

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-foreground/10 bg-surface-inset/30 p-3 min-h-[110px]">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {title}
      </p>
      <div className="pt-1.5">{children}</div>
    </div>
  );
}

function Big({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn" | "muted";
}) {
  const cls =
    tone === "warn"
      ? "text-status-warning"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <p
      className={
        "text-[24px] font-semibold tabular-nums leading-none " + cls
      }
    >
      {children}
    </p>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground pt-1.5">
      {children}
    </p>
  );
}

function EvidenceBar({
  strong,
  moderate,
  needsMore,
}: {
  strong: number;
  moderate: number;
  needsMore: number;
}) {
  const total = strong + moderate + needsMore;
  if (total === 0) return null;
  const strongPct = (strong / total) * 100;
  const moderatePct = (moderate / total) * 100;
  const needsMorePct = (needsMore / total) * 100;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/5"
      role="img"
      aria-label={`Evidence strength: ${strong} strong, ${moderate} moderate, ${needsMore} thin`}
    >
      <div
        className="bg-emerald-500/80"
        style={{ width: `${strongPct}%` }}
        title={`${strong} strong`}
      />
      <div
        className="bg-amber-400/80"
        style={{ width: `${moderatePct}%` }}
        title={`${moderate} moderate`}
      />
      <div
        className="bg-rose-400/70"
        style={{ width: `${needsMorePct}%` }}
        title={`${needsMore} thin`}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function isTerminalStatus(status: ExecutiveStripRow["status"]): boolean {
  return (
    status === "shipped" ||
    status === "dismissed" ||
    status === "deferred" ||
    status === "measuring"
  );
}

/**
 * Pure helper: build the EvidenceDistribution + topPick from a row
 * list. Exported for tests.
 *
 *   - Distribution counts only PENDING rows (not shipped/dismissed/etc).
 *   - Top pick is the lowest-priority-number pending row whose derived
 *     confidence is NOT "needs_review" (so we don't surface a thin
 *     row as the headline). If no strong/moderate row exists, falls
 *     back to the top needs_review row, then to null.
 */
export function buildExecutiveStripData(
  rows: ReadonlyArray<ExecutiveStripRow>,
): {
  evidence: EvidenceDistribution;
  topPick: ExecutiveStripRow | null;
} {
  const pending = rows.filter((r) => !isTerminalStatus(r.status));

  const evidence: EvidenceDistribution = {
    strong: 0,
    moderate: 0,
    needsMore: 0,
  };
  for (const r of pending) {
    if (r.derived === "strong_evidence") evidence.strong += 1;
    else if (r.derived === "moderate_evidence") evidence.moderate += 1;
    else evidence.needsMore += 1;
  }

  const sorted = [...pending].sort((a, b) => a.rank - b.rank);
  const headline =
    sorted.find((r) => r.derived !== "needs_review") ?? sorted[0] ?? null;

  return { evidence, topPick: headline };
}

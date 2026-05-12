import "server-only";

import Link from "next/link";
import { PageHeader } from "@/components/data/page-header";
import { cn } from "@/lib/utils";
import { prettifySlug } from "./[id]/page";
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import {
  buildPromptDecisionMatrix,
  type CategoryGroupSummary,
  type DecisionMatrix,
} from "@/domains/prompts/decision-matrix";
import type {
  PromptOpportunity,
  PromptOpportunityCategory,
} from "@/domains/prompts/opportunity-classify";
import { PromptsV2Client } from "./prompts-v2-client";

/**
 * Prompts v2A switcher (Bundle 2026-05-11, plan:
 * `~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Routing rules (mirrors `/today`, `/recommendations`, `/changes`):
 *   - Default                        → legacy decision view (current production).
 *   - `?legacy=1` query              → legacy (escape hatch).
 *   - `?v2=1` query                  → v2 strategic surface (preview hatch).
 *   - `BEACON_PROMPTS_V2=true` env   → v2 becomes the default (NOT
 *                                       flipped yet).
 */
function shouldUsePromptsV2(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  if (searchParams.legacy === "1") return false;
  if (searchParams.v2 === "1") return true;
  return process.env.BEACON_PROMPTS_V2 === "true";
}

/**
 * Prompt Decision Surface v1 — grouped-by-opportunity list (Phase v5 Commit 2).
 *
 * Optimizes for 10-second scannability:
 *   - Section headers carry category + count + cluster notes.
 *   - Each row carries prompt text + one-line decision reasoning.
 *   - No per-platform columns, no scoring numbers, no filter chrome.
 *   - Drilldown lives at /prompts/[id] (Phase v5 Commit 3).
 */
export default async function PromptsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = await (searchParams ?? Promise.resolve({}));
  const useV2 = shouldUsePromptsV2(params);
  // Seed canonical stores once per lambda — kept so non-render consumers
  // (prompt-library, url-citation-history) still populate their module-level
  // arrays. Render path below does NOT read from those; it fetches fresh.
  await ensureCanonicalStoresSeeded();

  // Phase 4.9 (Sprint 4, 2026-04-24): fresh canonical data per render.
  // Module-level arrays are seeded once per Vercel lambda; after the
  // 07:00 UTC poll writes fresh observations to Supabase, already-warm
  // lambdas served yesterday's prompt-decision matrix until cold-recycled.
  //
  // E3 (operator audit, 2026-05-05) — bound the observation read to
  // 60 days. /prompts' decision matrix uses observations to score
  // current-window mention/citation status — it doesn't need historical
  // backfill rows. Cuts Supabase egress per /prompts render by ~80%.
  const observationsSince = new Date(Date.now() - 60 * 86_400_000)
    .toISOString();
  // Perf+egress bundle (2026-05-12) — /prompts NEVER renders the
  // visibility chart or any per-snapshot trend, so pulling the full
  // `daily_metric_snapshots` table (~24k rows) was pure waste. The
  // decision matrix consumes only `prompt_answer_observations`.
  // Pass a 1-day `snapshotsSince` so the repo fetches at most the
  // last calendar day's snapshots (which today-data uses for the
  // hero `chartEndDate` anchor; /prompts ignores the array but
  // `loadFreshCanonicalData`'s contract returns it either way).
  const snapshotsSince = new Date(Date.now() - 1 * 86_400_000)
    .toISOString();
  const {
    trackedPrompts,
    promptAnswerObservations,
    trackedEntities,
  } = await loadFreshCanonicalData({ observationsSince, snapshotsSince });
  const promptTextById = new Map(
    trackedPrompts.map((p) => [p.id, p.text]),
  );

  const matrix = buildPromptDecisionMatrix({
    prompts: trackedPrompts,
    observations: promptAnswerObservations,
    activeEntities: trackedEntities,
    now: new Date(),
  });

  if (useV2) {
    // v2A strategic surface — same matrix + prompt-text lookup the
    // legacy page consumes; pure presentation layer at this
    // boundary. No additional fetches, no server actions, no
    // domain logic changes.
    return (
      <PromptsV2Client
        prompts={matrix.prompts}
        promptTextById={promptTextById}
      />
    );
  }

  const totalPrompts = matrix.prompts.length;
  const hasAnyNativeObservations = matrix.prompts.some(
    (p) => p.category !== "early",
  );

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Prompts"
        description="Decision view across your tracked prompts. Grouped by how AI answers them."
      />

      {totalPrompts === 0 ? (
        <EmptyState
          title="No active prompts"
          body="Add prompts in Settings → Prompts to start daily polling."
          cta={{ href: "/settings/prompts", label: "Manage prompts →" }}
        />
      ) : !hasAnyNativeObservations ? (
        <EmptyState
          title="Too early to judge"
          body={`${totalPrompts} prompts active but no AI readings in the last 7 days. Beacon checks AI visibility every morning.`}
        />
      ) : (
        <>
          <AtGlance matrix={matrix} />
          <div className="space-y-8">
            {matrix.groupSummaries
              .filter((g) => g.count > 0)
              .map((group) => (
                <CategorySection
                  key={group.category}
                  group={group}
                  prompts={matrix.prompts.filter(
                    (p) => p.category === group.category,
                  )}
                  promptTextById={promptTextById}
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function AtGlance({ matrix }: { matrix: DecisionMatrix }) {
  const counts = Object.fromEntries(
    matrix.groupSummaries.map((g) => [g.category, g.count]),
  );
  const latest = mostRecentObservation(matrix);
  return (
    <div className="mb-6 rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="font-bold tabular-nums">{matrix.prompts.length}</span>
          <span className="text-muted-foreground ml-1.5">prompts</span>
        </span>
        {counts.winning > 0 && (
          <span className="text-status-success">
            <span className="font-semibold tabular-nums">{counts.winning}</span>{" "}
            winning
          </span>
        )}
        {counts.close > 0 && (
          <span className="text-status-warning/85">
            <span className="font-semibold tabular-nums">{counts.close}</span>{" "}
            close
          </span>
        )}
        {counts.absent > 0 && (
          <span className="text-status-warning">
            <span className="font-semibold tabular-nums">{counts.absent}</span>{" "}
            absent
          </span>
        )}
        {counts.outranked > 0 && (
          <span className="text-status-danger">
            <span className="font-semibold tabular-nums">
              {counts.outranked}
            </span>{" "}
            outranked
          </span>
        )}
        {counts.early > 0 && (
          <span className="text-muted-foreground">
            <span className="font-semibold tabular-nums">{counts.early}</span>{" "}
            early
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/80 leading-relaxed">
        Lookback: last 7 days of AI readings (from{" "}
        <span className="tabular-nums">{matrix.lookbackFrom}</span>). Thresholds
        fixed in v1 — surface only Perplexity + ChatGPT data.
        {latest ? (
          <>
            {" "}Latest observation:{" "}
            <span className="tabular-nums">{latest.slice(0, 10)}</span>.
          </>
        ) : null}
      </p>
    </div>
  );
}

function mostRecentObservation(matrix: DecisionMatrix): string | null {
  let max: string | null = null;
  for (const p of matrix.prompts) {
    for (const plat of p.evidence.byPlatform) {
      // byPlatform carries observation counts but not a timestamp; fall back
      // to lookbackFrom when we don't carry per-obs timestamps here. This is
      // a minor polish — OK to drop if not trivially available.
      if (plat.observations > 0 && max === null) max = matrix.date;
    }
  }
  return max;
}

/* ────────────────────────────────────────────────────────────────────────── */

const CATEGORY_META: Record<
  PromptOpportunityCategory,
  {
    label: string;
    lead: string;
    accent: string;
    bg: string;
    dotClass: string;
  }
> = {
  outranked: {
    label: "Outranked",
    lead: "Competitors dominate here. You're absent.",
    accent: "text-status-danger",
    bg: "border-status-danger/25 bg-status-danger/[0.03]",
    dotClass: "bg-status-danger",
  },
  absent: {
    label: "Absent",
    lead: "AI never mentioned you for these.",
    accent: "text-status-warning",
    bg: "border-status-warning/25 bg-status-warning/[0.03]",
    dotClass: "bg-status-warning",
  },
  close: {
    label: "Close",
    lead: "You're cited, not primary. Room to step up.",
    accent: "text-status-warning/85",
    bg: "border-border/60 bg-surface-inset/30",
    dotClass: "bg-status-warning/60",
  },
  winning: {
    label: "Winning",
    lead: "You're primary on at least one platform.",
    accent: "text-status-success",
    bg: "border-status-success/25 bg-status-success/[0.03]",
    dotClass: "bg-status-success",
  },
  early: {
    label: "Early",
    lead: "Not enough AI readings yet to judge.",
    accent: "text-muted-foreground",
    bg: "border-border/50 bg-surface-inset/20",
    dotClass: "bg-muted-foreground/60",
  },
};

function CategorySection({
  group,
  prompts,
  promptTextById,
}: {
  group: CategoryGroupSummary;
  prompts: PromptOpportunity[];
  promptTextById: Map<string, string>;
}) {
  const meta = CATEGORY_META[group.category];
  // Sort by signal strength descending within the group.
  const sorted = [...prompts].sort(
    (a, b) => b.signalStrength - a.signalStrength,
  );

  return (
    <section
      className={cn("rounded-lg border px-5 py-4", meta.bg)}
      aria-labelledby={`prompts-${group.category}-heading`}
    >
      <header className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dotClass)} />
          <h2
            id={`prompts-${group.category}-heading`}
            className={cn("text-[13px] font-bold tracking-tight", meta.accent)}
          >
            {meta.label.toUpperCase()} · {group.count}
          </h2>
        </div>
        {group.clusterNote && (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {group.clusterNote}
          </p>
        )}
      </header>

      <p className="mb-3 text-[11px] text-muted-foreground leading-relaxed">
        {meta.lead}
      </p>

      <ul className="space-y-2">
        {sorted.map((op) => (
          <PromptRow
            key={op.prompt_id}
            op={op}
            promptTextById={promptTextById}
          />
        ))}
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function PromptRow({
  op,
  promptTextById,
}: {
  op: PromptOpportunity;
  promptTextById: Map<string, string>;
}) {
  // Phase 4.9: prompt text resolved from the fresh repo-sourced Map built
  // in the parent. No module-level trackedPrompts read here.
  const text = promptTextById.get(op.prompt_id) ?? op.prompt_id;

  // Extract cluster tags for display as small pills.
  const clusterTags = op.tags.filter(
    (t) => t.startsWith("geo_cluster:") || t.startsWith("topic_cluster:"),
  );
  const hasRankedListMiss = op.tags.includes("ranked_list_miss");

  return (
    <li>
      <Link
        href={`/prompts/${encodeURIComponent(op.prompt_id)}`}
        className="block rounded-md border border-border/40 bg-background px-3 py-2.5 hover:border-accent-primary/40 hover:bg-surface-raised/30 transition-colors"
      >
        <p className="text-[13px] font-medium text-foreground leading-snug">
          {text}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
          {op.reasoning}
        </p>
        {(clusterTags.length > 0 || hasRankedListMiss) && (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {hasRankedListMiss && (
              <li className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-surface-inset/30 text-muted-foreground">
                Not on the list
              </li>
            )}
            {clusterTags.map((t) => {
              const [type, ...rest] = t.split(":");
              const rawLabel = rest.join(":");
              const label = prettifySlug(rawLabel) ?? rawLabel;
              const kind = type === "geo_cluster" ? "geo" : "topic";
              return (
                <li
                  key={t}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-surface-inset/30 text-muted-foreground"
                >
                  <span className="font-medium text-foreground/80">{kind}</span>
                  <span className="mx-0.5">·</span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Link>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
      <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          {cta.label}
        </Link>
      ) : null}
    </section>
  );
}

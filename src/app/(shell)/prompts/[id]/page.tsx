import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { buildPromptDrilldown } from "@/domains/prompts/prompt-drilldown";
import type { PromptOpportunityCategory } from "@/domains/prompts/opportunity-classify";
import {
  encodePromptRouteId,
  decodePromptRouteId,
} from "@/components/prompts/v2/prompt-route-id";
import { projectPromptDrilldownToBrief } from "@/domains/prompts/v2-brief-projection";
import {
  createPerfTrace,
  readPerfTraceIdFromHeaders,
} from "@/lib/perf-trace";
import { PromptDetailV2Client } from "./prompt-detail-v2-client";
import { PromptDetailV2NotFound } from "./prompt-detail-v2-not-found";
import { computePromptPrimaryShare } from "@/domains/daily-metric-snapshots/prompt-primary-share";

// 2026-05-15 — Section 6 C5 prerender safety. Mirrors
// `/diagnostics/page.tsx`'s post-fix pattern. The v2 branch reads
// `daily_metric_snapshots` for the per-prompt primary-share sub-line
// via `computePromptPrimaryShare`; static prerender would execute that
// Supabase read at build time and risk the same statement-timeout
// flake we hit in /diagnostics. Opt every render into dynamic per-
// request rendering. Pinned by
// `tests/architecture/prompts-detail-force-dynamic.test.ts`.
export const dynamic = "force-dynamic";

/**
 * Prompts v2B switcher (Bundle 2026-05-11, plan:
 * `~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`).
 *
 * Routing rules (mirrors `/prompts`, `/changes/[id]`, etc.):
 *   - Default                       → legacy drilldown (current production).
 *   - `?legacy=1` query             → legacy (escape hatch — wins).
 *   - `?v2=1` query                 → v2 5-act proof brief.
 *   - `BEACON_PROMPTS_V2=true` env  → v2 becomes the default (NOT
 *                                      flipped yet — shared with the
 *                                      list page).
 */
function shouldUsePromptsDetailV2(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  if (searchParams.legacy === "1") return false;
  if (searchParams.v2 === "1") return true;
  return process.env.BEACON_PROMPTS_V2 === "true";
}

/**
 * /prompts/[id] — the decision-evidence drilldown (Phase v5 Commit 3).
 *
 * Layout is deliberately anti-analytical:
 *   1. Header block: category + rich decision sentence + prompt text + tags.
 *      This is the "so what" — strongest line on the page.
 *   2. Platform split: 2 cards, Ritz's state per platform.
 *   3. Who else is here: top competitors by appearance frequency.
 *   4. Words AI used near you: descriptor chip cloud (when Ritz mentioned).
 *   5. Answer shape: one-line callout only when a single structure ≥60%.
 *   6. Raw evidence: last 3 observations collapsed, click to expand.
 *
 * No raw numbers above the decision sentence. No tables. No scoring.
 */
export default async function PromptDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const trace = createPerfTrace("loader:/prompts/[id]", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/prompts/[id]",
  });
  try {
  const [{ id }, sp] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({}),
  ]);
  // Defensive id decoding through the v2 route-id helper. Next.js
  // already decodes the path segment once before it reaches us; the
  // helper turns empty/whitespace ids into `null` so we can short-
  // circuit to the calm not-found state instead of querying the
  // canonical store with a junk id.
  const decoded = decodePromptRouteId(id);
  if (decoded === null) {
    // v2 + legacy both render the same calm not-found here; the
    // legacy `notFound()` path stays available for downstream
    // failures, but a literally-empty route id never reaches the
    // legacy renderer.
    return <PromptDetailV2NotFound />;
  }
  const promptId = decoded;
  const useV2 = shouldUsePromptsDetailV2(sp);

  // Emergency P0 fix (2026-05-12) — prompt-scoped repo reads.
  //
  // Production trace measured `/prompts/[id]` at **11+ seconds** with
  // `loadFreshCanonicalData` alone taking ~11s pulling all 15,125
  // observations across all 100 tracked prompts — only to filter to
  // ONE prompt below. The waste was structural: 4-table fan-out via
  // `loadFreshCanonicalData` when this page needs:
  //   • `tracked_prompts` (small, ~100 rows) — to find one prompt
  //   • `tracked_entities` (small, ~40 rows) — for drilldown
  //   • `prompt_answer_observations` WHERE prompt_id = $1 — small
  //     (~50–500 rows for one prompt's 60-day window) instead of 15k
  //   • snapshots and the canonical seed: NOT needed here
  //
  // The three direct repo reads run in parallel; the
  // `prompt_answer_observations` query pushes `prompt_id = $1` down
  // to Postgres so the row count crossing the wire drops from
  // ~15,000 to typically <500. Expected /prompts/[id] loader time:
  // 11s → ~1s in production.
  const NOW_MS = Date.now();
  const observationsSince = new Date(NOW_MS - 60 * 86_400_000).toISOString();
  const tenantId = await currentTenantId();
  const tenantRepo = getRepository().forTenant(tenantId);
  const [trackedPrompts, trackedEntities, promptAnswerObservations] =
    await trace.time("prompt_scoped_reads", () =>
      Promise.all([
        trace.time("tenantRepo.getTrackedPrompts", () =>
          tenantRepo.getTrackedPrompts(),
        ),
        trace.time("tenantRepo.getTrackedEntities", () =>
          tenantRepo.getTrackedEntities(),
        ),
        trace.time("tenantRepo.getPromptAnswerObservations(scoped)", () =>
          tenantRepo.getPromptAnswerObservations({
            since: observationsSince,
            promptId,
          }),
        ),
      ]),
    );
  trace.data("observations_count", promptAnswerObservations.length);

  const prompt = trackedPrompts.find((p) => p.id === promptId);
  if (!prompt) notFound();

  // Fetch the last ~30 days of answer_texts for this prompt's observations.
  // We query by observation_id (the observation IDs we already have locally
  // for this prompt). One Supabase round-trip; bounded by last 10 obs.
  const promptObservations = promptAnswerObservations
    .filter((o) => o.prompt_id === promptId)
    .sort(
      (a, b) =>
        new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime(),
    )
    .slice(0, 10);

  let answerTexts: Map<string, string> | undefined;
  try {
    const ids = promptObservations.map((o) => o.id);
    trace.data("answer_texts_ids", ids.length);
    if (ids.length > 0) {
      const { data, error } = await trace.time(
        "answer_texts.select",
        () =>
          getSupabaseAdmin()
            .from("answer_texts")
            .select("observation_id, body")
            .in("observation_id", ids),
      );
      if (!error && data) {
        answerTexts = new Map(
          data.map((r) => [
            r.observation_id as string,
            (r.body as string) ?? "",
          ]),
        );
      }
    }
  } catch (err) {
    console.error("prompts/[id] answer_texts fetch failed:", err);
  }

  const drilldown = await trace.time("buildPromptDrilldown", async () =>
    buildPromptDrilldown({
      prompt,
      observations: promptAnswerObservations,
      activeEntities: trackedEntities,
      answerTexts,
      now: new Date(),
    } as Parameters<typeof buildPromptDrilldown>[0]),
  );
  trace.measureSize("payload_drilldown", drilldown);

  if (useV2) {
    // v2 proof brief — reuses the SAME `drilldown` object the legacy
    // renderer consumes; the projector is pure and lives in
    // `src/domains/prompts/v2-brief-projection.ts`. No additional
    // fetches, no server actions, no domain logic changes.
    //
    // `hasLinkedRecommendation` defaults to false today — the prompt
    // → recommendation linkage is not currently surfaced through the
    // drilldown shape. When that becomes available, this single
    // flag wires the CTA from "See related recommendations" to a
    // direct "Open recommendation" link.
    const briefProps = projectPromptDrilldownToBrief({
      drilldown,
      promptRouteId: encodePromptRouteId(promptId),
      hasLinkedRecommendation: false,
      includeLegacyEscape: true,
    });

    // Section 6 C5 (2026-05-15) — per-prompt primary-share aggregate.
    // Reads `daily_metric_snapshots` rows where scope_type='prompt'
    // for the last 14 UTC days and aggregates per platform (sum-count
    // / sum-total). Mathematically distinct from the Today hero C4b
    // path: prompt-scope rows have total_possible = 1 per row, so
    // single-row semantic would force every card into still_learning.
    // The 14-day aggregate clears the ≥ 7-obs guard for any prompt
    // backfilled by C3.
    //
    // Tenant isolation: explicit `.forTenant(tenantId)` binding;
    // helper module does NOT import getRepository. Pinned by
    // `tests/architecture/prompt-primary-share-source.test.ts`.
    const sinceDate = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 14);
      return d.toISOString().slice(0, 10);
    })();
    const promptPrimaryRepo = getRepository().forTenant(tenantId);
    // Resilient read: if the repo surface is missing the method (e.g.,
    // a test mock that predates C5) OR Supabase momentarily errors,
    // fall back to `{ chatgpt: null, perplexity: null }` so the page
    // still renders with the sub-line hidden. The customer-visible
    // outcome matches the null-result path (operator-approved per
    // C5 §6 edge cases + J1 carry-over) rather than crashing the
    // prompt detail page. The fallback is NOT silent — we emit a
    // structured `console.warn` with `tenantId` + `promptId` +
    // `error.message` so operator diagnostics can locate the
    // failing tenant/prompt without leaking Supabase keys, answer
    // text, raw prompt bodies, or stack traces. The warning shape
    // is pinned by
    // `tests/architecture/prompt-primary-share-source.test.ts`.
    const promptPrimary = await trace.time("computePromptPrimaryShare", async () => {
      try {
        return await computePromptPrimaryShare({
          repo: promptPrimaryRepo,
          promptId,
          options: { since: sinceDate },
        });
      } catch (error) {
        console.warn("[section6-c5] prompt primary share failed", {
          tenantId,
          promptId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { chatgpt: null, perplexity: null };
      }
    });

    return (
      <PromptDetailV2Client {...briefProps} promptPrimary={promptPrimary} />
    );
  }

  return (
    <div className="max-w-3xl">
      <BackLink />

      {/* 1. Header: "so what" */}
      <SoWhatBlock drilldown={drilldown} />

      {/* 1.5 (2026-05-06 Phase 3-bis fix 7) — action bridge.
          Tells the operator what to do next. For "early" prompts the
          copy is reassuring ("Beacon is watching"); for actionable
          categories (outranked / absent / close / winning) it links
          to the recommendations queue. */}
      <ActionBridge category={drilldown.classification.category} />

      {/* 2. Platform split */}
      <PlatformSplit drilldown={drilldown} />

      {/* 2.5 Who IS the primary answer */}
      {drilldown.primarySummary.totalAnswers > 0 && (
        <PrimaryAnswerBlock drilldown={drilldown} />
      )}

      {/* 3. Who else is here */}
      {drilldown.competitors.length > 0 && (
        <CompetitorList drilldown={drilldown} />
      )}

      {/* 4. Descriptors near brand */}
      <DescriptorCloud drilldown={drilldown} />

      {/* 5. Answer shape (only when dominant) */}
      {drilldown.dominantAnswerStructure && (
        <AnswerShapeCallout drilldown={drilldown} />
      )}

      {/* 6. Raw evidence */}
      <RawEvidence drilldown={drilldown} />
    </div>
  );
  } finally {
    trace.flush();
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

function BackLink() {
  return (
    <p className="mb-4 text-[12px]">
      <Link
        href="/prompts"
        className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
      >
        ← All prompts
      </Link>
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 2026-05-06 demo-path Phase 3-bis fix 7 — action bridge from prompt
 * detail to recommendations queue. Pre-fix: the drilldown showed the
 * full prompt analysis but never told the operator what to do next.
 * Post-fix: a single line below the "so what" header either points to
 * the recommendations queue (when the prompt is actionable) or
 * explicitly reassures the operator that Beacon is watching (when
 * the prompt is "early" — too few observations to act on yet).
 */
function ActionBridge({
  category,
}: {
  category: PromptOpportunityCategory;
}) {
  if (category === "early") {
    return (
      <section className="mb-6 rounded-md border border-border/40 bg-surface-inset/20 px-4 py-2.5">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          No action queued yet — Beacon will keep watching this prompt as
          more answers come in.
        </p>
      </section>
    );
  }
  return (
    <section className="mb-6">
      <Link
        href="/recommendations"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-primary hover:underline underline-offset-2"
        data-prompt-action-bridge="recommendations"
      >
        See related recommendations →
      </Link>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

const CATEGORY_META: Record<
  PromptOpportunityCategory,
  { label: string; accent: string; border: string; bg: string; dot: string }
> = {
  outranked: {
    label: "Outranked",
    accent: "text-status-danger",
    border: "border-status-danger/30",
    bg: "bg-status-danger/[0.04]",
    dot: "bg-status-danger",
  },
  absent: {
    label: "Absent",
    accent: "text-status-warning",
    border: "border-status-warning/30",
    bg: "bg-status-warning/[0.04]",
    dot: "bg-status-warning",
  },
  close: {
    label: "Close",
    accent: "text-status-warning/85",
    border: "border-border/60",
    bg: "bg-surface-inset/30",
    dot: "bg-status-warning/60",
  },
  winning: {
    label: "Winning",
    accent: "text-status-success",
    border: "border-status-success/30",
    bg: "bg-status-success/[0.04]",
    dot: "bg-status-success",
  },
  early: {
    label: "Early",
    accent: "text-muted-foreground",
    border: "border-border/50",
    bg: "bg-surface-inset/20",
    dot: "bg-muted-foreground/60",
  },
};

function SoWhatBlock({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  const meta = CATEGORY_META[drilldown.category];
  const clusterTags = drilldown.classification.tags.filter(
    (t) => t.startsWith("geo_cluster:") || t.startsWith("topic_cluster:"),
  );

  return (
    <section
      className={cn(
        "rounded-lg border px-5 py-4 mb-6",
        meta.border,
        meta.bg,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
        <span className={cn("text-[12px] font-bold tracking-tight", meta.accent)}>
          {meta.label.toUpperCase()}
        </span>
      </div>
      <p className="text-[14px] leading-relaxed text-foreground">
        {drilldown.decisionSentence}
      </p>
      <p className="mt-3 pt-3 border-t border-border/30 text-[13px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Prompt:</span>{" "}
        {drilldown.promptText}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1">
        {drilldown.topicId && prettifySlug(drilldown.topicId) && (
          <li className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-background text-muted-foreground">
            <span className="font-medium text-foreground/80">topic</span>
            <span className="mx-0.5">·</span>
            <span>{prettifySlug(drilldown.topicId)}</span>
          </li>
        )}
        {drilldown.locationScope && prettifySlug(drilldown.locationScope) && (
          <li className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-background text-muted-foreground">
            <span className="font-medium text-foreground/80">geo</span>
            <span className="mx-0.5">·</span>
            <span>{prettifySlug(drilldown.locationScope)}</span>
          </li>
        )}
        {clusterTags.map((t) => {
          const [type, ...rest] = t.split(":");
          const rawLabel = rest.join(":");
          // 2026-05-06 demo-path fix — humanize cluster slug labels
          // (e.g. "bay_area_ca" → "Bay Area, CA"). Earlier this rendered
          // raw underscore-shaped tokens.
          const label = prettifySlug(rawLabel) ?? rawLabel;
          const kind = type === "geo_cluster" ? "geo cluster" : "topic cluster";
          return (
            <li
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-background text-muted-foreground"
            >
              <span className="font-medium text-foreground/80">{kind}</span>
              <span className="mx-0.5">·</span>
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Round 2 customer-readiness (2026-05-06) — friendly-slug helper.
 *
 * Round 1 audit found the prompt-drilldown header rendered raw
 * `topicId` and `locationScope` values (e.g., `"cupertino_ca"` slug
 * or a UUID-shaped key) when the operator was thinking in
 * human-readable cluster labels. This helper turns slug-shaped keys
 * into operator-readable display strings:
 *
 *   "cupertino_ca"           → "Cupertino, CA"
 *   "palo_alto_ca"           → "Palo Alto, CA"
 *   "luxury_home_builder"    → "Luxury Home Builder"
 *   "kitchen-remodel"        → "Kitchen Remodel"
 *
 * For UUID-shaped strings (8-4-4-4-12 hex with hyphens, RFC-4122),
 * returns null — the caller renders nothing rather than show a raw
 * UUID. Same posture as the rec-drawer UUID sanitizer.
 *
 * No external dependencies; pure string transform.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const US_STATE_SUFFIX = /\b([A-Za-z]{2})$/;
const KNOWN_US_STATES = new Set([
  "ca",
  "ny",
  "tx",
  "wa",
  "or",
  "az",
  "nv",
  "fl",
  "co",
  "ma",
  "il",
  "ga",
  "nj",
  "pa",
  "va",
  "nc",
  "mi",
  "oh",
  "wi",
  "mn",
  "mo",
  "tn",
  "in",
  "ky",
  "al",
  "sc",
  "md",
  "ct",
  "ut",
  "ar",
  "ms",
  "la",
  "ia",
  "ks",
  "nm",
  "ne",
  "wv",
  "ms",
  "id",
  "hi",
  "nh",
  "me",
  "ri",
  "mt",
  "de",
  "sd",
  "nd",
  "ak",
  "vt",
  "wy",
]);

function titleCaseToken(token: string): string {
  if (token.length === 0) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function prettifySlug(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Bare UUIDs are operator-noise — don't render.
  if (UUID_RE.test(trimmed)) return null;

  // If the input already contains a space, treat it as already-prettified
  // human-readable text (e.g. tracked-prompts.json topic_ids like
  // "Already Have Architectural Plans (Bay Area)") and return verbatim.
  // Slugs always use `-` or `_` separators, never spaces, so this is a
  // safe early-exit. Without this guard, single-token title-cased input
  // gets sentence-cased by titleCaseToken (only the first char stays
  // uppercase) — the live bug surfaced by prompt-drilldown-smoke.
  if (/\s/.test(trimmed)) return trimmed;

  // Split on - or _ ; reject if there's nothing word-like.
  const tokens = trimmed.split(/[-_]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  // Detect trailing US state (2-letter): show as ", CA" suffix
  // instead of " ca" to avoid "Cupertino Ca" awkwardness.
  const last = tokens[tokens.length - 1].toLowerCase();
  if (
    tokens.length >= 2 &&
    US_STATE_SUFFIX.test(last) &&
    KNOWN_US_STATES.has(last)
  ) {
    const head = tokens
      .slice(0, -1)
      .map(titleCaseToken)
      .join(" ");
    return `${head}, ${last.toUpperCase()}`;
  }

  return tokens.map(titleCaseToken).join(" ");
}

const PLATFORM_LABEL: Record<string, string> = {
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  google_aio: "Google AI",
};

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p;
}

function PlatformSplit({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  const byPlatform = drilldown.classification.evidence.byPlatform;
  if (byPlatform.length === 0) return null;
  return (
    <section className="mb-6">
      <SectionHeading>Your state, per platform</SectionHeading>
      <ul className="grid gap-2 sm:grid-cols-2">
        {byPlatform.map((p) => {
          const label = platformLabel(p.platform);
          const primaryRate =
            p.observations > 0 ? Math.round((p.primary / p.observations) * 100) : 0;
          const isWinning = p.observations > 0 && p.primary / p.observations >= 0.5;
          const isAbsent = p.observations > 0 && p.absent === p.observations;
          return (
            <li
              key={p.platform}
              className="rounded-md border border-border/50 bg-background px-3 py-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-foreground">
                  {label}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {p.observations} {p.observations === 1 ? "answer" : "answers"}
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 text-[12px] leading-snug",
                  isWinning && "text-status-success",
                  isAbsent && "text-status-warning",
                  !isWinning && !isAbsent && "text-foreground",
                )}
              >
                {p.observations === 0
                  ? "No observations"
                  : isWinning
                    ? `Primary in ${p.primary} of ${p.observations} (${primaryRate}%)`
                    : isAbsent
                      ? "Absent from every answer"
                      : p.primary > 0
                        ? `Primary ${p.primary} of ${p.observations} · cited ${p.cited} · absent ${p.absent}`
                        : p.cited > 0
                          ? `Cited in ${p.cited} of ${p.observations}${p.avgCitationRank !== null ? ` (avg #${p.avgCitationRank})` : ""}`
                          : `Mentioned in ${p.mentioned} of ${p.observations}, never cited`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function PrimaryAnswerBlock({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  const s = drilldown.primarySummary;
  const topCompetitor = s.primaryCompetitors[0] ?? null;

  // Compose a one-line verdict + tone per state.
  let headline: string;
  let tone: "good" | "bad" | "mixed" | "neutral";
  if (s.ritzState === "primary") {
    const pct = Math.round(s.ritzPrimaryShare * 100);
    headline = `You're the primary recommendation in ${s.ritzPrimaryCount} of ${s.totalAnswers} answers (${pct}%).`;
    tone = "good";
  } else if (topCompetitor && !s.fragmented) {
    const pct = Math.round(
      (topCompetitor.primaryCount / topCompetitor.totalAnswers) * 100,
    );
    headline = `${topCompetitor.name} is the primary recommendation in ${topCompetitor.primaryCount} of ${topCompetitor.totalAnswers} answers (${pct}%).`;
    tone = "bad";
  } else if (s.fragmented) {
    const distinct =
      (s.ritzPrimaryCount > 0 ? 1 : 0) + s.primaryCompetitors.length;
    headline = `No single primary — ${distinct} different entities split the top slot across ${s.totalAnswers} answers.`;
    tone = "mixed";
  } else {
    // Ritz mentioned but never primary AND no competitor majority AND
    // not fragmented (single entity but < 50%). Rare. Or: nobody mentioned
    // at all (ritzState="absent" with no competitors).
    headline =
      s.ritzState === "absent"
        ? `No recommendation primary yet — brand absent and no competitor has a majority in ${s.totalAnswers} answers.`
        : `Brand mentioned, never primary. No competitor has a majority in ${s.totalAnswers} answers yet.`;
    tone = "neutral";
  }

  const toneClass =
    tone === "good"
      ? "border-status-success/30 bg-status-success/[0.05]"
      : tone === "bad"
        ? "border-status-danger/30 bg-status-danger/[0.05]"
        : tone === "mixed"
          ? "border-status-warning/30 bg-status-warning/[0.05]"
          : "border-border/50 bg-surface-inset/30";

  // Detail line: enumerate up to 3 primary competitors beyond the top one
  // so the operator sees the share of the field.
  const otherCompetitors = s.primaryCompetitors.slice(topCompetitor ? 1 : 0, 3);

  return (
    <section className="mb-6">
      <SectionHeading>Who IS the answer</SectionHeading>
      <div
        className={cn(
          "rounded-md border px-3 py-2.5 text-[13px] leading-relaxed",
          toneClass,
        )}
      >
        <p className="text-foreground">{headline}</p>
        {otherCompetitors.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Also primary on some answers:{" "}
            {otherCompetitors
              .map((c) => `${c.name} (${c.primaryCount})`)
              .join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function CompetitorList({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  return (
    <section className="mb-6">
      <SectionHeading>Who else is here</SectionHeading>
      <ul className="space-y-1.5">
        {drilldown.competitors.map((c) => {
          const pct = c.totalObservations > 0
            ? Math.round((c.appearances / c.totalObservations) * 100)
            : 0;
          return (
            <li
              key={c.name}
              className="flex items-baseline justify-between gap-3 text-[13px] border border-border/40 bg-background rounded-md px-3 py-2"
            >
              <span className="font-medium text-foreground">{c.name}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {c.appearances} of {c.totalObservations} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function DescriptorCloud({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  const hasAny = drilldown.descriptorsNearBrand.length > 0;
  return (
    <section className="mb-6">
      <SectionHeading>Words AI used near you</SectionHeading>
      {hasAny ? (
        <ul className="flex flex-wrap gap-1.5">
          {drilldown.descriptorsNearBrand.map((d) => (
            <li
              key={d.word}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] tabular-nums"
            >
              <span className="font-medium text-foreground">{d.word}</span>
              <span className="text-muted-foreground/70">{d.count}×</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          AI hasn&apos;t described you on this prompt yet — your brand was
          not mentioned in any of the observed answers.
        </p>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function AnswerShapeCallout({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  const s = drilldown.dominantAnswerStructure!;
  const pct = Math.round(s.share * 100);
  const pretty = s.structure.replace(/_/g, " ");
  return (
    <section className="mb-6">
      <SectionHeading>Answer shape</SectionHeading>
      <p className="text-[13px] text-foreground">
        <span className="font-medium">{pct}%</span> of answers ({s.topCount} of {s.total}) came back as a{" "}
        <span className="font-medium">{pretty}</span>. Worth appearing in one.
      </p>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

const STATE_COPY: Record<
  "primary" | "cited" | "mentioned" | "absent",
  { label: string; className: string }
> = {
  primary: { label: "primary", className: "text-status-success" },
  cited: { label: "cited", className: "text-status-warning/85" },
  mentioned: { label: "mentioned", className: "text-muted-foreground" },
  absent: { label: "absent", className: "text-status-danger/85" },
};

function RawEvidence({
  drilldown,
}: {
  drilldown: ReturnType<typeof buildPromptDrilldown>;
}) {
  if (drilldown.rawSamples.length === 0) {
    return null;
  }
  return (
    <section className="mb-6">
      <SectionHeading>Raw evidence — last {drilldown.rawSamples.length}</SectionHeading>
      <ul className="space-y-2">
        {drilldown.rawSamples.map((s) => {
          const state = STATE_COPY[s.ritzState];
          const dateStr = s.observedAt.slice(0, 10);
          return (
            <li
              key={s.observationId}
              className="rounded-md border border-border/40 bg-background"
            >
              <details className="group/sample">
                <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-baseline gap-2 text-[12px] tabular-nums">
                    <span className="text-muted-foreground">{dateStr}</span>
                    <span className="text-foreground">
                      {platformLabel(s.platform)}
                    </span>
                    <span className={cn("font-medium", state.className)}>
                      {state.label}
                    </span>
                    {s.citationRank !== null && (
                      <span className="text-muted-foreground">
                        #{s.citationRank}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 group-open/sample:rotate-90 transition-transform">
                    ▶
                  </span>
                </summary>
                <div className="px-3 pb-3 text-[12px] text-foreground/90 leading-relaxed border-t border-border/30 pt-2 mt-0.5">
                  {s.answerTextFull ? (
                    <p className="whitespace-pre-wrap">{s.answerTextFull}</p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      Answer text not available for this observation.
                    </p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase mb-2">
      {children}
    </h2>
  );
}

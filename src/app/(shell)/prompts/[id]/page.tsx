import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { buildPromptDrilldown } from "@/domains/prompts/prompt-drilldown";
import type { PromptOpportunityCategory } from "@/domains/prompts/opportunity-classify";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const promptId = decodeURIComponent(id);

  await ensureCanonicalStoresSeeded();

  // Phase 4.9 (Sprint 4, 2026-04-24): fresh per-render canonical read.
  const {
    trackedPrompts,
    trackedEntities,
    promptAnswerObservations,
  } = await loadFreshCanonicalData();

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
    if (ids.length > 0) {
      const { data, error } = await getSupabaseAdmin()
        .from("answer_texts")
        .select("observation_id, body")
        .in("observation_id", ids);
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

  const drilldown = buildPromptDrilldown({
    prompt,
    observations: promptAnswerObservations,
    activeEntities: trackedEntities,
    answerTexts,
    now: new Date(),
  } as Parameters<typeof buildPromptDrilldown>[0]);

  return (
    <div className="max-w-3xl">
      <BackLink />

      {/* 1. Header: "so what" */}
      <SoWhatBlock drilldown={drilldown} />

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
          const label = rest.join(":");
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

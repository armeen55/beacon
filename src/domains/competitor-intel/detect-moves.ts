/**
 * 2026-06-09 — Competitor move detection (pure): the "steal this move"
 * join. A MOVE = a dated competitor page change (sitemap-level new/
 * updated page, or a structural change from the page differ) joined
 * with that URL's AI-citation aftermath.
 *
 * Tiers (honest, windowed):
 *   proven   — ≥ MIN_PROVEN_POST citations in the post window AND more
 *              than the pre window (their change preceded a real rise).
 *   early    — some AI pickup already, below the proven bar.
 *   watching — still inside the post window, no pickup yet.
 *   quiet    — window complete, no pickup (operator surface only).
 *
 * Copy is TEMPORAL-ASSOCIATIVE only — two dated facts side by side
 * ("added it June 2; AI started citing it 6 days later"). No causal
 * verbs, no revenue/$ — same discipline as the outcome surfaces.
 */

import type { CompetitorPageChange } from "@/domains/competitor-monitoring/types";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  firstCitationOnOrAfter,
  windowCount,
} from "./citation-series";
import type {
  CompetitorMove,
  CompetitorMoveAction,
  CompetitorMoveKind,
  CompetitorMoveTier,
  CompetitorStructuralChange,
  CompetitorUrlCitationSeries,
} from "./types";

export const PRE_WINDOW_DAYS = 14;
export const POST_WINDOW_DAYS = 14;
export const MIN_PROVEN_POST = 2;
/** Ignore moves older than this — stale intel isn't a move to steal. */
export const MAX_MOVE_AGE_DAYS = 120;

// ── Date helpers (UTC, YYYY-MM-DD strings) ────────────────────────────

export function addDaysUtc(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetweenUtc(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy!, (fm ?? 1) - 1, fd ?? 1);
  const to = Date.UTC(ty!, (tm ?? 1) - 1, td ?? 1);
  return Math.round((to - from) / 86_400_000);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "2026-06-02" → "June 2". */
export function formatMoveDate(dateIso: string): string {
  const [, m, d] = dateIso.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? "";
  return `${month} ${d ?? 1}`;
}

// ── Source normalization ──────────────────────────────────────────────

type MoveSource = {
  url: string;
  path: string;
  domain: string;
  displayName: string;
  movedAtDate: string;
  kind: CompetitorMoveKind;
  whatTheyDid: string;
};

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function describePath(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const words = last.replace(/[-_]+/g, " ").trim();
  return words === "" ? "their site" : `a ${words} page`;
}

function sitemapToSource(c: CompetitorPageChange): MoveSource | null {
  if (c.type === "removed") return null; // alerts cover removals; not a move
  const movedAtDate = (c.lastmod ?? c.detectedAt).slice(0, 10);
  if (movedAtDate.length !== 10) return null;
  const path = c.path || pathOf(c.url);
  return {
    url: c.url,
    path,
    domain: c.domain,
    displayName: c.displayName,
    movedAtDate,
    kind: c.type === "added" ? "new_page" : "updated_page",
    whatTheyDid:
      c.type === "added"
        ? `published ${describePath(path)}`
        : `updated ${describePath(path)}`,
  };
}

function structuralToSource(c: CompetitorStructuralChange): MoveSource {
  return {
    url: c.url,
    path: pathOf(c.url),
    domain: c.domain,
    displayName: c.displayName,
    movedAtDate: c.capturedAt.slice(0, 10),
    kind: c.kind,
    whatTheyDid: c.detail,
  };
}

// ── Action mapping (the "steal it" half) ──────────────────────────────

const PRICING_RE = /\b(cost|price|pricing|how much|budget|estimate)\b/i;

export function mapMoveToAction(source: {
  kind: CompetitorMoveKind;
  path: string;
  whatTheyDid: string;
}): CompetitorMoveAction {
  const text = `${source.path.replace(/[-_/]+/g, " ")} ${source.whatTheyDid}`;
  if (source.kind === "faq_added" || source.kind === "faq_expanded") {
    return { actionType: "add_faq", label: "Add an FAQ to your matching page" };
  }
  if (PRICING_RE.test(text)) {
    return {
      actionType: "expand_page_coverage",
      label: "Publish your own cost guide",
    };
  }
  if (source.kind === "new_page") {
    return {
      actionType: "expand_page_coverage",
      label: "Publish your equivalent page",
    };
  }
  if (source.kind === "section_added") {
    return {
      actionType: "strengthen_structure",
      label: "Add the same section to your page",
    };
  }
  // updated_page / title_changed / meta_added
  return {
    actionType: "refresh_content",
    label: "Refresh your matching page",
  };
}

// ── Copy ──────────────────────────────────────────────────────────────

function renderLine(args: {
  displayName: string;
  whatTheyDid: string;
  movedAtDate: string;
  tier: CompetitorMoveTier;
  preCount: number;
  postCount: number;
  daysToFirstCitation: number | null;
  windowDays: number;
}): string {
  const head = `${args.displayName} ${args.whatTheyDid} on ${formatMoveDate(args.movedAtDate)}.`;
  if (args.tier === "proven") {
    const when =
      args.daysToFirstCitation != null && args.daysToFirstCitation > 0
        ? `AI started citing it ${args.daysToFirstCitation} day${args.daysToFirstCitation === 1 ? "" : "s"} later`
        : "AI started citing it the same day";
    const baseline =
      args.preCount > 0
        ? `(vs ${args.preCount} in the two weeks before)`
        : "(none in the two weeks before)";
    return `${head} ${when} — ${args.postCount} citations in the ${args.windowDays} days after ${baseline}.`;
  }
  if (args.tier === "early") {
    return `${head} AI has cited it ${args.postCount} time${args.postCount === 1 ? "" : "s"} since.`;
  }
  if (args.tier === "watching") {
    return `${head} Watching for AI pickup — still inside the first ${args.windowDays} days.`;
  }
  return `${head} No AI pickup yet.`;
}

// ── Detection ─────────────────────────────────────────────────────────

export type DetectCompetitorMovesArgs = {
  sitemapChanges: ReadonlyArray<CompetitorPageChange>;
  structuralChanges: ReadonlyArray<CompetitorStructuralChange>;
  series: ReadonlyArray<CompetitorUrlCitationSeries>;
  /** Today as YYYY-MM-DD (UTC). Injected for determinism. */
  todayIso: string;
};

const TIER_ORDER: Record<CompetitorMoveTier, number> = {
  proven: 0,
  early: 1,
  watching: 2,
  quiet: 3,
};

/** Structural kinds carry more meaning than a bare sitemap "updated". */
const KIND_RICHNESS: Record<CompetitorMoveKind, number> = {
  faq_added: 0,
  faq_expanded: 1,
  section_added: 2,
  title_changed: 3,
  meta_added: 4,
  new_page: 5,
  updated_page: 6,
};

export function detectCompetitorMoves(
  args: DetectCompetitorMovesArgs,
): CompetitorMove[] {
  const seriesByUrl = new Map(args.series.map((s) => [s.url, s]));

  const sources: MoveSource[] = [];
  for (const c of args.sitemapChanges) {
    const s = sitemapToSource(c);
    if (s != null) sources.push(s);
  }
  for (const c of args.structuralChanges) sources.push(structuralToSource(c));

  // Dedupe per (url, date): keep the richest description of that day's move.
  const byKey = new Map<string, MoveSource>();
  for (const s of sources) {
    if (daysBetweenUtc(s.movedAtDate, args.todayIso) > MAX_MOVE_AGE_DAYS) continue;
    if (s.movedAtDate > args.todayIso) continue; // defensive: future lastmod
    const canonical = canonicalizeCitationUrl(s.url) ?? s.url;
    const key = `${canonical}|${s.movedAtDate}`;
    const existing = byKey.get(key);
    if (
      existing == null ||
      KIND_RICHNESS[s.kind] < KIND_RICHNESS[existing.kind]
    ) {
      byKey.set(key, { ...s, url: canonical });
    }
  }

  const moves: CompetitorMove[] = [];
  for (const s of byKey.values()) {
    const series = seriesByUrl.get(s.url);
    const daily = series?.daily ?? [];
    const preStart = addDaysUtc(s.movedAtDate, -PRE_WINDOW_DAYS);
    const postEnd = addDaysUtc(s.movedAtDate, POST_WINDOW_DAYS);
    const preCount = windowCount(daily, preStart, s.movedAtDate);
    const postCount = windowCount(daily, s.movedAtDate, postEnd);
    const windowComplete = args.todayIso >= postEnd;

    let tier: CompetitorMoveTier;
    if (postCount >= MIN_PROVEN_POST && postCount > preCount) tier = "proven";
    else if (postCount >= 1) tier = "early";
    else if (!windowComplete) tier = "watching";
    else tier = "quiet";

    const firstAt = firstCitationOnOrAfter(daily, s.movedAtDate);
    const daysToFirstCitation =
      firstAt == null ? null : daysBetweenUtc(s.movedAtDate, firstAt);

    const action = mapMoveToAction(s);
    moves.push({
      id: `${s.domain}|${s.url}|${s.movedAtDate}|${s.kind}`,
      domain: s.domain,
      displayName: s.displayName,
      url: s.url,
      path: s.path,
      movedAtDate: s.movedAtDate,
      kind: s.kind,
      whatTheyDid: s.whatTheyDid,
      tier,
      preCount,
      postCount,
      daysToFirstCitation,
      windowDays: POST_WINDOW_DAYS,
      line: renderLine({
        displayName: s.displayName,
        whatTheyDid: s.whatTheyDid,
        movedAtDate: s.movedAtDate,
        tier,
        preCount,
        postCount,
        daysToFirstCitation,
        windowDays: POST_WINDOW_DAYS,
      }),
      action,
    });
  }

  return moves.sort(
    (a, z) =>
      TIER_ORDER[a.tier] - TIER_ORDER[z.tier] ||
      z.postCount - z.preCount - (a.postCount - a.preCount) ||
      (a.movedAtDate < z.movedAtDate ? 1 : a.movedAtDate > z.movedAtDate ? -1 : 0) ||
      (a.id < z.id ? -1 : 1),
  );
}

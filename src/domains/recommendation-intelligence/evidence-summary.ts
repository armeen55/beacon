/**
 * Customer-facing evidence summary (2026-06-15) — turns the numbers
 * Beacon ALREADY holds on a recommendation into a specific, plain-English
 * "why this, why now" set of stat bullets.
 *
 * The owner asked for maximum evidence per decision: the EXACT search
 * volume, their current rank, their click-through vs what's typical for
 * that spot, and how many visits a fix could win — not a vague "improve
 * this". This helper reads the per-query Google Search signal the rec
 * already carries (`GscPageSignal.topQueries`: query, impressions, clicks,
 * CTR, position) and produces those bullets.
 *
 * HONESTY RAILS (mirrors the rest of the app):
 *   • Uses ONLY numbers present on the passed signal — never fabricates a
 *     keyword difficulty, a competitor, or a volume we don't have. When a
 *     number isn't available, the clause is simply omitted.
 *   • Plain English. No internal enum / jargon / "Profound" / SEO-speak.
 *     "impressions" → "times your page showed up"; "CTR" → "click-through".
 *   • Numbers via `toLocaleString` so 9137 reads as "9,137".
 *
 * PURE FUNCTION — no I/O, no React, no clock. Same signal → same lines.
 * The render layer (v2 card + detail drawer) calls this and renders the
 * returned bullets; it owns no number logic of its own.
 *
 * SCOPE NOTE (2026-06-15 follow-up): the Google Search signal (`gscSignal`) is
 * attached to a recommendation on the render path (load-queue.ts decorates it).
 * Microsoft Clarity friction rates and AI-assistant answer counts still live only
 * in the candidate `evidence` array at generation time and are NOT carried onto the
 * rendered row — enriching those remains a follow-up that first needs those
 * signals threaded onto `LiveRecQueueItem`. (SEMrush evidence removed Phase F.1.)
 */

import type { GscPageSignal, GscQuerySignal } from "./gsc-page-signals";
import type { ClarityPageSignal } from "./clarity-page-signals";
// R9 (2026-07-03): read the sourced positions-1-5 benchmark from the ONE
// canonical curve module (same object gsc-low-ctr re-exports; byte-identical).
import { SEMRUSH_TOP5_CTR as EXPECTED_CTR_BY_POSITION } from "@/domains/forecast/tenant-ctr-curve";
// Clarity friction thresholds, relocated verbatim from the retired
// triggers/clarity-friction.ts (2026-07-21) - evidence-summary is now the
// only consumer. Copy and predicate must keep agreeing on these values.
const MIN_CLARITY_SESSIONS = 50;
const SCRIPT_ERROR_RATE = 0.05;
const RAGE_RATE = 0.07;

/** One scannable evidence bullet. `value` is the bold number/phrase, `label`
 *  the plain-English caption. `detail` is an optional full-sentence "why now"
 *  the drawer can show under the stat. */
export type EvidenceLine = {
  key: string;
  value: string;
  label: string;
  detail?: string;
  /**
   * N47 primary-source (2026-07-03): an optional link to the ACTUAL thing this
   * claim rests on, so the operator can click through and verify it themselves
   * (the real Google search for the query, the competitor's page, the SERP
   * result). Absent when there is no clickable primary source, in which case
   * the line renders byte-identically to before. Reuses this same EvidenceLine
   * shape rather than a parallel evidence system.
   */
  sourceUrl?: string | null;
  /** Plain-English label for the primary-source link (e.g. "See this search on Google"). */
  sourceLabel?: string;
};

/**
 * N47 primary-source (2026-07-03): the real Google search for a tracked query,
 * so "People saw your page for X" points at the exact SERP the operator can open
 * and read. This is the query's PRIMARY source: the live search itself, not a
 * restatement of our stored number. Pure; returns null for an empty query.
 */
export function googleSearchUrlForQuery(query: string): string | null {
  const q = query.trim();
  if (q.length === 0) return null;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Minimum 90-day impressions for a query before we quote it. Below this a
 *  CTR/position is noise — mirrors the trigger floor (gsc-low-ctr.ts
 *  MIN_IMPRESSIONS) so the customer copy and the predicate agree on what
 *  counts as real demand. */
const MIN_QUERY_IMPRESSIONS = 200;
/** Striking-distance band (page ranks just short of page one). Mirrors the
 *  first-party GSC band in gsc-low-ctr.ts Rule B (4–15). */
const STRIKING_MIN_POS = 4;
const STRIKING_MAX_POS = 15;
/** Target position a striking-distance push aims for (top 3) — used only to
 *  estimate recoverable clicks, the same convention the trigger uses. */
const STRIKING_TARGET_CTR = EXPECTED_CTR_BY_POSITION[3] ?? 0.102;

function pct(fraction: number): string {
  return (fraction * 100).toFixed(1) + "%";
}

function n(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * The single query worth quoting on a card, picked from the signal's top
 * queries. Preference order, both grounded in real numbers:
 *   1. The worst CTR shortfall vs the typical click-through for its rank
 *      (positions 1–5, the band we have benchmarks for) — "you rank well
 *      but few click".
 *   2. The highest-demand striking-distance query (rank 4–15) — "one push
 *      from page one".
 * Returns null when no query clears the impressions floor / bands.
 */
export function pickHeadlineQuery(
  signal: GscPageSignal,
): { query: GscQuerySignal; kind: "low_ctr" | "striking" } | null {
  const eligible = signal.topQueries.filter(
    (q) => q.impressions >= MIN_QUERY_IMPRESSIONS,
  );
  if (eligible.length === 0) return null;

  // 1 — worst CTR shortfall in the benchmarked 1–5 band.
  let worstShortfall: { query: GscQuerySignal; shortfall: number } | null = null;
  for (const q of eligible) {
    const expected = EXPECTED_CTR_BY_POSITION[Math.round(q.position)];
    if (expected == null) continue; // outside 1–5
    const shortfall = expected - q.ctr;
    if (shortfall <= 0) continue;
    if (worstShortfall == null || shortfall > worstShortfall.shortfall) {
      worstShortfall = { query: q, shortfall };
    }
  }
  if (worstShortfall != null) {
    return { query: worstShortfall.query, kind: "low_ctr" };
  }

  // 2 — highest-demand striking-distance query.
  const striking = eligible
    .filter(
      (q) =>
        q.position >= STRIKING_MIN_POS && q.position <= STRIKING_MAX_POS,
    )
    .sort((a, b) => b.impressions - a.impressions)[0];
  if (striking != null) {
    return { query: striking, kind: "striking" };
  }
  return null;
}

/**
 * Build the customer-facing evidence bullets for a recommendation from its
 * Google Search signal. Returns [] when the signal is absent or carries no
 * quotable demand — the caller then falls back to its existing prose "why".
 *
 * The bullets lead with the page-level demand (so the owner sees the page is
 * really trafficked), then add the specific per-query "why now" when one
 * query stands out.
 */
export function buildGscEvidenceLines(
  signal: GscPageSignal | null | undefined,
): EvidenceLine[] {
  if (signal == null) return [];
  // Need real page demand to quote anything honestly.
  if (signal.impressions90d < MIN_QUERY_IMPRESSIONS) return [];

  const lines: EvidenceLine[] = [];

  const headline = pickHeadlineQuery(signal);
  if (headline != null) {
    const { query, kind } = headline;
    const rank = Math.round(query.position);
    const volume = n(query.impressions);

    if (kind === "low_ctr") {
      const expected = EXPECTED_CTR_BY_POSITION[rank];
      // Recoverable visits if CTR rose to the typical rate for this rank.
      const recoverable =
        expected != null
          ? Math.round(Math.max(0, expected - query.ctr) * query.impressions)
          : 0;
      const ctrClause =
        expected != null
          ? `Your click-through is ${pct(query.ctr)} vs about ${pct(
              expected,
            )} typical for spot #${rank}`
          : `Your click-through is ${pct(query.ctr)}`;
      // Trust audit E (2026-06-16): the upside is an ESTIMATE, not a promise —
      // CTR depends on the whole search result (other results, rich features,
      // and whether Google rewrites the displayed title link, which it may
      // generate from the title, H1, og:title, or page text).
      const recoverClause =
        recoverable > 0
          ? `, so a clearer title could recover an estimated ${n(
              recoverable,
            )} clicks over ~90 days, a rough estimate, not a guarantee (Google may rewrite how your title appears).`
          : ".";
      lines.push({
        key: "headline_query",
        value: `“${query.query}”`,
        label: `${volume} times shown · you rank #${rank}`,
        detail: `People saw your page for “${query.query}” ${volume} times in the last 90 days and you rank #${rank}. ${ctrClause}${recoverClause}`,
        sourceUrl: googleSearchUrlForQuery(query.query),
        sourceLabel: "See this search on Google",
      });
    } else {
      // striking distance
      const recoverable = Math.round(
        Math.max(0, STRIKING_TARGET_CTR - query.ctr) * query.impressions,
      );
      const recoverClause =
        recoverable > 0
          ? ` Reaching the top 3 could win an estimated ${n(
              recoverable,
            )} more clicks over ~90 days, an estimate, not a guarantee.`
          : "";
      lines.push({
        key: "headline_query",
        value: `“${query.query}”`,
        label: `${volume} times shown · you rank #${rank} (striking distance)`,
        detail: `You already rank #${rank} for “${query.query}”, shown ${volume} times in the last 90 days, just short of page one.${recoverClause}`,
        sourceUrl: googleSearchUrlForQuery(query.query),
        sourceLabel: "See this search on Google",
      });
    }
  }

  return lines;
}

// ── SEMrush evidence (2026-06-15 follow-up) ──────────────────────────
//
// (SEMrush evidence lines removed Phase F.1 — SEMrush deleted caller-first.
// GSC + Clarity + Profound/AEO evidence lines still ground every recommendation.)

// ── Microsoft Clarity evidence (2026-06-15) ──────────────────────────
//
// The fourth multi-source signal: Microsoft Clarity's behavioral
// recording exposes per-page FRICTION the owner can't see in search
// data — visitors rage-clicking a broken element, or pages throwing JS
// errors. `ClarityPageSignal` (clarity-page-signals.ts) carries the real
// per-URL counts summed over the trailing 28-day window: sessions,
// rageClicks/deadClicks/quickbacks/scriptErrors plus the derived
// per-session rates. This helper turns the two SOURCED, actionable
// sub-signals — the same two `clarity_friction` fires on — into a
// plain-English number line:
//
//   • script errors (HIGH): JS errors break the page for visitors AND
//     hide its content from AI crawlers (which don't run JS).
//   • rage clicks (MEDIUM): rapid repeated clicks = a frustrating /
//     unresponsive element worth fixing for conversions.
//
// HONESTY RAILS (same as the GSC/SEMrush helpers): we quote ONLY the
// numbers on the signal, only above the sourced thresholds the trigger
// uses (SESSION FLOOR + the script-error / rage-click rates), and never
// invent a friction we don't measure (dead-clicks / quickbacks /
// excessive-scroll have no published band — excluded, mirroring the
// trigger). Below the session floor we abstain (a tiny denominator is
// noise). Numbers via toLocaleString; rates as a whole-number percent.

/** Whole-number percent for a 0–1 rate, e.g. 0.082 → "8%". Clarity rates
 *  read cleaner to an owner without a decimal — the underlying counts are
 *  small and a "8.2%" precision implies more certainty than 28 days of
 *  session-level sampling supports. */
function ratePct(rate: number): string {
  return Math.round(rate * 100).toLocaleString("en-US") + "%";
}

/**
 * Build the customer-facing Microsoft Clarity evidence bullets for a
 * recommendation from its attached per-page Clarity signal. Returns []
 * when the signal is absent (Clarity not connected / no rows for this
 * page) or carries no friction above the sourced thresholds — the caller
 * then keeps its other evidence lines / prose "why".
 *
 * At most one line: script errors lead (the worse, confirmed defect),
 * else rage clicks. Mirrors `frictionReason`'s worst-first order so the
 * card copy and the trigger predicate agree on what counts.
 */
export function buildClarityEvidenceLines(
  signal: ClarityPageSignal | null | undefined,
): EvidenceLine[] {
  if (signal == null) return [];
  // Session floor: a tiny denominator must never quote a rate. Mirrors
  // the trigger's MIN_CLARITY_SESSIONS so the copy and predicate agree.
  if (signal.sessions < MIN_CLARITY_SESSIONS) return [];

  const sessions = n(signal.sessions);

  // 1 — script errors (HIGH): a confirmed defect, worst-first.
  const scriptErrorRate =
    signal.sessions > 0 ? signal.scriptErrors / signal.sessions : 0;
  if (signal.scriptErrors > 0 && scriptErrorRate >= SCRIPT_ERROR_RATE) {
    return [
      {
        key: "clarity_script_errors",
        value: ratePct(scriptErrorRate),
        label: `of sessions hit a page error (${sessions} sessions)`,
        detail: `This page throws an error in ${ratePct(
          scriptErrorRate,
        )} of visits (${sessions} sessions tracked). Errors break the page for visitors, and AI assistants can't read a page that fails to load, so fixing it protects how often you're recommended.`,
      },
    ];
  }

  // 2 — rage clicks (MEDIUM): frustration with a non-responsive element.
  if (signal.rageRate >= RAGE_RATE) {
    return [
      {
        key: "clarity_rage_clicks",
        value: ratePct(signal.rageRate),
        label: `of sessions rage-click this page (${sessions} sessions)`,
        detail: `Visitors rage-click on this page in ${ratePct(
          signal.rageRate,
        )} of sessions (${sessions} sessions tracked), a sign something feels broken or unresponsive. Fixing the friction lifts conversions.`,
      },
    ];
  }

  return [];
}

// ── AI-answer (answer-engine) evidence (2026-06-15) ──────────────────
//
// The fifth and final multi-source signal: the answer-engine gap. The
// `profound_aeo_gap` trigger already attaches its evidence to the rec —
// each trigger candidate carries an `evidence[]` array whose
// `prompt_answer_observation` entry (ref `profound:<categoryId>`) has a
// `detail` string encoding the real numbers the synced answer-engine
// data produced:
//
//   "profound_aeo_gap category=<id>; ai_answers=<N>; models=<M>;
//    own_mentions=0; competitor=<name>; competitor_mentions=<C>;
//    competitor_sov=<P>%"
//
// Rather than thread a NEW per-page signal (the gap is topic-scoped, not
// page-scoped — there is no per-URL signal to load), this helper reads
// the rec's OWN evidence array, finds that entry, and parses the numbers
// back out. It emits ONE white-label line:
//
//   "AI assistants answer this topic citing <competitor> across ~N
//    answers — you're not cited yet; add a direct answer block."
//
// WHITE-LABEL (hard rail): the vendor name is NEVER rendered — the copy
// says "AI assistants", matching `profoundAeoGapCopy` and the
// forbidden-customer-vocabulary contract. HONESTY RAILS: any clause
// whose number is absent from the detail string is omitted; absent /
// unparseable evidence → [] (dormant until the answer-engine source is
// connected). Numbers via toLocaleString.

/** A tolerant evidence-ref shape. The persisted edit row carries the
 *  strict `SpecificEditEvidenceRef` union (no `detail`); the resolver's
 *  `EvidenceRef` is another union; the trigger candidate carries
 *  `{ kind, ref, detail }`. We read the optional `detail` off whichever
 *  is present without coupling to any concrete type — entries that don't
 *  match the AEO shape are simply skipped. Using `unknown` (not an
 *  all-optional object) keeps the param assignable from those unions
 *  without TS's "no properties in common" rejection. */
type AeoEvidenceCandidateRef = unknown;

/** Pull `key=value` out of the trigger's detail string. Returns null when
 *  the key is absent so the caller can omit that clause honestly. */
function parseDetailField(detail: string, key: string): string | null {
  const m = detail.match(new RegExp(`${key}=([^;]+)`));
  return m != null ? m[1]!.trim() : null;
}

/**
 * Build the customer-facing AI-answer evidence bullet for a
 * recommendation by reading its OWN evidence array for the
 * `profound_aeo_gap` signal. `evidence` is the rec's evidence-ref list
 * (the trigger-candidate `evidence[]`, whose entries may carry the
 * `detail` string). Returns [] when no AEO-gap evidence is present or the
 * detail can't be parsed — dormant until the answer-engine source is
 * connected.
 *
 * One white-label line: the topic is answered by AI assistants citing a
 * competitor across ~N answers while the owner is absent — add a direct
 * answer block. The competitor name + answer count are quoted only when
 * the detail string actually carries them.
 */
export function buildAeoEvidenceLines(
  evidence: ReadonlyArray<AeoEvidenceCandidateRef> | null | undefined,
): EvidenceLine[] {
  if (evidence == null || evidence.length === 0) return [];

  // Find the AEO-gap entry: the trigger writes ref `profound:<categoryId>`
  // with a detail string starting "profound_aeo_gap …". Match on the
  // detail prefix (the durable contract) rather than the ref namespace.
  let detail: string | null = null;
  for (const e of evidence) {
    const raw =
      e != null && typeof e === "object"
        ? (e as { detail?: unknown }).detail
        : null;
    const d = typeof raw === "string" ? raw : null;
    if (d != null && d.startsWith("profound_aeo_gap")) {
      detail = d;
      break;
    }
  }
  if (detail == null) return [];

  const competitor = parseDetailField(detail, "competitor");
  const aiAnswersRaw = parseDetailField(detail, "ai_answers");
  const aiAnswers =
    aiAnswersRaw != null && /^\d+$/.test(aiAnswersRaw)
      ? Number(aiAnswersRaw)
      : null;

  // Need at least the competitor OR the answer count to say anything
  // honest; with neither there's no line worth showing.
  if (competitor == null && aiAnswers == null) return [];

  // Compose the white-label clauses, omitting any whose number is absent.
  const citingClause =
    competitor != null ? ` citing ${competitor}` : "";
  const acrossClause =
    aiAnswers != null
      ? ` across about ${aiAnswers.toLocaleString("en-US")} answers`
      : "";

  // Compact label (card stat strip): lead with the answer count when we
  // have it, else the competitor.
  const label =
    aiAnswers != null
      ? `${aiAnswers.toLocaleString("en-US")} AI answers cite a rival, not you`
      : "AI assistants cite a rival, not you";

  return [
    {
      key: "aeo_answer_gap",
      value: "Not cited yet",
      label,
      detail: `AI assistants answer this topic${citingClause}${acrossClause}, you're not cited yet. Add a clear, quotable answer block on your site for this topic so AI engines can cite you instead.`,
    },
  ];
}

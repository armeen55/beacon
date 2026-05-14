/**
 * 2026-05-14 Phase A.3 Step 1 — pure indexability verdict computer.
 *
 * Single pure function `computeIndexability(input)` that joins the
 * raw signals defined in `./types.ts` into one composite verdict.
 * No I/O. No env reads. No fetches. No imports from runtime
 * modules — only the sibling types file.
 *
 * Decision precedence (operator-locked v1, 2026-05-14):
 *
 *   1. `page_snapshot === null` or `http_status === null` → unknown
 *   2. `http_status >= 400` OR `http_status in [301, 302, 307, 308]`
 *      → bad_status_code
 *   3. `robots_meta` contains `noindex` (case-insensitive,
 *      whitespace-tolerant) → noindex_meta
 *   4. `has_canonical_mismatch === true` → canonical_elsewhere
 *   5. `robots_txt.googlebot_allowed === false`
 *      → blocked_by_robots_for_googlebot
 *   6. any of {gptbot, perplexitybot, claudebot, google_extended}
 *      `_allowed === false` → blocked_by_robots_for_ai
 *   7. `sitemap_membership.in_sitemap === false` → not_in_sitemap
 *   8. all confirmed non-null signals pass → ok
 *   9. otherwise → unknown
 *
 * Precedence rationale:
 *   • bad_status_code first: a 404/301 makes every downstream
 *     check moot (the URL Beacon is tracking no longer serves
 *     content).
 *   • noindex over canonical: a noindex meta tag is a stronger
 *     signal than a canonical pointer — search engines respect
 *     noindex regardless of canonical resolution.
 *   • canonical over robots: a canonical mismatch means citations
 *     will credit a different URL even if AI bots can reach this
 *     page; surfacing that first is more actionable than the
 *     robots check.
 *   • googlebot over AI bots: googlebot blocking is the broader
 *     discoverability-floor signal; if Googlebot is blocked, the
 *     AI-bot finding is downstream.
 *   • robots over sitemap: robots blocks are silent AEO killers
 *     and override missing-sitemap (a blocked URL won't be indexed
 *     even if it IS in the sitemap).
 *
 * Reserved verdicts (`not_indexed_in_gsc`, `indexed_but_not_cited`)
 * are NEVER produced by this function. A.3.b1 (GSC integration)
 * will fill them. The reserved-verdict invariant is asserted in
 * the test suite.
 *
 * Hard contracts:
 *   • Pure function. No I/O, no env reads, no Math.random.
 *   • Total. Every input combination produces a verdict; no
 *     thrown errors.
 *   • Deterministic. Same input → same output.
 *   • Input is never mutated; output preserves raw signals
 *     verbatim (maximum-extraction principle).
 */

import type {
  IndexabilityPageSnapshotSignal,
  IndexabilityRobotsSignal,
  IndexabilitySitemapSignal,
  IndexabilityVerdict,
  OwnedUrlIndexability,
} from "./types";

const MS_PER_DAY = 86_400_000;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 307, 308]);

const AI_BOT_KEYS = [
  "gptbot_allowed",
  "perplexitybot_allowed",
  "claudebot_allowed",
  "google_extended_allowed",
] as const satisfies ReadonlyArray<keyof IndexabilityRobotsSignal>;

/**
 * Computer input. Mirrors `IndexabilitySignals` but accepts
 * `page_snapshot` with `noindex_detected` OMITTED — the computer
 * derives that flag from the raw `robots_meta` value during
 * parsing and writes it into the returned `signals.page_snapshot`.
 * This keeps callers from having to pre-parse, and keeps
 * `noindex_detected` honest (it always reflects what the computer
 * actually saw).
 */
export type ComputeIndexabilityInput = {
  url: string;
  sitemap_membership: IndexabilitySitemapSignal;
  robots_txt: IndexabilityRobotsSignal;
  page_snapshot: Omit<IndexabilityPageSnapshotSignal, "noindex_detected"> | null;
  now: Date | string;
};

/**
 * Defensive `noindex` parser. Returns true iff the raw meta-robots
 * value contains a `noindex` token. Tolerates:
 *   • Mixed case ("NOINDEX", "NoIndex").
 *   • Leading/trailing whitespace.
 *   • Comma-delimited multi-value lists ("noindex, nofollow",
 *     "max-snippet:-1, noindex").
 *   • Internal whitespace inside the comma-delimited fragment
 *     (`" noindex "` → true).
 *
 * Does NOT treat `index` as `noindex` (the literal `index`
 * directive is the explicit opposite — `\bnoindex\b`-style
 * boundary check via token split).
 *
 * Returns false for `null`, the empty string, or any value that
 * does not contain a `noindex` token.
 */
function detectNoindex(robotsMeta: string | null): boolean {
  if (robotsMeta == null) return false;
  // Tokenize by comma + trim each fragment + lowercase. A "token"
  // is whatever the directive author wrote between commas; we
  // accept `noindex` AND `noindex; something` (defensive — some
  // CMSes inject semicolon-style separators).
  const tokens = robotsMeta
    .split(/[,;]/)
    .map((t) => t.trim().toLowerCase());
  return tokens.some((t) => {
    // Exact match on the bare directive.
    if (t === "noindex") return true;
    // Defensive: allow `noindex` followed by directive-specific
    // suffixes (e.g. `noindex` directive sometimes appears with
    // trailing version markers in non-standard CMS output).
    return t.startsWith("noindex") && /^noindex(\s|$)/.test(t);
  });
}

/**
 * Parse `now` to a UTC date string (YYYY-MM-DD). Returns null on
 * unparseable input — the freshness calculation falls back to
 * null, which surfaces as "freshness unknown" downstream.
 */
function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * UTC-day delta between `fetched_at` and `now`. Negative deltas
 * (fetched in the future — clock skew) are clamped to 0 so
 * customer copy never reads "fetched -3 days ago". Returns null
 * when either side is unparseable.
 */
function computeFreshnessDays(
  fetchedAt: string | null,
  nowInput: Date | string,
): number | null {
  if (fetchedAt == null) return null;
  const fetchedIso = toUtcDateString(fetchedAt);
  const nowIso = toUtcDateString(nowInput);
  if (fetchedIso == null || nowIso == null) return null;
  const fetchedMs = Date.UTC(
    Number(fetchedIso.slice(0, 4)),
    Number(fetchedIso.slice(5, 7)) - 1,
    Number(fetchedIso.slice(8, 10)),
  );
  const nowMs = Date.UTC(
    Number(nowIso.slice(0, 4)),
    Number(nowIso.slice(5, 7)) - 1,
    Number(nowIso.slice(8, 10)),
  );
  const delta = Math.floor((nowMs - fetchedMs) / MS_PER_DAY);
  return delta < 0 ? 0 : delta;
}

/**
 * Decide the composite verdict. Pure decision tree over the
 * normalized inputs. The caller's `page_snapshot` and the parsed
 * `noindex_detected` are passed alongside so the function does
 * not re-parse.
 */
function decideVerdict(
  pageSnapshot: Omit<IndexabilityPageSnapshotSignal, "noindex_detected"> | null,
  noindexDetected: boolean,
  robots: IndexabilityRobotsSignal,
  sitemap: IndexabilitySitemapSignal,
): IndexabilityVerdict {
  // 1. unknown — no page snapshot, or no http_status to anchor on.
  if (pageSnapshot == null || pageSnapshot.http_status == null) {
    return "unknown";
  }
  // 2. bad_status_code — any 4xx/5xx, or any of the four
  // redirect codes the contract enumerates.
  const status = pageSnapshot.http_status;
  if (status >= 400 || REDIRECT_STATUSES.has(status)) {
    return "bad_status_code";
  }
  // 3. noindex_meta — page-level meta robots noindex.
  if (noindexDetected) {
    return "noindex_meta";
  }
  // 4. canonical_elsewhere — the snapshot's own canonical
  // mismatch flag (computed upstream by the page extractor).
  if (pageSnapshot.has_canonical_mismatch === true) {
    return "canonical_elsewhere";
  }
  // 5. blocked_by_robots_for_googlebot — Googlebot floor signal
  // (separate from the AI-bot family).
  if (robots.googlebot_allowed === false) {
    return "blocked_by_robots_for_googlebot";
  }
  // 6. blocked_by_robots_for_ai — any of the four AI-bot keys
  // explicitly denied.
  for (const key of AI_BOT_KEYS) {
    if (robots[key] === false) {
      return "blocked_by_robots_for_ai";
    }
  }
  // 7. not_in_sitemap — explicit false (null = unchecked, not a
  // negative finding).
  if (sitemap.in_sitemap === false) {
    return "not_in_sitemap";
  }
  // 8. ok — only if every signal that COULD provide a negative
  // verdict has confirmed a positive value. Specifically:
  //   • has_canonical_mismatch must be non-null (we know it isn't
  //     true; we still need it to be confirmed false, not null).
  //   • Every robots_txt allow flag must be confirmed true.
  //     (If a bot's value is `null` we don't have evidence; the
  //     verdict drops to `unknown` rather than claiming `ok`.)
  //   • sitemap_membership.in_sitemap must be confirmed true.
  const canonicalConfirmed = pageSnapshot.has_canonical_mismatch === false;
  const robotsAllConfirmed =
    robots.googlebot_allowed === true &&
    AI_BOT_KEYS.every((k) => robots[k] === true);
  const sitemapConfirmed = sitemap.in_sitemap === true;
  if (canonicalConfirmed && robotsAllConfirmed && sitemapConfirmed) {
    return "ok";
  }
  // 9. unknown — passed all negative checks but at least one
  // signal is still null (insufficient evidence to claim ok).
  return "unknown";
}

export function computeIndexability(
  input: ComputeIndexabilityInput,
): OwnedUrlIndexability {
  const { url, sitemap_membership, robots_txt, page_snapshot, now } = input;
  const noindexDetected =
    page_snapshot == null
      ? false
      : detectNoindex(page_snapshot.robots_meta);

  const composite_verdict = decideVerdict(
    page_snapshot,
    noindexDetected,
    robots_txt,
    sitemap_membership,
  );

  const evidence_freshness_days = computeFreshnessDays(
    page_snapshot?.fetched_at ?? null,
    now,
  );

  // Preserve every raw signal verbatim (maximum-extraction).
  // `noindex_detected` is the parser's output — surfaced on the
  // result so operator diagnostics can see what the computer
  // actually decided.
  const enrichedPageSnapshot: IndexabilityPageSnapshotSignal | null =
    page_snapshot == null
      ? null
      : {
          http_status: page_snapshot.http_status,
          canonical_url: page_snapshot.canonical_url,
          has_canonical_mismatch: page_snapshot.has_canonical_mismatch,
          robots_meta: page_snapshot.robots_meta,
          noindex_detected: noindexDetected,
          fetched_at: page_snapshot.fetched_at,
          extraction_certainty: page_snapshot.extraction_certainty,
        };

  const nowIso =
    now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  return {
    url,
    composite_verdict,
    signals: {
      sitemap_membership: {
        in_sitemap: sitemap_membership.in_sitemap,
        sitemap_url: sitemap_membership.sitemap_url,
      },
      robots_txt: {
        googlebot_allowed: robots_txt.googlebot_allowed,
        gptbot_allowed: robots_txt.gptbot_allowed,
        perplexitybot_allowed: robots_txt.perplexitybot_allowed,
        claudebot_allowed: robots_txt.claudebot_allowed,
        google_extended_allowed: robots_txt.google_extended_allowed,
      },
      page_snapshot: enrichedPageSnapshot,
      gsc: null,
    },
    last_computed_at: nowIso,
    evidence_freshness_days,
  };
}

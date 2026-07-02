import "server-only";

/**
 * citation-loss (BEACON 500 item 83) - diff nightly Profound citations to find
 * where the tenant's OWN domain used to be cited in an AI answer and now is
 * not. Computed at READ time from `profound_answer_rows` (the Profound Prompt
 * Intelligence sync, migrations/2026-06-26_profound_prompt_intelligence.sql).
 * NO new store: this module never writes anything, and it does not touch
 * sync-nightly.ts, sync-prompt-intelligence.ts, or any other connector file -
 * it only reads rows those pipelines already wrote.
 *
 * WHY `profound_answer_rows`, not `profound_citation_rows`: this is the
 * PROFOUND CITATION stream (distinct from the native 4-engine poll stream
 * `prompt_answer_observations` that sov-weekly.ts / sov-drop-alert.ts already
 * cover). `profound_citation_rows` is a topic-aggregate with NO per-prompt
 * grain (date, model, root_domain, url -> count), so it cannot say "prompt X
 * used to cite us, now cites domain Y" - only `profound_answer_rows` carries
 * that per-(prompt, model, date) grain, with a durable `own_cited` boolean and
 * the full `citation_hosts` list for that answer. See
 * migrations/2026-06-26_profound_prompt_intelligence.sql.
 *
 * THE TWO-WINDOW COMPARE (recent vs prior, default 7 days each):
 *   - Group rows by PROMPT (the natural unit here - `topic` is a single
 *     uniform label in a borrowed/shared Profound workspace, e.g. every
 *     Iranopedia row carries topic="Iranopedia", so topic alone cannot
 *     distinguish prompts). A short, humanized topic label is derived from
 *     the prompt text itself (mirrors the promptToTopic derivation in
 *     sov-weekly.ts - duplicated, not imported, per that module's own
 *     no-cross-import note and this item's read-only-of-siblings rule).
 *   - COVERAGE LOSS: the prompt had rows in the prior window but has ZERO
 *     rows at all in the recent window. This means Profound stopped polling
 *     the prompt (or the sync hasn't run) - it is NOT evidence the tenant
 *     lost a citation, and the two must never be conflated (mislabeling a
 *     polling gap as "you lost this citation" would be a false alarm the
 *     owner can't act on).
 *   - CITATION LOSS: the prompt WAS cited (own_cited=true on at least one row)
 *     in the prior window, IS STILL POLLED in the recent window (at least one
 *     row exists), but is NOT cited (own_cited=false on every row) in the
 *     recent window. This is the real, actionable signal: the prompt is still
 *     being asked and answered, and our page fell out of the answer.
 *
 * COMPETITOR ATTRIBUTION: for each citation loss, the domain that now "takes"
 * the slot is the most-frequent non-owned, non-aggregator host across the
 * recent window's `citation_hosts` for that prompt (ties broken by first
 * appearance, deterministic). Generic platforms (reddit, youtube, wikipedia,
 * ...) are still eligible here (unlike the create-page-seeding aggregator
 * filter in competitor-citations-loader.ts) because "AI now cites Wikipedia
 * instead of you" is still a true, useful loss headline - we only fall back to
 * "no single domain" when the recent answers cite nothing at all.
 *
 * HEADLINE FACT: when `response_excerpt` is available on the citing answer
 * (durable, truncated to ~500 chars at write time - see
 * sync-prompt-intelligence.ts), the first sentence-like fragment is surfaced
 * as "what their page leads with." This is a coarse, honest read of the AI's
 * OWN answer text, not the competitor's page - Beacon does not fetch anything
 * new here (the item's "reuse loadable teardown/alignment data read-only; do
 * not fetch anything new" rule). No excerpt -> the fact is null, and callers
 * must render an honest "the excerpt isn't available" fallback rather than
 * inventing text.
 *
 * DEDUPE WITH sov_drop_alert (BEACON 500 item 79): both streams can name a
 * "you used to be cited on X, now you're not" story for the SAME topic in the
 * SAME week - one from the native poll, one from Profound's imported
 * citations. The trigger predicate (triggers/citation-loss-alert.ts) is where
 * that overlap is actually skipped (it needs the sov-weekly alerts loaded
 * side by side); this module stays a pure math + I/O layer with no knowledge
 * of the other trigger.
 *
 * STALE-SYNC HONESTY: the Profound sync is on-demand (not a nightly cron) and
 * has had silent-empty incidents before, so `loadCitationLossesForTenant`
 * always reports `latestRowDate` + a computed `syncStale` flag (true when the
 * newest scanned row is older than the start of what should be "this week").
 * Findings still emit when stale (they may still be true), but callers must
 * surface the staleness rather than let a comparison of two sub-windows of
 * one old sync batch read as a fresh week-over-week signal.
 *
 * PURE MATH here (window bucketing, loss/coverage-loss classification,
 * competitor attribution, headline-fact extraction). The Supabase read is the
 * one async loader at the bottom, paged at the 1000-row PostgREST cap.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { cleanTopicLabel } from "@/domains/demand-graph/clean-topic-label";

// ---------------------------------------------------------------------------
// Topic label (duplicated from sov-weekly.ts's promptToTopic - see module
// docstring for why this is not imported cross-module).
// ---------------------------------------------------------------------------

function promptToTopic(prompt: string): string {
  const q = /^\s*(what|which|who|where|when|why|how|are|is|the|a|an|do|does|can|should|list|tell me|evaluate)\b[\s,'’]*/i;
  let s = (prompt ?? "").trim();
  for (let i = 0; i < 3 && q.test(s); i++) s = s.replace(q, "");
  s = s.replace(/[?!.]+\s*$/g, "").trim();
  const cleaned = cleanTopicLabel(s || prompt);
  return cleaned.length > 56 ? cleaned.slice(0, 53).trimEnd() + "..." : cleaned;
}

// ---------------------------------------------------------------------------
// Window sizing
// ---------------------------------------------------------------------------

/** Default comparison window, in days, for both the "recent" and "prior"
 *  buckets (7 = one week, matching the item spec and sov-drop-alert's weekly
 *  cadence). */
export const CITATION_LOSS_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Raw input row (one profound_answer_rows record, lean-projected)
// ---------------------------------------------------------------------------

export type CitationLossInputRow = {
  prompt: string;
  model: string | null;
  /** ISO date (YYYY-MM-DD) the answer was observed. */
  date: string;
  ownCited: boolean;
  /** www-stripped hostnames cited in this answer (may include the tenant's
   *  own domain - callers pass the raw column; this module strips it out
   *  when computing "who took the slot"). */
  citationHosts: ReadonlyArray<string>;
  /** First ~500 chars of the answer text, when the sync captured one. */
  responseExcerpt: string | null;
};

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

export type CompetitorTakeover = {
  /** www-stripped competitor domain now taking the citation slot. Null when
   *  the recent window's answers cite nothing at all (no domain to name). */
  domain: string | null;
  /** How many of the recent-window answers for this prompt cite that domain. */
  citingAnswerCount: number;
};

export type CitationLossHeadlineFact = {
  /** A short, honest first-sentence-ish excerpt of the competing answer's
   *  text, sourced from the durable response_excerpt column. Never fabricated
   *  - null when no excerpt was captured for any recent-window answer. */
  fact: string;
  /** Which model's answer the fact was pulled from (ChatGPT, Perplexity, ...). */
  model: string | null;
};

export type CitationLossFinding = {
  kind: "citation_loss";
  prompt: string;
  topic: string;
  /** Distinct AI models that cited the tenant in the prior window. */
  priorCitingModels: string[];
  /** How many prior-window answers cited the tenant for this prompt - the
   *  "cited N times" figure the customer copy references directly. */
  priorCitationCount: number;
  /** Distinct AI models that answered the prompt in the recent window
   *  (evidence the prompt IS still being polled - this is what separates a
   *  citation loss from a coverage loss). */
  recentAnsweringModels: string[];
  competitor: CompetitorTakeover;
  headlineFact: CitationLossHeadlineFact | null;
};

export type CoverageLossFinding = {
  kind: "coverage_loss";
  prompt: string;
  topic: string;
  /** How many prior-window rows existed before polling apparently stopped. */
  priorRowCount: number;
  /** Most recent date any row exists for this prompt, prior to the recent
   *  window - so the copy/operator view can say "last seen on ...". */
  lastSeenDate: string | null;
};

export type CitationLossOrCoverageLoss = CitationLossFinding | CoverageLossFinding;

// ---------------------------------------------------------------------------
// Pure classification
// ---------------------------------------------------------------------------

type PromptBucket = {
  prompt: string;
  recent: CitationLossInputRow[];
  prior: CitationLossInputRow[];
};

function bucketByPrompt(
  rows: ReadonlyArray<CitationLossInputRow>,
  recentSinceIso: string,
  priorSinceIso: string,
): Map<string, PromptBucket> {
  const byPrompt = new Map<string, PromptBucket>();
  for (const r of rows) {
    if (!r.prompt || !r.date) continue;
    let bucket = byPrompt.get(r.prompt);
    if (!bucket) {
      bucket = { prompt: r.prompt, recent: [], prior: [] };
      byPrompt.set(r.prompt, bucket);
    }
    if (r.date >= recentSinceIso) {
      bucket.recent.push(r);
    } else if (r.date >= priorSinceIso) {
      bucket.prior.push(r);
    }
    // Rows older than priorSinceIso are outside both windows - ignored.
  }
  return byPrompt;
}

/** Strip "www." and lowercase, matching the convention every other Profound
 *  reader in this codebase uses (competitor-citations-loader.ts,
 *  answer-alignment-store.ts). Pure. */
function stripWww(host: string): string {
  return (host ?? "").trim().toLowerCase().replace(/^www\./, "");
}

/** Pick the competitor domain that now takes the citation slot for a prompt's
 *  recent-window rows: most-cited non-owned host, ties broken by first
 *  appearance (stable, deterministic). Pure. */
export function attributeCompetitorTakeover(
  recentRows: ReadonlyArray<CitationLossInputRow>,
  ownedDomainNorm: string,
): CompetitorTakeover {
  const counts = new Map<string, number>();
  const firstSeenOrder: string[] = [];
  for (const row of recentRows) {
    for (const rawHost of row.citationHosts) {
      const host = stripWww(rawHost);
      if (!host || host === ownedDomainNorm || host.endsWith("." + ownedDomainNorm)) continue;
      if (!counts.has(host)) {
        counts.set(host, 0);
        firstSeenOrder.push(host);
      }
      counts.set(host, counts.get(host)! + 1);
    }
  }
  let best: { domain: string; count: number } | null = null;
  for (const domain of firstSeenOrder) {
    const count = counts.get(domain)!;
    if (!best || count > best.count) best = { domain, count };
  }
  return best ? { domain: best.domain, citingAnswerCount: best.count } : { domain: null, citingAnswerCount: 0 };
}

/** First sentence-ish fragment of an excerpt, capped to a headline length.
 *  Pure, honest truncation - never invents text beyond what's there. */
function firstFactFromExcerpt(excerpt: string): string {
  const cleaned = excerpt.replace(/\s+/g, " ").trim();
  // Prefer the first sentence (period/question/exclamation followed by a
  // space or end), capped generously; fall back to a hard character cap so a
  // run-on first "sentence" (markdown lists often start this way) never
  // blows up the card.
  const sentenceMatch = /^(.{20,220}?[.!?])(\s|$)/.exec(cleaned);
  const raw = sentenceMatch ? sentenceMatch[1] : cleaned.slice(0, 160);
  return raw.length < cleaned.length ? raw.trimEnd() + (raw.endsWith(".") ? "" : "...") : raw;
}

/** Pull a headline fact from the recent window's answers - prefers an answer
 *  that cites the identified competitor domain (most relevant to "what THEIR
 *  page leads with"); falls back to any recent answer with an excerpt. Pure. */
export function extractHeadlineFact(
  recentRows: ReadonlyArray<CitationLossInputRow>,
  competitorDomain: string | null,
): CitationLossHeadlineFact | null {
  const withExcerpt = recentRows.filter((r) => r.responseExcerpt && r.responseExcerpt.trim().length > 0);
  if (withExcerpt.length === 0) return null;
  const fromCompetitor = competitorDomain
    ? withExcerpt.find((r) => r.citationHosts.some((h) => stripWww(h) === competitorDomain))
    : undefined;
  const chosen = fromCompetitor ?? withExcerpt[0]!;
  return {
    fact: firstFactFromExcerpt(chosen.responseExcerpt!),
    model: chosen.model,
  };
}

/**
 * Classify every prompt seen in either window into a citation loss, a
 * coverage loss, or neither (still cited, never cited, or too little history
 * to say anything honest). PURE - no I/O.
 *
 * `ownedDomainNorm` must already be www-stripped + lowercased (the loader
 * does this once from BusinessConfig.domain).
 */
export function computeCitationLosses(
  rows: ReadonlyArray<CitationLossInputRow>,
  args: { nowIso: string; ownedDomainNorm: string; windowDays?: number },
): CitationLossOrCoverageLoss[] {
  const windowDays = args.windowDays ?? CITATION_LOSS_WINDOW_DAYS;
  const now = new Date(args.nowIso);
  if (Number.isNaN(now.getTime())) return [];
  const recentSinceIso = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const priorSinceIso = new Date(now.getTime() - 2 * windowDays * 86_400_000).toISOString().slice(0, 10);

  const byPrompt = bucketByPrompt(rows, recentSinceIso, priorSinceIso);
  const out: CitationLossOrCoverageLoss[] = [];

  for (const bucket of byPrompt.values()) {
    const priorCitedRows = bucket.prior.filter((r) => r.ownCited);
    const wasCitedPrior = priorCitedRows.length > 0;
    if (!wasCitedPrior) continue; // never cited before -> not a loss of anything

    if (bucket.recent.length === 0) {
      // Coverage loss: no rows at all in the recent window -> the prompt
      // stopped being polled (or the sync is stale). Never call this a
      // citation loss - that would blame the tenant's content for a data-
      // pipeline gap.
      const lastSeen = [...bucket.prior].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.date ?? null;
      out.push({
        kind: "coverage_loss",
        prompt: bucket.prompt,
        topic: promptToTopic(bucket.prompt),
        priorRowCount: bucket.prior.length,
        lastSeenDate: lastSeen,
      });
      continue;
    }

    const stillCitedRecent = bucket.recent.some((r) => r.ownCited);
    if (stillCitedRecent) continue; // still cited - no loss

    // Citation loss: polled in the recent window (rows exist), cited before,
    // not cited now.
    const competitor = attributeCompetitorTakeover(bucket.recent, args.ownedDomainNorm);
    const headlineFact = extractHeadlineFact(bucket.recent, competitor.domain);
    out.push({
      kind: "citation_loss",
      prompt: bucket.prompt,
      topic: promptToTopic(bucket.prompt),
      priorCitingModels: [...new Set(priorCitedRows.map((r) => r.model).filter((m): m is string => Boolean(m)))].sort(),
      priorCitationCount: priorCitedRows.length,
      recentAnsweringModels: [...new Set(bucket.recent.map((r) => r.model).filter((m): m is string => Boolean(m)))].sort(),
      competitor,
      headlineFact,
    });
  }

  // Worst-first-ish stable order: citation losses before coverage losses (the
  // actionable ones lead), then by prompt text for determinism.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "citation_loss" ? -1 : 1;
    return a.prompt.localeCompare(b.prompt);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Loader (I/O) - paged Supabase read, 1000-row PostgREST cap per page.
// ---------------------------------------------------------------------------

export type CitationLossLoadResult = {
  tenantId: string;
  findings: CitationLossOrCoverageLoss[];
  /** Rows read, across all pages (for honest "how much history" reporting). */
  rowsScanned: number;
  /** True when the read failed partway (empty/partial result; never throws). */
  partial: boolean;
  /** Most recent `date` seen across every scanned row, or null when nothing
   *  was read. This is the honesty check the item asks for: when this is
   *  much older than `windowDays` before "now", the sync itself is stale
   *  (Profound sync has had silent-empty incidents before) and any findings
   *  below are really "as of the last sync," not "this week." Callers
   *  (including the trigger predicate's operator_evidence) should surface
   *  this rather than let a stale-data comparison read as a fresh one. */
  latestRowDate: string | null;
  /** True when either (a) `latestRowDate` is older than the recent window's
   *  start (the sync produced no row inside what SHOULD be "this week"), or
   *  (b) the newest row is more than half a window old (the sync ran, but
   *  long enough ago that "recent" is really the thin tail of one old
   *  batch). Either case means a comparison here is really "as of the last
   *  sync," not a real week-over-week read - a plain, computed signal the
   *  item asks callers to report honestly instead of silently comparing two
   *  sub-windows of one stale sync batch. */
  syncStale: boolean;
};

const PAGE_SIZE = 1000;
/** Ceiling on total rows scanned - generous multiple of one tenant's monthly
 *  volume (Iranopedia's whole answer-row history today is ~4.4k rows). */
const MAX_ROWS = 20_000;

type AnswerRow = {
  prompt: string;
  model: string | null;
  date: string;
  own_cited: boolean;
  citation_hosts: string[] | null;
  response_excerpt: string | null;
};

/**
 * Load + compute citation losses for a tenant from `profound_answer_rows`.
 * Read-only; never writes. Scoped to the trailing 2x window (so the query
 * only pulls what the compare needs, not the whole table). Fail-soft -> empty
 * result with `partial: true` on any read error.
 */
export async function loadCitationLossesForTenant(
  tenantId: string,
  args: { ownedDomain: string | null | undefined; now?: Date; windowDays?: number },
): Promise<CitationLossLoadResult> {
  const windowDays = args.windowDays ?? CITATION_LOSS_WINDOW_DAYS;
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const ownedDomainNorm = stripWww((args.ownedDomain ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""));

  const empty: CitationLossLoadResult = {
    tenantId,
    findings: [],
    rowsScanned: 0,
    partial: false,
    latestRowDate: null,
    syncStale: false,
  };
  if (!ownedDomainNorm) return empty; // no configured domain -> nothing to call "ours"

  const recentSinceDate = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const sinceDate = new Date(now.getTime() - 2 * windowDays * 86_400_000).toISOString().slice(0, 10);

  const rows: CitationLossInputRow[] = [];
  let partial = false;
  try {
    const sb = getSupabaseAdmin();
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_answer_rows")
        .select("prompt, model, date, own_cited, citation_hosts, response_excerpt")
        .eq("tenant_id", tenantId)
        .gte("date", sinceDate)
        .order("date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[citation-loss] profound_answer_rows read failed (partial result)", {
          tenantId,
          error: error.message,
        });
        partial = true;
        break;
      }
      const batch = (data ?? []) as unknown as AnswerRow[];
      for (const r of batch) {
        if (!r.prompt || !r.date) continue;
        rows.push({
          prompt: r.prompt,
          model: r.model ?? null,
          date: r.date,
          ownCited: r.own_cited === true,
          citationHosts: Array.isArray(r.citation_hosts) ? r.citation_hosts : [],
          responseExcerpt: r.response_excerpt ?? null,
        });
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (err) {
    log.warn("[citation-loss] profound_answer_rows unavailable (partial result)", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      tenantId,
      findings: [],
      rowsScanned: 0,
      partial: true,
      latestRowDate: null,
      syncStale: false,
    };
  }

  const latestRowDate = rows.reduce<string | null>((latest, r) => (latest === null || r.date > latest ? r.date : latest), null);
  // Honesty check (item 83), two-part: the sync is stale either when its
  // newest row doesn't even reach the start of what should be "this week"
  // (a hard zero-coverage case), OR when the newest row is more than half a
  // window old (the sync ran, but so long ago that the "recent window" is
  // really just the tail of one old batch, not a real week of fresh polls -
  // e.g. an on-demand sync that last ran days into what should be the
  // recent window still produces SOME recent-window rows, which would
  // otherwise pass the hard check while comparing two sub-windows of one
  // stale batch). Either way, comparing across two slices of the same old
  // sync would silently masquerade as a fresh week-over-week read.
  const halfWindowMs = (windowDays / 2) * 86_400_000;
  const latestRowAgeMs = latestRowDate !== null ? now.getTime() - new Date(latestRowDate + "T00:00:00Z").getTime() : null;
  const syncStale =
    latestRowDate === null ||
    latestRowDate < recentSinceDate ||
    (latestRowAgeMs !== null && latestRowAgeMs > halfWindowMs);
  if (syncStale) {
    log.warn("[citation-loss] profound_answer_rows sync looks stale - findings are as of the last sync, not this week", {
      tenantId,
      latestRowDate,
      recentSinceDate,
    });
  }

  const findings = computeCitationLosses(rows, { nowIso, ownedDomainNorm, windowDays });
  return { tenantId, findings, rowsScanned: rows.length, partial, latestRowDate, syncStale };
}

import "server-only";

/**
 * answer-alignment-store (BEACON 500 item 71) - the I/O + persistence layer around
 * the pure math in ./answer-alignment.ts. Reads the real answer text and page text
 * available today, runs the deterministic alignment, and caches the result via
 * move-draft-store keyed by a content hash so a re-render with unchanged inputs
 * costs nothing (no recompute, no re-read).
 *
 * Server-only, plain async functions (NOT a "use server" actions file) - a Next.js
 * "use server" module may only export async functions, but this module also needs
 * to export the persisted type + a sync parse helper. Server components (proof
 * ledger) import this directly with a server-resolved tenantId; client components
 * (the worklist Move card) go through the thin wrappers in
 * ./answer-alignment-actions.ts, which resolve the tenant themselves.
 *
 * TWO alignment surfaces:
 *   - Competitor: "the words that beat you" - align a cited AI answer against the
 *     ALREADY-CACHED competitor teardown text (competitor-page-audit.ts). We do
 *     not persist raw competitor HTML anywhere, so the page-side text here is the
 *     real, literal text the audit already extracted and stores: outline
 *     (H2/H3 headings), FAQ questions, meta description, title. Coarser than full
 *     paragraphs, but every word is real page text, never fabricated.
 *   - Owned: "AI quoted this line" - align a cited AI answer against our OWN
 *     page_snapshots body text (body_paragraph_sample + card_texts), which DOES
 *     carry real paragraph-level content.
 *
 * HONEST DATA-COVERAGE CAVEAT (ground-truth verified 2026-07-02): the durable
 * Profound answer store (`profound_answer_rows.response_excerpt`) truncates the
 * live API's full response to 500 characters at write time (see
 * sync-prompt-intelligence.ts), and the native 4-engine poll
 * (`prompt_answer_observations.metadata.answer_excerpt`) truncates to 400. Neither
 * pipeline persists the untruncated AI answer text anywhere durable. This module
 * reads whichever excerpt exists and aligns against it - it does not claim to see
 * the full answer, and a short excerpt naturally yields fewer/shorter matches.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { getLatestMoveDrafts, saveMoveDraft, type MoveDraftKind } from "@/domains/demand-graph/move-draft-store";
import { getCompetitorAuditsForTenantId, type CompetitorPageFacts } from "@/domains/demand-graph/competitor-page-audit";
import {
  alignAnswerToPage,
  alignmentContentHash,
  summarizeWinningShapes,
  type AlignedPassage,
  type WinningShapeSummary,
} from "./answer-alignment";

const MOVE_DRAFT_KIND: MoveDraftKind = "answer_alignment";
const PAGE_SIZE = 1000;
const MAX_PAGES = 5; // 5k rows ceiling - far above one tenant's answer-row volume.

/** One row of the durable Profound answer cache, projected to only what alignment needs. */
export type ProfoundAnswerExcerpt = {
  prompt: string;
  model: string | null;
  responseExcerpt: string;
};

/** Paginated, tenant-scoped read of profound_answer_rows (bounded at 5k rows).
 *  Fail-soft -> []. Mirrors the paged-read pattern in profound-coverage/load-cached.ts. */
async function readProfoundAnswerExcerpts(tenantId: string): Promise<ProfoundAnswerExcerpt[]> {
  if (!isSupabaseConfigured() || !tenantId) return [];
  const out: ProfoundAnswerExcerpt[] = [];
  try {
    const sb = getSupabaseAdmin();
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await sb
        .from("profound_answer_rows")
        .select("prompt, model, response_excerpt")
        .eq("tenant_id", tenantId)
        .not("response_excerpt", "is", null)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        log.warn("[answer-alignment] profound_answer_rows read failed", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as { prompt: string; model: string | null; response_excerpt: string | null }[];
      for (const r of rows) {
        if (r.response_excerpt) out.push({ prompt: r.prompt, model: r.model, responseExcerpt: r.response_excerpt });
      }
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (e) {
    log.warn("[answer-alignment] profound_answer_rows read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}

/** Lean projection of an owned page_snapshots row - only the text fields alignment
 *  needs. Deliberately narrower than the shared repository projection (which drops
 *  body_paragraph_sample/card_texts to protect hot web-render egress) - this reader
 *  targets exactly ONE url per call, so the extra columns are cheap. */
type OwnedBodyRow = {
  body_paragraph_sample: string[] | null;
  card_texts: string[] | null;
  faqs: { answer_excerpt: string }[] | null;
};

/** Read the latest page_snapshots body text for ONE owned URL. Fail-soft -> null. */
async function readOwnedPageBodyText(tenantId: string, url: string): Promise<string | null> {
  if (!isSupabaseConfigured() || !tenantId || !url) return null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("body_paragraph_sample, card_texts, faqs, fetched_at")
      .eq("tenant_id", tenantId)
      .eq("url", url)
      .order("fetched_at", { ascending: false })
      .limit(1);
    if (error) {
      log.warn("[answer-alignment] page_snapshots read failed", { tenantId, url, error: error.message });
      return null;
    }
    const row = ((data ?? [])[0] ?? null) as OwnedBodyRow | null;
    if (!row) return null;
    const parts = [
      ...(row.body_paragraph_sample ?? []),
      ...(row.card_texts ?? []),
      ...(row.faqs ?? []).map((f) => f.answer_excerpt).filter(Boolean),
    ];
    const text = parts.join(" ").trim();
    return text || null;
  } catch (e) {
    log.warn("[answer-alignment] page_snapshots read threw", {
      tenantId,
      url,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Real, literal competitor page text built from the ALREADY-CACHED teardown
 *  facts (no new fetch, no new store) - outline headings + FAQ questions + meta
 *  description + title. Every fragment is real page text; the coarser granularity
 *  (vs full paragraphs) is an honest tradeoff since raw competitor body text is
 *  never persisted (see competitor-page-audit.ts). Null when there is nothing usable. */
export function competitorPageTextFromFacts(facts: CompetitorPageFacts | null): string | null {
  if (!facts) return null;
  const parts = [facts.title, facts.metaDescription, ...facts.outline, ...facts.faqQuestions].filter(
    (s): s is string => Boolean(s && s.trim()),
  );
  return parts.length > 0 ? parts.join(". ") : null;
}

/** A generic word common across many unrelated Iranopedia-style topics ("iran",
 *  "persian", "best", "top" ...) - matching on this token ALONE must never be
 *  enough to call two topics "the same". Kept intentionally small and generic
 *  (not tenant-specific vocabulary) - this is about generic English stopword-
 *  adjacent nouns that show up in almost every prompt for any topic-heavy site,
 *  not about any one tenant's subject matter. */
const GENERIC_TOKENS = new Set(["best", "top", "most", "what", "are", "the", "for", "and"]);

/** Pick the best-matching durable Profound answer excerpt for a topic/query label.
 *  Deterministic token-overlap match against the prompt text (no LLM). Requires
 *  BOTH a high one-sided containment of the topic's tokens AND at least 2 shared
 *  non-generic tokens (or all of them, when the topic itself has fewer than 2) -
 *  a single coincidental shared word (e.g. two unrelated prompts both mentioning
 *  "Iran") must never count as a topic match. Null when nothing clears that bar. */
export function pickAnswerExcerptForTopic(
  excerpts: ReadonlyArray<ProfoundAnswerExcerpt>,
  topic: string,
): ProfoundAnswerExcerpt | null {
  const topicToks = new Set(
    topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
  if (topicToks.size === 0 || excerpts.length === 0) return null;
  const meaningfulTopicToks = [...topicToks].filter((t) => !GENERIC_TOKENS.has(t));
  const minSharedMeaningful = Math.min(2, meaningfulTopicToks.length || topicToks.size);

  let best: { row: ProfoundAnswerExcerpt; score: number } | null = null;
  for (const row of excerpts) {
    const promptToks = new Set(
      row.prompt
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    );
    if (promptToks.size === 0) continue;
    let hit = 0;
    let meaningfulHit = 0;
    for (const t of topicToks) {
      if (promptToks.has(t)) {
        hit += 1;
        if (!GENERIC_TOKENS.has(t)) meaningfulHit += 1;
      }
    }
    if (meaningfulHit < minSharedMeaningful) continue;
    const score = hit / topicToks.size;
    if (score > 0 && (!best || score > best.score)) best = { row, score };
  }
  return best && best.score >= 0.5 ? best.row : null;
}

/** Persisted shape for the "answer_alignment" move-draft kind. Compact - the
 *  passages themselves are already excerpt-length, so this comfortably fits the
 *  shared 12k move_drafts content cap. */
export type PersistedAnswerAlignment = {
  /** alignmentContentHash(answerText, pageText) - re-render skips recompute when
   *  this still matches (same answer excerpt, same page text). */
  contentHash: string;
  engine: string | null;
  promptText: string | null;
  passages: AlignedPassage[];
  shape: WinningShapeSummary | null;
  computedAt: string;
};

const MAX_PASSAGE_TEXT = 600; // per sentence field - keeps a few passages well under the 12k draft cap

function capPassageText(s: string): string {
  return s.length > MAX_PASSAGE_TEXT ? `${s.slice(0, MAX_PASSAGE_TEXT)}…` : s;
}

/** Build the persisted shape from a raw alignment result, capping every text field
 *  well under the shared move_drafts 12k content cap. Exported for direct testing
 *  of the truncation behavior. */
export function toPersistable(
  hash: string,
  engine: string | null,
  promptText: string | null,
  passages: AlignedPassage[],
): PersistedAnswerAlignment {
  const capped = passages.map((p) => ({
    ...p,
    answerSentence: capPassageText(p.answerSentence),
    pageSentence: capPassageText(p.pageSentence),
  }));
  return {
    contentHash: hash,
    engine,
    promptText: promptText ? capPassageText(promptText) : null,
    passages: capped,
    shape: summarizeWinningShapes(capped),
    computedAt: new Date().toISOString(),
  };
}

/** Parse a persisted answer_alignment draft. Never throws - malformed/legacy
 *  content is treated as "nothing cached yet". */
export function parsePersistedAnswerAlignment(content: string | null | undefined): PersistedAnswerAlignment | null {
  if (!content) return null;
  try {
    const o = JSON.parse(content) as PersistedAnswerAlignment;
    if (!o || !Array.isArray(o.passages)) return null;
    return o;
  } catch {
    return null;
  }
}

/**
 * Competitor-side alignment for one Move: "the words that beat you." Looks up the
 * cached competitor teardown text (matched by DOMAIN - the card only ever shows the
 * competitor's domain, e.g. "Who AI cites now", never the raw URL) and the cached
 * Profound answer excerpt for the given topic, aligns them, and persists the result
 * under move_drafts (kind "answer_alignment") keyed by `${recId}::competitor`,
 * cached by content hash.
 *
 * Fail-soft throughout - returns null on any missing input (no competitor audit,
 * no matching answer excerpt, no overlap above the score floor). Never throws.
 */
export async function getCompetitorAnswerAlignment(
  tenantId: string,
  recId: string,
  competitorDomain: string,
  topic: string,
): Promise<PersistedAnswerAlignment | null> {
  if (!tenantId || !recId || !competitorDomain) return null;
  const draftKey = `${recId}::competitor`;
  try {
    const [audits, excerpts, existingDrafts] = await Promise.all([
      getCompetitorAuditsForTenantId(tenantId),
      readProfoundAnswerExcerpts(tenantId),
      getLatestMoveDrafts(tenantId),
    ]);
    const wantedDomain = competitorDomain.replace(/^www\./i, "").toLowerCase();
    const audit = [...audits.values()].find((a) => a.domain?.replace(/^www\./i, "").toLowerCase() === wantedDomain) ?? null;
    const pageText = competitorPageTextFromFacts(audit?.facts ?? null);
    const answerRow = pickAnswerExcerptForTopic(excerpts, topic);
    if (!pageText || !answerRow) return null;

    const hash = alignmentContentHash(answerRow.responseExcerpt, pageText);
    const cached = parsePersistedAnswerAlignment(existingDrafts.get(`${draftKey}::${MOVE_DRAFT_KIND}`)?.content);
    if (cached && cached.contentHash === hash) return cached;

    const passages = alignAnswerToPage(answerRow.responseExcerpt, pageText);
    if (passages.length === 0) return null;
    const result = toPersistable(hash, answerRow.model, answerRow.prompt, passages);
    await saveMoveDraft(tenantId, draftKey, MOVE_DRAFT_KIND, JSON.stringify(result)).catch(() => false);
    return result;
  } catch (e) {
    log.warn("[answer-alignment] competitor alignment failed", {
      tenantId,
      recId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** W2-B (2026-07-10) - one owned-alignment request in the batched reader below. */
export type OwnedAlignmentRequest = {
  recId: string;
  ownedUrl: string;
  citingPrompts: ReadonlyArray<string>;
};

/**
 * W2-B (2026-07-10) - BATCHED owned-side alignment for MANY shipped cards in ONE
 * pass, and the fix for the /results GET-mutation + N+1.
 *
 * The per-card getOwnedAnswerAlignment above did THREE Supabase reads for EVERY
 * card (readOwnedPageBodyText + readProfoundAnswerExcerpts + getLatestMoveDrafts)
 * AND wrote saveMoveDraft DURING the render (a GET that mutates). On a ledger with
 * N cited cards that was 3N reads and up to N writes on a plain page view.
 *
 * This reader instead:
 *   - reads the two request-WIDE inputs (Profound excerpts + the move-draft cache)
 *     EXACTLY ONCE across every card, plus one page-body read per DISTINCT url;
 *   - resolves each card from those in-memory inputs (pure);
 *   - by default DOES NOT persist (opts.persist !== true), so the render path is a
 *     pure read - it serves the cached alignment when the content hash still
 *     matches and otherwise returns the freshly-computed passages WITHOUT writing.
 *
 * The caller warms the cache by scheduling ONE more call with { persist: true }
 * in next/after() (off the render path), which writes back any freshly-computed
 * alignment so the next visit is a pure cache hit. Fail-soft per row; a total
 * read failure returns null for every request.
 */
export async function getOwnedAnswerAlignmentsBatch(
  tenantId: string,
  requests: ReadonlyArray<OwnedAlignmentRequest>,
  opts: { persist?: boolean } = {},
): Promise<Map<string, PersistedAnswerAlignment | null>> {
  const persist = opts.persist === true;
  const out = new Map<string, PersistedAnswerAlignment | null>();
  const valid = requests.filter((r) => r.recId && r.ownedUrl && r.citingPrompts.length > 0);
  for (const r of requests) out.set(r.recId, null); // honest default for every asked row
  if (!tenantId || valid.length === 0) return out;

  let excerpts: ProfoundAnswerExcerpt[];
  let existingDrafts: Awaited<ReturnType<typeof getLatestMoveDrafts>>;
  try {
    [excerpts, existingDrafts] = await Promise.all([
      readProfoundAnswerExcerpts(tenantId), // ONE read across all cards
      getLatestMoveDrafts(tenantId), // ONE read across all cards
    ]);
  } catch (e) {
    log.warn("[answer-alignment] batched owned reads failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return out; // every request already null
  }

  // ONE page-body read per DISTINCT url (a ledger often ships several changes to
  // the same page), run in parallel and reused across the requests that share it.
  const distinctUrls = [...new Set(valid.map((r) => r.ownedUrl))];
  const bodyByUrl = new Map<string, string | null>();
  await Promise.all(
    distinctUrls.map(async (url) => {
      bodyByUrl.set(url, await readOwnedPageBodyText(tenantId, url).catch(() => null));
    }),
  );

  for (const req of valid) {
    try {
      const pageText = bodyByUrl.get(req.ownedUrl) ?? null;
      if (!pageText) continue;
      const byExactPrompt = excerpts.find((e) =>
        req.citingPrompts.some((p) => p.trim().toLowerCase() === e.prompt.trim().toLowerCase()),
      );
      const answerRow = byExactPrompt ?? pickAnswerExcerptForTopic(excerpts, req.citingPrompts[0] ?? "");
      if (!answerRow) continue;

      const hash = alignmentContentHash(answerRow.responseExcerpt, pageText);
      const draftKey = `${req.recId}::owned`;
      const cached = parsePersistedAnswerAlignment(existingDrafts.get(`${draftKey}::${MOVE_DRAFT_KIND}`)?.content);
      if (cached && cached.contentHash === hash) {
        out.set(req.recId, cached);
        continue;
      }
      const passages = alignAnswerToPage(answerRow.responseExcerpt, pageText);
      if (passages.length === 0) continue;
      const result = toPersistable(hash, answerRow.model, answerRow.prompt, passages);
      out.set(req.recId, result);
      // GET-safe: only the after() warm-up (persist:true) ever writes.
      if (persist) {
        await saveMoveDraft(tenantId, draftKey, MOVE_DRAFT_KIND, JSON.stringify(result)).catch(() => false);
      }
    } catch (e) {
      log.warn("[answer-alignment] batched owned row failed", {
        tenantId,
        recId: req.recId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

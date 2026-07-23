import "server-only";
import { z } from "zod";
import { checkBudget, recordSpend } from "./adjudicator-budget";
import { log } from "@/lib/logger";
import { buildWinnerFewShots, buildWinnerFewShotsWithPattern } from "./winner-memory";
import type { DraftPatternId } from "./draft-pattern";
import { openAIChatCompletion } from "./gateway";
import { PROMPT_REGISTRY, type PromptId } from "./prompt-registry";
import { llmCallCacheKey, resolveCacheImpl, type CacheImpl } from "./call-cache";
import { looksTemplated, REPEAT_FLAG, REPEAT_HISTORY_SIZE, VARIATION_INSTRUCTION } from "./de-templating";
import {
  allowNumbers,
  buildGroundedNumbers,
  findUngroundedNumbers,
  groundedNumberList,
  type GroundedNumbers,
} from "./numeric-fidelity";
import { sanitizeEvidenceTexts, sanitizeNullableEvidence, sanitizeEvidenceText } from "./injection-sanitizer";
import {
  stampSourceAuthority,
  findSupportingSpan,
  pageEntailsDraftClaims,
  classifySourceAuthority,
  extractDomain,
  ungroundedSuperlatives,
  isEntityRichTopic,
  looksLikeListOrIndexUrl,
  type ClassifiableSource,
} from "@/domains/decision/drafts/source-authority";
import { safeFetchSourceText } from "@/lib/net/safe-source-fetch";
import {
  SCHEMA_BY_KIND,
  draftProseStringValues,
  type StructuredDraftKind,
  type AnswerBlockDraft,
  type AtomicEditDraft,
  type CreatePageBrief,
  type AeoPromptBrief,
} from "./schemas";

/**
 * llm/structured-drafter (2026-06-25, P4) — the trustworthy drafting layer and
 * the FIRST production caller of the gated/budgeted LLM pattern. It turns a
 * grounded request into a SCHEMA-VALIDATED structured draft, or nothing:
 *
 *   gate (BEACON_LLM_PROVIDER=openai + key) → cache ($0 on an identical repeat)
 *   → budget (fail-closed cap) → call → robust JSON extract → Zod validate →
 *   content firewalls (numeric-fidelity, placeholder, em-dash, superlative) →
 *   de-templating guard → RETRY ONCE on failure → FAIL CLOSED.
 *
 * It NEVER returns loose/unvalidated text as a product artifact. Spend is
 * recorded the moment a call returns (even if the draft is later rejected). The
 * completion fn is injectable so the whole flow is unit-tested with zero paid
 * calls. Mirrors the lessons in llm-answer-block.ts (gpt-5-mini reasoning models
 * return empty under response_format, so we parse JSON out of the text robustly).
 *
 * R16 (2026-07-03, P6): the raw fetch moved into the ONE gateway
 * (llm/gateway.ts - loud fallbacks, error ledger, reasoning timeout floor);
 * every call carries a registered promptId + version (prompt-registry.ts,
 * fixture-pinned by tests/llm-regression); identical requests are served from
 * the content-hash call cache at $0 (call-cache.ts, `bypassCache` for the
 * explicit Regenerate); the numeric firewall gained formatting tolerance +
 * a repair retry that injects the correct grounded numbers (numeric-fidelity
 * .ts); near-copies of recent same-family drafts retry once with a variation
 * instruction and otherwise ship FLAGGED "reads like a repeat"
 * (de-templating.ts); and evidence text is stripped of instruction-shaped
 * lines before it enters any prompt (injection-sanitizer.ts).
 *
 * Tenant-agnostic. Pinned by structured-drafter.test.ts +
 * structured-drafter-engine-pack.test.ts.
 */

const MODEL = "gpt-5-mini";

/** BEACON_500 item 74: present on a "drafted" result only when a CONFIDENT house
 *  pattern cell backed this draft's prompt (winner-memory's pattern aggregate cleared
 *  the minimum-sample floor for this page family). Absent (not merely null) whenever
 *  the ledger has no confident opinion yet - callers must treat absence as "no claim". */
export type FewShotProvenance = {
  /** The structural pattern the winning few-shot examples were tagged with. */
  pattern: DraftPatternId;
  /** The sibling page whose measured win backs this pattern (best-known example). */
  winningPage: string | null;
  /** Plain, jargon-free sentence describing the winning cell (no "experiment"/"cell"). */
  sentence: string;
};

export type StructuredDraftResult<T> =
  | { status: "off" }
  | { status: "blocked_budget"; reason: string }
  | { status: "validation_failed"; reason: string; errors: string[]; costUsd: number; retried: boolean }
  | {
      status: "drafted";
      kind: StructuredDraftKind;
      value: T;
      costUsd: number;
      retried: boolean;
      fewShot?: FewShotProvenance;
      /** R16: present when this exact request was served from the call cache ($0). */
      cached?: true;
      /** R16: present when the draft still reads like a repeat of recent same-family
       *  drafts after the variation retry ("reads like a repeat") - the draft-quality
       *  gate demotes flagged output instead of calling it ready. */
      repeatFlag?: string;
    };

/** Injectable completion fn (default = real OpenAI). Returns text or an error. */
export type CompleteFn = (args: {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}) => Promise<{ text: string } | { error: string }>;

function isOn(): boolean {
  return (process.env.BEACON_LLM_PROVIDER ?? "").trim().toLowerCase() === "openai";
}

/** BEACON_500 item 74: turn a confident pattern-hint cell into the one-line, plain-
 *  English provenance the draft-provenance surface shows. Pure - no I/O. Names the
 *  real winning page when one is known; otherwise names the page family only (never
 *  fabricates a page). */
function fewShotProvenanceFrom(
  hint: { pattern: DraftPatternId; pageFamily: string; winningPage: string | null } | null,
  pageFamily: string,
): FewShotProvenance | undefined {
  if (!hint) return undefined;
  const styleWord = hint.pattern.replace(/_/g, "-");
  const sentence = hint.winningPage
    ? `I wrote this the way your last winners were written: ${styleWord}, like the block that won on ${hint.winningPage}.`
    : `I wrote this the way your last winners were written: ${styleWord}, the structure that has won most often on ${pageFamily} pages here.`;
  return { pattern: hint.pattern, winningPage: hint.winningPage, sentence };
}

/** Rough gpt-5-mini cost (~$0.25/1M in, ~$2/1M out; ~4 chars/token). */
function estimateCostUsd(promptChars: number, completionChars: number): number {
  return (promptChars / 4 / 1_000_000) * 0.25 + (completionChars / 4 / 1_000_000) * 2;
}

const SUPERLATIVES = /\b(best|leading|#1|number one|top-rated|guaranteed|world-class|ultimate|premier)\b/i;

/** Pilot loop 6 (2026-07-11): a rephrase-class retry asks the model to REWRITE
 *  its previous answer - exactly the moment it is tempted to "help" fill in a
 *  more convincing-sounding claim with a fresh, invented number or percentage
 *  (the numeric firewall would still catch it, but only after the final retry
 *  is spent). Every rephrase-class retry instruction below closes with this
 *  same reminder so a rewrite cannot trade an ungrounded superlative, or a
 *  too-thin answer, for an ungrounded statistic instead. */
const NO_NEW_NUMBERS_RETRY_REMINDER =
  "Do not introduce any number, percentage, or statistic that is not present in the evidence; if " +
  "unsure, write the sentence without a number.";

/** G4 (2026-07-10): the RETRY instruction when an answer block asserted a
 *  superlative no cited source proves. Instructs the model to REPHRASE to a
 *  grounded, non-superlative fact (the honest fix the operator made by hand:
 *  "most celebrated" -> "the defining voices in classical music", grounded by
 *  the honors/dates), rather than blanket-banning the superlative-intent topic.
 *
 *  Pilot loop 4 (2026-07-10): the pilot's second real run showed the model can
 *  satisfy this by swapping ONE ungrounded superlative for a DIFFERENT
 *  ungrounded one ("most famous" -> "the leading voice") - still a fail-closed
 *  reject, just on a fresh phrase. Strengthened below to rule that out
 *  explicitly and to state the preference plainly: a concrete grounded fact
 *  always beats any superlative, grounded or not.
 *
 *  Pilot loop 6 (2026-07-11): closes with NO_NEW_NUMBERS_RETRY_REMINDER so the
 *  rephrase cannot launder in a fresh invented number while it removes the
 *  superlative. */
const SUPERLATIVE_REPHRASE_INSTRUCTION =
  'Your previous answer used a superlative or ranking claim (for example "most famous", ' +
  '"most celebrated", "leading", "best-known", "the first") that none of your cited sources ' +
  "actually states. Do NOT simply repeat it, and do NOT drop the topic. Do NOT swap it for a " +
  'DIFFERENT unproven superlative either (for example replacing "most famous" with "leading" or ' +
  '"best-known" is still ungrounded and will fail again) - introduce NO new superlative or ranking ' +
  "claim that was not in your first answer. REPHRASE it as a grounded, non-superlative fact using " +
  'the specific honors, dates, roles, and works in the evidence: for example write "a defining ' +
  'voice in classical Persian music, awarded the UNESCO Mozart Medal" instead of "the most ' +
  'celebrated singer". A concrete grounded fact is always the better answer than any superlative - ' +
  "prefer it every time. Only keep a superlative if a cited source explicitly asserts that exact " +
  "superlative. " +
  NO_NEW_NUMBERS_RETRY_REMINDER;

/** Pilot loop 5 (2026-07-11): the MERGED retry instruction for when attempt 1
 *  fails BOTH the 80-word floor AND the verification-aware superlative check
 *  at once. Before this, the too-thin retry and the superlative-rephrase retry
 *  each consumed the SAME single retry slot - whichever check ran first
 *  "claimed" the retry and the other problem was never named in the
 *  instruction, so a draft with both problems in attempt 1 died on attempt 2
 *  still carrying whichever issue the retry never mentioned. This addresses
 *  both in ONE instruction, spending no extra LLM call: lengthen with MORE
 *  grounded single-fact sentences (never padding), AND remove or replace every
 *  unproven superlative with a grounded fact, introducing no new one.
 *
 *  Pilot loop 6 (2026-07-11): closes with NO_NEW_NUMBERS_RETRY_REMINDER so
 *  lengthening the answer never smuggles in a fresh invented number either. */
const COMBINED_THIN_AND_SUPERLATIVE_RETRY_INSTRUCTION =
  "Your previous answer had TWO problems - fix BOTH in this rewrite. First, it was too short: write " +
  "a complete answer of 80 to 150 words, grounded ONLY in the evidence provided - add the missing " +
  "length with MORE grounded single-fact sentences (one honor, one work, one date, one role per " +
  "sentence), never by padding or writing longer compound sentences. Second, it used a superlative " +
  'or ranking claim (for example "most famous", "most celebrated", "leading", "best-known") that ' +
  "none of your cited sources actually states - remove it or REPHRASE it as a grounded, " +
  "non-superlative fact using the specific honors, dates, roles, and works in the evidence. Do NOT " +
  "swap it for a DIFFERENT unproven superlative and introduce NO new superlative or ranking claim " +
  "that was not in your first answer. Only keep a superlative if a cited source explicitly asserts " +
  "that exact superlative. " +
  NO_NEW_NUMBERS_RETRY_REMINDER;

/** Em/en-dashes are a STYLE issue, not a trust issue — normalize them to hyphens
 *  in every string field before validation, so a good draft isn't rejected for
 *  punctuation (gpt-5-mini strongly favors em-dashes). Trust firewalls (invented
 *  numbers, placeholders, superlatives) stay HARD rejects. */
function sanitizeDashesDeep(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\s*[—–]\s*/g, " - ");
  if (Array.isArray(v)) return v.map(sanitizeDashesDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = sanitizeDashesDeep(val);
    return out;
  }
  return v;
}

/** Parse JSON robustly: direct, then the first {...} / [...] slice in the text. */
function robustJsonExtract(raw: string): unknown {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    const cand = t.match(/\{[\s\S]*\}/)?.[0] ?? t.match(/\[[\s\S]*\]/)?.[0];
    if (!cand) return undefined;
    try {
      return JSON.parse(cand);
    } catch {
      return undefined;
    }
  }
}

/** The full grounded-number ledger for one request: evidence numbers with R16
 *  formatting tolerance (numeric-fidelity.ts) plus the structural allowances -
 *  adjacent years and the 7/14/28-day proof-window constants (methodology
 *  language, not factual claims). */
function buildRequestLedger(grounded: string, nowYear: number): GroundedNumbers {
  return allowNumbers(buildGroundedNumbers(grounded), [
    String(nowYear - 1),
    String(nowYear),
    String(nowYear + 1),
    "7",
    "14",
    "28",
  ]);
}

/** The primary CUSTOMER-FACING text of a validated draft (what the de-templating
 *  guard compares + what the call cache keeps as same-family history). Null for
 *  kinds whose output is analysis/verdict shaped rather than publishable copy. */
function primaryCustomerText(kind: StructuredDraftKind, value: unknown): string | null {
  const v = value as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof v?.[k] === "string" ? (v[k] as string) : null);
  switch (kind) {
    case "answer_block": return pick("answer");
    case "atomic_edit": return pick("after");
    case "create_page_brief": return pick("openingAnswer");
    case "aeo_prompt_brief": return pick("direct_answer_40_80_words");
    case "section_draft": return pick("body");
    case "outreach_pitch": return pick("body");
    case "internal_link": return pick("linkSentence");
    default: return null;
  }
}

/**
 * W5 (2026-07-09, J-69), re-stamp any `sources` array on a validated draft
 * with the DETERMINISTIC authority classification, discarding whatever the
 * LLM proposed. "ONLY this module [source-authority.ts] stamps authority",  * this is the one place that rule is enforced for every LLM-drafted kind
 * that carries a `sources` field (answer_block, create_page_brief,
 * atomic_edit). A draft with no `sources` array is returned unchanged.
 */
function stampAnySources(value: unknown, tenantAllowlist?: readonly string[]): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sources)) return value;
  return { ...v, sources: stampSourceAuthority(v.sources as ClassifiableSource[], tenantAllowlist) };
}

/** W5 (J-71): an answer block runs 80-150 words; the drafter gives ONE
 *  word-count retry so a too-thin answer is never cached for the gate to
 *  reject. Matches evaluateDraftQuality's own floor + word count. */
const ANSWER_MIN_WORDS = 80;
function countWords(text: string): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** How many cited sources per draft the generation-time verifier will fetch
 *  (cost cap - real drafts carry 1-2; anything past this stays unverified). */
const MAX_SOURCES_TO_VERIFY = 3;

/** How many of a draft's sources verify concurrently (P2, 2026-07-09): a
 *  bounded worker pool, never a full fan-out - a draft's 1-3 sources share
 *  this budget rather than serializing one full fetch at a time. */
const SOURCE_VERIFY_CONCURRENCY = 2;

/** P2 (2026-07-09): the WHOLE draft's source-verification wall-clock budget,
 *  not a per-source one. Without this, N sources each capped at their own
 *  per-fetch timeout can still add up to N times that before the draft ships
 *  - on a slow/hostile host, generation could hang far longer than any single
 *  fetch's timeout suggests. Once spent, every source not yet fetched stays
 *  verified:false / authority:"weak" (FAIL CLOSED) rather than being fetched
 *  on borrowed time. */
const WHOLE_DRAFT_VERIFY_DEADLINE_MS = 20_000;

/**
 * W5 P0-1 (2026-07-09): fetch a cited source URL and return its visible text.
 * Injected in tests (hermetic); the default routes through the SSRF-safe
 * source fetcher (lib/net/safe-source-fetch.ts) - NOT the competitor crawler's
 * follow-redirect fetch, because a source URL is untrusted model-generated
 * text. Fail-soft: any failure resolves to `{ ok: false, text: "" }` so
 * verification downgrades the source rather than throwing. `finalUrl` (W5
 * stop-ship F2) is the post-redirect URL the fetch actually landed on, so the
 * verifier can recompute authority from the REAL final host. `opts.deadlineMs`
 * (P2) is the REMAINING whole-draft budget for this particular fetch, so a
 * source that starts late gets a shorter leash than one that starts first.
 */
export type SourceTextFetcher = (
  url: string,
  opts?: { deadlineMs?: number },
) => Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>;

/** Strip HTML to visible text (scripts/styles/tags removed, whitespace
 *  collapsed) so claim tokens can be matched against the page's real words. */
function htmlToVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200_000);
}

function defaultSourceFetcher(timeoutMs: number): SourceTextFetcher {
  return async (url: string, opts?: { deadlineMs?: number }) => {
    try {
      const res = await safeFetchSourceText(url, {}, { timeoutMs, deadlineMs: opts?.deadlineMs });
      // G5 (2026-07-10): surface a robots/anti-bot block (403 class) distinctly
      // from an unreachable/broken URL so an authority-strong-but-unreadable
      // source is held as "check this citation", not "no source". Never evade it.
      if (!res.ok) return { ok: false, text: "", blocked: res.reason === "access_blocked" };
      return { ok: true, text: htmlToVisibleText(res.text), finalUrl: res.finalUrl };
    } catch {
      return { ok: false, text: "" };
    }
  };
}

/** The verifier to use: the injected one in tests, the polite-fetch default in
 *  production, and NOTHING under vitest without injection (keeps every pinned
 *  suite hermetic - no draft with sources ever hits the network in a test that
 *  didn't opt in), exactly the resolveCacheImpl posture. */
function resolveSourceFetch(injected: SourceTextFetcher | undefined, timeoutMs: number): SourceTextFetcher | null {
  if (injected) return injected;
  if (process.env.VITEST === "true") return null;
  return defaultSourceFetcher(timeoutMs);
}

/** Fields the source-verify trust boundary owns end to end. Cleared before any
 *  fetch so an LLM-supplied `verified: true` (or a stale value) can never
 *  survive into a returned draft; re-set ONLY when a real fetch confirms the
 *  claim on an authoritative final host. */
function resetSourceVerification(s: Record<string, unknown>): void {
  s.verified = false;
  delete s.verifiedAt;
  delete s.supportingExcerpt;
  delete s.finalUrl;
  delete s.contentHash;
  // G5 (2026-07-10): an LLM-supplied `fetchBlocked` must never survive either -
  // only a real 403-class fetch below is allowed to set it.
  delete s.fetchBlocked;
  // G6 (2026-07-10): the transient full-page text is set ONLY by a real fetch
  // below (never the model); wipe any inbound value so it cannot be spoofed.
  delete s.fetchedText;
}

/**
 * W5 stop-ship F2 (2026-07-09): pure strip of every source-verification field
 * when NO verifier is configured (vitest without injection, or a runtime with
 * source-fetch disabled). Without this, an LLM that emitted `verified: true`
 * would have that value survive unchallenged. Forces verified=false and drops
 * verifiedAt/supportingExcerpt/finalUrl/contentHash on every source. A draft
 * with no sources array is returned unchanged.
 */
function stripSourceVerificationFields(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sources) || v.sources.length === 0) return value;
  const sources = v.sources.map((raw) => {
    const s = { ...(raw as Record<string, unknown>) };
    resetSourceVerification(s);
    return s;
  });
  return { ...v, sources };
}

/**
 * W5 stop-ship F2 (2026-07-09): the GENERATION-TIME source-verification trust
 * boundary. For each of the first MAX_SOURCES_TO_VERIFY sources:
 *   1. RESET every verification field FIRST (never trust the LLM's own
 *      `verified`/excerpt/hash) - see resetSourceVerification.
 *   2. fetch the URL through the SSRF-safe fetcher (injected here).
 *   3. on a reachable page, run findSupportingSpan(claim, text) and recompute
 *      authority from the FINAL (post-redirect) host. `verified: true` is set
 *      ONLY when a qualifying span is found AND the final host is authoritative;
 *      the fetched final URL, the supporting excerpt, and its content hash are
 *      persisted so the receipt shows exactly what backed the claim.
 * An unreachable URL, a redirect to an untrusted (non-authoritative) final
 * host, a weak-match, or a source with no URL/claim all downgrade `authority`
 * to "weak" and leave `verified: false` - so a hallucinated .gov/.edu URL can
 * never pass the authority gate on domain class alone. NEVER throws; a draft
 * with no sources array is returned unchanged. Runs at generation time only
 * (behind the resolveSourceFetch gate), never on a render/eval path.
 *
 * P2 (2026-07-09): eligible sources verify through a bounded worker pool of
 * at most SOURCE_VERIFY_CONCURRENCY fetches in flight, all sharing ONE
 * WHOLE_DRAFT_VERIFY_DEADLINE_MS wall-clock budget (captured once, before the
 * first fetch). Each worker checks the remaining budget immediately before
 * its OWN next fetch; once spent, every source not yet started is left
 * verified:false / authority:"weak" rather than fetched on borrowed time -
 * FAIL CLOSED on the whole-draft deadline, exactly like a single fetch's own
 * per-hop deadline in safe-source-fetch.ts. Results are reassembled in the
 * original source order regardless of which worker finished first.
 */
async function verifyStampedSources(
  value: unknown,
  fetcher: SourceTextFetcher,
  cache: Map<string, Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>>,
  nowIso: string,
  nowYear: number,
  tenantAllowlist: readonly string[] | undefined,
  // G6 (2026-07-10): the draft's own customer-facing prose (answer/openingAnswer/
  // after/...). Threaded so a fetchable authoritative page whose META-claim did
  // not span-match can STILL verify when its full page text entails the draft's
  // sentences - the roundup case, where one Wikipedia list page backs many names.
  draftText: string | null,
): Promise<unknown> {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sources) || v.sources.length === 0) return value;

  const prepared: Record<string, unknown>[] = v.sources.map((raw) => {
    const s = { ...(raw as Record<string, unknown>) };
    // (1) never trust an LLM-supplied verification: wipe it before any fetch.
    resetSourceVerification(s);
    return s;
  });

  // Sources eligible for a real fetch, IN ORIGINAL ORDER; anything past the
  // MAX_SOURCES_TO_VERIFY cap or missing url/claim short-circuits to weak
  // without ever touching the fetcher or the whole-draft deadline budget.
  const eligible: number[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    const s = prepared[i]!;
    const url = String(s.url ?? "").trim();
    const claim = String(s.claim ?? "").trim();
    if (i >= MAX_SOURCES_TO_VERIFY || !url || !claim) {
      s.authority = "weak";
    } else {
      eligible.push(i);
    }
  }
  if (eligible.length === 0) return { ...v, sources: prepared };

  async function verifyOne(i: number, remainingMs: number): Promise<void> {
    const s = prepared[i]!;
    const url = String(s.url ?? "").trim();
    const claim = String(s.claim ?? "").trim();
    // (2) fetch through the injected SSRF-safe fetcher (per-request URL cache,
    // deduping the same source cited on either generation attempt OR by two
    // different sources in the same draft). The cache stores the IN-FLIGHT
    // PROMISE, not the resolved value - `get` + `set` happen synchronously
    // (no await between them), so two pool workers racing on the same URL
    // both see the SAME shared fetch rather than each starting their own.
    let pending = cache.get(url);
    if (!pending) {
      pending = fetcher(url, { deadlineMs: remainingMs }).catch(() => ({ ok: false, text: "" }));
      cache.set(url, pending);
    }
    const fetched = await pending;
    if (!fetched.ok) {
      // G5 (2026-07-10): a robots/anti-bot BLOCK (403 class) on an
      // authority-strong domain is honest middle ground - we could not read the
      // page, so we cannot mark it verified, but the domain IS trusted. Keep
      // authority "authoritative" + verified:false + fetchBlocked:true so the
      // gate holds the draft as `needs_source_check` ("check this citation"),
      // NOT `missing_source`. A block on a non-trusted domain, or any
      // dns/timeout/broken fetch, stays "weak" exactly as before.
      if (fetched.blocked === true) {
        const blockedHost = extractDomain({ url, domain: String(s.domain ?? "") });
        const blockedAuthority = classifySourceAuthority(
          { url, domain: blockedHost, claim },
          tenantAllowlist,
        );
        if (blockedAuthority === "authoritative") {
          s.authority = "authoritative";
          s.verified = false;
          s.fetchBlocked = true;
          return;
        }
      }
      s.authority = "weak";
      return;
    }
    // (3) span-level entailment + FINAL-host authority.
    const finalUrl = (fetched.finalUrl && fetched.finalUrl.trim()) || url;
    const finalHost = extractDomain({ url: finalUrl });
    const finalAuthority = classifySourceAuthority(
      { url: finalUrl, domain: finalHost, claim },
      tenantAllowlist,
    );
    const sup = findSupportingSpan(claim, fetched.text, nowYear);
    if (sup.supported && finalAuthority === "authoritative") {
      s.url = finalUrl;
      s.domain = finalHost;
      s.finalUrl = finalUrl;
      s.authority = "authoritative";
      s.verified = true;
      s.verifiedAt = nowIso;
      if (sup.excerpt != null) s.supportingExcerpt = sup.excerpt;
      if (sup.contentHash != null) s.contentHash = sup.contentHash;
      // G6 (2026-07-10): thread the FULL fetched page text (transient, never
      // persisted - stripped at the store boundary) so per-claim coverage can back
      // the OTHER roundup sentences this one page covers, not just this claim's span.
      s.fetchedText = fetched.text;
    } else if (finalAuthority === "authoritative") {
      // G6 roundup path: the model's meta-claim ("Summarizes X as ...") did not
      // span-match, but this is a REAL authoritative page we just READ. If its full
      // text entails the draft's own sentences (a list page backing many names),
      // verify it and thread the full text through to per-claim coverage. This
      // reuses the SAME per-sentence + negation-parity discipline as the coverage
      // gate (never a looser bar), so a page that entails nothing stays weak.
      const entail = draftText ? pageEntailsDraftClaims(draftText, fetched.text, nowYear) : { entails: false, excerpt: null, contentHash: null };
      if (entail.entails) {
        s.url = finalUrl;
        s.domain = finalHost;
        s.finalUrl = finalUrl;
        s.authority = "authoritative";
        s.verified = true;
        s.verifiedAt = nowIso;
        // A representative covering span so the persisted (fetchedText-stripped)
        // render path still shows a real ~400-char receipt for this source.
        if (entail.excerpt != null) s.supportingExcerpt = entail.excerpt;
        if (entail.contentHash != null && entail.contentHash !== "") s.contentHash = entail.contentHash;
        s.fetchedText = fetched.text;
      } else {
        s.authority = "weak";
      }
    } else {
      // weak final host, or no supporting span on a non-authoritative page.
      s.authority = "weak";
    }
  }

  const startedAt = Date.now();
  let cursor = 0;
  let deadlineHit = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (cursor >= eligible.length) return;
      const i = eligible[cursor]!;
      cursor += 1;
      if (deadlineHit) {
        prepared[i]!.authority = "weak";
        continue;
      }
      const remainingMs = WHOLE_DRAFT_VERIFY_DEADLINE_MS - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        deadlineHit = true;
        prepared[i]!.authority = "weak";
        continue;
      }
      await verifyOne(i, remainingMs);
    }
  }

  const poolSize = Math.min(SOURCE_VERIFY_CONCURRENCY, eligible.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return { ...v, sources: prepared };
}

/** Content firewalls over every string field of a parsed draft. Same trust rails
 *  as the deterministic drafter: no placeholders, no em-dashes, no superlatives,
 *  and no invented multi-digit numbers (must be grounded - years allowed). R16
 *  upgraded the numeric check to TOKENIZED extraction with formatting tolerance
 *  (5,400 == 5400; percentages match rounded) - strictly MORE permissive, so a
 *  grounded number formatted differently is never a false reject while genuinely
 *  invented stats still fail closed. */
function runContentFirewalls(
  strings: string[],
  ledger: GroundedNumbers,
  // G4 (2026-07-10): when true, the flat marketing-superlative reject is SKIPPED
  // here and handled instead by the verification-aware superlative post-check
  // after source verification (a superlative IS allowed when a qualifying
  // verified source asserts it; an ungrounded one triggers ONE rephrase retry,
  // then fails closed). The drafter passes this for `answer_block` only; every
  // other kind keeps the byte-identical hard reject below.
  opts?: { deferSuperlativeCheck?: boolean },
): { ok: true } | { ok: false; reason: string } {
  const blob = strings.join("  ");
  if (/\[[^\]]*\]|\{\{|TODO|TBD|lorem ipsum/i.test(blob)) return { ok: false, reason: "placeholder" };
  if (blob.includes("—")) return { ok: false, reason: "em_dash" };
  if (!opts?.deferSuperlativeCheck && SUPERLATIVES.test(blob)) return { ok: false, reason: "superlative" };
  const invented = findUngroundedNumbers(blob, ledger);
  if (invented.length > 0) return { ok: false, reason: `invented_numbers:${invented.slice(0, 3).join(",")}` };
  return { ok: true };
}

function defaultComplete(apiKey: string, promptId: PromptId): CompleteFn {
  return async ({ system, user, maxTokens, timeoutMs }) => {
    // R16: the ONE gateway owns the transport (loud fallback logs, error ledger,
    // reasoning timeout floor). Budget stays HERE in caller mode: callStructuredLLM
    // checks the fail-closed cap before calling and records spend per attempt.
    const outcome = await openAIChatCompletion({
      promptId,
      promptVersion: PROMPT_REGISTRY[promptId],
      action: `structured-draft:${promptId}`,
      apiKey,
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // gpt-5-mini reasoning tokens count against this budget — give headroom.
        // No response_format: it returns empty under reasoning; we parse robustly.
        max_completion_tokens: maxTokens,
        reasoning_effort: "low",
      },
      timeoutMs,
      budget: { mode: "caller", note: "checkBudget + recordSpend live in callStructuredLLM" },
    });
    if (outcome.kind === "blocked_budget") return { error: "blocked_budget" };
    if (outcome.kind === "error") return { error: outcome.reason || "fetch_failed" };
    const res = outcome.response;
    if (!res.ok) return { error: `openai_${res.status}` };
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = (json.choices?.[0]?.message?.content ?? "").trim();
      return text ? { text } : { error: "empty_response" };
    } catch (e) {
      return { error: e instanceof Error ? e.message.slice(0, 80) : "fetch_failed" };
    }
  };
}

export type StructuredDraftRequest<K extends StructuredDraftKind> = {
  kind: K;
  /** System prompt — describe the JSON shape + the grounding/safety rules. */
  system: string;
  /** User prompt — the grounded inputs. */
  user: string;
  /** Concatenated grounded text for the numeric-fidelity firewall. */
  grounded: string;
  projectedCostUsd?: number;
  maxTokens?: number;
  timeoutMs?: number;
  now?: Date;
  /** Injected for tests; defaults to the real OpenAI call. */
  complete?: CompleteFn;
  /** BEACON_500 item 74: carried straight onto a "drafted" result's `fewShot` field
   *  when present. The engine does not compute this itself - it only threads through
   *  whatever the concrete drafter (e.g. draftAnswerBlockStructured) already resolved
   *  from winner-memory's pattern aggregate, so the prompt-building and the result
   *  metadata always agree on whether a confident cell was actually used. */
  fewShotProvenance?: FewShotProvenance;
  /** R16: skip the $0 cache-serve and force a fresh paid draft (the explicit
   *  Regenerate action). The fresh result still REPLACES the cached entry. */
  bypassCache?: boolean;
  /** R16 test seam: inject cache behavior. Default: the store-backed call cache
   *  in production, NO cache under vitest (pinned suites stay hermetic). */
  cacheImpl?: CacheImpl;
  /** R16 test seam / caller-supplied history for the de-templating guard. When
   *  absent the guard reads the last cached outputs for this kind. */
  recentOutputs?: string[];
  /** W5 (J-69): this tenant's curated authoritative-domain allowlist
   *  (BusinessProfile.authoritativeSourceDomains), used ONLY to re-stamp any
   *  `sources` field on the validated draft. Omitted = only the universal
   *  .gov/.edu + named encyclopedic/press set applies. */
  authoritativeSourceDomains?: readonly string[];
  /** W5 P0-1 (2026-07-09): injectable source-text fetcher for the
   *  generation-time verification step. Tests inject a hermetic stub; the
   *  default is the polite competitor-intel fetch, and NOTHING under vitest
   *  without injection (no draft with sources ever hits the network in a test
   *  that didn't opt in). */
  sourceFetch?: SourceTextFetcher;
};

/**
 * The engine: cache ($0 repeats) → validate → retry-once → fail-closed. Returns
 * a typed, schema-valid draft or a non-"drafted" status. Never throws.
 */
export async function callStructuredLLM<K extends StructuredDraftKind>(
  req: StructuredDraftRequest<K>,
): Promise<StructuredDraftResult<z.infer<(typeof SCHEMA_BY_KIND)[K]>>> {
  if (!isOn()) return { status: "off" };
  const apiKey = process.env.OPENAI_API_KEY;
  // R16: every structured call carries a registered prompt identity (all kinds
  // are registered as draft.<kind>; the registry test enforces coverage).
  const promptId = `draft.${req.kind}` as PromptId;
  const promptVersion = PROMPT_REGISTRY[promptId];
  const complete = req.complete ?? (apiKey ? defaultComplete(apiKey, promptId) : null);
  if (!complete) return { status: "off" }; // configured "on" but no key → off

  const schemaForCache = SCHEMA_BY_KIND[req.kind] as z.ZodTypeAny;
  const cache = resolveCacheImpl(req.cacheImpl);
  const cacheKey = cache
    ? llmCallCacheKey({ promptId, promptVersion, kind: req.kind, system: req.system, user: req.user })
    : null;

  // R16 call cache: an identical request (same prompt version + prompts) returns
  // the prior VALIDATED output at $0 - before the budget gate, because a hit
  // spends nothing. `bypassCache` (the explicit Regenerate) forces a paid take.
  if (cache && cacheKey && req.bypassCache !== true) {
    const hit = await cache.read(cacheKey).catch(() => null);
    if (hit) {
      const revalidated = schemaForCache.safeParse(hit.value);
      if (revalidated.success) {
        // W5 P2 (2026-07-09): re-stamp authority against THIS request's tenant
        // allowlist on every cache read. The cache key does not include the
        // allowlist, so a cached entry can be served to a different tenant; a
        // stale "authoritative" label must never render under the wrong
        // tenant's allowlist. `verified` and every other field survive
        // (stampSourceAuthority only overwrites `authority`).
        return {
          status: "drafted",
          kind: req.kind,
          value: stampAnySources(revalidated.data, req.authoritativeSourceDomains) as z.infer<(typeof SCHEMA_BY_KIND)[K]>,
          costUsd: 0,
          retried: false,
          cached: true,
          ...(req.fewShotProvenance ? { fewShot: req.fewShotProvenance } : {}),
        };
      }
    }
  }

  const projectedCostUsd = req.projectedCostUsd ?? 0.02;
  // B82: fail CLOSED on an unknown budget (Supabase down / tenant-ctx error) — a
  // paid LLM call must NOT fire when spend can't be verified (matches the DataForSEO
  // + adjudicator caps; was fail-OPEN `allowed: true`, risking uncapped spend).
  const budget = await checkBudget({ projectedCostUsd }).catch(() => ({ allowed: false as const, reason: "budget check unavailable — failing closed" }));
  if (budget.allowed === false) {
    return { status: "blocked_budget", reason: (budget as { reason?: string }).reason ?? "cap reached" };
  }

  const schema = SCHEMA_BY_KIND[req.kind] as z.ZodTypeAny;
  const nowYear = (req.now ?? new Date()).getFullYear();
  const maxTokens = req.maxTokens ?? 6000;
  const timeoutMs = req.timeoutMs ?? 60_000;
  const ledger = buildRequestLedger(req.grounded, nowYear);
  // R16 de-templating history: the last cached same-family outputs (or the
  // injected list). Empty history keeps the guard dormant.
  const recentTexts =
    req.recentOutputs ?? (cache ? await cache.recentTexts(req.kind, REPEAT_HISTORY_SIZE).catch(() => []) : []);

  // W5 P0-1: the generation-time source verifier (null under vitest unless a
  // hermetic fetcher is injected) + a per-request URL cache so the same source
  // cited on both attempts is fetched once.
  const sourceFetch = resolveSourceFetch(req.sourceFetch, timeoutMs);
  const sourceTextCache = new Map<string, Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>>();
  const verifyNowIso = (req.now ?? new Date()).toISOString();

  let totalCost = 0;
  const errors: string[] = [];
  let lastFailureWasTemplated = false;
  let lastFailureWasThin = false;
  let lastFailureWasSuperlative = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retried = attempt > 0;
    let system = req.system;
    if (retried) {
      if (lastFailureWasSuperlative && lastFailureWasThin) {
        // Pilot loop 5 (2026-07-11): attempt 1 failed BOTH the word-count floor
        // and the superlative check at once - one combined instruction, not
        // whichever single-issue instruction would otherwise win below (this
        // branch must be checked BEFORE the plain superlative/thin branches).
        system = `${req.system}\n\n${COMBINED_THIN_AND_SUPERLATIVE_RETRY_INSTRUCTION}`;
      } else if (lastFailureWasSuperlative) {
        // G4 (2026-07-10): the first draft asserted a superlative no cited source
        // proves. Retry with an explicit REPHRASE instruction (ground it in
        // specific facts) rather than a blanket "invalid output" correction - a
        // superlative-intent topic ("most famous X") must still be answerable.
        system = `${req.system}\n\n${SUPERLATIVE_REPHRASE_INSTRUCTION}`;
      } else if (lastFailureWasTemplated) {
        // R16 de-templating: the first draft read like a repeat - retry with a
        // variation instruction rather than an "invalid output" correction.
        system = `${req.system}\n\n${VARIATION_INSTRUCTION}`;
      } else if (lastFailureWasThin) {
        // W5 (J-71): the first answer was under the 80-word floor - retry asking
        // for the full band rather than an "invalid output" correction.
        // Pilot loop 4 (2026-07-10): a live re-run showed the model can lengthen a
        // too-thin answer by adding a FRESH ungrounded superlative ("a leading
        // classical vocalist") instead of more grounded facts - the same loophole
        // SUPERLATIVE_REPHRASE_INSTRUCTION already closes for a superlative-
        // triggered retry, but this retry reason never carried that reminder. State
        // it here too, so lengthening never trades away groundedness.
        // Pilot loop 6 (2026-07-11): also closes with NO_NEW_NUMBERS_RETRY_REMINDER
        // so lengthening never trades away groundedness for an invented number
        // either - the same reminder every other rephrase-class retry carries.
        system = `${req.system}\n\nYour previous answer was too short. Write a complete answer of 80 to 150 words, grounded ONLY in the evidence provided. Add the missing length with MORE grounded facts (names, dates, honors, works) - do NOT introduce a new superlative or ranking claim while lengthening it. ${NO_NEW_NUMBERS_RETRY_REMINDER}`;
      } else {
        system = `${req.system}\n\nYour previous output was invalid: ${errors.slice(-3).join(" | ")}. Return ONLY valid JSON matching the described shape, with non-empty evidenceRefs.`;
        // R16 numeric repair: when the failure was an ungrounded number, inject
        // the CORRECT grounded numbers so the retry can fix the figure instead
        // of guessing again. One repair retry, then fail closed.
        if (errors.some((e) => e.startsWith("firewall:invented_numbers"))) {
          const nums = groundedNumberList(ledger);
          system +=
            nums.length > 0
              ? ` The evidence contains ONLY these numbers: ${nums.join(", ")}. Cite numbers exactly from this list, or write without numbers.`
              : " The evidence contains no citable numbers. Write without numbers.";
        }
      }
    }

    // The retry-instruction flags above have now been consumed for this attempt;
    // clear them so any failure below re-sets only the reason that actually
    // applies (the explicit resets on each failure path stay as documentation).
    lastFailureWasSuperlative = false;
    lastFailureWasTemplated = false;
    lastFailureWasThin = false;

    const out = await complete({ system, user: req.user, maxTokens, timeoutMs });
    if ("error" in out) {
      errors.push(`llm_${out.error}`);
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }
    totalCost += estimateCostUsd(system.length + req.user.length, out.text.length);
    await recordSpend(estimateCostUsd(system.length + req.user.length, out.text.length), {}).catch(() => {});

    const parsedJson = robustJsonExtract(out.text);
    if (parsedJson === undefined) {
      errors.push("non_json");
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }
    const parsed = schema.safeParse(sanitizeDashesDeep(parsedJson));
    if (!parsed.success) {
      errors.push(...parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }
    // W5 (J-69): the LLM may PROPOSE sources, but only source-authority.ts
    // decides `authority`, re-stamp before any firewall/cache/return step.
    const result = { ...parsed, data: stampAnySources(parsed.data, req.authoritativeSourceDomains) as typeof parsed.data };
    const fw = runContentFirewalls(draftProseStringValues(result.data), ledger, {
      deferSuperlativeCheck: req.kind === "answer_block",
    });
    if (!fw.ok) {
      errors.push(`firewall:${fw.reason}`);
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }

    // R16 de-templating guard: a validated draft whose customer-facing text is a
    // near-copy (>70 percent 3-gram overlap) of a recent same-family output gets
    // ONE variation retry; a second near-copy ships FLAGGED ("reads like a
    // repeat") for the draft-quality gate to demote - style never fails closed.
    const primary = primaryCustomerText(req.kind, result.data);
    const templated = primary != null && looksTemplated(primary, recentTexts);
    if (templated && !retried) {
      errors.push("templated");
      lastFailureWasTemplated = true;
      lastFailureWasThin = false;
      continue;
    }

    // W5 P2 (J-71): an answer block under the 80-word floor is flagged here.
    // Pilot loop 5 (2026-07-11): verification (needed for the superlative check
    // right below) now runs BEFORE this decision is acted on, so a draft that is
    // BOTH too thin AND carrying an ungrounded superlative gets BOTH problems
    // diagnosed on the SAME attempt - previously this check's own `continue`
    // skipped verification entirely, silently hiding a co-occurring superlative
    // problem from the retry (the retry only ever named ONE of the two issues,
    // whichever check happened to run first, and the run could die on attempt 2
    // still carrying the other).
    const thinAnswer = req.kind === "answer_block" && primary != null && countWords(primary) < ANSWER_MIN_WORDS;

    // W5 stop-ship F2: verify each cited source AT GENERATION TIME (SSRF-safe
    // fetch + span-level entailment + final-host authority) AFTER the firewalls,
    // so the added verification metadata never enters the numeric firewall. When
    // no verifier is configured (vitest without injection), STRIP every
    // verification field so an LLM-supplied `verified: true` can never survive.
    const verifiedData = sourceFetch
      ? ((await verifyStampedSources(
          result.data,
          sourceFetch,
          sourceTextCache,
          verifyNowIso,
          nowYear,
          req.authoritativeSourceDomains,
          primary,
        )) as z.infer<(typeof SCHEMA_BY_KIND)[K]>)
      : (stripSourceVerificationFields(result.data) as z.infer<(typeof SCHEMA_BY_KIND)[K]>);

    // G4 (2026-07-10): SUPERLATIVE post-check, verification-aware (runs on
    // `answer_block` only; every other kind's marketing-superlative reject stays
    // in runContentFirewalls above). A superlative is allowed ONLY when a
    // QUALIFYING verified source asserts it (superlative-parity); an ungrounded
    // one is not shipped.
    const ungroundedSuperlative =
      req.kind === "answer_block" && primary != null
        ? ungroundedSuperlatives(primary, (verifiedData as { sources?: ClassifiableSource[] }).sources, req.authoritativeSourceDomains, nowYear)
        : [];
    const hasUngroundedSuperlative = ungroundedSuperlative.length > 0;

    if (thinAnswer) errors.push("too_thin_answer");
    if (hasUngroundedSuperlative) errors.push(`superlative_ungrounded:${ungroundedSuperlative.slice(0, 3).join(",")}`);

    // A superlative is the highest-risk claim, so it ALWAYS forces a continue
    // (one rephrase retry, then fail closed) on either attempt - never shipped
    // ungrounded, unchanged from before. Pilot loop 5: when the SAME draft is
    // ALSO too thin, flag both reasons together so the retry-instruction
    // builder above merges them into ONE combined instruction instead of only
    // addressing the superlative.
    if (hasUngroundedSuperlative) {
      if (!retried) {
        lastFailureWasSuperlative = true;
        lastFailureWasThin = thinAnswer;
        continue; // rephrase retry (combined with the length instruction when also too thin)
      }
      continue; // second attempt still ungrounded -> fall through to fail-closed
    }

    // W5 P2 (J-71): a too-thin-only draft (no superlative problem) gets ONE
    // word-count retry so the drafter never caches a too-thin answer the
    // quality gate would only reject later. A style-class retry, never a
    // fail-closed: if the second attempt is still short it ships as-is for the
    // gate to hold as too_thin (redrafting endlessly would just burn budget) -
    // unchanged single-error behavior.
    if (thinAnswer && !retried) {
      lastFailureWasThin = true;
      continue;
    }

    const drafted = {
      status: "drafted" as const,
      kind: req.kind,
      value: verifiedData,
      costUsd: totalCost,
      retried,
      ...(req.fewShotProvenance ? { fewShot: req.fewShotProvenance } : {}),
      ...(templated ? { repeatFlag: REPEAT_FLAG } : {}),
    };
    if (cache && cacheKey) {
      const nowIso = (req.now ?? new Date()).toISOString();
      await cache
        .write({
          key: cacheKey,
          kind: req.kind,
          promptId,
          promptVersion,
          value: verifiedData,
          primaryText: primary,
          createdAt: nowIso,
          lastUsedAt: nowIso,
        })
        .catch(() => {});
    }
    return drafted;
  }

  log.warn("[structured-drafter] fail-closed", { kind: req.kind, errors: errors.slice(0, 6) });
  return { status: "validation_failed", reason: errors[0] ?? "unknown", errors, costUsd: totalCost, retried: true };
}

// ── intent-aware drafting (C) ─────────────────────────────────────────────────
// The searcher's dominant intent decides the ANSWER TYPE. A "when" query must be answered with a
// date, not a definition (the chaharshanbe failure). This directive is injected into the prompt so
// the LLM writes the right kind of answer. Intent strings mirror answer-intent.ts (kept as a loose
// string to avoid an llm -> experiments domain import). Empty string when unknown = no constraint.
export function intentDirective(intent?: string): string {
  switch (intent) {
    case "when": return "The searcher wants a DATE or timeline. Lead with the specific date or schedule, never a definition.";
    case "cost": return "The searcher wants a PRICE or number. Lead with the concrete cost or range, never a definition.";
    case "how": return "The searcher wants STEPS or a method. Lead with the concrete how-to, not background.";
    case "where": return "The searcher wants a PLACE or location. Lead with where it is, not a definition.";
    case "who": return "The searcher wants a PERSON or people. Lead with who, not a definition.";
    case "list": return "The searcher wants a LIST or examples. Lead with the concrete items.";
    case "compare": return "The searcher wants a COMPARISON. Lead with the key difference.";
    case "what": return "The searcher wants to know what this is. Open by clearly stating what this specific topic is.";
    default: return "";
  }
}

// ── concrete drafter: AnswerBlockDraft (the Sprint 2A debug/manual path) ──────

export type AnswerBlockStructuredInput = {
  query: string;
  pageLabel: string;
  brief: string | null;
  outline: string[];
  faqs: string[];
  /** Plain-language evidence the team already established (for the LLM to cite). */
  evidenceHints?: string[];
  /** The searcher's dominant intent (when/cost/how/where/who/list/compare/what) — decides answer type. */
  intent?: string;
  /** BEACON_500 item 30: tenant id, used ONLY to look up this tenant's own measured
   *  winners for the few-shot injection below. Optional - omitting it just means no
   *  few-shot examples are added (prompt unchanged), never an error. */
  tenantId?: string;
  /** BEACON_500 item 74: the page's family (first path segment, e.g. "iran-animals"),
   *  used ONLY to look up a CONFIDENT winning pattern for this family in winner-memory's
   *  pattern aggregate. Optional - omitting it (or having no confident cell yet) leaves
   *  the prompt byte-identical to the item-30 few-shot behavior, never an error. */
  pageFamily?: string;
  /** Pilot loop 4 (2026-07-10): known reference URLs for the entities this
   *  topic names (e.g. the tenant's own AI-citation table for this cluster, or
   *  the page's own outbound links), cheap to include - NO new fetch happens
   *  here or at prompt time. Rendered as "sources you may cite" ONLY after a
   *  bare list/index URL is filtered out (looksLikeListOrIndexUrl) and the
   *  list is deduped + capped; empty/all-filtered input renders nothing, the
   *  system-prompt guidance below still applies on its own. Never trusted as
   *  verified - the existing generation-time source-verification step (W5
   *  P0-1) still fetches + checks whatever the model actually cites. */
  referenceCandidates?: string[];
};

const ANSWER_BLOCK_SYSTEM =
  "You write structured AEO answer blocks for an encyclopedia / content site. Return ONLY a JSON object with keys: " +
  // W5 (2026-07-09, J-71): 80-150 words WITH sources - "40-60 is too thin" per the
  // operator's own spec. Bumped from the old 40-60 word target (prompt-registry.ts
  // version bumped alongside this so the content-hash call cache never serves a
  // stale 40-60-word response for the new contract).
  '"answer" (one direct factual answer of 80-150 words an AI assistant could quote verbatim), ' +
  '"citationHook" (a short quotable phrase, or null), ' +
  '"sources" (array of {"url","title","domain","retrievedAt","claim","authority"}: cite 1-2 AUTHORITATIVE sources for the answer\'s claims, each with a real URL, its domain, the date you are citing it, and the specific claim it backs; leave "authority" as "unverified", the caller decides it), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one, citing ONLY the grounding provided; source one of gsc|ga4|clarity|profound|dataforseo|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground everything ONLY in the brief/outline/questions provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes. Cite 1-2 authoritative sources for any factual claim (a date, a count, a named fact). Never state one with no source. " +
  // G4 (2026-07-10): superlative-intent topics ("most famous X") must still be
  // answerable WITHOUT an unprovable superlative. Instruct grounding-by-facts up
  // front, so the drafter usually clears the verification-aware post-check on the
  // first attempt (the rephrase retry is the safety net, not the norm).
  "If the topic is inherently superlative (a \"most famous\" or \"best\" roundup), do NOT assert a superlative you cannot cite; instead ground it in the specific honors, dates, works, and roles in the evidence (for example \"a defining voice in classical Persian music, awarded the UNESCO Mozart Medal\" rather than \"the most celebrated singer\"). Only use a superlative if a cited source explicitly states that exact superlative. " +
  // Pilot loop 4 (2026-07-10): the model was choosing correctly-authoritative
  // domains but the WRONG PAGE on that domain (a shared list/index page) to back
  // a specific person's fact. When the user message below includes a "Sources
  // you may cite" list or this tenant's allowlisted domains, use them as a
  // starting point ONLY when the exact page actually supports the claim - never
  // cite a page just because it is on an allowlisted domain or was suggested.
  "When the evidence below includes a \"Sources you may cite\" list or a tenant's allowlisted domains, prefer a citation from among them, but ONLY when that exact page genuinely supports the specific claim you are citing it for; never fabricate a URL and never cite a page that does not actually discuss the claim. " +
  "The FIRST sentence must be specific to THIS exact page/topic — name the concrete subject, not a generic category. Do NOT open with a context-free dictionary definition (e.g. \"A gift is a voluntarily transferred item…\"); a reader must immediately know which specific topic this answers. Never defer or punt (\"varies\", \"check elsewhere\", \"consult other sources\") — answer directly. Do not claim something is \"official\" unless the grounding states it.";

/**
 * Pilot loop 4 (2026-07-10): appended to ANSWER_BLOCK_SYSTEM ONLY for an
 * entity-rich topic (isEntityRichTopic - a roundup naming 3+ distinct named
 * entities, e.g. "famous Iranian singers"). Proven gap from the pilot re-run:
 * the model correctly cited an authoritative, on-topic page (Wikipedia's
 * List_of_Iranian_singers) but that page is a bare INDEX - it names each
 * singer without discussing their honors/songs, so it cannot entail any
 * per-singer claim, while that SAME singer's own Wikipedia article covered 3
 * of 6 sentences in a live replay. This instructs the model to reach for the
 * entity's own page in the first place, so per-claim coverage (source-
 * authority.ts's draftFactsCoveredBySources) has something that actually
 * entails the sentence instead of holding the whole roundup at
 * needs_source_check for a structural, avoidable reason. */
const ENTITY_REFERENCE_INSTRUCTION =
  " This topic names several different people, places, or things (a roundup). For EACH named " +
  "entity's own factual claim (an honor, a song, a role, a date, a work), cite that ENTITY'S OWN " +
  "reference page (their own encyclopedia article, e.g. en.wikipedia.org/wiki/<Entity_Name>) - " +
  'never a bare list or index page (for example a page titled or path-shaped like "List of ...") ' +
  "for that claim. A list/index page can confirm an entity EXISTS or belongs to a group, but it " +
  "cannot back a specific fact ABOUT that entity. One citation may cover more than one claim only " +
  "when that exact page's own text genuinely discusses those claims, not merely lists the name.";

/**
 * Pilot loop 5 (2026-07-11): appended alongside ENTITY_REFERENCE_INSTRUCTION for
 * the same entity-rich roundup topics. Proven gap from loop 4's live re-run: the
 * model correctly cited each entity's own reference page, but still wrote
 * COMPOUND sentences that bundle a coverable fact (an honor a fetched source
 * confirms) with an uncoverable one (a song title that source never mentions) -
 * e.g. "Shajarian is known for the song 'Morgh-e Sahar' and a UNESCO Mozart
 * Medal." The per-sentence coverage gate (source-authority.ts's
 * draftFactsCoveredBySources) correctly fails the WHOLE sentence when only HALF
 * of it is grounded, so a single stray fact drags down an otherwise-covered
 * claim. This instructs the model to never bundle in the first place - one
 * fact per sentence, so every sentence stands or falls on its OWN citation
 * rather than being held hostage by its neighbor's uncovered claim. */
const ONE_FACT_PER_SENTENCE_INSTRUCTION =
  " For this roundup, state each distinct factual claim about a named entity in its OWN short " +
  "sentence - one honor, one work, one role, or one date per sentence - because each sentence must " +
  "be verifiable against its cited source ON ITS OWN. Never bundle two different facts about the " +
  'same entity into one clause or sentence (for example do NOT write "Shajarian is known for the ' +
  'song \'Morgh-e Sahar\' and a UNESCO Mozart Medal" as one sentence - write two separate sentences, ' +
  "one for the song, one for the medal). If a single sentence would need more than one source to " +
  "prove it, split it into separate sentences instead. To reach the required 80-150 word length, " +
  "add MORE single-fact sentences about the entities already named - never write longer compound " +
  "sentences.";

/** Pilot loop 4: how many "sources you may cite" candidates ever reach the
 *  prompt - a hint, not a citation list; more than a handful would just bury
 *  the model in URLs it still has to individually verify are relevant. */
const MAX_REFERENCE_CANDIDATES = 5;

/** Draft a schema-valid AnswerBlockDraft for one Move. Capped + budgeted. */
export async function draftAnswerBlockStructured(
  input: AnswerBlockStructuredInput,
  opts: {
    complete?: CompleteFn;
    now?: Date;
    bypassCache?: boolean;
    authoritativeSourceDomains?: readonly string[];
    sourceFetch?: SourceTextFetcher;
  } = {},
): Promise<StructuredDraftResult<AnswerBlockDraft>> {
  // R16 injection firewall: crawled briefs/outlines, PAA questions, and evidence
  // hints are untrusted text - strip instruction-shaped lines before they enter
  // the prompt or the grounding ledger. Benign input passes through unchanged.
  const brief = sanitizeNullableEvidence(input.brief);
  const outline = sanitizeEvidenceTexts(input.outline);
  const faqs = sanitizeEvidenceTexts(input.faqs);
  const evidenceHints = sanitizeEvidenceTexts(input.evidenceHints ?? []);
  const grounded = [
    input.query,
    brief ?? "",
    outline.join(" "),
    faqs.join(" "),
    evidenceHints.join(" "),
  ].join(" ");
  const dir = intentDirective(input.intent);

  // Pilot loop 4: known reference URLs for the entities this topic names -
  // deterministic, no new fetch. A bare list/index URL (the exact proven gap:
  // the model citing "List_of_Iranian_singers" for one singer's facts) is
  // filtered out here BEFORE it ever reaches the prompt, so the hint can only
  // ever point at a page that could plausibly entail a per-entity claim.
  // Deduped + capped; empty (or fully filtered) input renders no hint line at
  // all - the ANSWER_BLOCK_SYSTEM guidance above still applies on its own.
  const referenceCandidates = [
    ...new Set(sanitizeEvidenceTexts(input.referenceCandidates ?? []).filter((u) => !looksLikeListOrIndexUrl(u))),
  ].slice(0, MAX_REFERENCE_CANDIDATES);

  const user = [
    `Search/topic: "${input.query}"`,
    dir ? `What the searcher wants: ${dir}` : "",
    `Page: ${input.pageLabel}`,
    brief ? `Brief: ${brief}` : "",
    outline.length ? `Grounded sections: ${outline.join("; ")}` : "",
    faqs.length ? `Related questions: ${faqs.slice(0, 6).join("; ")}` : "",
    evidenceHints.length ? `Evidence the team established: ${evidenceHints.join("; ")}` : "",
    referenceCandidates.length
      ? `Sources you may cite (each entity's own reference page - verify the exact page covers the specific claim before citing it): ${referenceCandidates.join("; ")}`
      : "",
    opts.authoritativeSourceDomains?.length
      ? `This tenant's allowlisted authoritative domains (prefer a citation from one of these when a relevant page exists there, but only if it actually covers the claim): ${opts.authoritativeSourceDomains.join(", ")}`
      : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  // BEACON_500 item 30/74: additive-only. When a pageFamily is known, use the pattern-
  // aware builder (item 74) so a CONFIDENT winning structural pattern for this family
  // gets named alongside the existing before/after examples; otherwise fall back to the
  // item-30 builder unchanged. Both return '' (or the unchanged fragment) when the
  // tenant has no measured "answer" winners yet - the system prompt stays byte-identical
  // to today whenever there is nothing confident to say.
  let fewShots = "";
  let fewShotProvenance: FewShotProvenance | undefined;
  if (input.tenantId && input.pageFamily) {
    const res = await buildWinnerFewShotsWithPattern(input.tenantId, "answer", input.pageFamily).catch(() => ({ fragment: "", patternHint: null }));
    fewShots = res.fragment;
    fewShotProvenance = fewShotProvenanceFrom(res.patternHint, input.pageFamily);
  } else if (input.tenantId) {
    fewShots = await buildWinnerFewShots(input.tenantId, "answer").catch(() => "");
  }

  // Pilot loop 4: the per-entity citation guidance is scoped to a genuine
  // roundup (isEntityRichTopic - 3+ distinct named entities across the query/
  // brief/outline/faqs/evidence hints), so a single-fact topic's prompt stays
  // byte-identical to before this change. Each field is passed SEPARATELY
  // (never pre-joined into `grounded`) so one entity's name can never merge
  // with the next into a single false span - see isEntityRichTopic.
  const entityRich = isEntityRichTopic([input.query, brief ?? "", ...outline, ...faqs, ...evidenceHints]);

  return callStructuredLLM({
    kind: "answer_block",
    system: ANSWER_BLOCK_SYSTEM + (entityRich ? ENTITY_REFERENCE_INSTRUCTION + ONE_FACT_PER_SENTENCE_INSTRUCTION : "") + fewShots,
    user,
    grounded,
    projectedCostUsd: 0.02,
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
    fewShotProvenance,
    authoritativeSourceDomains: opts.authoritativeSourceDomains,
    sourceFetch: opts.sourceFetch,
  });
}

// ── concrete drafter: AtomicEditDraft (existing-page title/meta edit) ──────────

export type AtomicEditStructuredInput = {
  query: string;
  pageLabel: string;
  field: "title" | "meta";
  currentValue: string | null;
  outline: string[];
  evidenceHints?: string[];
  /** The searcher's dominant intent (when/cost/how/where/who/list/compare/what) — shapes the copy. */
  intent?: string;
  /** BEACON_500 item 30: tenant id, used ONLY to look up this tenant's own measured
   *  winners (same field/lever) for the few-shot injection below. Optional - omitting
   *  it just means no few-shot examples are added (prompt unchanged), never an error. */
  tenantId?: string;
  /** BEACON_500 item 74: the page's family (first path segment), used ONLY to look up
   *  a CONFIDENT winning pattern for this family. Optional - omitting it (or having no
   *  confident cell yet) leaves the prompt byte-identical, never an error. */
  pageFamily?: string;
};

const ATOMIC_EDIT_SYSTEM =
  "You improve ONE on-page field (a page title or meta description) for an encyclopedia / content site to better match the search intent and earn the click. " +
  'Return ONLY a JSON object: "field" (the field being edited), "before" (the exact current value, or null), "after" (the improved value), ' +
  '"rationale" (one sentence), "evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|profound|dataforseo|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Keep a title under ~60 characters and a meta description 120-160. Ground ONLY in what is provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes.";

/** Draft a schema-valid AtomicEditDraft (title/meta) for one existing-page Move. */
export async function draftAtomicEditStructured(
  input: AtomicEditStructuredInput,
  opts: {
    complete?: CompleteFn;
    now?: Date;
    bypassCache?: boolean;
    authoritativeSourceDomains?: readonly string[];
    sourceFetch?: SourceTextFetcher;
  } = {},
): Promise<StructuredDraftResult<AtomicEditDraft>> {
  // R16 injection firewall (see draftAnswerBlockStructured).
  const currentValue = sanitizeNullableEvidence(input.currentValue);
  const outline = sanitizeEvidenceTexts(input.outline);
  const evidenceHints = sanitizeEvidenceTexts(input.evidenceHints ?? []);
  const grounded = [
    input.query,
    currentValue ?? "",
    outline.join(" "),
    evidenceHints.join(" "),
  ].join(" ");
  const dir = intentDirective(input.intent);
  const user = [
    `Search/topic: "${input.query}"`,
    dir ? `What the searcher wants: ${dir}` : "",
    `Page: ${input.pageLabel}`,
    `Field to edit: ${input.field}`,
    currentValue ? `Current ${input.field}: ${currentValue}` : `Current ${input.field}: (none/empty)`,
    outline.length ? `Page covers: ${outline.slice(0, 8).join("; ")}` : "",
    evidenceHints.length ? `Evidence the team established: ${evidenceHints.join("; ")}` : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  // BEACON_500 item 30/74: additive-only, same posture as draftAnswerBlockStructured
  // above - the pattern-aware builder only fires when a pageFamily is known, and both
  // paths return '' (or the unchanged fragment) when the tenant has no measured winners
  // yet for this exact field, leaving the prompt byte-identical to today.
  const lever = input.field === "title" ? "title" : "meta";
  let fewShots = "";
  let fewShotProvenance: FewShotProvenance | undefined;
  if (input.tenantId && input.pageFamily) {
    const res = await buildWinnerFewShotsWithPattern(input.tenantId, lever, input.pageFamily).catch(() => ({ fragment: "", patternHint: null }));
    fewShots = res.fragment;
    fewShotProvenance = fewShotProvenanceFrom(res.patternHint, input.pageFamily);
  } else if (input.tenantId) {
    fewShots = await buildWinnerFewShots(input.tenantId, lever).catch(() => "");
  }

  const result = await callStructuredLLM({
    kind: "atomic_edit",
    system: ATOMIC_EDIT_SYSTEM + fewShots,
    user,
    grounded,
    projectedCostUsd: 0.02,
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
    fewShotProvenance,
    authoritativeSourceDomains: opts.authoritativeSourceDomains,
    sourceFetch: opts.sourceFetch,
  });

  // BEACON_500 item 74: the atomic-edit rationale is the ONE free-text channel that
  // already flows end-to-end into the daily card's "Beacon wrote this: <rationale>"
  // line (build-today-preview.ts reads value.rationale into llmRationale). When a
  // confident pattern backed this draft, prepend our exact controlled sentence so the
  // card surfaces it without any change to that unrelated wiring - the model's own
  // rationale sentence is kept right after it, never replaced.
  if (result.status === "drafted" && result.fewShot) {
    // Re-apply the schema's own 400-char rationale cap so this stays a VALID
    // AtomicEditDraft (deserializeStructuredDraft re-validates on every read).
    const merged = `${result.fewShot.sentence} ${result.value.rationale}`.trim().slice(0, 400);
    return { ...result, value: { ...result.value, rationale: merged } };
  }
  return result;
}

// ── concrete drafter: CreatePageBrief (a brand-new page) ──────────────────────

export type CreatePageStructuredInput = {
  /** The topic / demand cluster the new page targets. */
  query: string;
  /** Suggested slug or label for the page. */
  pageLabel: string;
  /** Competitor pages AI/Google cite for this topic (to study + beat). */
  competitorPages: string[];
  /** Fan-out sub-questions / grounded section seeds. */
  fanoutQueries: string[];
  /** Evidence the team established (GSC demand, profound prompt, etc.). */
  evidenceHints?: string[];
  /** Exact cached pages Beacon already found while researching this topic. The
   * model may cite only a page that supports its claim; the existing fetch and
   * entailment boundary still decides whether it is verified. */
  referenceCandidates?: string[];
};

const CREATE_PAGE_SYSTEM =
  "You write the BRIEF for a brand-new encyclopedia / content page so an editor can build it. " +
  'Return ONLY a JSON object: "proposedTitle" (<=70 chars, concise + descriptive, no boilerplate/year-stuffing), ' +
  '"metaDescription" (120-160 chars, page-specific, no overpromising), "openingAnswer" (a 40-80 word direct, extractable answer), ' +
  '"outline" (3-16 H2 section headings, specific to the topic), "faqQuestions" (real questions a reader asks, from the grounding), ' +
  '"schemaTypes" (relevant schema.org types, e.g. Article, FAQPage — only if warranted), ' +
  '"sources" (array of 1-2 {"url","title","domain","retrievedAt","claim","authority"} authoritative sources backing factual opening claims; use a real exact URL from the provided candidates when it supports the claim, leave authority "unverified" for the caller), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|profound|dataforseo|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (concrete build steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground ONLY in what is provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes. " +
  "The openingAnswer's first sentence must name THIS specific topic (not a generic category) — no context-free dictionary definitions. Title must avoid boilerplate like \"(YYYY Guide)\" or \"Complete/Ultimate Guide\". Use the provided sub-questions to shape the outline and FAQ. " +
  // Broad culture/history/topic tuning (2026-06-29): the #1 reason these briefs were
  // rejected is an INVENTED count the firewall can't verify. State scope qualitatively.
  "CRITICAL for broad culture/history topics: do NOT state any numeric count or quantity — no \"N provinces / ethnic groups / dynasties\", no \"over X years\", no \"thousands of\" — unless that exact figure is in the grounding; instead describe the SCOPE and name the concrete sub-topics qualitatively (e.g. \"spans cuisine, music, poetry, and festivals\"). Open by naming the subject and what the page covers, never \"<X> is a …\" dictionary phrasing.";

/** Draft a schema-valid CreatePageBrief for one create_page / hub Move. */
export async function draftCreatePageStructured(
  input: CreatePageStructuredInput,
  opts: {
    complete?: CompleteFn;
    now?: Date;
    bypassCache?: boolean;
    authoritativeSourceDomains?: readonly string[];
    sourceFetch?: SourceTextFetcher;
  } = {},
): Promise<StructuredDraftResult<CreatePageBrief>> {
  // R16 injection firewall: competitor pages + fan-out questions are untrusted.
  const competitorPages = sanitizeEvidenceTexts(input.competitorPages);
  const fanoutQueries = sanitizeEvidenceTexts(input.fanoutQueries);
  const evidenceHints = sanitizeEvidenceTexts(input.evidenceHints ?? []);
  const referenceCandidates = [
    ...new Set(sanitizeEvidenceTexts(input.referenceCandidates ?? []).filter((url) => !looksLikeListOrIndexUrl(url))),
  ].slice(0, MAX_REFERENCE_CANDIDATES);
  const grounded = [
    input.query,
    competitorPages.join(" "),
    fanoutQueries.join(" "),
    evidenceHints.join(" "),
    referenceCandidates.join(" "),
  ].join(" ");
  const user = [
    `New-page topic: "${input.query}"`,
    `Working label/slug: ${input.pageLabel}`,
    fanoutQueries.length ? `Sub-questions AI is asked: ${fanoutQueries.slice(0, 10).join("; ")}` : "",
    competitorPages.length ? `Competitor pages cited now (study + beat): ${competitorPages.slice(0, 6).join("; ")}` : "",
    evidenceHints.length ? `Evidence the team established: ${evidenceHints.join("; ")}` : "",
    referenceCandidates.length
      ? `Exact source pages already found during research (cite only when the page supports the specific claim): ${referenceCandidates.join("; ")}`
      : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  return callStructuredLLM({
    kind: "create_page_brief",
    system: CREATE_PAGE_SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.03,
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
    authoritativeSourceDomains: opts.authoritativeSourceDomains,
    sourceFetch: opts.sourceFetch,
  });
}

// ── concrete drafter: CROFixSpec (fix_experience / Clarity friction) ──────────

export type CROFixStructuredInput = {
  /** The page with friction. */
  pageLabel: string;
  /** Clarity friction score / detail the team established (grounding). */
  frictionDetail: string;
  /** Optional dominant friction signal hint (dead/rage/quickback) if known. */
  frictionHint?: string;
};

const CRO_FIX_SYSTEM =
  "You diagnose ONE on-page UX/conversion friction and prescribe a concrete fix for a content/encyclopedia site. " +
  'Return ONLY a JSON object: "frictionType" (one of dead_click|rage_click|cta_clarity|form_friction|intent_mismatch), ' +
  '"location" (where on the page — be specific), "fix" (a concrete, actionable change — what to inspect and change, not vague advice), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|profound|dataforseo|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (concrete steps to inspect + fix), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground ONLY in the friction evidence provided — do NOT assert a cause you cannot see in the data (no fake certainty). Prefer a checklist of elements to inspect over prose. No marketing language. No em-dashes. Do NOT invent statistics.";

/** Draft a schema-valid CROFixSpec for one fix_experience Move from Clarity friction. */
export async function draftCROFixStructured(
  input: CROFixStructuredInput,
  opts: { complete?: CompleteFn; now?: Date; bypassCache?: boolean } = {},
): Promise<StructuredDraftResult<import("./schemas").CROFixSpec>> {
  // R16 injection firewall: friction detail can carry crawled page text.
  const frictionDetail = sanitizeEvidenceText(input.frictionDetail);
  const frictionHint = sanitizeNullableEvidence(input.frictionHint ?? null);
  const grounded = [input.pageLabel, frictionDetail, frictionHint ?? ""].join(" ");
  const user = [
    `Page: ${input.pageLabel}`,
    `Friction the team measured: ${frictionDetail}`,
    frictionHint ? `Dominant signal: ${frictionHint}` : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");
  return callStructuredLLM({
    kind: "cro_fix",
    system: CRO_FIX_SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.02,
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
  });
}

// ── concrete drafter: AeoPromptBrief (Profound Question Intelligence) ──────────

export type AeoPromptBriefInput = {
  /** The verbatim AI prompt to win. */
  prompt: string;
  /** Downstream fan-out queries the prompt expands into (grounding). */
  fanoutQueries: string[];
  /** Competitor pages/domains AI cites now (to study + beat). */
  competitorPages: string[];
  /** Owned pages already cited (expand vs create). */
  ownCitedUrls: string[];
  /** Recommended move from the opportunity (answer_block | expand_page | …). */
  recommendedMove: string;
  /** Profound theme tags / entities seen (grounding). */
  tags?: string[];
};

const AEO_PROMPT_BRIEF_SYSTEM =
  "You write a STRUCTURED brief (never a vague summary) for an encyclopedia / content site to WIN one specific AI-assistant question (AEO). " +
  "Return ONLY a JSON object with keys: " +
  '"direct_answer_40_80_words" (one quotable, self-contained factual answer of 40-80 words an AI could lift verbatim), ' +
  '"fanout_sections" (array of {"question","answer_goal"} — one per sub-question the page must also answer, from the fan-out queries provided), ' +
  '"facts_to_verify" (array of specific facts the owner must confirm before publishing — do NOT assert them as true), ' +
  '"entities_to_include" (array of named people/places/works to mention), ' +
  '"sources_to_reference" (array of authoritative source types/names to cite), ' +
  '"competitor_pages_to_beat" (array — the cited competitor pages/domains provided), ' +
  '"schema_recommendation" ("FAQPage"|"Article"|"ItemList"|"None"), ' +
  '"internal_links" (array of on-site link suggestions, or []), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one; source one of gsc|ga4|clarity|profound|dataforseo|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps). ' +
  "Ground EVERYTHING only in the prompt, fan-out queries, and competitor pages provided. Do NOT invent statistics, dates, prices, rankings, or superlatives (put anything uncertain in facts_to_verify). No marketing language. No em-dashes.";

/** Draft a schema-valid AeoPromptBrief for one Profound PromptOpportunity.
 *  Capped + budgeted + firewalled; spends only when invoked. */
export async function draftAeoPromptBrief(
  input: AeoPromptBriefInput,
  opts: { complete?: CompleteFn; now?: Date; bypassCache?: boolean } = {},
): Promise<StructuredDraftResult<AeoPromptBrief>> {
  // R16 injection firewall: the verbatim AI prompt, fan-outs, and competitor
  // pages are untrusted external text.
  const prompt = sanitizeEvidenceText(input.prompt);
  const fanoutQueries = sanitizeEvidenceTexts(input.fanoutQueries);
  const competitorPages = sanitizeEvidenceTexts(input.competitorPages);
  const tags = sanitizeEvidenceTexts(input.tags ?? []);
  const grounded = [
    prompt,
    fanoutQueries.join(" "),
    competitorPages.join(" "),
    input.ownCitedUrls.join(" "),
    tags.join(" "),
  ].join(" ");
  const user = [
    `AI prompt to win: "${prompt}"`,
    `Recommended move: ${input.recommendedMove}`,
    fanoutQueries.length ? `Fan-out queries this prompt expands into: ${fanoutQueries.slice(0, 12).join("; ")}` : "",
    competitorPages.length ? `Pages AI cites now (study + beat): ${competitorPages.slice(0, 10).join("; ")}` : "",
    input.ownCitedUrls.length ? `Your pages already cited: ${input.ownCitedUrls.join("; ")}` : "Your site is NOT currently cited for this prompt.",
    tags.length ? `Topic tags: ${tags.join("; ")}` : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  return callStructuredLLM({
    kind: "aeo_prompt_brief",
    system: AEO_PROMPT_BRIEF_SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.03,
    complete: opts.complete,
    now: opts.now,
    bypassCache: opts.bypassCache,
  });
}

// ── persistence (projected, under the move_drafts size cap) ───────────────────

const PERSIST_VERSION = 1;

/** Serialize a validated draft for durable storage. */
export function serializeStructuredDraft(kind: StructuredDraftKind, value: unknown): string {
  return JSON.stringify({ v: PERSIST_VERSION, kind, value });
}

/** Parse + RE-VALIDATE a persisted draft (rejects tampered/legacy/fake content).
 *  Fail-soft → null. The Zod re-check means a hand-edited row with no evidenceRefs
 *  can never be served as a trusted draft. */
export function deserializeStructuredDraft(
  content: string | null | undefined,
  tenantAllowlist?: readonly string[],
): { kind: StructuredDraftKind; value: unknown } | null {
  if (!content) return null;
  try {
    const obj = JSON.parse(content) as { v?: number; kind?: StructuredDraftKind; value?: unknown };
    if (!obj || obj.v !== PERSIST_VERSION || !obj.kind || !(obj.kind in SCHEMA_BY_KIND)) return null;
    const schema = SCHEMA_BY_KIND[obj.kind] as z.ZodTypeAny;
    const res = schema.safeParse(obj.value);
    if (!res.success) return null;
    // W5 P2 (2026-07-09): re-derive authority on every read against the reading
    // tenant's own allowlist so a persisted "authoritative" label can never be
    // trusted under a DIFFERENT tenant's allowlist. `verified` and every other
    // field survive (stampSourceAuthority only overwrites `authority`); with no
    // allowlist supplied this conservatively keeps only the universal
    // .gov/.edu + named set as authoritative.
    return { kind: obj.kind, value: stampAnySources(res.data, tenantAllowlist) };
  } catch {
    return null;
  }
}

// ── team verdict (FINAL PREMIUM PLAN item 25) ─────────────────────────────────

export type TeamVerdictInput = {
  pageLabel: string;
  targetQuery: string;
  /** Tonight's change in plain words ("a sharper description"). */
  leverPlain: string;
  proposedText: string;
  voices: Array<{ label: string; claim: string }>;
  objections: Array<{ label: string; reason: string }>;
  whyNot?: string;
};

/**
 * The strategist writes the team's verdict: a 1-3 sentence synthesis of the REAL specialist
 * claims for one nightly pick. Grounded in the voices verbatim (the numeric firewall rejects
 * any number not present in them). Budget-gated + fail-closed like every structured draft;
 * the caller keeps the deterministic verdict on any non-"drafted" result.
 */
export async function draftTeamVerdictStructured(
  input: TeamVerdictInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<import("./schemas").TeamVerdict>> {
  const voiceLines = input.voices.map((v) => `${v.label}: ${v.claim}`).join("\n");
  const objectionLines = input.objections.map((o) => `${o.label} pushed back: ${o.reason}`).join("\n");
  const grounded = [input.pageLabel, input.targetQuery, input.proposedText, voiceLines, objectionLines, input.whyNot ?? ""].join("\n");
  return callStructuredLLM({
    kind: "team_verdict",
    system: [
      "You are the strategist on an SEO team, synthesizing your specialists' findings for the site owner.",
      'Return ONLY JSON: {"verdict": string, "evidenceRefs": [{"source": string, "detail": string}]}.',
      "The verdict is 1-3 sentences, plain business English, first person plural (we).",
      "Rules: use ONLY facts and numbers from the specialists' lines below, never invent a figure;",
      "name the single weakest link the change fixes; if AI citations are mentioned, name that prize;",
      "no hedging filler, no jargon (experiment, control, SERP), no em dashes, no exclamation marks.",
      "Write like a sharp human strategist: specific, confident, brief.",
    ].join(" "),
    user: [
      `Page: ${input.pageLabel}`,
      `The search: "${input.targetQuery}"`,
      `Today's change: ${input.leverPlain}`,
      `New text: ${input.proposedText}`,
      "",
      "The specialists said:",
      voiceLines || "(no voices)",
      objectionLines ? `\nPushback:\n${objectionLines}` : "",
      input.whyNot ? `\nRoad not taken: ${input.whyNot}` : "",
    ].join("\n"),
    grounded,
    projectedCostUsd: 0.01,
    maxTokens: 1200,
    timeoutMs: 45_000,
    now: opts.now,
    complete: opts.complete,
  });
}

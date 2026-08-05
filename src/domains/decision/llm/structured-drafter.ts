import "server-only";
import { z } from "zod";
import { checkBudget, recordSpend, reserveOnboardingSpend, reconcileOnboardingSpend } from "./adjudicator-budget";
import { log } from "@/lib/logger";
import { buildWinnerFewShots, buildWinnerFewShotsWithPattern } from "./winner-memory";
import type { DraftPatternId } from "./draft-pattern";
import { openAIStructuredResponse, llmFailureOf, type LlmFailure, type LlmProvenance } from "./gateway";
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
import { sanitizeEvidenceTexts, sanitizeNullableEvidence } from "./injection-sanitizer";
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
  UNGROUNDED_EVIDENCE_ERROR,
  draftProseStringValues,
  evidenceIsGrounded,
  type StructuredDraftKind,
  type AnswerBlockDraft,
  type AtomicEditDraft,
  type InternalLinkDraft,
  type SectionDraft,
} from "./schemas";

/**
 * llm/structured-drafter (2026-06-25, P4) — the trustworthy drafting layer. It
 * turns a grounded request into a SCHEMA-VALIDATED structured draft, or nothing:
 *   key/injected transport → cache ($0 on an identical repeat)
 *   → budget (fail-closed cap) → strict structured call → Zod validate →
 *   content firewalls (numeric-fidelity, placeholder, em-dash, superlative) →
 *   de-templating guard → RETRY ONCE on failure → FAIL CLOSED.
 *
 * It NEVER returns loose/unvalidated text as a product artifact. Slice 3 (2026-
 * 07-23): the transport is the strict Responses gateway (openAIStructuredResponse)
 * returning a PARSED, schema-shaped VALUE; the drafter still runs its own Zod
 * safeParse as the second gate. A refusal/incomplete/non-retryable transport error
 * FAILS CLOSED; only a schema-invalid value or a retryable error consumes the
 * single retry. Spend is recorded per attempt. The completion fn is injectable so
 * the flow runs with zero paid calls. Every call carries a registered promptId +
 * version and is scoped to an EXPLICIT account (Slice 3): the cache key + storage,
 * the budget check/record, and the gateway spend are all keyed by tenantId - a
 * missing account fails closed before cache/budget/network, never a global call.
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
  /** `failure` is WHOSE failure it was, typed (gateway.ts's LlmFailure); `errors`/`reason` are the same facts as prose, for a log line and nothing else. */
  | { status: "validation_failed"; reason: string; errors: string[]; failure: LlmFailure; costUsd: number; retried: boolean }
  | {
      status: "drafted";
      kind: StructuredDraftKind;
      value: T;
      costUsd: number;
      retried: boolean;
      fewShot?: FewShotProvenance;
      /** R16: present when this exact request was served from the call cache ($0). */
      cached?: true;
      /** Provider provenance for the successful paid attempt (audit trail). */
      provenance?: LlmProvenance;
      /** R16: present when the draft still reads like a repeat of recent same-family
       *  drafts after the variation retry ("reads like a repeat") - the draft-quality
       *  gate demotes flagged output instead of calling it ready. */
      repeatFlag?: string;
    };

/** Injectable completion fn (default = the strict Responses gateway). Returns a
 *  PARSED, schema-shaped VALUE (the caller still Zod-validates it) plus provenance,
 *  or an error with whether a retry helps (429/5xx/network yes; else no). */
export type CompleteFn = (args: {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  kind: StructuredDraftKind;
  /** The owning account, threaded to the gateway for spend + provenance. */
  tenantId: string;
  /** `failure` is the TYPED name of what went wrong and `error` the same thing as text, for logs; an injected transport naming no type reads as a body I could not use. */
}) => Promise<{ value: unknown; provenance?: LlmProvenance } | { error: string; retryable: boolean; costUsd?: number; failure?: LlmFailure }>;

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

const SUPERLATIVES = /\b(best|leading|#1|number one|top-rated|guaranteed|world-class|ultimate|premier)\b/i;

/** Pilot loop 6: a rephrase-class retry asks the model to REWRITE its answer -
 *  exactly when it is tempted to fill in a fresh invented number. Every
 *  rephrase-class instruction below closes with this reminder so a rewrite cannot
 *  trade an ungrounded superlative or a too-thin answer for an invented statistic. */
const NO_NEW_NUMBERS_RETRY_REMINDER =
  "Do not introduce any number, percentage, or statistic that is not present in the evidence; if " +
  "unsure, write the sentence without a number.";

/** G4/Pilot loops 4+6: the RETRY instruction when an answer block asserted a
 *  superlative no cited source proves. REPHRASE to a grounded, non-superlative
 *  fact (never swap in a DIFFERENT unproven superlative); closes with
 *  NO_NEW_NUMBERS_RETRY_REMINDER so the rewrite cannot launder in an invented
 *  number while removing the superlative. */
const SUPERLATIVE_REPHRASE_INSTRUCTION =
  'Your previous answer used a superlative or ranking claim (for example "most famous", ' +
  '"most celebrated", "leading", "best-known", "the first") that none of your cited sources ' +
  "actually states. Do NOT simply repeat it, and do NOT drop the topic. Do NOT swap it for a " +
  'DIFFERENT unproven superlative either (for example replacing "most famous" with "leading" or ' +
  '"best-known" is still ungrounded and will fail again) - introduce NO new superlative or ranking ' +
  "claim that was not in your first answer. REPHRASE it as a grounded, non-superlative fact using " +
  'the specific credentials, dates, roles, and work in the evidence: for example write "holds the ' +
  'certification named on the page and has worked in it since the date given" instead of "the most ' +
  'trusted provider". A concrete grounded fact is always the better answer than any superlative - ' +
  "prefer it every time. Only keep a superlative if a cited source explicitly asserts that exact " +
  "superlative. " +
  NO_NEW_NUMBERS_RETRY_REMINDER;

/** Pilot loops 5+6: the MERGED retry instruction for when attempt 1 fails BOTH
 *  the 80-word floor AND the superlative check at once (each used to claim the
 *  single retry slot and hide the other problem). Addresses both in ONE
 *  instruction (lengthen with grounded single-fact sentences AND remove/replace
 *  every unproven superlative) and closes with NO_NEW_NUMBERS_RETRY_REMINDER. */
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
 * that carries a `sources` field (answer_block, atomic_edit). A draft with no
 * `sources` array is returned unchanged.
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
 * boundary. For each of the first MAX_SOURCES_TO_VERIFY sources it (1) RESETS
 * every verification field first (never trusts the LLM's own verified/excerpt/
 * hash), (2) fetches the URL through the injected SSRF-safe fetcher, and (3) on a
 * reachable page runs findSupportingSpan(claim, text) and recomputes authority
 * from the FINAL (post-redirect) host. `verified: true` is set ONLY when a
 * qualifying span is found AND the final host is authoritative; the final URL,
 * supporting excerpt, and content hash are persisted for the receipt. An
 * unreachable URL, a redirect to an untrusted host, a weak match, or a missing
 * url/claim all downgrade `authority` to "weak" with `verified: false`, so a
 * hallucinated .gov/.edu URL never passes on domain class alone. NEVER throws;
 * a draft with no sources array is returned unchanged; generation-time only.
 *
 * P2 (2026-07-09): eligible sources verify through a bounded worker pool (at most
 * SOURCE_VERIFY_CONCURRENCY in flight) sharing ONE WHOLE_DRAFT_VERIFY_DEADLINE_MS
 * budget captured before the first fetch. Each worker checks the remaining budget
 * before its OWN next fetch; once spent, every source not yet started stays
 * verified:false / weak (FAIL CLOSED). Results reassemble in original order.
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
  // sentences - the roundup case, where one list page backs many named entities.
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
  // then fails closed). The drafter defers it for `answer_block` and for
  // every `answer_analysis` kind, which RESTATES somebody else's answer and may quote a
  // superlative that answer used; every other kind keeps the hard reject below.
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

/** Retryable HTTP statuses: throttling (429) + server faults (5xx). */
function httpStatusRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * WHAT ONE ATTEMPT ACTUALLY COST: the provider's own usage receipt, or ZERO. An attempt that came back with no receipt (a 429, a socket that died, a stop before the
 * network) bought nothing, so nothing is recorded against any cap. This used to substitute an ESTIMATE, which is how a throttled minute became money on the books: a
 * projection may RESERVE spend before a call, but only a receipt may record it, or a refill lands on an account Beacon has already blocked over purchases it never made.
 * RECONCILIATION, PLAINLY: rows written BEFORE this fix overstate. The 660 calls and $0.832 recorded on 4 August 2026 mix real receipts with estimates for calls that
 * returned nothing. History is not rewritten here; it is simply not trustworthy below the receipt line before this change.
 */
function attemptCostUsd(costUsd: number | null | undefined): number {
  const c = costUsd;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0;
}

function defaultComplete(apiKey: string, promptId: PromptId): CompleteFn {
  return async ({ system, user, maxTokens, timeoutMs, kind, tenantId }) => {
    // The strict Responses gateway owns transport (fallbacks, error ledger,
    // reasoning timeout floor, json_schema). Budget stays HERE in caller mode.
    const outcome = await openAIStructuredResponse({
      promptId,
      promptVersion: PROMPT_REGISTRY[promptId],
      action: `structured-draft:${promptId}`,
      apiKey,
      model: MODEL,
      instructions: system,
      input: user,
      schemaName: kind,
      zodSchema: SCHEMA_BY_KIND[kind],
      maxOutputTokens: maxTokens,
      timeoutMs,
      tenantId,
      budget: { mode: "caller", note: "checkBudget + recordSpend live in callStructuredLLM" },
    });
    // WHOSE FAILURE IT WAS IS DECIDED ONCE, AT THE DOOR THAT SAW IT, and travels as a TYPE; the `error` text below is for
    // a log line only. When a caller had to recognise a throttle by matching `openai_429` exactly, the same throttle
    // wearing the code OpenAI actually sends read as a bad shape, and answers nobody was billed for settled as refused.
    const failure = llmFailureOf(outcome);
    switch (outcome.kind) {
      case "ok": return { value: outcome.value, provenance: outcome.provenance }; // gateway parsed + null-normalized; the drafter still Zod-validates it
      case "blocked_budget": return { error: "blocked_budget", retryable: false, failure };
      case "blocked_credit": return { error: "blocked_credit", retryable: false, failure }; // the door already holds every call for this account, so asking again is the storm this closes
      case "refusal": return { error: "refusal", retryable: false, costUsd: outcome.provenance.costUsd ?? undefined, failure };
      case "incomplete": return { error: "incomplete", retryable: false, costUsd: outcome.provenance.costUsd ?? undefined, failure };
      case "invalid_response": return { error: outcome.reason || "invalid_response", retryable: false, costUsd: outcome.provenance?.costUsd ?? undefined, failure }; // a POST-network invalid carries provenance: bill its REAL usage cost
      // AN EMPTY BALANCE IS NEVER RETRYABLE however it is dressed: it arrives as a 429, which the throttle rule alone would send back into the same wall.
      case "http_error": return { error: `openai_${outcome.status}${outcome.code ? `_${outcome.code}` : ""}`, retryable: failure !== "credit_exhausted" && httpStatusRetryable(outcome.status), failure };
      case "error": return { error: outcome.reason || "fetch_failed", retryable: !outcome.timedOut, failure }; // a dead socket is worth one more try; MY OWN DEADLINE only re-buys the same slow call, and it has no receipt to show either way
    }
  };
}

export type StructuredDraftRequest<K extends StructuredDraftKind> = {
  kind: K;
  /** The owning account. REQUIRED and validated non-empty FIRST (before cache,
   *  budget, or the call), and threaded into the cache key, cache storage, the
   *  budget check/record, and the completion fn. No global fallback. */
  tenantId: string;
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
  /** Slice 5: budget this call against the $2 pre-activation onboarding lifetime cap. Omitted = default (byte-identical). */
  budgetPlatform?: "onboarding-openai";
};

/**
 * The engine: cache ($0 repeats) → validate → retry-once → fail-closed. Returns
 * a typed, schema-valid draft or a non-"drafted" status. Never throws.
 */
export async function callStructuredLLM<K extends StructuredDraftKind>(
  req: StructuredDraftRequest<K>,
): Promise<StructuredDraftResult<z.infer<(typeof SCHEMA_BY_KIND)[K]>>> {
  // Slice 3 account isolation: fail closed on a missing account BEFORE touching
  // the cache, the budget, or the network - a draft with no owner is a bug, never
  // a global call or a shared-cache read.
  const tenantId = (req.tenantId ?? "").trim();
  // No call was made and nothing was billed, so a missing account is named transient: a bug of mine never settles somebody's work.
  if (!tenantId) return { status: "validation_failed", reason: "missing_tenant", errors: ["missing_tenant"], failure: "transient", costUsd: 0, retried: false };
  const apiKey = process.env.OPENAI_API_KEY;
  // R16: every structured call carries a registered prompt identity (all kinds
  // are registered as draft.<kind>; the registry test enforces coverage).
  const promptId = `draft.${req.kind}` as PromptId;
  const promptVersion = PROMPT_REGISTRY[promptId];
  const complete = req.complete ?? (apiKey ? defaultComplete(apiKey, promptId) : null);
  if (!complete) return { status: "off" }; // no injected transport and no key

  const schemaForCache = SCHEMA_BY_KIND[req.kind] as z.ZodTypeAny;
  const cache = resolveCacheImpl(req.cacheImpl);
  const cacheKey = cache
    ? llmCallCacheKey({ tenantId, promptId, promptVersion, kind: req.kind, system: req.system, user: req.user })
    : null;

  // R16 call cache: an identical request (same prompt version + prompts) returns
  // the prior VALIDATED output at $0 - before the budget gate, because a hit
  // spends nothing. `bypassCache` (the explicit Regenerate) forces a paid take.
  if (cache && cacheKey && req.bypassCache !== true) {
    const hit = await cache.read(tenantId, cacheKey).catch(() => null);
    if (hit) {
      const revalidated = schemaForCache.safeParse(hit.value);
      if (revalidated.success) {
        // A cache hit is now ALWAYS same-account (the key + storage are scoped to
        // tenantId), so a hit can never serve another account. Re-stamp authority
        // against this request's allowlist anyway - source-authority.ts is the one
        // place `authority` is decided (stampSourceAuthority only overwrites it;
        // `verified` and every other field survive).
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
  const isOnboarding = req.budgetPlatform === "onboarding-openai";
  // B82: fail CLOSED on unknown budget; onboarding reserves per real attempt (D10) instead of this pre-loop check.
  if (!isOnboarding) {
    const budget = await checkBudget({ tenantId, projectedCostUsd }).catch(() => ({ allowed: false as const, reason: "budget check unavailable; failing closed" }));
    if (budget.allowed === false) return { status: "blocked_budget", reason: (budget as { reason?: string }).reason ?? "cap reached" };
  }

  const schema = SCHEMA_BY_KIND[req.kind] as z.ZodTypeAny;
  const nowYear = (req.now ?? new Date()).getFullYear();
  const maxTokens = req.maxTokens ?? 6000;
  const timeoutMs = req.timeoutMs ?? 60_000;
  const ledger = buildRequestLedger(req.grounded, nowYear);
  // R16 de-templating history: the last cached same-family outputs (or the
  // injected list). Empty history keeps the guard dormant.
  const recentTexts =
    req.recentOutputs ?? (cache ? await cache.recentTexts(tenantId, req.kind, REPEAT_HISTORY_SIZE).catch(() => []) : []);

  // W5 P0-1: the generation-time source verifier (null under vitest unless a
  // hermetic fetcher is injected) + a per-request URL cache so the same source
  // cited on both attempts is fetched once.
  const sourceFetch = resolveSourceFetch(req.sourceFetch, timeoutMs);
  const sourceTextCache = new Map<string, Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>>();
  const verifyNowIso = (req.now ?? new Date()).toISOString();

  let totalCost = 0;
  let lastProvenance: LlmProvenance | undefined;
  // WHOSE FAILURE THE LAST ATTEMPT WAS. It defaults to (and returns to) `schema_invalid`, because every rejection below this line is one I make about a body that DID come back.
  let failure: LlmFailure = "schema_invalid";
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
        // G4: ungrounded superlative - retry with the REPHRASE instruction.
        system = `${req.system}\n\n${SUPERLATIVE_REPHRASE_INSTRUCTION}`;
      } else if (lastFailureWasTemplated) {
        // R16 de-templating: read like a repeat - retry with variation.
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
        system = `${req.system}\n\nYour previous output was rejected: ${errors.slice(-3).join(" | ")}. Fix exactly those problems and include at least one non-empty evidenceRefs entry.`;
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

    // The retry-instruction flags above have now been consumed for this attempt; clear them so any failure below
    // re-sets only the reason that actually applies (the explicit resets on each failure path stay as documentation).
    lastFailureWasSuperlative = false;
    lastFailureWasTemplated = false;
    lastFailureWasThin = false;

    // Slice 5 D10: onboarding durably RESERVES its projected cost before each real attempt (retries reserve again); a refusal makes no call and fails closed to the deterministic fallback.
    if (isOnboarding) {
      const rv = await reserveOnboardingSpend(projectedCostUsd, { tenantId });
      if (rv.allowed === false) return { status: "blocked_budget", reason: rv.reason };
    }

    const out = await complete({ system, user: req.user, maxTokens, timeoutMs, kind: req.kind, tenantId });

    const attemptCost = attemptCostUsd("error" in out ? out.costUsd : out.provenance?.costUsd); totalCost += attemptCost;
    // Onboarding SETTLES its reservation against the real cost EVERY time, including zero, which refunds in full the
    // reservation an attempt that bought nothing had already parked. Everyone else records only a receipt: a call
    // that returned no usage records no spend (onboarding still reconciles to zero, touching the row and its capless call counter: money stays purchases-only).
    if (isOnboarding) await reconcileOnboardingSpend(projectedCostUsd, attemptCost, { tenantId }).catch(() => {});
    else if (attemptCost > 0) await recordSpend(attemptCost, { tenantId }).catch(() => {});

    if ("error" in out) {
      errors.push(`llm_${out.error}`);
      failure = out.failure ?? "schema_invalid";
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      // Non-retryable (refusal/incomplete/budget/4xx) FAILS CLOSED; a retryable
      // error re-enters the SAME 2-attempt ceiling.
      if (!out.retryable) break;
      continue;
    }
    lastProvenance = out.provenance ? { ...out.provenance, retryCount: attempt } : undefined;
    failure = "schema_invalid"; // it answered, so nothing below is the transport's fault any more

    // The drafter runs its OWN Zod safeParse (second validation) after normalizing
    // em/en dashes in every string field of the gateway's schema-shaped value.
    const parsed = schema.safeParse(sanitizeDashesDeep(out.value));
    if (!parsed.success) {
      errors.push(...parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }
    // ANALYTICS ALONE IS NOT EVIDENCE OF A SEARCH: ga4 and clarity report what people did once they had already arrived, so a change argued from them alone
    // has nothing behind the search it is meant to win. Refused with the reason, which the retry then carries.
    const refs = (parsed.data as { evidenceRefs?: { source?: string }[] }).evidenceRefs;
    if (Array.isArray(refs) && !evidenceIsGrounded(refs)) { errors.push(UNGROUNDED_EVIDENCE_ERROR); lastFailureWasTemplated = false; lastFailureWasThin = false; continue; }
    // W5 (J-69): the LLM may PROPOSE sources, but only source-authority.ts
    // decides `authority`, re-stamp before any firewall/cache/return step.
    const result = { ...parsed, data: stampAnySources(parsed.data, req.authoritativeSourceDomains) as typeof parsed.data };
    // answer_analysis is a RESTATEMENT of somebody else's AI answer, never copy this
    // product publishes, so the flat marketing-superlative reject does not apply to
    // it: a verbatim "the best sushi in town" is the observed fact being recorded.
    // The numeric firewall still applies, grounded on the answer text itself, so an
    // invented figure is still caught.
    const fw = runContentFirewalls(draftProseStringValues(result.data), ledger, {
      deferSuperlativeCheck: req.kind === "answer_block" || req.kind.startsWith("answer_analysis"),
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
      ...(lastProvenance ? { provenance: lastProvenance } : {}),
      ...(req.fewShotProvenance ? { fewShot: req.fewShotProvenance } : {}),
      ...(templated ? { repeatFlag: REPEAT_FLAG } : {}),
    };
    if (cache && cacheKey) {
      const nowIso = (req.now ?? new Date()).toISOString();
      await cache
        .write(tenantId, {
          key: cacheKey,
          tenantId,
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

  log.warn("[structured-drafter] fail-closed", { kind: req.kind, failure, errors: errors.slice(0, 6) });
  return { status: "validation_failed", reason: errors[0] ?? "unknown", errors, failure, costUsd: totalCost, retried: true };
}

// ── intent-aware drafting (C) ─────────────────────────────────────────────────
// The searcher's dominant intent decides the ANSWER TYPE. A "when" query must be answered with a
// date, not a definition (the chaharshanbe failure). This directive is injected into the prompt so
// the LLM writes the right kind of answer. Intent strings mirror answer-intent.ts (kept as a loose
// string to avoid an llm -> experiments domain import). Empty string when unknown = no constraint.
function intentDirective(intent?: string): string {
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
  /** The owning account (Slice 3: REQUIRED, threaded to the drafter for cache +
   *  budget scoping). Also looks up this account's own measured winners for the
   *  few-shot injection below. */
  tenantId: string;
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
  "You write structured AEO answer blocks for the page and business described in the grounding below. Return ONLY a JSON object with keys: " +
  // W5 (2026-07-09, J-71): 80-150 words WITH sources - "40-60 is too thin" per the
  // operator's own spec. Bumped from the old 40-60 word target (prompt-registry.ts
  // version bumped alongside this so the content-hash call cache never serves a
  // stale 40-60-word response for the new contract).
  '"answer" (one direct factual answer of 80-150 words an AI assistant could quote verbatim), ' +
  '"citationHook" (a short quotable phrase, or null), ' +
  '"sources" (array of {"url","title","domain","retrievedAt","claim","authority"}: cite 1-2 AUTHORITATIVE sources for the answer\'s claims, each with a real URL, its domain, the date you are citing it, and the specific claim it backs; leave "authority" as "unverified", the caller decides it), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one, citing ONLY the grounding provided; source one of gsc|ga4|clarity|dataforseo|competitor_teardown|owned_snapshot|fanout, and at least one ref must NOT be ga4 or clarity: those two say what people did once they arrived, never what anyone searched for), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground everything ONLY in the brief/outline/questions provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes. Cite 1-2 authoritative sources for any factual claim (a date, a count, a named fact). Never state one with no source. " +
  // G4 (2026-07-10): superlative-intent topics ("most famous X") must still be
  // answerable WITHOUT an unprovable superlative. Instruct grounding-by-facts up
  // front, so the drafter usually clears the verification-aware post-check on the
  // first attempt (the rephrase retry is the safety net, not the norm).
  "If the topic is inherently superlative (a \"most famous\" or \"best\" roundup), do NOT assert a superlative you cannot cite; instead ground it in the specific honors, dates, works, and roles in the evidence (for example \"holds the certification the page names, and has done the work since the date in the evidence\" rather than \"the most trusted provider\"). Only use a superlative if a cited source explicitly states that exact superlative. " +
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
 * entities). Proven gap from the pilot re-run: the model correctly cited an
 * authoritative, on-topic page, but that page was a bare INDEX - it names each
 * entity without discussing any of them, so it cannot entail a per-entity
 * claim, while that SAME entity's own dedicated page covered 3 of 6 sentences
 * in a live replay. This instructs the model to reach for the
 * entity's own page in the first place, so per-claim coverage (source-
 * authority.ts's draftFactsCoveredBySources) has something that actually
 * entails the sentence instead of holding the whole roundup at
 * needs_source_check for a structural, avoidable reason. */
const ENTITY_REFERENCE_INSTRUCTION =
  " This topic names several different people, places, or things (a roundup). For EACH named " +
  "entity's own factual claim (an honor, a song, a role, a date, a work), cite that ENTITY'S OWN " +
  "reference page (the page dedicated to that one entity, not a page about the whole set) - " +
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
  // the model citing a whole-set list page for one entity's own facts) is
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
    tenantId: input.tenantId,
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
  /** V1 Closure: `answer_block` joins the two field edits this drafter has always written. The cause ladder
   *  can name a page whose OPENING never says what the search is about, and that fix is one field's worth of
   *  copy exactly like a title is; the schema already allowed the value and nothing ever passed it. */
  field: "title" | "meta" | "answer_block";
  currentValue: string | null;
  outline: string[];
  evidenceHints?: string[];
  /** The searcher's dominant intent (when/cost/how/where/who/list/compare/what) — shapes the copy. */
  intent?: string;
  /** The owning account (Slice 3: REQUIRED, threaded to the drafter for cache +
   *  budget scoping). Also looks up this account's own measured winners (same
   *  field/lever) for the few-shot injection below. */
  tenantId: string;
  /** BEACON_500 item 74: the page's family (first path segment), used ONLY to look up
   *  a CONFIDENT winning pattern for this family. Optional - omitting it (or having no
   *  confident cell yet) leaves the prompt byte-identical, never an error. */
  pageFamily?: string;
};

const ATOMIC_EDIT_SYSTEM =
  "You improve ONE on-page field (a page title or meta description) to better match the search intent and earn the click. " +
  'Return ONLY a JSON object: "field" (the field being edited), "before" (the exact current value, or null), "after" (the improved value), ' +
  '"rationale" (one sentence), "evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|dataforseo|competitor_teardown|owned_snapshot|fanout, and at least one ref must NOT be ga4 or clarity: those two say what people did once they arrived, never what anyone searched for), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Keep a title under ~60 characters and a meta description 120-160. Ground ONLY in what is provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes.";

/** APPENDED ONLY FOR `answer_block`, so the title and meta prompt stays byte for byte what it has always
 *  been and no stored draft is re-read under different wording. An opening answer is a different job from a
 *  field rewrite: it is the first thing a reader sees, and it has to answer the search in its own first line. */
const OPENING_ANSWER_CLAUSE =
  " This edit is the page's OPENING ANSWER: the first 2 to 4 sentences a reader sees. Write \"after\" as those " +
  "sentences, 40 to 90 words, answering the search directly in the FIRST sentence and naming the exact subject " +
  "the search is about. Never open with a dictionary definition, never defer (\"it varies\", \"check elsewhere\"), " +
  "and state only what the evidence and the page's own sections below already support.";

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
  const lever = input.field === "title" ? "title" : input.field === "answer_block" ? "answer" : "meta";
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
    tenantId: input.tenantId,
    system: ATOMIC_EDIT_SYSTEM + (input.field === "answer_block" ? OPENING_ANSWER_CLAUSE : "") + fewShots,
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
    // AtomicEditDraft.
    const merged = `${result.fewShot.sentence} ${result.value.rationale}`.trim().slice(0, 400);
    return { ...result, value: { ...result.value, rationale: merged } };
  }
  return result;
}

// ── concrete drafter: SectionDraft (a section the winning pages all carry and mine does not) ──
// The cause ladder can prove a page is missing a subject its rivals agree on, and until this existed the
// only answer was a sentence saying so. GROUNDING IS THE WHOLE CONTRACT here: a section is long-form copy,
// so the prompt forbids everything the evidence does not carry and the caller's own gates (draft-quality,
// factual entailment, the numeric firewall above) read it again before it can reach an operator.

export type SectionStructuredInput = {
  query: string;
  pageLabel: string;
  /** The section to write, when the reading named one. Null = write the heading too. */
  heading: string | null;
  /** One plain sentence saying what this section has to do. */
  brief: string;
  /** The page's existing sections, so the new one does not repeat one it already has. */
  outline: string[];
  evidenceHints?: string[];
  tenantId: string;
};

const SECTION_SYSTEM =
  "You write ONE section of an existing web page. Return ONLY a JSON object: " +
  '"heading" (a short plain section heading), "body" (the section copy, 60 to 180 words), ' +
  '"sources" (array of {"kind","detail"} with at least one entry, kind one of own_data|competitor_observation|fanout_question|keyword, ' +
  "each naming the piece of evidence below that the sentence rests on), " +
  '"containsNumber" (true only when your body actually states a figure). ' +
  "GROUNDING IS THE RULE YOU MAY NOT BREAK: write only what the evidence, the brief and the page's own sections below already " +
  "support. Never invent a statistic, a price, a date, a count, a person, a place, a company or a web address. If you cannot " +
  "say something the evidence supports, write a shorter section rather than filling it in. " +
  "Name the exact subject of the search in your first sentence, answer it plainly, and never repeat a section the page already has. " +
  "No marketing language, no superlatives, no em-dashes and no en-dashes.";

/** Draft ONE schema-valid section for a page that is missing it. Capped, budgeted, cached. */
export async function draftSectionStructured(
  input: SectionStructuredInput,
  opts: { complete?: CompleteFn; now?: Date; bypassCache?: boolean; authoritativeSourceDomains?: readonly string[] } = {},
): Promise<StructuredDraftResult<SectionDraft>> {
  // Injection firewall: the brief, the outline and the hints are all built from crawled or observed text.
  const heading = sanitizeNullableEvidence(input.heading);
  const brief = sanitizeNullableEvidence(input.brief) ?? "";
  const outline = sanitizeEvidenceTexts(input.outline);
  const evidenceHints = sanitizeEvidenceTexts(input.evidenceHints ?? []);
  const grounded = [input.query, heading ?? "", brief, outline.join(" "), evidenceHints.join(" ")].join(" ");
  const user = [
    `Search/topic: "${input.query}"`,
    `Page: ${input.pageLabel}`,
    heading ? `Section to write: ${heading}` : "Section to write: choose the heading yourself from the brief",
    `What this section has to do: ${brief}`,
    outline.length ? `Sections the page already has (never repeat one): ${outline.slice(0, 12).join("; ")}` : "",
    evidenceHints.length ? `Evidence the team established: ${evidenceHints.join("; ")}` : "",
    "",
    "Return the JSON now.",
  ].filter(Boolean).join("\n");

  return callStructuredLLM({
    kind: "section_draft", tenantId: input.tenantId, system: SECTION_SYSTEM, user, grounded,
    projectedCostUsd: 0.02, complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache,
    authoritativeSourceDomains: opts.authoritativeSourceDomains,
  });
}

// ── concrete drafter: InternalLinkDraft (where one page should point a reader next) ──

export type InternalLinkStructuredInput = {
  query: string;
  sourcePage: string;
  targetPage: string;
  /** What the destination is about, in the account's own words. */
  topic: string;
  evidenceHints?: string[];
  tenantId: string;
};

const INTERNAL_LINK_SYSTEM =
  "You place ONE link from a page to another page on the SAME site. Return ONLY a JSON object: " +
  '"sourcePage", "targetPage" (echo both exactly as given), "anchorText" (the exact words to link, 2 to 8 words), ' +
  '"linkSentence" (the one sentence to add or amend, containing that anchor text), "reason" (one sentence on what the reader gains), ' +
  '"riskNotes" (short strings, may be empty), "proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}), ' +
  // THE VALIDATOR REJECTS AN UNGROUNDED DRAFT (evidenceIsGrounded), so a prompt that never asked for the field, or
  // never named the rule, spent a guaranteed-rejected attempt before the retry told the model what was owed.
  '"evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|dataforseo|competitor_teardown|owned_snapshot|fanout, and at least one ref must NOT be ga4 or clarity: those two say what people did once they arrived, never what anyone searched for), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps). ' +
  "The anchor text must describe the destination honestly and must never be a bare instruction like click here. Ground every word in " +
  "the evidence below, invent no fact, no figure and no web address, and never link a page to itself. No marketing language, no em-dashes and no en-dashes.";

/** Draft ONE schema-valid internal link. Capped, budgeted, cached. */
export async function draftInternalLinkStructured(
  input: InternalLinkStructuredInput,
  opts: { complete?: CompleteFn; now?: Date; bypassCache?: boolean; authoritativeSourceDomains?: readonly string[] } = {},
): Promise<StructuredDraftResult<InternalLinkDraft>> {
  const topic = sanitizeNullableEvidence(input.topic) ?? "";
  const evidenceHints = sanitizeEvidenceTexts(input.evidenceHints ?? []);
  const grounded = [input.query, topic, input.sourcePage, input.targetPage, evidenceHints.join(" ")].join(" ");
  const user = [
    `Search/topic: "${input.query}"`,
    `Page the link goes ON: ${input.sourcePage}`,
    `Page the link points TO: ${input.targetPage}`,
    `What that destination is about: ${topic}`,
    evidenceHints.length ? `Evidence the team established: ${evidenceHints.join("; ")}` : "",
    "",
    "Return the JSON now.",
  ].filter(Boolean).join("\n");

  return callStructuredLLM({
    kind: "internal_link", tenantId: input.tenantId, system: INTERNAL_LINK_SYSTEM, user, grounded,
    projectedCostUsd: 0.02, complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache,
    authoritativeSourceDomains: opts.authoritativeSourceDomains,
  });
}

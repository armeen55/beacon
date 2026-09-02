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
  type ClassifiableSource,
} from "@/domains/decision/drafts/source-authority";
import { safeFetchSourceText } from "@/lib/net/safe-source-fetch";
import {
  SCHEMA_BY_KIND,
  UNGROUNDED_EVIDENCE_ERROR,
  draftProseStringValues,
  evidenceIsGrounded,
  type StructuredDraftKind,
  type AtomicEditDraft,
  type InternalLinkDraft,
} from "./schemas";

/** llm/structured-drafter (2026-06-25, P4), the trustworthy drafting layer. It turns a grounded request into a SCHEMA-VALIDATED structured draft, or nothing: key/injected transport → cache ($0 on an identical repeat) → budget (fail-closed cap) → strict structured call → Zod validate → content firewalls (numeric-fidelity, placeholder, em-dash, superlative) → de-templating guard → RETRY ONCE on failure → FAIL CLOSED. It NEVER returns loose/unvalidated text as a product artifact. Slice 3 (2026- 07-23): the transport is the strict Responses gateway (openAIStructuredResponse) returning a PARSED, schema-shaped VALUE; the drafter still runs its own Zod safeParse as the second gate. A refusal/incomplete/non-retryable transport error FAILS CLOSED; only a schema-invalid value or a retryable error consumes the single retry. Spend is recorded per attempt. The completion fn is injectable so the flow runs with zero paid calls. Every call carries a registered promptId + version and is scoped to an EXPLICIT account (Slice 3): the cache key + storage, the budget check/record, and the gateway spend are all keyed by tenantId - a missing account fails closed before cache/budget/network, never a global call. / */

const MODEL = "gpt-5.4-mini"; // gpt-5-mini failed the claim-coverage contract on four funded passes (2026-08-17): forty refusals, zero survivors. The gates stay; the writer gets stronger.

/** BEACON_500 item 74: present on a "drafted" result only when a CONFIDENT house pattern cell backed this draft's prompt (winner-memory's pattern aggregate cleared the minimum-sample floor for this page family). Absent (not merely null) whenever the ledger has no confident opinion yet - callers must treat absence as "no claim". */
type FewShotProvenance = {
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
  | { status: "validation_failed"; reason: string; errors: string[]; failure: LlmFailure; costUsd: number; retried: boolean; /** EXACT network attempts made for this logical operation, counted at the gateway call site, never inferred (Codex, 2026-08-23). */ attempts?: number }
  | {
      status: "drafted";
      kind: StructuredDraftKind;
      value: T;
      costUsd: number;
      retried: boolean; attempts?: number;
      fewShot?: FewShotProvenance;
      /** R16: present when this exact request was served from the call cache ($0). */
      cached?: true;
      /** Provider provenance for the successful paid attempt (audit trail). */
      provenance?: LlmProvenance;
      /** R16: present when the draft still reads like a repeat of recent same-family drafts after the variation retry ("reads like a repeat") - the draft-quality gate demotes flagged output instead of calling it ready. */
      repeatFlag?: string;
    };

/** Injectable completion fn (default = the strict Responses gateway). Returns a PARSED, schema-shaped VALUE (the caller still Zod-validates it) plus provenance, or an error with whether a retry helps (429/5xx/network yes; else no). */
export type CompleteFn = (args: {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
  kind: StructuredDraftKind;
  /** The owning account, threaded to the gateway for spend + provenance. */
  tenantId: string;
  /** `failure` is the TYPED name of what went wrong and `error` the same thing as text, for logs; an injected transport naming no type reads as a body I could not use. */
  /** REQUESTS THAT ACTUALLY LEFT THE PROCESS for this one completion, counted at the gateway's own fetch line
   *  and never here (Codex, 2026-08-23). Absent means ZERO: a transport that cannot say it reached the network
   *  did not, which is the honest default for every injected seam and every pre-network refusal. */
}) => Promise<({ value: unknown; provenance?: LlmProvenance } | { error: string; retryable: boolean; costUsd?: number; failure?: LlmFailure }) & { httpAttempts?: number }>;

/** BEACON_500 item 74: turn a confident pattern-hint cell into the one-line, plain- English provenance the draft-provenance surface shows. Pure - no I/O. Names the real winning page when one is known; otherwise names the page family only (never fabricates a page). */
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

export const SUPERLATIVES = /\b(best|leading|#1|number one|top-rated|guaranteed|world-class|ultimate|premier)\b/i;

/** Pilot loop 6: a rephrase-class retry asks the model to REWRITE its answer - exactly when it is tempted to fill in a fresh invented number. Every rephrase-class instruction below closes with this reminder so a rewrite cannot trade an ungrounded superlative or a too-thin answer for an invented statistic. */
const NO_NEW_NUMBERS_RETRY_REMINDER =
  "Do not introduce any number, percentage, or statistic that is not present in the evidence; if " +
  "unsure, write the sentence without a number.";

/** G4/Pilot loops 4+6: the RETRY instruction when an answer block asserted a superlative no cited source proves. REPHRASE to a grounded, non-superlative fact (never swap in a DIFFERENT unproven superlative); closes with NO_NEW_NUMBERS_RETRY_REMINDER so the rewrite cannot launder in an invented number while removing the superlative. */
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

/** Pilot loops 5+6: the MERGED retry instruction for when attempt 1 fails BOTH the 80-word floor AND the superlative check at once (each used to claim the single retry slot and hide the other problem). Addresses both in ONE instruction (lengthen with grounded single-fact sentences AND remove/replace every unproven superlative) and closes with NO_NEW_NUMBERS_RETRY_REMINDER. */
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

/** Em/en-dashes are a STYLE issue, not a trust issue, normalize them to hyphens in every string field before validation, so a good draft isn't rejected for punctuation (gpt-5-mini strongly favors em-dashes). Trust firewalls (invented numbers, placeholders, superlatives) stay HARD rejects. */
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

/** The full grounded-number ledger for one request: evidence numbers with R16 formatting tolerance (numeric-fidelity.ts) plus the structural allowances - adjacent years and the 7/14/28-day proof-window constants (methodology language, not factual claims). */
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

/** The primary CUSTOMER-FACING text of a validated draft (what the de-templating guard compares + what the call cache keeps as same-family history). Null for kinds whose output is analysis/verdict shaped rather than publishable copy. */
function primaryCustomerText(kind: StructuredDraftKind, value: unknown): string | null {
  const v = value as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof v?.[k] === "string" ? (v[k] as string) : null);
  switch (kind) {
    case "answer_block": return pick("answer");
    case "atomic_edit": return pick("after");
    case "outreach_pitch": return pick("body");
    case "internal_link": return pick("linkSentence");
    default: return null;
  }
}

/** W5 (2026-07-09, J-69), re-stamp any `sources` array on a validated draft with the DETERMINISTIC authority classification, discarding whatever the LLM proposed. "ONLY this module [source-authority.ts] stamps authority", * this is the one place that rule is enforced for every LLM-drafted kind that carries a `sources` field (answer_block, atomic_edit). A draft with no `sources` array is returned unchanged. / */
function stampAnySources(value: unknown, tenantAllowlist?: readonly string[]): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.sources)) return value;
  return { ...v, sources: stampSourceAuthority(v.sources as ClassifiableSource[], tenantAllowlist) };
}

/** W5 (J-71): an answer block runs 80-150 words; the drafter gives ONE word-count retry so a too-thin answer is never cached for the gate to reject. Matches evaluateDraftQuality's own floor + word count. */
const ANSWER_MIN_WORDS = 15; // a SANITY floor against pathological output only (lowered 2026-08-25): a 39-word complete answer was refused over one word by a 40-word constant, and completeness is the evaluator's question, never a count's
function countWords(text: string): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** How many cited sources per draft the generation-time verifier will fetch (cost cap - real drafts carry 1-2; anything past this stays unverified). */
const MAX_SOURCES_TO_VERIFY = 3;

/** How many of a draft's sources verify concurrently (P2, 2026-07-09): a bounded worker pool, never a full fan-out - a draft's 1-3 sources share this budget rather than serializing one full fetch at a time. */
const SOURCE_VERIFY_CONCURRENCY = 2;

/** P2 (2026-07-09): the WHOLE draft's source-verification wall-clock budget, not a per-source one. Without this, N sources each capped at their own per-fetch timeout can still add up to N times that before the draft ships - on a slow/hostile host, generation could hang far longer than any single fetch's timeout suggests. Once spent, every source not yet fetched stays verified:false / authority:"weak" (FAIL CLOSED) rather than being fetched on borrowed time. */
const WHOLE_DRAFT_VERIFY_DEADLINE_MS = 20_000;

/** W5 P0-1 (2026-07-09): fetch a cited source URL and return its visible text. Injected in tests (hermetic); the default routes through the SSRF-safe source fetcher (lib/net/safe-source-fetch.ts) - NOT the competitor crawler's follow-redirect fetch, because a source URL is untrusted model-generated text. Fail-soft: any failure resolves to `{ ok: false, text: "" }` so verification downgrades the source rather than throwing. `finalUrl` (W5 stop-ship F2) is the post-redirect URL the fetch actually landed on, so the verifier can recompute authority from the REAL final host. `opts.deadlineMs` (P2) is the REMAINING whole-draft budget for this particular fetch, so a source that starts late gets a shorter leash than one that starts first. / */
type SourceTextFetcher = (
  url: string,
  opts?: { deadlineMs?: number },
) => Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>;

/** Strip HTML to visible text (scripts/styles/tags removed, whitespace collapsed) so claim tokens can be matched against the page's real words. */
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
      // G5 (2026-07-10): surface a robots/anti-bot block (403 class) distinctly from an unreachable/broken URL so an authority-strong-but-unreadable source is held as "check this citation", not "no source". Never evade it.
      if (!res.ok) return { ok: false, text: "", blocked: res.reason === "access_blocked" };
      return { ok: true, text: htmlToVisibleText(res.text), finalUrl: res.finalUrl };
    } catch {
      return { ok: false, text: "" };
    }
  };
}

/** The verifier to use: the injected one in tests, the polite-fetch default in production, and NOTHING under vitest without injection (keeps every pinned suite hermetic - no draft with sources ever hits the network in a test that didn't opt in), exactly the resolveCacheImpl posture. */
function resolveSourceFetch(injected: SourceTextFetcher | undefined, timeoutMs: number): SourceTextFetcher | null {
  if (injected) return injected;
  if (process.env.VITEST === "true") return null;
  return defaultSourceFetcher(timeoutMs);
}

/** Fields the source-verify trust boundary owns end to end. Cleared before any fetch so an LLM-supplied `verified: true` (or a stale value) can never survive into a returned draft; re-set ONLY when a real fetch confirms the claim on an authoritative final host. */
function resetSourceVerification(s: Record<string, unknown>): void {
  s.verified = false;
  delete s.verifiedAt;
  delete s.supportingExcerpt;
  delete s.finalUrl;
  delete s.contentHash;
  // G5 (2026-07-10): an LLM-supplied `fetchBlocked` must never survive either - only a real 403-class fetch below is allowed to set it.
  delete s.fetchBlocked;
  // G6 (2026-07-10): the transient full-page text is set ONLY by a real fetch below (never the model); wipe any inbound value so it cannot be spoofed.
  delete s.fetchedText;
}

/** W5 stop-ship F2 (2026-07-09): pure strip of every source-verification field when NO verifier is configured (vitest without injection, or a runtime with source-fetch disabled). Without this, an LLM that emitted `verified: true` would have that value survive unchallenged. Forces verified=false and drops verifiedAt/supportingExcerpt/finalUrl/contentHash on every source. A draft with no sources array is returned unchanged. / */
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

/** W5 stop-ship F2 (2026-07-09): the GENERATION-TIME source-verification trust boundary. For each of the first MAX_SOURCES_TO_VERIFY sources it (1) RESETS every verification field first (never trusts the LLM's own verified/excerpt/ hash), (2) fetches the URL through the injected SSRF-safe fetcher, and (3) on a reachable page runs findSupportingSpan(claim, text) and recomputes authority from the FINAL (post-redirect) host. `verified: true` is set ONLY when a qualifying span is found AND the final host is authoritative; the final URL, supporting excerpt, and content hash are persisted for the receipt. An unreachable URL, a redirect to an untrusted host, a weak match, or a missing url/claim all downgrade `authority` to "weak" with `verified: false`, so a hallucinated .gov/.edu URL never passes on domain class alone. NEVER throws; a draft with no sources array is returned unchanged; generation-time only. P2 (2026-07-09): eligible sources verify through a bounded worker pool (at most SOURCE_VERIFY_CONCURRENCY in flight) sharing ONE WHOLE_DRAFT_VERIFY_DEADLINE_MS budget captured before the first fetch. Each worker checks the remaining budget before its OWN next fetch; once spent, every source not yet started stays verified:false / weak (FAIL CLOSED). Results reassemble in original order. / */
async function verifyStampedSources(
  value: unknown,
  fetcher: SourceTextFetcher,
  cache: Map<string, Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>>,
  nowIso: string,
  nowYear: number,
  tenantAllowlist: readonly string[] | undefined,
  // G6 (2026-07-10): the draft's own customer-facing prose (answer/openingAnswer/ after/...). Threaded so a fetchable authoritative page whose META-claim did not span-match can STILL verify when its full page text entails the draft's sentences - the roundup case, where one list page backs many named entities.
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

  // Sources eligible for a real fetch, IN ORIGINAL ORDER; anything past the MAX_SOURCES_TO_VERIFY cap or missing url/claim short-circuits to weak without ever touching the fetcher or the whole-draft deadline budget.
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
    // (2) fetch through the injected SSRF-safe fetcher (per-request URL cache, deduping the same source cited on either generation attempt OR by two different sources in the same draft). The cache stores the IN-FLIGHT PROMISE, not the resolved value - `get` + `set` happen synchronously (no await between them), so two pool workers racing on the same URL both see the SAME shared fetch rather than each starting their own.
    let pending = cache.get(url);
    if (!pending) {
      pending = fetcher(url, { deadlineMs: remainingMs }).catch(() => ({ ok: false, text: "" }));
      cache.set(url, pending);
    }
    const fetched = await pending;
    if (!fetched.ok) {
      // G5 (2026-07-10): a robots/anti-bot BLOCK (403 class) on an authority-strong domain is honest middle ground - we could not read the page, so we cannot mark it verified, but the domain IS trusted. Keep authority "authoritative" + verified:false + fetchBlocked:true so the gate holds the draft as `needs_source_check` ("check this citation"), NOT `missing_source`. A block on a non-trusted domain, or any dns/timeout/broken fetch, stays "weak" exactly as before.
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
      // G6 (2026-07-10): thread the FULL fetched page text (transient, never persisted - stripped at the store boundary) so per-claim coverage can back the OTHER roundup sentences this one page covers, not just this claim's span.
      s.fetchedText = fetched.text;
    } else if (finalAuthority === "authoritative") {
      // G6 roundup path: the model's meta-claim ("Summarizes X as ...") did not span-match, but this is a REAL authoritative page we just READ. If its full text entails the draft's own sentences (a list page backing many names), verify it and thread the full text through to per-claim coverage. This reuses the SAME per-sentence + negation-parity discipline as the coverage gate (never a looser bar), so a page that entails nothing stays weak.
      const entail = draftText ? pageEntailsDraftClaims(draftText, fetched.text, nowYear) : { entails: false, excerpt: null, contentHash: null };
      if (entail.entails) {
        s.url = finalUrl;
        s.domain = finalHost;
        s.finalUrl = finalUrl;
        s.authority = "authoritative";
        s.verified = true;
        s.verifiedAt = nowIso;
        // A representative covering span so the persisted (fetchedText-stripped) render path still shows a real ~400-char receipt for this source.
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

/** Content firewalls over every string field of a parsed draft. Same trust rails as the deterministic drafter: no placeholders, no em-dashes, no superlatives, and no invented multi-digit numbers (must be grounded - years allowed). R16 upgraded the numeric check to TOKENIZED extraction with formatting tolerance (5,400 == 5400; percentages match rounded) - strictly MORE permissive, so a grounded number formatted differently is never a false reject while genuinely invented stats still fail closed. */
function runContentFirewalls(
  strings: string[],
  ledger: GroundedNumbers,
  // G4 (2026-07-10): when true, the flat marketing-superlative reject is SKIPPED here and handled instead by the verification-aware superlative post-check after source verification (a superlative IS allowed when a qualifying verified source asserts it; an ungrounded one triggers ONE rephrase retry, then fails closed). The drafter defers it for `answer_block` and for every `answer_analysis` kind, which RESTATES somebody else's answer and may quote a superlative that answer used; every other kind keeps the hard reject below.
  opts?: { deferSuperlativeCheck?: boolean; skipPlaceholderCheck?: boolean; ownWords?: string },
): { ok: true } | { ok: false; reason: string } {
  const blob = strings.join("  ");
  // NAME THE THING THAT WAS REJECTED. A bare "placeholder" tells a retry only its category, so it returns the
  // identical output and the second paid call buys nothing, which is exactly what happened on the live fact
  // judge: a Wikipedia reference marker like "[ 1 ]" inside a quoted passage is a bracket pair, and the retry
  // had no way to know that was the offending text. `invented_numbers` below already reports its own match.
  // A VERDICT IS NOT A PAGE (live, 2026-08-30): a judgement or analysis quotes the page and its sources, so a
  // citation marker like "[ 1 ]" in that quote is data; rejecting it left the quoted claims permanently
  // unsettleable, because every retry must quote the same words. The bracket rule guards what a customer could
  // paste, so only kinds with customer-facing primary text keep it; every other rail still applies everywhere.
  if (!opts?.skipPlaceholderCheck) {
    const placeholder = /\[[^\]]*\]|\{\{|TODO|TBD|lorem ipsum/i.exec(blob);
    if (placeholder) return { ok: false, reason: `placeholder:${placeholder[0].slice(0, 40)}` };
  }
  if (blob.includes("—")) return { ok: false, reason: "em_dash" };
  const sup = opts?.deferSuperlativeCheck ? null : SUPERLATIVES.exec(blob); if (sup && !(opts?.ownWords && new RegExp(`\\b${sup[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(opts.ownWords))) return { ok: false, reason: `superlative:${sup[0]}` }; // NAMED, like the placeholder above: told only the category, three paid retries per page returned the same word (live 2026-09-02)
  const invented = findUngroundedNumbers(blob, ledger);
  if (invented.length > 0) return { ok: false, reason: `invented_numbers:${invented.slice(0, 3).join(",")}` };
  return { ok: true };
}

/** Retryable HTTP statuses: throttling (429) + server faults (5xx). */
function httpStatusRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** WHAT ONE ATTEMPT ACTUALLY COST: the provider's own usage receipt, or ZERO. An attempt that came back with no receipt (a 429, a socket that died, a stop before the network) bought nothing, so nothing is recorded against any cap. This used to substitute an ESTIMATE, which is how a throttled minute became money on the books: a projection may RESERVE spend before a call, but only a receipt may record it, or a refill lands on an account Beacon has already blocked over purchases it never made. RECONCILIATION, PLAINLY: rows written BEFORE this fix overstate. The 660 calls and $0.832 recorded on 4 August 2026 mix real receipts with estimates for calls that returned nothing. History is not rewritten here; it is simply not trustworthy below the receipt line before this change. / */
function attemptCostUsd(costUsd: number | null | undefined): number {
  const c = costUsd;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0;
}

function defaultComplete(apiKey: string, promptId: PromptId): CompleteFn {
  return async ({ system, user, maxTokens, timeoutMs, kind, tenantId }) => {
    // The strict Responses gateway owns transport (fallbacks, error ledger, reasoning timeout floor, json_schema). Budget stays HERE in caller mode.
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
    // WHOSE FAILURE IT WAS IS DECIDED ONCE, AT THE DOOR THAT SAW IT, and travels as a TYPE; the `error` text below is for a log line only. When a caller had to recognise a throttle by matching `openai_429` exactly, the same throttle wearing the code OpenAI actually sends read as a bad shape, and answers nobody was billed for settled as refused.
    const failure = llmFailureOf(outcome), httpAttempts = outcome.httpAttempts;
    switch (outcome.kind) {
      case "ok": return { httpAttempts, value: outcome.value, provenance: outcome.provenance }; // gateway parsed + null-normalized; the drafter still Zod-validates it
      case "blocked_budget": return { httpAttempts, error: "blocked_budget", retryable: false, failure };
      case "blocked_credit": return { httpAttempts, error: "blocked_credit", retryable: false, failure }; // the door already holds every call for this account, so asking again is the storm this closes
      case "refusal": return { httpAttempts, error: "refusal", retryable: false, costUsd: outcome.provenance.costUsd ?? undefined, failure };
      case "incomplete": return { httpAttempts, error: "incomplete", retryable: false, costUsd: outcome.provenance.costUsd ?? undefined, failure };
      case "invalid_response": return { httpAttempts, error: outcome.reason || "invalid_response", retryable: false, costUsd: outcome.provenance?.costUsd ?? undefined, failure }; // a POST-network invalid carries provenance: bill its REAL usage cost
      // AN EMPTY BALANCE IS NEVER RETRYABLE however it is dressed: it arrives as a 429, which the throttle rule alone would send back into the same wall.
      case "http_error": return { httpAttempts, error: `openai_${outcome.status}${outcome.code ? `_${outcome.code}` : ""}`, retryable: failure !== "credit_exhausted" && httpStatusRetryable(outcome.status), failure };
      case "error": return { httpAttempts, error: outcome.reason || "fetch_failed", retryable: !outcome.timedOut, failure }; // a dead socket is worth one more try; MY OWN DEADLINE only re-buys the same slow call, and it has no receipt to show either way
    }
  };
}

export type StructuredDraftRequest<K extends StructuredDraftKind> = {
  kind: K;
  /** The owning account. REQUIRED and validated non-empty FIRST (before cache, budget, or the call), and threaded into the cache key, cache storage, the budget check/record, and the completion fn. No global fallback. */
  tenantId: string;
  /** System prompt, describe the JSON shape + the grounding/safety rules. */
  system: string;
  /** User prompt, the grounded inputs. */
  user: string;
  /** Concatenated grounded text for the numeric-fidelity firewall. */
  grounded: string;
  /** A phrase CODE resolved and the writer was told to carry verbatim, so markup the writer wrapped around it can be taken off before the firewalls read the copy. */ unmarkPhrase?: string;
  projectedCostUsd?: number;
  maxTokens?: number;
  timeoutMs?: number;
  now?: Date;
  /** Injected for tests; defaults to the real OpenAI call. */
  complete?: CompleteFn;
  /** BEACON_500 item 74: carried straight onto a "drafted" result's `fewShot` field when present. The engine does not compute this itself - it only threads through whatever the concrete drafter already resolved from winner-memory's pattern aggregate, so the prompt-building and the result metadata always agree on whether a confident cell was actually used. */
  fewShotProvenance?: FewShotProvenance;
  /** R16: skip the $0 cache-serve and force a fresh paid draft (the explicit Regenerate action). The fresh result still REPLACES the cached entry. */
  bypassCache?: boolean; /** THE PAGE'S OWN TITLE AND HEADINGS (live 2026-09-02): a superlative they carry is the page's own fact, not the writer's claim, so a summary field may repeat that word; twenty city pages headed "Best Persian Restaurants in X" could never earn a description. */ ownWords?: string;
  /** R16 test seam: inject cache behavior. Default: the store-backed call cache in production, NO cache under vitest (pinned suites stay hermetic). */
  cacheImpl?: CacheImpl;
  /** R16 test seam / caller-supplied history for the de-templating guard. When absent the guard reads the last cached outputs for this kind. */
  recentOutputs?: string[];
  /** W5 (J-69): this tenant's curated authoritative-domain allowlist (BusinessProfile.authoritativeSourceDomains), used ONLY to re-stamp any `sources` field on the validated draft. Omitted = only the universal .gov/.edu + named encyclopedic/press set applies. */
  authoritativeSourceDomains?: readonly string[];
  /** W5 P0-1 (2026-07-09): injectable source-text fetcher for the generation-time verification step. Tests inject a hermetic stub; the default is the polite competitor-intel fetch, and NOTHING under vitest without injection (no draft with sources ever hits the network in a test that didn't opt in). */
  sourceFetch?: SourceTextFetcher;
  /** Slice 5: budget this call against the $2 pre-activation onboarding lifetime cap. Omitted = default (byte-identical). */
  budgetPlatform?: "onboarding-openai";
};

/** The engine: cache ($0 repeats) → validate → retry-once → fail-closed. Returns a typed, schema-valid draft or a non-"drafted" status. Never throws. / */
export async function callStructuredLLM<K extends StructuredDraftKind>(
  req: StructuredDraftRequest<K>,
): Promise<StructuredDraftResult<z.infer<(typeof SCHEMA_BY_KIND)[K]>>> {
  // Slice 3 account isolation: fail closed on a missing account BEFORE touching the cache, the budget, or the network - a draft with no owner is a bug, never a global call or a shared-cache read.
  const tenantId = (req.tenantId ?? "").trim();
  // No call was made and nothing was billed, so a missing account is named transient: a bug of mine never settles somebody's work.
  if (!tenantId) return { status: "validation_failed", reason: "missing_tenant", errors: ["missing_tenant"], failure: "transient", costUsd: 0, retried: false, attempts: 0 }; // refused before any transport: zero requests left this process
  const apiKey = process.env.OPENAI_API_KEY;
  // R16: every structured call carries a registered prompt identity (all kinds are registered as draft.<kind>; the registry test enforces coverage).
  const promptId = `draft.${req.kind}` as PromptId;
  const promptVersion = PROMPT_REGISTRY[promptId];
  const complete = req.complete ?? (apiKey ? defaultComplete(apiKey, promptId) : null);
  if (!complete) return { status: "off" }; // no injected transport and no key

  const schemaForCache = SCHEMA_BY_KIND[req.kind] as z.ZodTypeAny;
  const cache = resolveCacheImpl(req.cacheImpl);
  const cacheKey = cache
    ? llmCallCacheKey({ tenantId, promptId, promptVersion, kind: req.kind, system: req.system, user: req.user })
    : null;

  // R16 call cache: an identical request (same prompt version + prompts) returns the prior VALIDATED output at $0 - before the budget gate, because a hit spends nothing. `bypassCache` (the explicit Regenerate) forces a paid take.
  if (cache && cacheKey && req.bypassCache !== true) {
    const hit = await cache.read(tenantId, cacheKey).catch(() => null);
    if (hit) {
      const revalidated = schemaForCache.safeParse(hit.value);
      if (revalidated.success) {
        // A cache hit is now ALWAYS same-account (the key + storage are scoped to tenantId), so a hit can never serve another account. Re-stamp authority against this request's allowlist anyway - source-authority.ts is the one place `authority` is decided (stampSourceAuthority only overwrites it; `verified` and every other field survive).
        return {
          status: "drafted",
          kind: req.kind,
          // THE SAME REPAIR ON BOTH DOORS (operator, 2026-08-31): a hit returns here BEFORE the firewalls and before the unwrap, so a draft banked under an older prompt version could serve the customer the brackets the fresh path now takes off. What a cached answer says must not depend on which door it came through.
          value: unmarkAnchor(stampAnySources(revalidated.data, req.authoritativeSourceDomains), req.unmarkPhrase) as z.infer<(typeof SCHEMA_BY_KIND)[K]>,
          costUsd: 0,
          retried: false, attempts: 0,
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
    // The kind names what the call is FOR: fact checking draws on its own reserve, everything else on bulk.
    const budget = await checkBudget({ tenantId, projectedCostUsd, purpose: req.kind.startsWith("fact_claim_") ? "fact_check" : "bulk" }).catch(() => ({ allowed: false as const, reason: "budget check unavailable; failing closed" }));
    if (budget.allowed === false) return { status: "blocked_budget", reason: (budget as { reason?: string }).reason ?? "cap reached" };
  }

  const schema = SCHEMA_BY_KIND[req.kind] as z.ZodTypeAny;
  const nowYear = (req.now ?? new Date()).getFullYear();
  const maxTokens = req.maxTokens ?? 6000;
  const timeoutMs = req.timeoutMs ?? 60_000;
  const ledger = buildRequestLedger(req.grounded, nowYear);
  // R16 de-templating history: the last cached same-family outputs (or the injected list). Empty history keeps the guard dormant.
  const recentTexts =
    req.recentOutputs ?? (cache ? await cache.recentTexts(tenantId, req.kind, REPEAT_HISTORY_SIZE).catch(() => []) : []);

  // W5 P0-1: the generation-time source verifier (null under vitest unless a hermetic fetcher is injected) + a per-request URL cache so the same source cited on both attempts is fetched once.
  const sourceFetch = resolveSourceFetch(req.sourceFetch, timeoutMs);
  const sourceTextCache = new Map<string, Promise<{ ok: boolean; text: string; finalUrl?: string; blocked?: boolean }>>();
  const verifyNowIso = (req.now ?? new Date()).toISOString();

  let totalCost = 0, networkAttempts = 0;
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
        // Pilot loop 5 (2026-07-11): attempt 1 failed BOTH the word-count floor and the superlative check at once - one combined instruction, not whichever single-issue instruction would otherwise win below (this branch must be checked BEFORE the plain superlative/thin branches).
        system = `${req.system}\n\n${COMBINED_THIN_AND_SUPERLATIVE_RETRY_INSTRUCTION}`;
      } else if (lastFailureWasSuperlative) {
        // G4: ungrounded superlative - retry with the REPHRASE instruction.
        system = `${req.system}\n\n${SUPERLATIVE_REPHRASE_INSTRUCTION}`;
      } else if (lastFailureWasTemplated) {
        // R16 de-templating: read like a repeat - retry with variation.
        system = `${req.system}\n\n${VARIATION_INSTRUCTION}`;
      } else if (lastFailureWasThin) {
        // W5 (J-71): the first answer was under the 80-word floor - retry asking for the full band rather than an "invalid output" correction. Pilot loop 4 (2026-07-10): a live re-run showed the model can lengthen a too-thin answer by adding a FRESH ungrounded superlative ("a leading classical vocalist") instead of more grounded facts - the same loophole SUPERLATIVE_REPHRASE_INSTRUCTION already closes for a superlative- triggered retry, but this retry reason never carried that reminder. State it here too, so lengthening never trades away groundedness. Pilot loop 6 (2026-07-11): also closes with NO_NEW_NUMBERS_RETRY_REMINDER so lengthening never trades away groundedness for an invented number either - the same reminder every other rephrase-class retry carries.
        system = `${req.system}\n\nYour previous answer stopped before it answered the search. Complete it, grounded ONLY in the evidence provided. Add the missing length with MORE grounded facts (names, dates, honors, works) - do NOT introduce a new superlative or ranking claim while lengthening it. ${NO_NEW_NUMBERS_RETRY_REMINDER}`;
      } else {
        // AND ONLY ASK FOR A FIELD THIS KIND ACTUALLY HAS. The evidenceRefs sentence was appended to every retry
        // of every kind, so a judgement whose schema has no such field was told to fill one in, which is an
        // instruction it can only fail or fabricate against.
        const wantsRefs = "evidenceRefs" in ((schema as unknown as { shape?: Record<string, unknown> }).shape ?? {});
        system = `${req.system}\n\nYour previous output was rejected: ${errors.slice(-3).join(" | ")}. Fix exactly those problems${wantsRefs ? " and include at least one non-empty evidenceRefs entry" : ""}.`; const sup = errors.map((e) => /^firewall:superlative:(.+)$/.exec(e)?.[1]).find(Boolean); if (sup) system += ` The word "${sup}" is a ranking claim no supplied source makes: remove it and every other ranking word (best, leading, top-rated, premier, ultimate) and say what the page offers instead.`; // A CODE IS NOT AN INSTRUCTION (live 2026-09-02): told "firewall:superlative:best", the writer returned "best" on every retry
        // R16 numeric repair: when the failure was an ungrounded number, inject the CORRECT grounded numbers so the retry can fix the figure instead of guessing again. One repair retry, then fail closed.
        if (errors.some((e) => e.startsWith("firewall:invented_numbers"))) {
          const nums = groundedNumberList(ledger);
          system +=
            nums.length > 0
              ? ` The evidence contains ONLY these numbers: ${nums.join(", ")}. Cite numbers exactly from this list, or write without numbers.`
              : " The evidence contains no citable numbers. Write without numbers.";
        }
      }
    }

    // The retry-instruction flags above have now been consumed for this attempt; clear them so any failure below re-sets only the reason that actually applies (the explicit resets on each failure path stay as documentation).
    lastFailureWasSuperlative = false;
    lastFailureWasTemplated = false;
    lastFailureWasThin = false;

    // Slice 5 D10: onboarding durably RESERVES its projected cost before each real attempt (retries reserve again); a refusal makes no call and fails closed to the deterministic fallback.
    if (isOnboarding) {
      const rv = await reserveOnboardingSpend(projectedCostUsd, { tenantId });
      if (rv.allowed === false) return { status: "blocked_budget", reason: rv.reason };
    }

    // THE ATTEMPT IS COUNTED BY WHOEVER TOUCHED THE WIRE. Incrementing here counted every pre-network refusal
    // (research paused, credit held, breaker, budget, an unconvertible schema) as a charged provider call, and
    // the operator read those as money spent (Codex, 2026-08-23, from a live receipt). The gateway stamps the
    // one transport fact on its outcome; this adds it, and a seam that reports nothing adds nothing.
    const out = await complete({ system, user: req.user, maxTokens, timeoutMs, kind: req.kind, tenantId });
    networkAttempts += Math.max(0, Math.round((out as { httpAttempts?: number }).httpAttempts ?? 0));

    const attemptCost = attemptCostUsd("error" in out ? out.costUsd : out.provenance?.costUsd); totalCost += attemptCost;
    // Onboarding SETTLES its reservation against the real cost EVERY time, including zero, which refunds in full the reservation an attempt that bought nothing had already parked. Everyone else records only a receipt: a call that returned no usage records no spend (onboarding still reconciles to zero, touching the row and its capless call counter: money stays purchases-only).
    if (isOnboarding) await reconcileOnboardingSpend(projectedCostUsd, attemptCost, { tenantId }).catch(() => {});
    else if (attemptCost > 0) await recordSpend(attemptCost, { tenantId }).catch(() => {});

    if ("error" in out) {
      errors.push(`llm_${out.error}`);
      failure = out.failure ?? "schema_invalid";
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      // Non-retryable (refusal/incomplete/budget/4xx) FAILS CLOSED; a retryable error re-enters the SAME 2-attempt ceiling.
      if (!out.retryable) break;
      continue;
    }
    lastProvenance = out.provenance ? { ...out.provenance, retryCount: attempt } : undefined;
    failure = "schema_invalid"; // it answered, so nothing below is the transport's fault any more

    // The drafter runs its OWN Zod safeParse (second validation) after normalizing em/en dashes in every string field of the gateway's schema-shaped value.
    const parsed = schema.safeParse(sanitizeDashesDeep(out.value));
    if (!parsed.success) {
      errors.push(...parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }
    // ANALYTICS ALONE IS NOT EVIDENCE OF A SEARCH: ga4 and clarity report what people did once they had already arrived, so a change argued from them alone has nothing behind the search it is meant to win. Refused with the reason, which the retry then carries.
    const refs = (parsed.data as { evidenceRefs?: { source?: string }[] }).evidenceRefs;
    if (Array.isArray(refs) && !evidenceIsGrounded(refs)) { errors.push(UNGROUNDED_EVIDENCE_ERROR); lastFailureWasTemplated = false; lastFailureWasThin = false; continue; }
    // W5 (J-69): the LLM may PROPOSE sources, but only source-authority.ts decides `authority`, re-stamp before any firewall/cache/return step.
    const result = { ...parsed, data: stampAnySources(parsed.data, req.authoritativeSourceDomains) as typeof parsed.data };
    // answer_analysis is a RESTATEMENT of somebody else's AI answer, never copy this product publishes, so the flat marketing-superlative reject does not apply to it: a verbatim "the best sushi in town" is the observed fact being recorded. The numeric firewall still applies, grounded on the answer text itself, so an invented figure is still caught.
    if (req.kind === "internal_link" || req.unmarkPhrase) result.data = unmarkAnchor(result.data, req.unmarkPhrase);
    const fw = runContentFirewalls(draftProseStringValues(result.data), ledger, {
      deferSuperlativeCheck: req.kind === "answer_block" || req.kind.startsWith("answer_analysis"),
      skipPlaceholderCheck: primaryCustomerText(req.kind, result.data) == null, ownWords: req.ownWords,
    });
    if (!fw.ok) {
      errors.push(`firewall:${fw.reason}`);
      lastFailureWasTemplated = false;
      lastFailureWasThin = false;
      continue;
    }

    // R16 de-templating guard: a validated draft whose customer-facing text is a near-copy (>70 percent 3-gram overlap) of a recent same-family output gets ONE variation retry; a second near-copy ships FLAGGED ("reads like a repeat") for the draft-quality gate to demote - style never fails closed.
    const primary = primaryCustomerText(req.kind, result.data);
    const templated = primary != null && looksTemplated(primary, recentTexts);
    if (templated && !retried) {
      errors.push("templated");
      lastFailureWasTemplated = true;
      lastFailureWasThin = false;
      continue;
    }

    // W5 P2 (J-71): an answer block under the 80-word floor is flagged here. Pilot loop 5 (2026-07-11): verification (needed for the superlative check right below) now runs BEFORE this decision is acted on, so a draft that is BOTH too thin AND carrying an ungrounded superlative gets BOTH problems diagnosed on the SAME attempt - previously this check's own `continue` skipped verification entirely, silently hiding a co-occurring superlative problem from the retry (the retry only ever named ONE of the two issues, whichever check happened to run first, and the run could die on attempt 2 still carrying the other).
    const thinAnswer = req.kind === "answer_block" && primary != null && countWords(primary) < ANSWER_MIN_WORDS;

    // W5 stop-ship F2: verify each cited source AT GENERATION TIME (SSRF-safe fetch + span-level entailment + final-host authority) AFTER the firewalls, so the added verification metadata never enters the numeric firewall. When no verifier is configured (vitest without injection), STRIP every verification field so an LLM-supplied `verified: true` can never survive.
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

    // G4 (2026-07-10): SUPERLATIVE post-check, verification-aware (runs on `answer_block` only; every other kind's marketing-superlative reject stays in runContentFirewalls above). A superlative is allowed ONLY when a QUALIFYING verified source asserts it (superlative-parity); an ungrounded one is not shipped.
    const ungroundedSuperlative =
      req.kind === "answer_block" && primary != null
        ? ungroundedSuperlatives(primary, (verifiedData as { sources?: ClassifiableSource[] }).sources, req.authoritativeSourceDomains, nowYear)
        : [];
    const hasUngroundedSuperlative = ungroundedSuperlative.length > 0;

    if (thinAnswer) errors.push("too_thin_answer");
    if (hasUngroundedSuperlative) errors.push(`superlative_ungrounded:${ungroundedSuperlative.slice(0, 3).join(",")}`);

    // A superlative is the highest-risk claim, so it ALWAYS forces a continue (one rephrase retry, then fail closed) on either attempt - never shipped ungrounded, unchanged from before. Pilot loop 5: when the SAME draft is ALSO too thin, flag both reasons together so the retry-instruction builder above merges them into ONE combined instruction instead of only addressing the superlative.
    if (hasUngroundedSuperlative) {
      if (!retried) {
        lastFailureWasSuperlative = true;
        lastFailureWasThin = thinAnswer;
        continue; // rephrase retry (combined with the length instruction when also too thin)
      }
      continue; // second attempt still ungrounded -> fall through to fail-closed
    }

    // W5 P2 (J-71): a too-thin-only draft (no superlative problem) gets ONE word-count retry so the drafter never caches a too-thin answer the quality gate would only reject later. A style-class retry, never a fail-closed: if the second attempt is still short it ships as-is for the gate to hold as too_thin (redrafting endlessly would just burn budget) - unchanged single-error behavior.
    if (thinAnswer && !retried) {
      lastFailureWasThin = true;
      continue;
    }

    const drafted = {
      status: "drafted" as const,
      kind: req.kind,
      value: verifiedData,
      costUsd: totalCost,
      retried, attempts: networkAttempts,
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
  return { status: "validation_failed", reason: errors[0] ?? "unknown", errors, failure, costUsd: totalCost, retried: true, attempts: networkAttempts };
}

// ── intent-aware drafting (C) ───────────────────────────────────────────────── The searcher's dominant intent decides the ANSWER TYPE. A "when" query must be answered with a date, not a definition (the chaharshanbe failure). This directive is injected into the prompt so the LLM writes the right kind of answer. Intent strings mirror answer-intent.ts (kept as a loose string to avoid an llm -> experiments domain import). Empty string when unknown = no constraint.
function intentDirective(intent?: string): string {
  switch (intent) {
    // The AEO producer's own shape vocabulary (producers/ai-cases), passed through typed rather than buried in brief prose (Codex, 2026-08-23).
    case "examples": return "a one-sentence direct answer first, then the strongest items each on its own line with the one fact a reader needs about each";
    case "definition": return "the definition in the first sentence, then the two or three facts on this page that support it";
    case "comparison": return "what each option is and the one difference that decides between them";
    case "process": return "the steps in order, one per line, each something a reader can do";
    case "history": return "the turns in order, earliest first, with their dates";
    case "category": return "what this category offers and how a buyer narrows it, using only what this page carries";
    case "question": return "the direct answer in the first two sentences, then the specifics only this page has";
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

// ── concrete drafter: AtomicEditDraft (existing-page title/meta edit) ──────────

type AtomicEditStructuredInput = {
  query: string;
  pageLabel: string;
  /** V1 Closure: `answer_block` joins the two field edits this drafter has always written. The cause ladder can name a page whose OPENING never says what the search is about, and that fix is one field's worth of copy exactly like a title is; the schema already allowed the value and nothing ever passed it. */
  /** `h1` joined them when one decision started writing on FOUR addresses at once: telling sibling pages apart replaces the heading a reader sees as well as the line Google shows, and the schema already allowed it. */
  field: "title" | "meta" | "h1" | "answer_block";
  currentValue: string | null;
  outline: string[];
  evidenceHints?: string[];
  /** The searcher's dominant intent (when/cost/how/where/who/list/compare/what), shapes the copy. */
  intent?: string;
  /** The exact anchor this edit must carry, when it is a link. Resolved from the destination, never from the model. */ unmarkPhrase?: string;
  /** The owning account (Slice 3: REQUIRED, threaded to the drafter for cache + budget scoping). Also looks up this account's own measured winners (same field/lever) for the few-shot injection below. */
  tenantId: string;
  /** BEACON_500 item 74: the page's family (first path segment), used ONLY to look up a CONFIDENT winning pattern for this family. Optional - omitting it (or having no confident cell yet) leaves the prompt byte-identical, never an error. */
  pageFamily?: string;
};

/** THE OPENING NAMES THE ACTUAL JOB (Codex, 2026-08-23). This system prompt opened "You improve ONE on-page field (a page title or meta description)" for EVERY field, so a model asked for a 40-to-90-word answer block was simultaneously told it was writing a title: two assignments in one prompt, and the live reviewer read the confusion as thin restatement. The head clause now names the field being written; every homework rule after it is shared and unchanged. */
const ATOMIC_HEAD: Record<string, string> = {
  title: "You improve ONE page title to better match the search intent and earn the click. Keep it under 60 characters: COUNT them. ",
  meta: "You improve ONE meta description to better match the search intent and earn the click. Keep it between 120 and 150 characters: COUNT them, and never go past 155. ",
  h1: "You improve ONE page heading (the H1) so it names exactly what the page delivers in the searcher's own words. Keep it under 90 characters. ",
  answer_block: "You write ONE answer block that will be pasted into the page's body to answer the tracked question outright, transforming the page's stored evidence into the required shape rather than restating the page. ",
  default: "You improve ONE on-page field to better match the search intent and earn the click. ",
};
const ATOMIC_EDIT_SYSTEM =
  'Return ONLY a JSON object: "field" (the field being edited), "before" (the exact current value, or null), "after" (the improved value), ' +
  '"rationale" (one sentence), "evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|dataforseo|competitor_teardown|owned_snapshot|fanout, and at least one ref must NOT be ga4 or clarity: those two say what people did once they arrived, never what anyone searched for), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground ONLY in what is provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes. " +
  'ALSO SHOW YOUR HOMEWORK, or the edit is refused: "placementAnchor" (the EXACT existing heading or sentence from the stored page copy below that this edit replaces, lands on, or lands after, copied character for character), "naturalHeading" (a heading a reader would search for, or null when the edit replaces an existing field; NEVER the search or tracked question repeated back), ' +
  '"claims" (array of {"text","supportedBy"}, one per material statement the copy makes, where supportedBy lists the exact grounding ids given to you that carry it), "implementationMinutes" (how long this takes an operator). TWO DIFFERENT VOCABULARIES, AND MIXING THEM THROWS THE EDIT AWAY: an evidenceRefs "source" is one of the KINDS listed above (gsc, owned_snapshot, fanout and the rest), while the "supportedBy" on a claim holds only the exact grounding IDS printed below (page-copy-1, card-2, demand-3). Never put a source kind in supportedBy. Every id in supportedBy must be one handed to you. State no figure the grounding does not already show. '
  + 'KEEP EVERY REFERENCE SHORT, or the whole edit is thrown away: each evidenceRefs "detail" and each claim\'s "text" must be UNDER 200 characters and NAME what backs it by its id, never quote the passage back.';

/** APPENDED ONLY FOR `answer_block`, so the title and meta prompt stays byte for byte what it has always been and no stored draft is re-read under different wording. An opening answer is a different job from a field rewrite: it is the first thing a reader sees, and it has to answer the search in its own first line. */
const OPENING_ANSWER_CLAUSE =
  " This edit is a BODY ANSWER BLOCK. ANSWER THE SEARCH COMPLETELY AND STOP: a reader who lands on this block alone must be able to act on it without the rest of the page. Do not pad to a length and do not repeat yourself; a sharp 40-word answer is better than an 80-word one carrying filler. " +
  "Open with the direct answer to the search in the first one or two sentences, naming the exact subject, then follow the required shape the directive above gives. " +
  "Never open with a dictionary definition, never defer (\"it varies\", \"check elsewhere\"), and state only what the evidence ids below support. The page's own sections are context for what is true, not material to reword: this block owes the reader at least one thing those sections do not already say, whether that is a checked fact, a figure, a relation to another page of this site, or an answer the page scatters and this block finally assembles in one place. THIS EDIT IS A NEW SECTION, SO `naturalHeading` IS REQUIRED AND MAY NEVER BE NULL OR EMPTY: the homework note above allows null only where an edit replaces an existing FIELD, and a section that names no heading lands nowhere a person can paste it, which is refused outright." + " THE HEADING NAMES THE ACTUAL INTENT OR QUESTION a reader arrives with, in ordinary words, never the search string pasted back and never the page's own H1 said again. THE FIRST SENTENCE ANSWERS OR DEFINES, in the shape the assignment's OPEN LIKE THIS line gives you: an entity is, was or refers to something; a plural category is or includes its members; a procedure opens on the action a reader takes first; a comparison opens on the distinction. Later sentences add the evidence, the examples, the qualifications or the structure, in that order. ONE EXTRACTABLE, SELF-CONTAINED FACT PER SECTION: a reader who lifts any single sentence out of it still has something true and complete, which means no sentence may depend on a word like here, this or below to make sense. NO CONTAINER NARRATION, no generic introduction, no closing summary, no repeating the search phrase to look relevant, and no template with the entity swapped: if the same sentence would read identically about a different subject, it says nothing. A NAME OR DICTIONARY ENTRY KEEPS THE PAGE'S OWN COMPACT FORMAT, with its existing spacing and punctuation, and is never inflated into a paragraph.";

// APPENDED ONLY FOR `meta`, as the opening-answer clause is appended only for `answer_block`. A description names what the page IS ABOUT and must never advertise the page's own furniture: "Iran Shir o Khorshid Vertical Stripe Shirt with FAQs on shipping, returns, waterproofing, and gift-ready details on the page" told a shopper nothing about the shirt, and its own caveat admitted no shipping answer was stored. Naming the subject is right for every page kind, so it is not conditioned on one.
const META_SUBJECT_CLAUSE = ' DESCRIBE THE THING THE PAGE IS ABOUT, NEVER THE PAGE. OPEN BY NAMING IT, in the words the page\'s own title and heading use, and include the plain noun for what it is: a reader who sees only your first few words must know what this is. "A limited rebuild of the original vertical stripe design" never says the thing is a shirt. Then say what is true of it: for an item, its real attributes (what it is made of, how it looks, its colour, its cut, its size, what it is for); for a subject, the specific answer the page gives. Take those only from the page\'s own stored words handed to you. NEVER describe the page\'s structure or its sections: no "FAQs", no "frequently asked questions", no shipping, returns, delivery or policy topics, no "on this page", "here you will find", "learn more", and no naming of a question the page asks. If the stored words give you no real attribute, describe the subject plainly and stop; a short true line beats a long one made of furniture. WRITE ONE NATURAL, PAGE-SPECIFIC, COMPLETE SENTENCE. Where the page is about ONE entity, name that entity first. Where it is a list, a directory or a category, it may open with an intent verb (Find, Explore, Compare, Browse) and then say what is actually in it. Where it is a submission form or a tool, open with the direct action it performs. Never write a list of the page\'s headings, never force a call to action, and never claim anything about assistants, AI answers or search itself. ';
/** APPENDED ONLY FOR `title` and `h1`. A summary line is a noun phrase a person would publish, not a sentence and not a comma list of search phrasings. */ const TITLE_SHAPE_CLAUSE = ' WRITE A NOUN PHRASE LED BY THE ENTITY OR THE SEARCH, never a sentence: no forced "is" or "are", no question mark, no closing punctuation. It must sit naturally beside the page\'s own H1 and mean the same thing it does; where the H1 names the subject one way, do not rename it. One natural line, no repeated word, no stacked keyword phrases separated by pipes or commas. ';
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
  // R16 injection firewall: untrusted crawled text is stripped of instruction-shaped lines before it enters the prompt.
  const currentValue = sanitizeNullableEvidence(input.currentValue);
  // A DESCRIPTION IS ABOUT THE PAGE'S SUBJECT, AND A PAGE'S QUESTION RAIL IS NOT ITS SUBJECT: `Page covers:` renders the stored headings verbatim, so on a page whose first headings are its FAQ the model was told, truthfully, that the page covers shipping, returns and waterproofing, and it sold those. A heading shaped as a question is the page ASKING something, not being about it. Every other field keeps the whole outline.
  const outline = sanitizeEvidenceTexts(input.outline).filter((h) => input.field !== "meta" || !h.trim().endsWith("?"));
  const evidenceHints = sanitizeEvidenceTexts(input.evidenceHints ?? []);
  const grounded = [
    input.query,
    currentValue ?? "",
    outline.join(" "),
    evidenceHints.join(" "),
  ].join(" ");
  const dir = intentDirective(input.intent);
  const user = [
    // THE QUERY IS INTENT, NOT COPY (operator, 2026-08-31): labelled "Search/topic" and placed first, the model read it as the words to use and wrote the anchor "iran eagle", which is how somebody searches and not how anybody writes.
    `What the reader is trying to find (this is INTENT, never wording to copy): "${input.query}"`,
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

  // BEACON_500 item 30/74: additive-only - the pattern-aware builder only fires when a pageFamily is known, and both paths return '' (or the unchanged fragment) when the tenant has no measured winners yet for this exact field, leaving the prompt byte-identical to today.
  const lever = input.field === "title" || input.field === "h1" ? "title" : input.field === "answer_block" ? "answer" : "meta";
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
    tenantId: input.tenantId, ownWords: input.field === "answer_block" ? undefined : [input.pageLabel, ...outline].join(" "), // a summary field may repeat a superlative the page's own title or headings carry; body copy may not
    ...(input.unmarkPhrase ? { unmarkPhrase: input.unmarkPhrase } : {}),
    system: (ATOMIC_HEAD[input.field] ?? ATOMIC_HEAD.default!) + ATOMIC_EDIT_SYSTEM + (input.field === "answer_block" ? OPENING_ANSWER_CLAUSE : input.field === "meta" ? META_SUBJECT_CLAUSE : input.field === "title" || input.field === "h1" ? TITLE_SHAPE_CLAUSE : "") + fewShots,
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

  // BEACON_500 item 74: the atomic-edit rationale is the ONE free-text channel that already flows end-to-end into the daily card's "Beacon wrote this: <rationale>" line (build-today-preview.ts reads value.rationale into llmRationale). When a confident pattern backed this draft, prepend our exact controlled sentence so the card surfaces it without any change to that unrelated wiring - the model's own rationale sentence is kept right after it, never replaced.
  if (result.status === "drafted" && result.fewShot) {
    // Re-apply the schema's own 400-char rationale cap so this stays a VALID AtomicEditDraft.
    const merged = `${result.fewShot.sentence} ${result.value.rationale}`.trim().slice(0, 400);
    return { ...result, value: { ...result.value, rationale: merged } };
  }
  return result;
}

// ── concrete drafter: InternalLinkDraft (where one page should point a reader next) ──

type InternalLinkStructuredInput = {
  query: string;
  sourcePage: string;
  targetPage: string;
  /** What the destination is about, in the account's own words. */
  topic: string;
  evidenceHints?: string[];
  tenantId: string;
};

/** MARKUP AROUND THE RIGHT WORDS IS PUNCTUATION, NOT A PLACEHOLDER (live, 2026-08-31). Told in the plainest terms not to mark the anchor, the writer still returns "[Zanjan Rug]", and the placeholder firewall rightly refuses brackets, so every link candidate dies twice and buys nothing. Instructing harder was already tried and already failed. What the model got WRONG is the punctuation it wrapped around words that are otherwise exactly correct, so code unwraps it, the way the page's own typos are repaired rather than reproduced. It fires ONLY on a run that equals the model's own anchor: a real placeholder like "[insert year]" matches nothing and is still refused outright. PURE. */
function unmarkAnchor<T>(data: T, phrase?: string): T {
  const d = data as Record<string, unknown>;
  const a = (phrase ?? (typeof d.anchorText === "string" ? d.anchorText : "")).trim();
  if (a.length < 2 || !data || typeof data !== "object") return data;
  const q = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[(${q})\\]\\([^)]*\\)|\\[(${q})\\]|\\*\\*(${q})\\*\\*|\\*(${q})\\*`, "gi");
  const strip = (t: string): string => t.replace(re, (_m, ...g) => g.slice(0, 4).find((x) => typeof x === "string") ?? a);
  let moved = false; const out: Record<string, unknown> = { ...d };
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "string") { const t = strip(v); if (t !== v) { out[k] = t; moved = true; } }
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) { const t = (v as string[]).map(strip); if (t.some((x, i) => x !== v[i])) { out[k] = t; moved = true; } } }
  return moved ? (out as T) : data;
}
const INTERNAL_LINK_SYSTEM =
  "You place ONE link from a page to another page on the SAME site. Return ONLY a JSON object: " +
  '"sourcePage", "targetPage" (echo both exactly as given), "anchorText" (the exact words to link, 2 to 8 words), ' +
  '"linkSentence" (the one sentence to add or amend, containing that anchor text), "reason" (one sentence on what the reader gains), ' +
  '"riskNotes" (short strings, may be empty), "proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}), ' +
  // THE VALIDATOR REJECTS AN UNGROUNDED DRAFT (evidenceIsGrounded), so a prompt that never asked for the field, or never named the rule, spent a guaranteed-rejected attempt before the retry told the model what was owed.
  '"evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|dataforseo|competitor_teardown|owned_snapshot|fanout, and at least one ref must NOT be ga4 or clarity: those two say what people did once they arrived, never what anyone searched for), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps). ' +
  "The anchor text must describe the destination honestly and must never be a bare instruction like click here. Take the anchor from the destination's OWN name as its title and heading give it, in the most natural form a person would write mid-sentence: for a page titled \"Booted Eagle in Iran\" write \"booted eagle\" or \"Booted Eagle in Iran\", never the search phrase \"iran eagle\", which no page of that name uses. The anchor is resolved from the destination and may legitimately match the search when the destination genuinely carries that name, as a page titled \"Caspian Horse\" does for the search \"caspian horse\": what is refused is copying the query, never coincidence. Ground every word in " +
  // THE SENTENCE IS FINISHED PROSE, NOT MARKED-UP COPY (live, 2026-08-30): the model wrote the anchor inside
  // the sentence as "[iranian horse]", "[lion and sun flag]" and "[iran flags]", the placeholder firewall
  // rightly refused copy containing brackets, and both attempts died the same way, so every link candidate
  // failed twice and produced nothing. The anchor already travels as its own typed field; the sentence must
  // read as something a person could paste with no editing at all.
  "the evidence below, invent no fact, no figure and no web address, and never link a page to itself. No marketing language, no em-dashes and no en-dashes. " +
  "Write linkSentence as an ordinary finished sentence a person could paste as-is: the anchor words appear in it verbatim and UNMARKED. Never wrap them in square brackets, " +
  "parentheses, asterisks, quotes or markdown link syntax, and never write a placeholder of any kind: brackets in the copy are rejected outright. " +
  // WRITE ABOUT THE DESTINATION, NOT ABOUT THE LINK (live, 2026-08-31): with no destination evidence in the
  // packet the model had nothing true to say, so it described its own edit ("Famous Iranian Singers also has
  // an Explore More link to iranian horse") and asserted claims like "The body includes a link labeled iranian
  // horse", which no evidence can ever carry. The destination's own words now travel as owned-page-target-* ids.
  "The sentence tells the reader what they will find on the destination page, in the reader's terms. Never write about the link itself, the site's navigation or this edit: " +
  "sentences of the form \"this page now has a link to X\" or \"X also has an Explore More link\" are refused. Anything the sentence says the destination covers must come from the " +
  "owned-page-target-* evidence, which is that page's own title, headings and copy. The figures about impressions, positions and clicks explain WHY this link is worth adding and " +
  "may never be repeated in the sentence or used to support what the destination is about. " +
  // THE MODEL STILL DESCRIBED THE MECHANISM (live, 2026-08-31): given the destination's own words it wrote "The Parthian and Sassanian Empires period includes a link to the parthian empire flag", which is a sentence about the edit wearing the destination's vocabulary. A worked pair is worth more than another prohibition.
  "Write the sentence a good editor would add to that spot. GOOD: \"For the banner this era flew, see the Parthian Empire flag.\" GOOD: \"Compare this design with the late Safavid military flag.\" BAD: \"This page includes a link to the Parthian Empire flag.\" BAD: \"The Parthian and Sassanian Empires period includes a link to the parthian empire flag.\" BAD: \"Click here to learn more.\" " +
  "The words link, page, section, article and site must not appear in the sentence describing what you are adding, and never claim in claims[] that a link now exists: claim only what the destination genuinely covers.";

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

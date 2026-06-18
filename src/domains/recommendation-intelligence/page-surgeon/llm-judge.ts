/**
 * Page Surgeon — LLM JUDGE (W1a upgrade: multi-change battle plan). A 10x
 * SEO/AEO operator over the evidence packet. It returns a PRIMARY atomic change
 * + SUPPORTING changes (with dependency order) + REJECTED changes, researches
 * out-of-the-box WORDING alternatives grounded in GSC/SEMrush, and names what a
 * normal SEO would miss + why it isn't just a title tweak. Uses ONLY packet
 * numbers. Any failure → deterministic page decision (visible fallback). The
 * deterministic GATE alone sets confidence caps + publishability.
 */

import "server-only";

import { log } from "@/lib/logger";
import type { EvidencePacket } from "./contract";
import type { BrandConfig } from "./title-candidates";
import {
  applyDeterministicGate,
  buildSourceCoverage,
  deterministicPageDecision,
  type AtomicChange,
  type PageAtomicDecision,
  type WordingResearch,
} from "./page-decision";

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5-mini";

const CHANGE_ACTIONS = [
  "title", "h1", "meta", "intro_answer_block", "faq",
  "section_add", "section_remove", "section_reorder",
  "internal_link", "schema", "image_alt", "ux_cta_fix",
  "citation_source", "create_new_page",
] as const;
const HEADLINE_ACTIONS = [...CHANGE_ACTIONS, "keep_current", "needs_more_evidence", "needs_llm_review"] as const;

const SYSTEM_PROMPT = `
You are an elite SEO/AEO operator auditing ONE web page for ONE business, given a
structured evidence packet (Google Search Console, GA4, Microsoft Clarity,
SEMrush, Profound, and a crawl). Produce a BATTLE PLAN, not a single tweak.

THINK LIKE A 10x OPERATOR:
- A page often needs SEVERAL atomic changes. Choose exactly ONE primary (highest
  leverage) and list supporting changes with a dependency order (1 = do first).
- Consider every lever: title, h1, meta, intro_answer_block, faq, section_add/
  remove/reorder, internal_link, schema, image_alt, ux_cta_fix, citation_source,
  create_new_page. Title is just one.
- RESEARCH WORDING: brainstorm alternative phrasings for the page's concept
  (synonyms / how real people search — e.g. "swear words" vs "cuss words" vs
  "profanity" vs "bad words" vs "insults" vs "slang"). Ground each in the GSC
  queries (and SEMrush if present). Decide which wording belongs in the title vs
  meta vs h1 vs an FAQ vs a section. Put this in wording_research.
- USE THE MARKET CONTEXT: GSC is first-party truth about what is happening on
  THIS page. SEMrush (when present) is the broader market: semrush.keywords =
  this page's keyword portfolio (volume / kd / cpc / intent), relatedKeywords =
  query variants people also search, questionKeywords = question-form demand
  (answer-block / FAQ fodder), competitorDomains = the market rivals. Use GSC to
  say what's happening and SEMrush to judge whether the broader market / query /
  SERP context SUPPORTS the move (real volume behind a wording, real questions to
  answer, a competitive term worth targeting). Never let SEMrush override GSC.
- Name what a NORMAL SEO would MISS (what_normal_seo_misses) and why this is not
  just a title tweak (why_not_just_title).

HARD RULES:
- Use ONLY numbers present in the packet. NEVER invent a metric, ranking, volume,
  CTR, or SERP feature. If a source is absent, do not assume its values; note the
  gap instead.
- You may claim AI-citation / AEO impact ONLY if Profound evidence is present.
- If evidence is thin or moves are close, set confidence "needs_more_evidence"
  and keep the plan minimal.
- Each change.action MUST be one of: ${CHANGE_ACTIONS.join(", ")}.
- recommended_atomic_action MUST be one of: ${HEADLINE_ACTIONS.join(", ")} and must
  equal the primary change's action when a primary exists.

Output ONE JSON object, no prose around it, with EXACTLY these keys:
  recommended_atomic_action (string),
  primary_atomic_change (object or null) with keys: action, exact_change,
    evidence, hypothesis, risk, before_after {before, after},
    measurement, rollback, dependency_order (number),
  supporting_atomic_changes (array of the same object shape),
  rejected_changes (array of {action, reason}),
  wording_research (array of {variant, evidence, best_placement}),
  confidence (high|medium|low|needs_more_evidence),
  operator_insight (string),
  what_normal_seo_misses (string),
  why_not_just_title (string).
`;

export type JudgePageArgs = {
  packet: EvidencePacket;
  brand: BrandConfig;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asStrOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function parseChange(raw: unknown, fallbackOrder: number): AtomicChange | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const action = o.action;
  if (typeof action !== "string" || !CHANGE_ACTIONS.includes(action as (typeof CHANGE_ACTIONS)[number]))
    return null;
  const ba = (o.before_after ?? {}) as Record<string, unknown>;
  return {
    action: action as AtomicChange["action"],
    exact_change: asStr(o.exact_change),
    evidence: asStr(o.evidence),
    hypothesis: asStr(o.hypothesis),
    risk: asStr(o.risk),
    before_after: { before: asStrOrNull(ba.before), after: asStrOrNull(ba.after) },
    measurement: asStr(o.measurement),
    rollback: asStr(o.rollback),
    publishability: "review_only", // gate overrides
    dependency_order:
      typeof o.dependency_order === "number" ? o.dependency_order : fallbackOrder,
  };
}

function sanitize(raw: unknown, packet: EvidencePacket): PageAtomicDecision | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const action = o.recommended_atomic_action;
  if (typeof action !== "string" || !HEADLINE_ACTIONS.includes(action as (typeof HEADLINE_ACTIONS)[number]))
    return null;
  const conf = o.confidence;
  if (typeof conf !== "string" || !["high", "medium", "low", "needs_more_evidence"].includes(conf))
    return null;

  const primary = parseChange(o.primary_atomic_change, 1);
  const supporting = Array.isArray(o.supporting_atomic_changes)
    ? o.supporting_atomic_changes
        .map((c, i) => parseChange(c, i + 2))
        .filter((c): c is AtomicChange => c != null)
    : [];
  const rejected = Array.isArray(o.rejected_changes)
    ? o.rejected_changes
        .filter((r): r is { action: string; reason: string } => r != null && typeof (r as { action?: unknown }).action === "string")
        .map((r) => ({ action: asStr(r.action), reason: asStr(r.reason) }))
    : [];
  const wording: WordingResearch[] = Array.isArray(o.wording_research)
    ? o.wording_research
        .filter((w): w is Record<string, unknown> => w != null && typeof w === "object")
        .map((w) => ({ variant: asStr(w.variant), evidence: asStr(w.evidence), best_placement: asStr(w.best_placement) }))
        .filter((w) => w.variant.length > 0)
    : [];

  const coverage = buildSourceCoverage(packet);
  return {
    pageUrl: packet.current.pageUrl,
    recommended_atomic_action: action as PageAtomicDecision["recommended_atomic_action"],
    primary_atomic_change: primary,
    supporting_atomic_changes: supporting,
    rejected_changes: rejected,
    source_coverage: coverage,
    wording_research: wording,
    confidence: conf as PageAtomicDecision["confidence"],
    operator_insight: asStr(o.operator_insight),
    what_normal_seo_misses: asStr(o.what_normal_seo_misses),
    why_not_just_title: asStr(o.why_not_just_title),
    evidence_gaps: coverage.filter((c) => !c.used).map((c) => `${c.source}: ${c.detail}`),
    decided_by: "llm_judge",
  };
}

export async function judgePageAtomicChange(args: JudgePageArgs): Promise<PageAtomicDecision> {
  const { packet, brand } = args;
  const fallback = () => deterministicPageDecision(packet, brand);

  if (process.env.VITEST === "true" && !args.fetchImpl) return fallback();
  if (process.env.NEXT_PHASE === "phase-production-build" && process.env.BEACON_LLM_BUILD_OK !== "1")
    return fallback();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey && !args.fetchImpl) {
    log.warn("[page-surgeon-judge] no OPENAI_API_KEY in process env; deterministic fallback", {
      page: packet.current.pageUrl,
    });
    return fallback();
  }

  const model = args.model ?? DEFAULT_MODEL;
  const fetchImpl = args.fetchImpl ?? fetch;
  // gpt-5-mini is a REASONING model. Measured latency on a real multi-change
  // packet (2026-06-18): reasoning_effort medium (its default) ~44s — over the
  // old 40s timeout, so EVERY call aborted to fallback; low ~32s; minimal ~19s.
  // "low" keeps genuine reasoning while staying well under the timeout, and 90s
  // gives headroom for larger packets (e.g. SEMrush keyword enrichment).
  const timeoutMs = args.timeoutMs ?? 90_000;

  const body = JSON.stringify({
    model,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      { role: "user", content: `Evidence packet (use ONLY these numbers):\n${JSON.stringify(packet, null, 2)}` },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 8_000,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(OPENAI_CHAT_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey ?? "test"}`, "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn("[page-surgeon-judge] non-2xx; deterministic fallback", { status: res.status, page: packet.current.pageUrl });
      return fallback();
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    // gpt-5-mini is a reasoning model: if reasoning eats the whole token budget
    // the call returns finish_reason="length" with truncated/empty content. Treat
    // that as an explicit, LOGGED fallback (never a silent "keep_current").
    if (choice?.finish_reason === "length") {
      log.warn("[page-surgeon-judge] truncated (finish_reason=length); raise budget or shrink packet; deterministic fallback", {
        page: packet.current.pageUrl,
      });
      return fallback();
    }
    if (!content) {
      log.warn("[page-surgeon-judge] empty content; deterministic fallback", {
        page: packet.current.pageUrl,
        finish: choice?.finish_reason,
      });
      return fallback();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      log.warn("[page-surgeon-judge] content not valid JSON; deterministic fallback", {
        page: packet.current.pageUrl,
      });
      return fallback();
    }
    const decision = sanitize(parsed, packet);
    if (decision == null) {
      log.warn("[page-surgeon-judge] sanitize rejected; deterministic fallback", { page: packet.current.pageUrl });
      return fallback();
    }
    return applyDeterministicGate(decision, packet);
  } catch (e) {
    log.warn("[page-surgeon-judge] threw; deterministic fallback", {
      page: packet.current.pageUrl,
      error: e instanceof Error ? e.message : String(e),
    });
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

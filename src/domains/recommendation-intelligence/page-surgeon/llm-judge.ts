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
import { estimateCost, openAIChatCompletion, recordGatewaySpend } from "@/domains/llm/gateway";
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
Profound, and a crawl). Work in TWO STAGES — DIAGNOSE, then PLAN. A plan
that is not tied to a diagnosed bottleneck will be rejected.

STAGE 1 — DIAGNOSE (do this FIRST, before considering any change):
- Identify the SINGLE biggest reason this page underperforms the demand it
  already has, grounded ONLY in packet numbers (e.g. "page-1 query 'pedar sag
  meaning' has 438 impressions but 0.2% CTR at position 7 — the result doesn't
  answer the searcher's intent in the snippet"). Pick ONE root cause, not a list.
- State what you RULED OUT: the levers that look plausible but the data does NOT
  support (e.g. "the title already contains the dominant query, so re-titling is
  not the lever"). This is what stops a reflex title rewrite.
- Put this in diagnosis = {bottleneck, evidence, ruled_out}, and make
  operator_insight LEAD with the diagnosed bottleneck.

STAGE 2 — PLAN (only after diagnosing; every change must resolve the bottleneck):
- Choose exactly ONE primary atomic change that DIRECTLY fixes the diagnosed
  bottleneck (highest leverage), plus supporting changes with a dependency order
  (1 = do first). Do not propose changes unrelated to the diagnosis.
- Consider every lever: title, h1, meta, intro_answer_block, faq, section_add/
  remove/reorder, internal_link, schema, image_alt, ux_cta_fix, citation_source,
  create_new_page. Title is just one.
- RESEARCH WORDING: brainstorm alternative phrasings for the page's concept
  (synonyms / how real people search — e.g. "swear words" vs "cuss words" vs
  "profanity" vs "bad words" vs "insults" vs "slang"). Ground each in the GSC
  queries. Decide which wording belongs in the title vs
  meta vs h1 vs an FAQ vs a section. Put this in wording_research.
- Name what a NORMAL SEO would MISS (what_normal_seo_misses) and why this is not
  just a title tweak (why_not_just_title).

HARD RULES:
- Use ONLY numbers present in the packet. NEVER invent a metric, ranking, volume,
  CTR, or SERP feature. If a source is absent, do not assume its values; note the
  gap instead.
- You may claim AI-citation / AEO impact ONLY if Profound evidence is present.
- If evidence is thin or moves are close, set confidence "needs_more_evidence"
  and keep the plan minimal.

TRUST RULES (a deterministic gate enforces these; violating them gets the change
rejected, so follow them to keep your plan intact):
- NEVER cite a packet field that is empty/absent. If ga4 is absent, do not claim
  conversions/engagement/sessions. Do not cite keyword-research data (related
  keywords, question keywords, search volume, competitor rankings) — no such
  source is wired. Only cite what is actually in the packet.
- A null metric means NOT MEASURED, not zero. Do not reason from a null as if it
  were 0.
- NO snippet deficit → NO title/meta rewrite. If GSC CTR is at/above the
  expectedCtrForPosition (ctrGap ≈ 0) AND the current title already contains the
  dominant query's terms, prefer keep_current over a title/meta change — unless a
  page-1 query gets ~0 clicks. Don't rewrite a title that's already working.
- image_alt is OFF-LIMITS: the crawl carries no image/alt data, so you cannot
  ground an image_alt change. Do not propose one.
- ux_cta_fix ONLY when Clarity shows MEANINGFUL friction (significant dead/rage
  clicks). A handful of dead clicks or a single quickback is noise — do not build
  a behavioral argument on it. But when Clarity DOES show real friction, propose
  the UX fix — do not reject it.
- FAQ: a VISIBLE Q&A block is a valid lever, but NEVER use the words "rich result",
  "rich snippet", or "SERP real estate", and never tie FAQ to CTR/rich results —
  Google deprecated FAQ rich results for most sites in 2023. Justify a FAQ ONLY by
  real question / "meaning" demand, citing the specific zero-click queries it
  answers.
- LEAD WITH THE ANSWER BLOCK when warranted: if the page has page-1 "meaning" /
  definition queries that earn ~0 clicks AND a CTR deficit, the PRIMARY should be
  intro_answer_block (answer those queries directly, above the fold), with title a
  SUPPORTING change — don't default to a title rewrite.
- schema is low priority: only propose it when the crawl shows the page is missing
  schema and its page type supports it.
- Each change.action MUST be one of: ${CHANGE_ACTIONS.join(", ")}.
- recommended_atomic_action MUST be one of: ${HEADLINE_ACTIONS.join(", ")} and must
  equal the primary change's action when a primary exists.

FINISHED CONTENT (operator-draft, not a directive — write the REAL thing):
- For title/meta/h1: exact_change MUST be the literal production string to ship
  (the actual new title text), nothing else. Title ≤ 60 chars, meta ≤ 155 chars
  (count the characters — a meta over the limit will be trimmed).
- For intro_answer_block or section_add: put the LITERAL 2–4 sentence block to
  publish in artifact_text (real, on-brand prose — no "[insert]" placeholders).
- For faq: put the LITERAL Q&A pairs in faq_items (3–5 items, each a real
  question + a real answer). Do not describe them — write them.

Output ONE JSON object, no prose around it, with EXACTLY these keys:
  diagnosis (object) with keys: bottleneck (string), evidence (string),
    ruled_out (string) — the STAGE 1 root cause, its packet evidence, and what
    you ruled out,
  recommended_atomic_action (string),
  primary_atomic_change (object or null) with keys: action, exact_change,
    evidence, hypothesis, risk, before_after {before, after},
    measurement, rollback, dependency_order (number),
    artifact_text (string or null — the literal block copy when applicable),
    faq_items (array of {question, answer} or null — for the faq action),
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
  const faqItems = Array.isArray(o.faq_items)
    ? o.faq_items
        .filter((f): f is Record<string, unknown> => f != null && typeof f === "object")
        .map((f) => ({ question: asStr(f.question), answer: asStr(f.answer) }))
        .filter((f) => f.question.length > 0 && f.answer.length > 0)
    : null;
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
    artifact_text: asStrOrNull(o.artifact_text),
    faq_items: faqItems && faqItems.length > 0 ? faqItems : null,
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

  // STAGE-1 diagnosis: fold the diagnosed bottleneck into operator_insight so the
  // gate's existing insight plumbing surfaces it (and WL1 still overwrites it with
  // a protective insight on a keep_current collapse). Requiring the structured
  // diagnosis is what enforces diagnose-BEFORE-plan; leading the insight with it
  // is what the operator sees.
  const dx = o.diagnosis && typeof o.diagnosis === "object" ? (o.diagnosis as Record<string, unknown>) : null;
  const bottleneck = dx ? asStr(dx.bottleneck) : "";
  let operatorInsight = asStr(o.operator_insight);
  const bottleneckKey = bottleneck.slice(0, 24).toLowerCase();
  if (bottleneck && (!operatorInsight || !operatorInsight.toLowerCase().includes(bottleneckKey))) {
    operatorInsight = `Bottleneck: ${bottleneck}${operatorInsight ? ` ${operatorInsight}` : ""}`;
  }

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
    operator_insight: operatorInsight,
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
  // gpt-5-mini is a REASONING model. Measured latency on a real multi-change
  // packet (2026-06-18): reasoning_effort medium (its default) ~44s — over the
  // old 40s timeout, so EVERY call aborted to fallback; low ~32s; minimal ~19s.
  // "low" keeps genuine reasoning while staying well under the timeout, and 90s
  // gives headroom for larger packets (e.g. SEMrush keyword enrichment).
  const timeoutMs = args.timeoutMs ?? 90_000;

  const body = {
    model,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      { role: "user", content: `Evidence packet (use ONLY these numbers):\n${JSON.stringify(packet, null, 2)}` },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 8_000,
  };

  try {
    // R16: transport via the ONE gateway. The judge previously had NO monthly
    // cap - gateway_check closes that hole (budget blocked / ledger unreadable
    // -> loud deterministic fallback, never an uncapped paid call), and spend
    // is recorded from real usage tokens below.
    const outcome = await openAIChatCompletion({
      promptId: "page_surgeon.judge",
      promptVersion: 1,
      action: "page-surgeon-judge",
      apiKey: apiKey ?? "test",
      body,
      timeoutMs,
      budget: { mode: "gateway_check", projectedCostUsd: 0.02 },
      fetchImpl: args.fetchImpl,
      tenantId: packet.current.tenantId,
    });
    if (outcome.kind === "blocked_budget") {
      log.warn("[page-surgeon-judge] budget blocked; deterministic fallback", {
        reason: outcome.reason,
        page: packet.current.pageUrl,
      });
      return fallback();
    }
    if (outcome.kind === "error") {
      log.warn("[page-surgeon-judge] threw; deterministic fallback", {
        page: packet.current.pageUrl,
        error: outcome.reason,
      });
      return fallback();
    }
    const res = outcome.response;
    if (!res.ok) {
      log.warn("[page-surgeon-judge] non-2xx; deterministic fallback", { status: res.status, page: packet.current.pageUrl });
      return fallback();
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    // The call happened - record the real spend against the monthly cap.
    await recordGatewaySpend(
      estimateCost(model, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0),
    );
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
  }
}

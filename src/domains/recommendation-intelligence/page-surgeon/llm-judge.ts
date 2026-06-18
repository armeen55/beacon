/**
 * Page Surgeon — LLM JUDGE (W1a). A 10x SEO/AEO operator over the evidence
 * packet. It does NOT just write titles: it decides the single highest-leverage
 * ATOMIC action for the page (title / meta / intro answer / section move / new
 * section / internal link / schema / UX / cannibalization / create-new-page /
 * keep_current), surfaces the non-obvious pattern, and uses ONLY the numbers in
 * the packet (never invents a metric).
 *
 * Safety (mirrors the openai provider): VITEST + build-phase guards, API-key
 * check, strict JSON schema, bounded tokens. ANY failure → the deterministic
 * page decision (visible `decided_by="deterministic_fallback"`). The
 * deterministic GATE runs on the LLM output too — it alone sets confidence caps
 * + publishability; the LLM can propose but never publish.
 */

import "server-only";

import { log } from "@/lib/logger";
import type { EvidencePacket } from "./contract";
import type { BrandConfig } from "./title-candidates";
import {
  applyDeterministicGate,
  deterministicPageDecision,
  type AtomicAction,
  type PageAtomicDecision,
} from "./page-decision";

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5-mini";

const ATOMIC_ACTIONS: AtomicAction[] = [
  "title", "h1", "meta", "intro_answer_block", "faq",
  "section_add", "section_remove", "section_reorder",
  "internal_link", "schema", "image_alt", "ux_cta_fix",
  "citation_source", "create_new_page", "keep_current", "needs_more_evidence",
];

const SYSTEM_PROMPT = `
You are an elite SEO/AEO operator auditing ONE web page for ONE business. You are
given a structured evidence packet (Google Search Console, GA4, Microsoft
Clarity, SEMrush, Profound, and a crawl of the page). Decide the SINGLE
highest-leverage ATOMIC change for this page — the move a great operator would
make first — or that the page should be left alone.

CRITICAL RULES:
- Use ONLY numbers present in the evidence packet. NEVER invent a metric, a
  ranking, a volume, or a CTR. If a source is absent, do not assume its value.
- Title is only ONE option. Consider whether the real bottleneck is the meta
  description, an intro answer block, a missing/!-reordered section, an internal
  link, schema, a UX/CTA problem (Clarity), cannibalization, or a NEW page.
- A normal SEO associate would just "rewrite the title". Find what they'd MISS:
  the non-obvious pattern across sources (operator_insight).
- If the evidence is thin or two moves are close, return "keep_current" or
  "needs_more_evidence" — do not force a change.
- You may claim AI-citation / AEO impact ONLY if Profound evidence is present.
- recommended_atomic_action MUST be one of the allowed values.
- title_candidate is non-null ONLY when recommended_atomic_action is "title".
- Output a SINGLE JSON object, no prose around it, with EXACTLY these keys:
  recommended_atomic_action (string, one of the allowed values),
  title_candidate (string or null),
  rejected_alternatives (array of {action, reason}),
  evidence_by_source (object with any of: gsc, ga4, clarity, semrush, profound, crawl → short strings),
  hypothesis (string), risk (string),
  before_after_diff ({before: string|null, after: string|null}),
  measurement_plan (string), rollback_plan (string),
  confidence (one of: high, medium, low, needs_more_evidence),
  operator_insight (string).
`;

export type JudgePageArgs = {
  packet: EvidencePacket;
  brand: BrandConfig;
  /** REQUIRED in vitest; defaults to global fetch otherwise. */
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

/** Sanitize the raw LLM object into a PageAtomicDecision (gate applied after). */
function sanitize(
  raw: unknown,
  packet: EvidencePacket,
): PageAtomicDecision | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const action = o.recommended_atomic_action;
  if (typeof action !== "string" || !ATOMIC_ACTIONS.includes(action as AtomicAction))
    return null;
  const conf = o.confidence;
  if (
    typeof conf !== "string" ||
    !["high", "medium", "low", "needs_more_evidence"].includes(conf)
  )
    return null;
  const diff = (o.before_after_diff ?? {}) as Record<string, unknown>;
  const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
  const asStrOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    pageUrl: packet.current.pageUrl,
    recommended_atomic_action: action as AtomicAction,
    // title only valid for the title action; ignore stray titles otherwise.
    title_candidate: action === "title" ? asStrOrNull(o.title_candidate) : null,
    rejected_alternatives: Array.isArray(o.rejected_alternatives)
      ? o.rejected_alternatives
          .filter((r): r is { action: string; reason: string } =>
            r != null && typeof (r as { action?: unknown }).action === "string")
          .map((r) => ({ action: asStr(r.action), reason: asStr(r.reason) }))
      : [],
    evidence_by_source:
      o.evidence_by_source && typeof o.evidence_by_source === "object"
        ? (o.evidence_by_source as PageAtomicDecision["evidence_by_source"])
        : {},
    hypothesis: asStr(o.hypothesis),
    risk: asStr(o.risk),
    before_after_diff: { before: asStrOrNull(diff.before), after: asStrOrNull(diff.after) },
    measurement_plan: asStr(o.measurement_plan),
    rollback_plan: asStr(o.rollback_plan),
    confidence: conf as PageAtomicDecision["confidence"],
    operator_insight: asStr(o.operator_insight),
    publishability: "review_only", // gate overrides
    decided_by: "llm_judge",
  };
}

/**
 * Run the LLM judge over a page's evidence packet. Returns a gated
 * PageAtomicDecision. On ANY problem (no key, vitest w/o fetchImpl, build phase,
 * non-2xx, parse/sanitize fail, timeout) it returns the deterministic page
 * decision — visibly flagged — so the caller always gets a safe answer.
 */
export async function judgePageAtomicChange(
  args: JudgePageArgs,
): Promise<PageAtomicDecision> {
  const { packet, brand } = args;
  const fallback = () => deterministicPageDecision(packet, brand);

  // Safety gates (mirror the openai provider).
  if (process.env.VITEST === "true" && !args.fetchImpl) return fallback();
  if (
    process.env.NEXT_PHASE === "phase-production-build" &&
    process.env.BEACON_LLM_BUILD_OK !== "1"
  )
    return fallback();
  // A real run needs the key; an injected fetchImpl (tests) mocks the network
  // and does not. Only bail for a missing key when calling the real network.
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey && !args.fetchImpl) return fallback();

  const model = args.model ?? DEFAULT_MODEL;
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? 30_000;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      {
        role: "user",
        content:
          `Allowed atomic actions: ${ATOMIC_ACTIONS.join(", ")}\n\n` +
          `Evidence packet (use ONLY these numbers):\n${JSON.stringify(packet, null, 2)}`,
      },
    ],
    // Lenient JSON mode — our sanitize() is the validator. (Strict json_schema
    // with optional evidence_by_source keys 400s on the API.)
    response_format: { type: "json_object" },
    // gpt-5 family burns reasoning tokens before output — give headroom.
    max_completion_tokens: 6_000,
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
      log.warn("[page-surgeon-judge] non-2xx; deterministic fallback", {
        status: res.status,
        page: packet.current.pageUrl,
      });
      return fallback();
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return fallback();
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return fallback();
    }
    const decision = sanitize(parsed, packet);
    if (decision == null) {
      log.warn("[page-surgeon-judge] sanitize rejected; deterministic fallback", {
        page: packet.current.pageUrl,
      });
      return fallback();
    }
    // The deterministic gate is the sole authority on confidence/publishability.
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

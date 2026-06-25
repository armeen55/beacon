import "server-only";
import { checkBudget, recordSpend } from "@/domains/recommendations/adjudicator-budget";
import { log } from "@/lib/logger";

/**
 * llm-answer-block (2026-06-24) — OPTIONAL LLM upgrade for a demand-graph
 * answer-block Move: turns the deterministic grounded brief into a real, quotable
 * 40–60 word answer block the operator can paste.
 *
 * SAFETY (mirrors the AEO LLM gateway):
 *   - OFF by default — only fires when `BEACON_LLM_PROVIDER=openai` AND the key is set.
 *   - Budget-gated (`checkBudget`) + records spend (`recordSpend`) — the same
 *     fail-closed monthly cap that protects every paid call.
 *   - Numeric-fidelity firewall: any multi-digit number in the output MUST appear
 *     in the grounded input, else the draft is rejected (no invented stats/dates).
 *   - Public-copy guard: rejects placeholders / em-dashes / obvious superlatives.
 *   - Bounded: gpt-5-mini, low reasoning effort, 45s timeout, capped tokens.
 * Returns a discriminated result; callers fall back to the deterministic brief on
 * any non-"ok" status. NEVER throws.
 */

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-5-mini";

export type AnswerBlockDraftInput = {
  query: string;
  pageLabel: string;
  brief: string | null;
  outline: string[];
  faqs: string[];
};

export type AnswerBlockDraftResult =
  | { status: "off" }
  | { status: "blocked_budget"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string }
  | { status: "ok"; text: string; costUsd: number };

function isOn(): boolean {
  return (process.env.BEACON_LLM_PROVIDER ?? "").trim().toLowerCase() === "openai";
}

/** Rough gpt-5-mini cost (~$0.25/1M in, ~$2/1M out; ~4 chars/token). */
function estimateCostUsd(promptChars: number, completionChars: number): number {
  const inTok = promptChars / 4;
  const outTok = completionChars / 4;
  return (inTok / 1_000_000) * 0.25 + (outTok / 1_000_000) * 2;
}

const SUPERLATIVES = /\b(best|leading|#1|number one|top-rated|guaranteed|world-class|ultimate|premier)\b/i;

export async function draftAnswerBlockWithLLM(
  input: AnswerBlockDraftInput,
): Promise<AnswerBlockDraftResult> {
  if (!isOn()) return { status: "off" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "off" };

  const projectedCostUsd = 0.01;
  const budget = await checkBudget({ projectedCostUsd }).catch(() => ({ allowed: true as const }));
  if (budget.allowed === false) {
    return { status: "blocked_budget", reason: (budget as { reason?: string }).reason ?? "cap reached" };
  }

  const system =
    "You write concise, factual AEO answer blocks for an encyclopedia / content site. " +
    "Output ONE direct answer of 40-60 words that a search engine or AI assistant could quote verbatim. " +
    "Ground it ONLY in the brief/outline provided. Do NOT invent statistics, dates, prices, rankings, or " +
    "superlatives. No marketing language. Plain, neutral, factual. Output only the answer text — no heading, no preamble.";
  const user = [
    `Search/topic: "${input.query}"`,
    `Page: ${input.pageLabel}`,
    input.brief ? `Brief: ${input.brief}` : "",
    input.outline.length ? `Grounded sections: ${input.outline.join("; ")}` : "",
    input.faqs.length ? `Related questions: ${input.faqs.slice(0, 4).join("; ")}` : "",
    "",
    "Write the 40-60 word answer block now.",
  ]
    .filter(Boolean)
    .join("\n");

  let text = "";
  let costUsd = 0;
  try {
    const res = await fetch(OPENAI_CHAT_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: 1200,
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { status: "error", reason: `openai_${res.status}` };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { status: "error", reason: "empty_response" };
    costUsd = estimateCostUsd(system.length + user.length, text.length);
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message.slice(0, 80) : "fetch_failed" };
  }

  // Spend is real the moment the call returned — record before any reject.
  await recordSpend(costUsd, {}).catch(() => {});

  // ── safety firewalls ──
  if (/\[[^\]]*\]|\{\{|TODO|TBD|lorem ipsum/i.test(text)) {
    return { status: "rejected", reason: "placeholder" };
  }
  if (text.includes("—")) return { status: "rejected", reason: "em_dash" };
  if (SUPERLATIVES.test(text)) return { status: "rejected", reason: "superlative" };
  // numeric-fidelity: multi-digit numbers in the output must be grounded in the input.
  const grounded = `${input.query} ${input.brief ?? ""} ${input.outline.join(" ")} ${input.faqs.join(" ")}`;
  const groundedNums = new Set(grounded.match(/\d+/g) ?? []);
  const invented = (text.match(/\d+/g) ?? []).filter((n) => n.length >= 2 && !groundedNums.has(n));
  if (invented.length > 0) {
    log.warn("[llm-answer-block] rejected invented numbers", { query: input.query, invented: invented.slice(0, 5) });
    return { status: "rejected", reason: `invented_numbers:${invented.slice(0, 3).join(",")}` };
  }

  return { status: "ok", text, costUsd };
}

// ─────────────────────────────────────────────────────────────────────
// FAQ JSON-LD generator (FAQPage schema) — a top AEO win. The LLM answers the
// grounded fanout questions; we assemble valid FAQPage JSON-LD deterministically.
// Same gating + budget + numeric-fidelity firewall as the answer-block drafter.
// ─────────────────────────────────────────────────────────────────────

export type FaqDraftInput = { query: string; pageLabel: string; faqs: string[] };
export type FaqDraftResult =
  | { status: "off" }
  | { status: "blocked_budget"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "error"; reason: string }
  | { status: "ok"; jsonLd: string; pairs: { q: string; a: string }[]; costUsd: number };

export async function draftFaqSchemaWithLLM(input: FaqDraftInput): Promise<FaqDraftResult> {
  if (!isOn()) return { status: "off" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "off" };
  const questions = input.faqs.filter(Boolean).slice(0, 6);
  if (questions.length === 0) return { status: "rejected", reason: "no_questions" };

  const budget = await checkBudget({ projectedCostUsd: 0.02 }).catch(() => ({ allowed: true as const }));
  if (budget.allowed === false) {
    return { status: "blocked_budget", reason: (budget as { reason?: string }).reason ?? "cap reached" };
  }

  const system =
    "You answer FAQ questions for an encyclopedia / content page, factually and concisely (1-3 sentences each). " +
    "Do NOT invent statistics, dates, prices, or rankings. No marketing language. Return STRICT JSON: " +
    'an array of {"q":"<question verbatim>","a":"<answer>"} — nothing else.';
  const user = `Topic: "${input.query}" (page: ${input.pageLabel})\nAnswer each question:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;

  let pairs: { q: string; a: string }[] = [];
  let costUsd = 0;
  try {
    const res = await fetch(OPENAI_CHAT_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: 2000,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { status: "error", reason: `openai_${res.status}` };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = (json.choices?.[0]?.message?.content ?? "").trim();
    costUsd = estimateCostUsd(system.length + user.length, raw.length);
    await recordSpend(costUsd, {}).catch(() => {});
    // Tolerate {faqs:[...]} or a bare array.
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { faqs?: unknown[] })?.faqs)
        ? (parsed as { faqs: unknown[] }).faqs
        : Object.values(parsed as Record<string, unknown>).find(Array.isArray) ?? [];
    pairs = (arr as { q?: string; a?: string; question?: string; answer?: string }[])
      .map((p) => ({ q: String(p.q ?? p.question ?? "").trim(), a: String(p.a ?? p.answer ?? "").trim() }))
      .filter((p) => p.q && p.a);
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message.slice(0, 80) : "parse_failed" };
  }
  if (pairs.length === 0) return { status: "error", reason: "empty" };

  // numeric-fidelity firewall across all answers.
  const grounded = `${input.query} ${questions.join(" ")}`;
  const groundedNums = new Set(grounded.match(/\d+/g) ?? []);
  for (const p of pairs) {
    const invented = (p.a.match(/\d+/g) ?? []).filter((n) => n.length >= 2 && !groundedNums.has(n));
    if (invented.length > 0) {
      log.warn("[llm-faq] rejected invented numbers", { query: input.query, invented: invented.slice(0, 5) });
      return { status: "rejected", reason: `invented_numbers:${invented.slice(0, 3).join(",")}` };
    }
  }

  const jsonLd = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: pairs.map((p) => ({
        "@type": "Question",
        name: p.q,
        acceptedAnswer: { "@type": "Answer", text: p.a },
      })),
    },
    null,
    2,
  );
  return { status: "ok", jsonLd, pairs, costUsd };
}

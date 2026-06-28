import "server-only";
import { z } from "zod";
import { checkBudget, recordSpend } from "@/domains/recommendations/adjudicator-budget";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { log } from "@/lib/logger";
import {
  SCHEMA_BY_KIND,
  draftStringValues,
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
 *   gate (BEACON_LLM_PROVIDER=openai + key) → budget (fail-closed cap) → call
 *   → robust JSON extract → Zod validate → content firewalls (numeric-fidelity,
 *   placeholder, em-dash, superlative) → RETRY ONCE on failure → FAIL CLOSED.
 *
 * It NEVER returns loose/unvalidated text as a product artifact. Spend is
 * recorded the moment a call returns (even if the draft is later rejected). The
 * completion fn is injectable so the whole flow is unit-tested with zero paid
 * calls. Mirrors the lessons in llm-answer-block.ts (gpt-5-mini reasoning models
 * return empty under response_format, so we parse JSON out of the text robustly).
 *
 * Tenant-agnostic. Pinned by structured-drafter.test.ts.
 */

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-5-mini";
const MAX_DRAFT_CHARS = 11_500; // stay under the move_drafts 12k content cap

export type StructuredDraftResult<T> =
  | { status: "off" }
  | { status: "blocked_budget"; reason: string }
  | { status: "validation_failed"; reason: string; errors: string[]; costUsd: number; retried: boolean }
  | { status: "drafted"; kind: StructuredDraftKind; value: T; costUsd: number; retried: boolean };

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

/** Rough gpt-5-mini cost (~$0.25/1M in, ~$2/1M out; ~4 chars/token). */
function estimateCostUsd(promptChars: number, completionChars: number): number {
  return (promptChars / 4 / 1_000_000) * 0.25 + (completionChars / 4 / 1_000_000) * 2;
}

const SUPERLATIVES = /\b(best|leading|#1|number one|top-rated|guaranteed|world-class|ultimate|premier)\b/i;

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

/** Content firewalls over every string field of a parsed draft. Same trust rails
 *  as the deterministic drafter: no placeholders, no em-dashes, no superlatives,
 *  and no invented multi-digit numbers (must be grounded — years allowed). */
function runContentFirewalls(
  strings: string[],
  grounded: string,
  nowYear: number,
): { ok: true } | { ok: false; reason: string } {
  const blob = strings.join("  ");
  if (/\[[^\]]*\]|\{\{|TODO|TBD|lorem ipsum/i.test(blob)) return { ok: false, reason: "placeholder" };
  if (blob.includes("—")) return { ok: false, reason: "em_dash" };
  if (SUPERLATIVES.test(blob)) return { ok: false, reason: "superlative" };
  // Normalize thousands separators so "16,444" matches a grounded "16444" — a
  // comma-formatted grounded number is the SAME number, not an invented stat.
  const stripThousands = (s: string) => s.replace(/(?<=\d),(?=\d)/g, "");
  const groundedNums = new Set(stripThousands(grounded).match(/\d+/g) ?? []);
  for (const y of [nowYear - 1, nowYear, nowYear + 1]) groundedNums.add(String(y));
  // Proof-window methodology constants (7/14/28-day measurement) are structural
  // language, not factual claims — allow them like years.
  for (const w of [7, 14, 28]) groundedNums.add(String(w));
  const invented = (stripThousands(blob).match(/\d+/g) ?? []).filter((n) => n.length >= 2 && !groundedNums.has(n));
  if (invented.length > 0) return { ok: false, reason: `invented_numbers:${invented.slice(0, 3).join(",")}` };
  return { ok: true };
}

function defaultComplete(apiKey: string): CompleteFn {
  return async ({ system, user, maxTokens, timeoutMs }) => {
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
          // gpt-5-mini reasoning tokens count against this budget — give headroom.
          // No response_format: it returns empty under reasoning; we parse robustly.
          max_completion_tokens: maxTokens,
          reasoning_effort: "low",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { error: `openai_${res.status}` };
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
};

/**
 * The engine: validate → retry-once → fail-closed. Returns a typed, schema-valid
 * draft or a non-"drafted" status. Never throws.
 */
export async function callStructuredLLM<K extends StructuredDraftKind>(
  req: StructuredDraftRequest<K>,
): Promise<StructuredDraftResult<z.infer<(typeof SCHEMA_BY_KIND)[K]>>> {
  if (!isOn()) return { status: "off" };
  const apiKey = process.env.OPENAI_API_KEY;
  const complete = req.complete ?? (apiKey ? defaultComplete(apiKey) : null);
  if (!complete) return { status: "off" }; // configured "on" but no key → off

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

  let totalCost = 0;
  const errors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retried = attempt > 0;
    const system =
      attempt === 0
        ? req.system
        : `${req.system}\n\nYour previous output was invalid: ${errors.slice(-3).join(" | ")}. Return ONLY valid JSON matching the described shape, with non-empty evidenceRefs.`;

    const out = await complete({ system, user: req.user, maxTokens, timeoutMs });
    if ("error" in out) {
      errors.push(`llm_${out.error}`);
      continue;
    }
    totalCost += estimateCostUsd(system.length + req.user.length, out.text.length);
    await recordSpend(estimateCostUsd(system.length + req.user.length, out.text.length), {}).catch(() => {});

    const parsedJson = robustJsonExtract(out.text);
    if (parsedJson === undefined) {
      errors.push("non_json");
      continue;
    }
    const result = schema.safeParse(sanitizeDashesDeep(parsedJson));
    if (!result.success) {
      errors.push(...result.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      continue;
    }
    const fw = runContentFirewalls(draftStringValues(result.data), req.grounded, nowYear);
    if (!fw.ok) {
      errors.push(`firewall:${fw.reason}`);
      continue;
    }
    return {
      status: "drafted",
      kind: req.kind,
      value: result.data as z.infer<(typeof SCHEMA_BY_KIND)[K]>,
      costUsd: totalCost,
      retried,
    };
  }

  log.warn("[structured-drafter] fail-closed", { kind: req.kind, errors: errors.slice(0, 6) });
  return { status: "validation_failed", reason: errors[0] ?? "unknown", errors, costUsd: totalCost, retried: true };
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
};

const ANSWER_BLOCK_SYSTEM =
  "You write structured AEO answer blocks for an encyclopedia / content site. Return ONLY a JSON object with keys: " +
  '"answer" (one direct factual answer of 40-60 words an AI assistant could quote verbatim), ' +
  '"citationHook" (a short quotable phrase, or null), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one, citing ONLY the grounding provided; source one of gsc|ga4|clarity|profound|dataforseo|semrush|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground everything ONLY in the brief/outline/questions provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes. " +
  "The FIRST sentence must be specific to THIS exact page/topic — name the concrete subject, not a generic category. Do NOT open with a context-free dictionary definition (e.g. \"A gift is a voluntarily transferred item…\"); a reader must immediately know which specific topic this answers. Never defer or punt (\"varies\", \"check elsewhere\", \"consult other sources\") — answer directly. Do not claim something is \"official\" unless the grounding states it.";

/** Draft a schema-valid AnswerBlockDraft for one Move. Capped + budgeted. */
export async function draftAnswerBlockStructured(
  input: AnswerBlockStructuredInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<AnswerBlockDraft>> {
  const grounded = [
    input.query,
    input.brief ?? "",
    input.outline.join(" "),
    input.faqs.join(" "),
    (input.evidenceHints ?? []).join(" "),
  ].join(" ");
  const user = [
    `Search/topic: "${input.query}"`,
    `Page: ${input.pageLabel}`,
    input.brief ? `Brief: ${input.brief}` : "",
    input.outline.length ? `Grounded sections: ${input.outline.join("; ")}` : "",
    input.faqs.length ? `Related questions: ${input.faqs.slice(0, 6).join("; ")}` : "",
    (input.evidenceHints ?? []).length ? `Evidence the team established: ${input.evidenceHints!.join("; ")}` : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  return callStructuredLLM({
    kind: "answer_block",
    system: ANSWER_BLOCK_SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.02,
    complete: opts.complete,
    now: opts.now,
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
};

const ATOMIC_EDIT_SYSTEM =
  "You improve ONE on-page field (a page title or meta description) for an encyclopedia / content site to better match the search intent and earn the click. " +
  'Return ONLY a JSON object: "field" (the field being edited), "before" (the exact current value, or null), "after" (the improved value), ' +
  '"rationale" (one sentence), "evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|profound|dataforseo|semrush|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Keep a title under ~60 characters and a meta description 120-160. Ground ONLY in what is provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes.";

/** Draft a schema-valid AtomicEditDraft (title/meta) for one existing-page Move. */
export async function draftAtomicEditStructured(
  input: AtomicEditStructuredInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<AtomicEditDraft>> {
  const grounded = [
    input.query,
    input.currentValue ?? "",
    input.outline.join(" "),
    (input.evidenceHints ?? []).join(" "),
  ].join(" ");
  const user = [
    `Search/topic: "${input.query}"`,
    `Page: ${input.pageLabel}`,
    `Field to edit: ${input.field}`,
    input.currentValue ? `Current ${input.field}: ${input.currentValue}` : `Current ${input.field}: (none/empty)`,
    input.outline.length ? `Page covers: ${input.outline.slice(0, 8).join("; ")}` : "",
    (input.evidenceHints ?? []).length ? `Evidence the team established: ${input.evidenceHints!.join("; ")}` : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  return callStructuredLLM({
    kind: "atomic_edit",
    system: ATOMIC_EDIT_SYSTEM,
    user,
    grounded,
    projectedCostUsd: 0.02,
    complete: opts.complete,
    now: opts.now,
  });
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
};

const CREATE_PAGE_SYSTEM =
  "You write the BRIEF for a brand-new encyclopedia / content page so an editor can build it. " +
  'Return ONLY a JSON object: "proposedTitle" (<=70 chars, concise + descriptive, no boilerplate/year-stuffing), ' +
  '"metaDescription" (120-160 chars, page-specific, no overpromising), "openingAnswer" (a 40-80 word direct, extractable answer), ' +
  '"outline" (3-16 H2 section headings, specific to the topic), "faqQuestions" (real questions a reader asks, from the grounding), ' +
  '"schemaTypes" (relevant schema.org types, e.g. Article, FAQPage — only if warranted), ' +
  '"evidenceRefs" (array of {"source","detail"}, at least one, from the grounding; source one of gsc|ga4|clarity|profound|dataforseo|semrush|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (concrete build steps), ' +
  '"proofPlan" ({"metrics":[...],"windowsDays":[7,14,28],"controls":"..."}). ' +
  "Ground ONLY in what is provided. Do NOT invent statistics, dates, prices, rankings, or superlatives. No marketing language. No em-dashes. " +
  "The openingAnswer's first sentence must name THIS specific topic (not a generic category) — no context-free dictionary definitions. Title must avoid boilerplate like \"(YYYY Guide)\" or \"Complete/Ultimate Guide\". Use the provided sub-questions to shape the outline and FAQ.";

/** Draft a schema-valid CreatePageBrief for one create_page / hub Move. */
export async function draftCreatePageStructured(
  input: CreatePageStructuredInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<CreatePageBrief>> {
  const grounded = [
    input.query,
    input.competitorPages.join(" "),
    input.fanoutQueries.join(" "),
    (input.evidenceHints ?? []).join(" "),
  ].join(" ");
  const user = [
    `New-page topic: "${input.query}"`,
    `Working label/slug: ${input.pageLabel}`,
    input.fanoutQueries.length ? `Sub-questions AI is asked: ${input.fanoutQueries.slice(0, 10).join("; ")}` : "",
    input.competitorPages.length ? `Competitor pages cited now (study + beat): ${input.competitorPages.slice(0, 6).join("; ")}` : "",
    (input.evidenceHints ?? []).length ? `Evidence the team established: ${input.evidenceHints!.join("; ")}` : "",
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
  '"evidenceRefs" (array of {"source","detail"}, at least one; source one of gsc|ga4|clarity|profound|dataforseo|semrush|competitor_teardown|owned_snapshot|fanout), ' +
  '"confidence" ("high"|"medium"|"low"), "risks" (array of short strings), "operatorSteps" (array of concrete steps). ' +
  "Ground EVERYTHING only in the prompt, fan-out queries, and competitor pages provided. Do NOT invent statistics, dates, prices, rankings, or superlatives (put anything uncertain in facts_to_verify). No marketing language. No em-dashes.";

/** Draft a schema-valid AeoPromptBrief for one Profound PromptOpportunity.
 *  Capped + budgeted + firewalled; spends only when invoked. */
export async function draftAeoPromptBrief(
  input: AeoPromptBriefInput,
  opts: { complete?: CompleteFn; now?: Date } = {},
): Promise<StructuredDraftResult<AeoPromptBrief>> {
  const grounded = [
    input.prompt,
    input.fanoutQueries.join(" "),
    input.competitorPages.join(" "),
    input.ownCitedUrls.join(" "),
    (input.tags ?? []).join(" "),
  ].join(" ");
  const user = [
    `AI prompt to win: "${input.prompt}"`,
    `Recommended move: ${input.recommendedMove}`,
    input.fanoutQueries.length ? `Fan-out queries this prompt expands into: ${input.fanoutQueries.slice(0, 12).join("; ")}` : "",
    input.competitorPages.length ? `Pages AI cites now (study + beat): ${input.competitorPages.slice(0, 10).join("; ")}` : "",
    input.ownCitedUrls.length ? `Your pages already cited: ${input.ownCitedUrls.join("; ")}` : "Your site is NOT currently cited for this prompt.",
    (input.tags ?? []).length ? `Topic tags: ${input.tags!.join("; ")}` : "",
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
): { kind: StructuredDraftKind; value: unknown } | null {
  if (!content) return null;
  try {
    const obj = JSON.parse(content) as { v?: number; kind?: StructuredDraftKind; value?: unknown };
    if (!obj || obj.v !== PERSIST_VERSION || !obj.kind || !(obj.kind in SCHEMA_BY_KIND)) return null;
    const schema = SCHEMA_BY_KIND[obj.kind] as z.ZodTypeAny;
    const res = schema.safeParse(obj.value);
    if (!res.success) return null;
    return { kind: obj.kind, value: res.data };
  } catch {
    return null;
  }
}

/** Persist a validated draft via move_drafts (kind="structured_draft"). Refuses
 *  to write past the content cap (returns false) rather than truncate to junk. */
export async function saveStructuredDraft(
  tenantId: string,
  moveId: string,
  kind: StructuredDraftKind,
  value: unknown,
): Promise<boolean> {
  const content = serializeStructuredDraft(kind, value);
  if (content.length > MAX_DRAFT_CHARS) {
    log.warn("[structured-drafter] draft too large to persist", { tenantId, moveId, kind, size: content.length });
    return false;
  }
  return saveMoveDraft(tenantId, moveId, "structured_draft", content);
}

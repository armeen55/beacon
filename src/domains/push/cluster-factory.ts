import "server-only";

/**
 * 2026-06-10 — The page factory (§master goal step 3).
 *
 * Cluster plan → LLM-generated structured CMS fields per item → batch
 * Change Cards (`create_page`, element key `create:<collectionId>`,
 * proposed_text = JSON of the new item's fields). The cards land in the
 * SAME approval queue as everything else; pushing them walks the SAME
 * capped push path (Invariant 1 + 3) via the create route.
 *
 * Honesty + content rules:
 *   • BEACON_LLM_PROVIDER must resolve to openai (the existing gate);
 *     deterministic mode refuses loudly — no silent fake content.
 *   • MAX_ITEMS_PER_RUN caps a generation run (cost + review sanity).
 *   • Content rules ride the prompt AND a validator pass: rule
 *     violations (e.g. "Farsi" as the language name under the
 *     Persian-never-Farsi rule) are FLAGGED into the card's risks[] —
 *     the human approval gate is the enforcement point, with the
 *     violation made impossible to miss.
 *   • No fabricated facts: the prompt demands only widely-verifiable
 *     cultural facts and flags uncertainty; the operator reviews every
 *     card before push.
 */

import { resolveLLMProvider } from "@/lib/llm/config";
import { isReasoningModel } from "@/domains/recommendations/providers/openai";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

export const MAX_ITEMS_PER_RUN = 10;
const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 120_000;

export type ClusterFieldSpec = {
  /** CMS field name, e.g. "title", "description", "pronunciation". */
  field: string;
  /** Plain-English generation instruction for this field. */
  instruction: string;
  /** Soft word cap enforced by the validator (flags, not truncates). */
  maxWords?: number;
};

export type ClusterItemBrief = {
  /** URL slug for the new item, e.g. "ghormeh-sabzi". */
  slug: string;
  /** Human topic, e.g. "Ghormeh Sabzi". */
  title: string;
  /** One-line brief steering the generation. */
  brief: string;
};

export type ClusterPlan = {
  name: string;
  dataCollectionId: string;
  /** The collection's slug field name (set at CREATE time only). */
  slugField: string;
  /** Dynamic-page URL prefix, e.g. "/persian-food". */
  urlPrefix: string;
  /** Site base, e.g. "https://www.iranopedia.com". */
  siteBaseUrl: string;
  fields: ClusterFieldSpec[];
  items: ClusterItemBrief[];
  /** Tenant content rules, included verbatim in the prompt. */
  contentRules: string[];
  /** Terms that get FLAGGED into risks[] when present (case-sensitive word match). */
  flaggedTerms: string[];
};

export type ClusterCardDraft = Pick<
  RecommendedEditRow,
  | "action_type"
  | "target_url"
  | "target_element_key"
  | "display_label"
  | "current_text"
  | "proposed_text"
  | "why"
  | "difficulty"
  | "confidence"
  | "risks"
  | "expected_impact"
  | "measurement_plan"
> & { model: string; cost_usd: number };

export type ClusterFactoryResult =
  | {
      ok: true;
      drafts: ClusterCardDraft[];
      totalCostUsd: number;
      /** Drafts emitted WITH soft-flag risks (word-count, empty) — reviewable. */
      flagged: number;
      /** Drafts HARD-REJECTED (never emitted) for a banned-term violation. */
      rejected: number;
      /** Human-readable rejection reasons, for the operator surface. */
      rejectedReasons: string[];
    }
  | { ok: false; reason: "llm_disabled" | "too_many_items" | "api_error"; detail?: string };

export type ClusterDeps = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
  /**
   * Audit #47: content-rule ENFORCEMENT mode. When true (the default —
   * self-serve safe), a draft containing any `flaggedTerms` banned word
   * is HARD-REJECTED (never emitted as a pushable card) rather than
   * merely flagged. Word-count/empty issues stay SOFT flags (the human
   * approval gate reviews those). Set false only for an operator who
   * explicitly wants flag-and-review for banned terms too.
   */
  enforceContentRules?: boolean;
};

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validate a draft's fields. Returns SOFT risks (word-count, empty —
 * reviewable flags) separately from HARD violations (banned terms —
 * rejectable). Audit #47: callers in enforce mode drop hard violations.
 */
export function validateDraftFieldsSplit(
  fields: Record<string, string>,
  plan: Pick<ClusterPlan, "fields" | "flaggedTerms">,
): { soft: string[]; hard: string[] } {
  const soft: string[] = [];
  const hard: string[] = [];
  for (const spec of plan.fields) {
    const value = fields[spec.field] ?? "";
    if (value.trim() === "") {
      soft.push(`field "${spec.field}" came back empty`);
      continue;
    }
    if (spec.maxWords != null && wordCount(value) > spec.maxWords) {
      soft.push(
        `field "${spec.field}" is ${wordCount(value)} words (rule: ≤${spec.maxWords}) — trim before approving`,
      );
    }
    for (const term of plan.flaggedTerms) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(value)) {
        hard.push(
          `field "${spec.field}" contains banned term "${term}" (content rule)`,
        );
      }
    }
  }
  return { soft, hard };
}

/** Back-compat: combined risk list (soft + hard) for flag-only callers. */
export function validateDraftFields(
  fields: Record<string, string>,
  plan: Pick<ClusterPlan, "fields" | "flaggedTerms">,
): string[] {
  const { soft, hard } = validateDraftFieldsSplit(fields, plan);
  return [...soft, ...hard];
}

/**
 * Generate one cluster's Change Card drafts. The CALLER persists them
 * (mapSpecificEditToRow / persist path) — this module stays
 * persistence-agnostic and unit-testable.
 */
export async function generateClusterCards(
  plan: ClusterPlan,
  deps: ClusterDeps = {},
): Promise<ClusterFactoryResult> {
  // The existing gate: deterministic mode = no LLM content, loudly.
  let model = deps.model ?? "gpt-5-mini";
  if (deps.apiKey == null) {
    try {
      const provider = resolveLLMProvider();
      if (provider !== "openai") {
        return {
          ok: false,
          reason: "llm_disabled",
          detail: "BEACON_LLM_PROVIDER is not 'openai' — the factory never fabricates deterministic content",
        };
      }
    } catch (err) {
      return {
        ok: false,
        reason: "llm_disabled",
        detail: err instanceof Error ? err.message : "provider config error",
      };
    }
  }
  if (plan.items.length === 0)
    return { ok: true, drafts: [], totalCostUsd: 0, flagged: 0, rejected: 0, rejectedReasons: [] };
  if (plan.items.length > MAX_ITEMS_PER_RUN) {
    return {
      ok: false,
      reason: "too_many_items",
      detail: `${plan.items.length} items > cap ${MAX_ITEMS_PER_RUN} — split the cluster into runs`,
    };
  }

  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (apiKey === "") {
    return { ok: false, reason: "llm_disabled", detail: "OPENAI_API_KEY missing" };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  const enforce = deps.enforceContentRules ?? true; // self-serve-safe default
  const drafts: ClusterCardDraft[] = [];
  let totalCost = 0;
  let flagged = 0;
  let rejected = 0;
  const rejectedReasons: string[] = [];

  for (const item of plan.items) {
    const sys = [
      `You write structured CMS content for ${plan.name} pages on an encyclopedia site.`,
      `Respond ONLY with a JSON object whose keys are exactly: ${plan.fields.map((f) => f.field).join(", ")}.`,
      `Content rules (mandatory):`,
      ...plan.contentRules.map((r) => `- ${r}`),
      `- Only widely-verifiable facts. If unsure of a specific fact, omit it rather than guess.`,
    ].join("\n");
    const usr = [
      `Page: ${item.title}`,
      `Brief: ${item.brief}`,
      ``,
      ...plan.fields.map(
        (f) => `${f.field}: ${f.instruction}${f.maxWords ? ` (max ${f.maxWords} words)` : ""}`,
      ),
    ].join("\n");

    let fields: Record<string, string> = {};
    let costUsd = 0;
    try {
      const res = await fetchImpl(OPENAI_CHAT_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
          response_format: { type: "json_object" },
          // audit-wave2 #17: bound output + pin low reasoning effort so a
          // gpt-5-mini call can't burn its whole pool on reasoning_tokens and
          // return an empty '{}' (one structured CMS record needs little). Gated
          // so a non-reasoning model override doesn't 400.
          max_completion_tokens: 6_000,
          ...(isReasoningModel(model) ? { reasoning_effort: "low" } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, reason: "api_error", detail: `http_${res.status}: ${text.slice(0, 200)}` };
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = body.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as Record<string, unknown>;
      for (const spec of plan.fields) {
        const v = parsed[spec.field];
        fields[spec.field] = typeof v === "string" ? v : "";
      }
      // Cost estimate (gpt-5-mini class pricing; the ledger records it
      // on the card so approval sees the spend).
      const inTok = body.usage?.prompt_tokens ?? 0;
      const outTok = body.usage?.completion_tokens ?? 0;
      costUsd = (inTok * 0.25 + outTok * 2) / 1_000_000;
      totalCost += costUsd;
    } catch (err) {
      return {
        ok: false,
        reason: "api_error",
        detail: err instanceof Error ? err.message : "unknown",
      };
    }

    const { soft, hard } = validateDraftFieldsSplit(fields, plan);
    // Audit #47: HARD-REJECT banned-term violations in enforce mode —
    // never emit them as a pushable card (no human can approve a content-
    // rule breach). Soft issues (word-count, empty) stay reviewable flags.
    if (enforce && hard.length > 0) {
      rejected++;
      rejectedReasons.push(`${item.title}: ${hard.join("; ")}`);
      continue;
    }
    const risks = [...soft, ...hard];
    if (risks.length > 0) flagged++;
    const slug = item.slug.replace(/^\/+/, "");
    const targetUrl = `${plan.siteBaseUrl.replace(/\/+$/, "")}${plan.urlPrefix.replace(/\/+$/, "")}/${slug}`;

    drafts.push({
      action_type: "create_page",
      target_url: targetUrl,
      target_element_key: `create:${plan.dataCollectionId}`,
      display_label: `${plan.name}: ${item.title} (new page)`,
      current_text: null,
      proposed_text: JSON.stringify(
        { [plan.slugField]: slug, ...fields },
        null,
        2,
      ),
      why: `Cluster "${plan.name}": ${item.brief}`,
      difficulty: "low",
      confidence: "medium",
      risks,
      expected_impact: null,
      measurement_plan: "AI citations of the new URL the next time you refresh your connected data; GSC impressions once indexed.",
      model,
      cost_usd: costUsd,
    });
  }

  return { ok: true, drafts, totalCostUsd: totalCost, flagged, rejected, rejectedReasons };
}

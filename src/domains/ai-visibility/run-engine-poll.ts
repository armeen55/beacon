/**
 * run-engine-poll (2026-07-01, master plan item 4) - the nightly runner that
 * asks the tenant's tracked questions (prompt library order, top 25) across
 * up to 4 AI engines and writes what came back into the SAME observation
 * tables the native poll uses (observation_runs + prompt_answer_observations,
 * via the existing writers), then diffs the engines per question so
 * "Perplexity points people at you, ChatGPT does not" becomes a stored,
 * surfaced, fixable gap.
 *
 * Engine paths (each degrades honestly - no key means SKIPPED and every
 * downstream line says which engines were actually checked):
 *   chatgpt    - native OpenAI key (OPENAI_API_KEY), bounded to 25 calls
 *   perplexity - native Perplexity key (PERPLEXITY_API_KEY), bounded to 25
 *   gemini     - DataForSEO llm_responses through the FULL money gauntlet
 *   claude     - DataForSEO llm_responses through the FULL money gauntlet
 *
 * COST: DataForSEO calls ride the shared fail-closed monthly cap + dry-run
 * default + 20h cache in dataforseo-llm-mentions.ts; the nightly ceiling is
 * 2 engines x 25 prompts = 50 calls (~$1.50). Native calls use the operator's
 * own keys, bounded to 25 per engine per night. A per-night already-ran guard
 * makes the whole thing idempotent. No secrets are ever logged.
 */

import "server-only";

import { log } from "@/lib/logger";
import { getActivePrompts } from "@/domains/prompts/prompt-library";
import type { LibraryPrompt } from "@/domains/prompts/types";
import { getTenant } from "@/domains/tenants/store";
import type { BeaconTenant } from "@/domains/tenants/types";
import { syncPromptAnswerObservations } from "@/lib/persistence/dual-write";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { appendObservationRunSync } from "@/domains/observations/persist-run";
import type { ObservationRun } from "@/domains/observations/types";
import { extractMentionPosition, extractCitationRank } from "@/domains/prompt-answer-observations/extraction";
import { rootDomain } from "@/domains/serp/serp-provider";
import {
  runLlmPromptResponses,
  type EnginePromptRunResult,
  type PromptAnswerItem,
} from "@/domains/serp/dataforseo-llm-mentions";
import {
  ALL_ENGINES,
  DATAFORSEO_ENGINES,
  ENGINE_OBSERVATION_SOURCE,
  NIGHTLY_PROMPT_CAP,
  type EngineId,
} from "./engine-types";
import { computeEngineGaps, type EngineCheckRow } from "./engine-gaps";
import {
  hasEnginePollRunForNight,
  recordEnginePollRun,
  writeEngineGapSummary,
  type StoredEngineGapSummary,
} from "./gap-store";

// ---------------------------------------------------------------------------
// Native engine clients (injectable; null = no usable key = engine skipped)
// ---------------------------------------------------------------------------

export type NativeEngineAnswer = {
  answerText: string;
  /** Deduped cited URLs (annotations first-class, prose URLs as fallback). */
  citedUrls: string[];
  model: string;
};
export type NativeEngineClient = (question: string) => Promise<NativeEngineAnswer | null>;

const NATIVE_TIMEOUT_MS = 45_000;
const URL_RE = /https?:\/\/[^\s)"'\]<>]+/g;

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** Native OpenAI client. Uses the web-search-capable chat-completions model
 *  so answers carry url_citation annotations (closest to what ChatGPT shows
 *  users); prose URLs are extracted as a fallback either way. */
export function buildOpenAiEngineClient(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): NativeEngineClient | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.BEACON_ENGINE_POLL_OPENAI_MODEL?.trim() || "gpt-4o-mini-search-preview";
  return async (question) => {
    try {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: question }],
      };
      if (model.includes("search")) body.web_search_options = {};
      const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(NATIVE_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.warn("[engine-poll] openai non-2xx", { status: res.status });
        return null;
      }
      const json = (await res.json()) as {
        model?: string;
        choices?: Array<{
          message?: {
            content?: string;
            annotations?: Array<{ type?: string; url_citation?: { url?: string } }>;
          };
        }>;
      };
      const msg = json.choices?.[0]?.message;
      const answerText = (msg?.content ?? "").trim();
      if (!answerText) return null;
      const annUrls = (msg?.annotations ?? [])
        .map((a) => (a?.type === "url_citation" ? a.url_citation?.url : undefined))
        .filter((u): u is string => typeof u === "string" && u.length > 0);
      const proseUrls = answerText.match(URL_RE) ?? [];
      return { answerText, citedUrls: dedupeUrls([...annUrls, ...proseUrls]), model: json.model ?? model };
    } catch (err) {
      log.warn("[engine-poll] openai call failed (non-fatal)", {
        error: err instanceof Error ? err.message.slice(0, 120) : "fetch_failed",
      });
      return null;
    }
  };
}

/** Native Perplexity client (sonar). Perplexity returns first-class citation
 *  URLs on every answer, which is exactly the signal this poll wants. */
export function buildPerplexityEngineClient(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): NativeEngineClient | null {
  const apiKey = env.PERPLEXITY_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.BEACON_ENGINE_POLL_PERPLEXITY_MODEL?.trim() || "sonar";
  return async (question) => {
    try {
      const res = await fetchImpl("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: question }] }),
        signal: AbortSignal.timeout(NATIVE_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.warn("[engine-poll] perplexity non-2xx", { status: res.status });
        return null;
      }
      const json = (await res.json()) as {
        model?: string;
        citations?: string[];
        search_results?: Array<{ url?: string }>;
        choices?: Array<{ message?: { content?: string } }>;
      };
      const answerText = (json.choices?.[0]?.message?.content ?? "").trim();
      if (!answerText) return null;
      const cites = (json.citations ?? []).filter((u): u is string => typeof u === "string");
      const searchUrls = (json.search_results ?? [])
        .map((r) => r?.url)
        .filter((u): u is string => typeof u === "string" && u.length > 0);
      const proseUrls = answerText.match(URL_RE) ?? [];
      return { answerText, citedUrls: dedupeUrls([...cites, ...searchUrls, ...proseUrls]), model: json.model ?? model };
    } catch (err) {
      log.warn("[engine-poll] perplexity call failed (non-fatal)", {
        error: err instanceof Error ? err.message.slice(0, 120) : "fetch_failed",
      });
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type EnginePollEngineStatus =
  | "ok"
  | "skipped_no_key"
  | "disabled"
  | "dry_run"
  | "capped"
  | "cache_hit"
  | "error";

export type EnginePollEngineResult = {
  engine: EngineId;
  status: EnginePollEngineStatus;
  answers: number;
  citedYou: number;
  costUsd: number;
  detail: string;
};

export type EnginePollResult = {
  tenantId: string;
  date: string;
  status: "ok" | "already_ran" | "no_prompts" | "error";
  promptsRequested: number;
  engines: EnginePollEngineResult[];
  observationsWritten: number;
  enginesChecked: EngineId[];
  gaps: number;
  detail: string;
};

export type RunEnginePollDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  loadPrompts: () => Promise<LibraryPrompt[]>;
  loadTenant: (tenantId: string) => Promise<BeaconTenant | null>;
  hasRunForNight: (tenantId: string, date: string) => Promise<boolean>;
  recordRun: (row: { tenant_id: string; date: string; ran_at: string; engines: EngineId[]; prompts: number }) => Promise<void>;
  writeObservations: (rows: PromptAnswerObservation[], tenantId: string) => Promise<void>;
  appendRun: (run: ObservationRun) => void;
  writeGapSummary: (summary: StoredEngineGapSummary) => Promise<void>;
  /** Native clients; null = engine skipped (no key). Injectable for tests. */
  openAiClient: NativeEngineClient | null;
  perplexityClient: NativeEngineClient | null;
  /** DataForSEO path (full gauntlet lives inside). Injectable for tests. */
  runDataForSeoEngine: (
    items: PromptAnswerItem[],
    engine: "gemini" | "claude",
    tenantId: string,
  ) => Promise<EnginePromptRunResult>;
};

function defaultDeps(): RunEnginePollDeps {
  const env = process.env;
  return {
    env,
    now: () => new Date(),
    loadPrompts: getActivePrompts,
    loadTenant: (id) => getTenant(id),
    hasRunForNight: hasEnginePollRunForNight,
    recordRun: recordEnginePollRun,
    writeObservations: syncPromptAnswerObservations,
    appendRun: appendObservationRunSync,
    writeGapSummary: writeEngineGapSummary,
    openAiClient: buildOpenAiEngineClient(env),
    perplexityClient: buildPerplexityEngineClient(env),
    runDataForSeoEngine: (items, engine, tenantId) =>
      runLlmPromptResponses(items, { engine }, { tenantId: async () => tenantId }),
  };
}

type EngineAnswerLite = { promptId: string; answerText: string; citedUrls: string[]; model: string };

/** Host belongs to the tenant's site: exact match or a subdomain of it
 *  (en.iranopedia.com counts for iranopedia.com). */
function isOwnedHost(host: string, ownedRoot: string): boolean {
  return ownedRoot.length > 0 && (host === ownedRoot || host.endsWith(`.${ownedRoot}`));
}

function toObservation(args: {
  tenantId: string;
  runId: string;
  engine: EngineId;
  prompt: LibraryPrompt;
  answer: EngineAnswerLite;
  observedAtIso: string;
  ownedRoot: string;
  brandVariants: string[];
}): PromptAnswerObservation {
  const { engine, prompt, answer } = args;
  // Per-citation parallel arrays (types.ts contract): citation_urls[i] is the
  // i-th cited URL, citation_domains[i] its host. Invalid URLs are dropped.
  const urls: string[] = [];
  const domains: string[] = [];
  for (const u of answer.citedUrls) {
    try {
      const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      if (!host.includes(".")) continue;
      urls.push(u);
      domains.push(host);
    } catch {
      /* skip malformed URL */
    }
  }
  const ownedRootSet = new Set(args.ownedRoot ? [args.ownedRoot] : []);
  // Map owned subdomains onto the root so the existing rank extractor applies.
  const normalizedDomains = domains.map((d) => (isOwnedHost(d, args.ownedRoot) ? args.ownedRoot : d));
  const citationRank = extractCitationRank(normalizedDomains, ownedRootSet);
  const ownedCitations = normalizedDomains.filter((d) => ownedRootSet.has(d)).length;
  const mentionPosition = extractMentionPosition(answer.answerText, args.brandVariants);

  return {
    id: `paoeng-${args.observedAtIso.slice(0, 10)}-${engine}-${prompt.id}`,
    prompt_id: prompt.id,
    run_id: args.runId,
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: mentionPosition !== null,
    tracked_brand_cited: citationRank !== null,
    citation_count: urls.length,
    owned_citation_count: ownedCitations,
    citation_domains: domains,
    citation_urls: urls,
    citation_categories: {},
    mentions: [],
    observed_at: args.observedAtIso,
    platform: engine,
    topic: prompt.topic ?? "",
    mention_position: mentionPosition,
    citation_rank: citationRank,
    metadata: {
      source: ENGINE_OBSERVATION_SOURCE[engine],
      engine,
      prompt_text: prompt.prompt_text,
      model: answer.model,
      answer_excerpt: answer.answerText.slice(0, 400),
      pipeline: "ai-engines-nightly",
    },
    tenant_id: args.tenantId,
  };
}

/**
 * Run the nightly 4-engine poll for one tenant. Never throws; every failure
 * mode is a typed status. Idempotent per UTC night via the run guard.
 */
export async function runEnginePollForTenant(
  tenantId: string,
  depsOverride: Partial<RunEnginePollDeps> = {},
): Promise<EnginePollResult> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const now = deps.now();
  const date = now.toISOString().slice(0, 10);
  const base = { tenantId, date, promptsRequested: 0, engines: [] as EnginePollEngineResult[], observationsWritten: 0, enginesChecked: [] as EngineId[], gaps: 0 };

  try {
    // (1) idempotency - one real run per tenant per UTC night.
    if (await deps.hasRunForNight(tenantId, date)) {
      return { ...base, status: "already_ran", detail: "tonight's poll already ran for this tenant" };
    }

    // (2) top-N tracked prompts, prompt-library order.
    const prompts = (await deps.loadPrompts()).slice(0, NIGHTLY_PROMPT_CAP);
    if (prompts.length === 0) {
      return { ...base, status: "no_prompts", detail: "the prompt library has no active questions" };
    }

    const tenant = await deps.loadTenant(tenantId);
    if (!tenant || !tenant.domain) {
      return { ...base, status: "error", promptsRequested: prompts.length, detail: "tenant has no domain configured" };
    }
    const ownedRoot = rootDomain(tenant.domain);
    const brandVariants = [tenant.business_name, ownedRoot.replace(/\..*$/, "")].filter((v) => v.length >= 3);

    const observedAtIso = now.toISOString();
    const engineResults: EnginePollEngineResult[] = [];
    const checkRows: EngineCheckRow[] = [];
    const observations: PromptAnswerObservation[] = [];

    const collect = (engine: EngineId, answers: Array<{ prompt: LibraryPrompt; answer: EngineAnswerLite }>): number => {
      const runId = `aiengines-${engine}-${date}-${tenantId}`;
      let citedYou = 0;
      for (const { prompt, answer } of answers) {
        const obs = toObservation({ tenantId, runId, engine, prompt, answer, observedAtIso, ownedRoot, brandVariants });
        observations.push(obs);
        const ownedUrls = (obs.citation_urls ?? []).filter((_, i) => isOwnedHost(obs.citation_domains[i] ?? "", ownedRoot));
        if (obs.tracked_brand_cited) citedYou += 1;
        checkRows.push({
          promptId: prompt.id,
          promptText: prompt.prompt_text,
          engine,
          citedYou: obs.tracked_brand_cited === true,
          ownedUrls,
        });
      }
      return citedYou;
    };

    // (3a) native engines - bounded sequential calls, skip without a key.
    const natives: Array<{ engine: EngineId; client: NativeEngineClient | null }> = [
      { engine: "chatgpt", client: deps.openAiClient },
      { engine: "perplexity", client: deps.perplexityClient },
    ];
    for (const { engine, client } of natives) {
      if (!client) {
        engineResults.push({ engine, status: "skipped_no_key", answers: 0, citedYou: 0, costUsd: 0, detail: "no API key on this environment" });
        continue;
      }
      const answered: Array<{ prompt: LibraryPrompt; answer: EngineAnswerLite }> = [];
      for (const prompt of prompts) {
        const ans = await client(prompt.prompt_text);
        if (ans) answered.push({ prompt, answer: { promptId: prompt.id, ...ans } });
      }
      const citedYou = collect(engine, answered);
      engineResults.push({
        engine,
        status: answered.length > 0 ? "ok" : "error",
        answers: answered.length,
        citedYou,
        costUsd: 0,
        detail: answered.length > 0 ? `${answered.length}/${prompts.length} answers` : "all calls failed",
      });
    }

    // (3b) DataForSEO engines - the full money gauntlet lives inside the
    // runner (cache -> dry-run -> shared fail-closed cap -> ledger).
    const items: PromptAnswerItem[] = prompts.map((p) => ({ key: p.id, question: p.prompt_text }));
    const promptById = new Map(prompts.map((p) => [p.id, p]));
    for (const engine of DATAFORSEO_ENGINES) {
      const dfsEngine = engine as "gemini" | "claude";
      const r = await deps.runDataForSeoEngine(items, dfsEngine, tenantId);
      const answered = r.answers
        .map((a) => {
          const prompt = promptById.get(a.key);
          return prompt
            ? { prompt, answer: { promptId: a.key, answerText: a.answerText, citedUrls: a.citedUrls, model: a.model } }
            : null;
        })
        .filter((x): x is { prompt: LibraryPrompt; answer: EngineAnswerLite } => x !== null);
      const citedYou = collect(engine, answered);
      engineResults.push({
        engine,
        status: r.status === "ok" || r.status === "cache_hit" ? (answered.length > 0 ? r.status : "error") : r.status,
        answers: answered.length,
        citedYou,
        costUsd: r.costUsd,
        detail: r.detail,
      });
    }

    // (4) persist observations through the EXISTING writers (same tables the
    // native poll uses; same-day re-poll collisions are recovered inside).
    if (observations.length > 0) {
      await deps.writeObservations(observations, tenantId);
    }
    for (const er of engineResults) {
      if (er.status !== "ok" && er.status !== "cache_hit" && er.status !== "error") continue; // nothing ran
      const run: ObservationRun = {
        run_id: `aiengines-${er.engine}-${date}-${tenantId}`,
        run_type: "citation_sample_import",
        source: ENGINE_OBSERVATION_SOURCE[er.engine],
        status: er.status === "error" ? "failed" : "completed",
        started_at: observedAtIso,
        completed_at: deps.now().toISOString(),
        scope_label: `ai engines nightly ${er.engine} - ${er.answers}/${prompts.length} prompts`,
        pages_scanned: 0,
        pages_changed: 0,
        pages_with_errors: 0,
        guardrail_alerts: 0,
        critical_count: 0,
        regression_count: 0,
        improvement_count: 0,
        tenant_id: tenantId,
      };
      try {
        deps.appendRun(run);
      } catch (e) {
        log.warn("[engine-poll] observation_runs append failed (non-fatal)", { error: e instanceof Error ? e.message : "?" });
      }
    }

    // (5) diff the engines per question and persist the gap summary.
    const report = computeEngineGaps(checkRows);
    const summary: StoredEngineGapSummary = {
      tenant_id: tenantId,
      date,
      computed_at: deps.now().toISOString(),
      engines_checked: report.enginesChecked,
      prompts_checked: report.promptsChecked,
      per_engine: report.perEngine.map((p) => ({ engine: p.engine, prompts_checked: p.promptsChecked, cited_you: p.citedYou })),
      gaps: report.gaps.slice(0, 10).map((g) => ({
        prompt_id: g.promptId,
        prompt_text: g.promptText,
        cited_engines: g.citedEngines,
        missing_engines: g.missingEngines,
        owned_url: g.ownedUrl,
      })),
    };
    if (report.enginesChecked.length > 0) {
      await deps.writeGapSummary(summary).catch((e) =>
        log.warn("[engine-poll] gap summary write failed (non-fatal)", { error: e instanceof Error ? e.message : "?" }),
      );
    }

    // (6) stamp the per-night guard only after a real attempt completed.
    await deps.recordRun({ tenant_id: tenantId, date, ran_at: deps.now().toISOString(), engines: report.enginesChecked, prompts: prompts.length }).catch((e) =>
      log.warn("[engine-poll] run-guard write failed (non-fatal)", { error: e instanceof Error ? e.message : "?" }),
    );

    log.info("[engine-poll] LEDGER", {
      tenantId,
      date,
      prompts: prompts.length,
      engines: engineResults.map((e) => `${e.engine}:${e.status}:${e.answers}`).join(" "),
      observations: observations.length,
      enginesChecked: report.enginesChecked,
      gaps: report.gaps.length,
      dataForSeoCostUsd: Math.round(engineResults.reduce((s, e) => s + e.costUsd, 0) * 10000) / 10000,
    });

    return {
      tenantId,
      date,
      status: "ok",
      promptsRequested: prompts.length,
      engines: engineResults,
      observationsWritten: observations.length,
      enginesChecked: report.enginesChecked,
      gaps: report.gaps.length,
      detail: `checked ${report.enginesChecked.length} engine(s) across ${prompts.length} questions`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("[engine-poll] run failed", { tenantId, error: msg.slice(0, 300) });
    return { ...base, status: "error", detail: msg.slice(0, 300) };
  }
}

/** All engines this environment could poll tonight (for reporting). */
export function availableEngines(env: NodeJS.ProcessEnv = process.env): EngineId[] {
  return ALL_ENGINES.filter((e) => {
    if (e === "chatgpt") return Boolean(env.OPENAI_API_KEY?.trim());
    if (e === "perplexity") return Boolean(env.PERPLEXITY_API_KEY?.trim());
    return true; // DataForSEO engines report their own disabled/dry-run status
  });
}

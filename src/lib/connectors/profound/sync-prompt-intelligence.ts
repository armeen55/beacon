/**
 * Profound Prompt Intelligence — durable sync (2026-06-26, I/O write path).
 *
 * ON-DEMAND (operator action), NOT a cron. Pulls the tenant's Iranopedia-topic
 * prompts + answers + query-fanouts ONCE and upserts them into the additive
 * durable tables (profound_prompt_rows / profound_answer_rows /
 * profound_query_fanout_rows) so downstream surfaces can read prompt
 * intelligence in <100ms instead of the ~22s live Profound pull.
 *
 * Borrowed-account safe: topic-scoped on every pull; the prompts catalog is
 * filtered to the tenant's OWN topic id; Agent Analytics (bots/referrals/domains)
 * is NEVER called; ownership is decided by the owned domain + brand aliases, never
 * the tracked ChatGPT/openai.com asset. Idempotent (hash keys → upsert). Additive
 * only: writes to the three new tables, touches nothing else. Fail-soft: any pull
 * miss persists the others; a Supabase miss returns a reason, never throws.
 */
import "server-only";
import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { pullProfoundAnswers, pullProfoundPrompts, queryProfoundReport } from "./client";
import { getProfoundTenantScope, profoundTopicFilter } from "./tenant-scope";

const WINDOW_DAYS = 30;
const ANSWER_CAP = 5000;
const CHUNK = 500;

export type ProfoundSyncResult = {
  ok: boolean;
  reason?: string;
  prompts: number;
  answers: number;
  fanouts: number;
  citationUrls: number;
};

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const sha1 = (s: string): string => createHash("sha1").update(s).digest("hex");
const stripWww = (h: string): string => h.replace(/^www\./i, "").toLowerCase();
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Strip NUL + C0 control chars (keep \t\n) — Postgres/PostgREST reject these in
// text values ("invalid input syntax"). AI response text + scraped citation URLs
// occasionally carry them; sanitize before persisting.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
// Also drop UNPAIRED UTF-16 surrogates: slicing text to 500 chars can split an
// emoji pair -> a lone surrogate -> "invalid input syntax for type json" on
// insert (the whole JSON request body is rejected). Keeps valid (paired) emoji.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const clean = (s: string): string => s.replace(CONTROL, "").replace(LONE_SURROGATE, "");
const cleanArr = (a: string[]): string[] => a.map(clean);

function dateOnly(s: string | null, fallback: string): string {
  if (!s) return fallback;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(s);
  return m ? m[0] : fallback;
}

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

/** On-demand durable sync of one tenant's Profound prompt intelligence. */
export async function syncProfoundPromptIntelligenceForTenant(args: {
  tenantId: string;
}): Promise<ProfoundSyncResult> {
  const { tenantId } = args;
  const base: ProfoundSyncResult = { ok: false, prompts: 0, answers: 0, fanouts: 0, citationUrls: 0 };

  const scope = getProfoundTenantScope(tenantId);
  if (!scope) return { ...base, reason: "no_scope" };
  if (!isSupabaseConfigured()) return { ...base, reason: "supabase_unavailable" };

  const sb = getSupabaseAdmin();
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
  const startDate = ymd(start);
  const endDate = ymd(end);
  const today = ymd(end);
  const nowIso = end.toISOString();
  const filters = profoundTopicFilter(scope);

  const ownAliases = new Set(scope.ownedMentionAliases.map((a) => a.toLowerCase()));
  const isOwnedHost = (h: string): boolean => {
    const x = stripWww(h);
    return x === scope.ownedDomain || x.endsWith("." + scope.ownedDomain);
  };

  let prompts = 0;
  let answers = 0;
  let fanouts = 0;
  let citationUrls = 0;

  // Distinct prompt → topic/themes, collected from the answers (ground truth) so
  // the durable prompt catalog reflects the prompts AI actually answered for this
  // topic — robust to the borrowed account's catalog living under other category
  // topics. Enriched with the GET-prompts catalog id/status when the text matches.
  const promptMeta = new Map<string, { topic: string | null; themes: string[] }>();

  // ── Answers — the per-prompt gold (mentions + cited URLs + themes) ──
  try {
    const res = await pullProfoundAnswers({ tenantId, categoryId: scope.categoryId, startDate, endDate, filters, maxRows: ANSWER_CAP });
    const byKey = new Map<string, Record<string, unknown>>();
    for (const a of res?.rows ?? []) {
      const prompt = clean(a.prompt);
      if (!prompt) continue;
      const date = dateOnly(a.createdAt, today);
      const hosts = cleanArr(a.citationHostnames ?? []);
      const urls = cleanArr(a.citationUrls);
      const themes = cleanArr(a.themes);
      const mentions = cleanArr(a.mentions);
      citationUrls += urls.length;
      if (!promptMeta.has(prompt)) promptMeta.set(prompt, { topic: a.topic ? clean(a.topic) : null, themes });
      byKey.set(sha1(`${prompt}|${a.model ?? ""}|${date}`), {
        tenant_id: tenantId,
        answer_key: sha1(`${prompt}|${a.model ?? ""}|${date}`),
        prompt,
        topic: a.topic ? clean(a.topic) : null,
        model: a.model ? clean(a.model) : null,
        date,
        mentions,
        citation_urls: urls,
        citation_hosts: hosts,
        themes,
        own_cited: hosts.some(isOwnedHost),
        own_mentioned: mentions.some((m) => ownAliases.has(m.toLowerCase())),
        response_excerpt: a.response ? clean(a.response.slice(0, 500)) || null : null,
        pulled_at: nowIso,
      });
    }
    for (const chunk of chunked([...byKey.values()], CHUNK)) {
      const { error } = await sb.from("profound_answer_rows").upsert(chunk, { onConflict: "tenant_id,answer_key" });
      if (error) {
        log.warn("[profound-pi] answer upsert chunk failed", { tenantId, error: error.message });
        continue; // a bad chunk must not drop the rest
      }
      answers += chunk.length;
    }
  } catch (e) {
    log.warn("[profound-pi] answers pull failed", { tenantId, error: msg(e) });
  }

  // ── Prompt catalog — derived from the answered prompts, enriched by the GET
  //    prompts catalog (id/status/tags) when the prompt text matches ──
  try {
    const catalog = await pullProfoundPrompts({ tenantId, categoryId: scope.categoryId });
    const byText = new Map((catalog ?? []).map((p) => [p.prompt.trim().toLowerCase(), p]));
    const rows = [...promptMeta.entries()].map(([prompt, meta]) => {
      const hit = byText.get(prompt.trim().toLowerCase());
      return {
        tenant_id: tenantId,
        prompt_id: hit?.promptId ?? sha1(prompt), // stable synthetic id when not in the catalog
        prompt,
        topic_id: hit?.topicId ?? scope.topicId,
        topic: hit?.topic ?? meta.topic ?? scope.topicLabel,
        tags: hit?.tags ?? meta.themes,
        status: hit?.status ?? null,
        pulled_at: nowIso,
      };
    });
    for (const chunk of chunked(rows, CHUNK)) {
      const { error } = await sb.from("profound_prompt_rows").upsert(chunk, { onConflict: "tenant_id,prompt_id" });
      if (error) {
        log.warn("[profound-pi] prompt upsert chunk failed", { tenantId, error: error.message });
        continue;
      }
      prompts += chunk.length;
    }
  } catch (e) {
    log.warn("[profound-pi] prompts derive failed", { tenantId, error: msg(e) });
  }

  // ── Query fanouts (request the canonical [date,model,prompt,query] order) ──
  try {
    const fanRes = await queryProfoundReport({
      tenantId,
      report: "query-fanouts",
      categoryId: scope.categoryId,
      startDate,
      endDate,
      dimensions: ["date", "model", "prompt", "query"],
      metrics: ["total_fanouts", "share"],
      filters,
    });
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of fanRes?.rows ?? []) {
      const prompt = clean(r.dims.prompt ?? "");
      const query = clean(r.dims.query ?? "");
      if (!prompt || !query) continue;
      const model = r.dims.model ? clean(r.dims.model) : null;
      const date = dateOnly(r.dims.date || null, today);
      const key = sha1(`${prompt}|${query}|${model ?? ""}|${date}`);
      byKey.set(key, {
        tenant_id: tenantId,
        fanout_key: key,
        prompt,
        query,
        model,
        date,
        total_fanouts: r.mets.total_fanouts ?? null,
        share: r.mets.share ?? null,
        pulled_at: nowIso,
      });
    }
    for (const chunk of chunked([...byKey.values()], CHUNK)) {
      const { error } = await sb.from("profound_query_fanout_rows").upsert(chunk, { onConflict: "tenant_id,fanout_key" });
      if (error) {
        log.warn("[profound-pi] fanout upsert chunk failed", { tenantId, error: error.message });
        continue;
      }
      fanouts += chunk.length;
    }
  } catch (e) {
    log.warn("[profound-pi] fanouts pull failed", { tenantId, error: msg(e) });
  }

  return { ok: prompts > 0 || answers > 0 || fanouts > 0, prompts, answers, fanouts, citationUrls };
}

import "server-only";

/**
 * onboarding-store (Slice 5, 2026-07-24) - the shared core of the onboarding
 * facade: the injectable dependency bundle, the durable Supabase seam, the pure
 * prompt-candidate helpers, and the three commands that persist and activate
 * (generate candidates, approve the core set, activate the account). The
 * profile + state commands live in onboarding.ts and import `resolve` + the
 * shared types from here (one direction only, no cycle).
 *
 * Trust rails: every write is status-guarded (pending_onboarding only, or the
 * atomic activation flip) so a race with activation can never corrupt an active
 * account; no paid research runs before activation; all prompt rows carry
 * tenant_id = account_id = the canonical tenant id (never the slug).
 */

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { Account, BusinessProfile, BusinessType } from "@/domains/account";
import { getTenant, loadBusinessProfile, saveBusinessProfile } from "@/domains/account";
import { loadCrawlFrontier, runCrawlBatch, runInProcessColdStartScan, fetchPageHtml } from "@/domains/evidence";
import { startColdStartCrawl, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { getConnectorInfo, type ConnectorInfo, type ConnectorProvider } from "@/lib/connector-store";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { ensureResearchRunOnVisit } from "./ops/on-visit-refresh";

// ── shared public shapes ────────────────────────────────────────────────────

export type OnboardingGoal = "recover" | "grow" | "balanced";
type PromptIntent = "category" | "problem" | "comparison" | "commercial" | "factual" | "trust" | "brand";
export const PROMPT_INTENTS: readonly PromptIntent[] = ["category", "problem", "comparison", "commercial", "factual", "trust", "brand"];

/** Tags + limits that define the core-prompt lifecycle (one export each, bundled). */
export const PROMPT_TAGS = { candidate: "candidate_v1", set: "set_v1", recommended: "recommended", core: "core_v1", edited: "edited" } as const;
const LIMITS = { recommendedTarget: 50, minActive: 10, maxActive: 100 };

export type OnboardingState = {
  status: Account["status"];
  currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  website: { domain: string; crawl: { pagesRead: number; status: "in_progress" | "complete" | "unreachable" | "none" } };
  profile: {
    name: string; businessType: BusinessType | null; siteArchetype: string | null;
    offerings: string[]; audiences: string[]; customerProblems: string[];
    geographicScope: string[]; differentiators: string[]; trustClaims: string[];
    topicsToOwn: string[]; topicsToExclude: string[];
    confirmed: boolean; hasInference: boolean; source: "site" | "you" | "none";
  };
  goal: OnboardingGoal | null;
  prompts: {
    candidateCount: number; recommendedCount: number; approvedCount: number;
    groups: Array<{
      slug: string; name: string; intent: PromptIntent; total: number; recommended: number; approved: number;
      prompts: Array<{ id: string; text: string; recommended: boolean; approved: boolean }>;
    }>;
  };
  connections: Array<{ kind: ConnectorProvider; connected: boolean; lastSyncedAt: string | null }>;
};

export type ProfileEdits = Partial<{
  name: string; businessType: BusinessType | null; siteArchetype: string | null;
  offerings: string[]; audiences: string[]; customerProblems: string[];
  geographicScope: string[]; differentiators: string[]; trustClaims: string[];
  topicsToOwn: string[]; topicsToExclude: string[];
}>;
export type ProfilePatch = Partial<Record<string, string | string[] | null>>;
export type PromptSelection = {
  useRecommendedDefault?: boolean;
  approvedGroups?: string[];
  approvedIds?: string[];
  removedIds?: string[];
  edits?: Array<{ fromId: string; text: string }>;
};
export type TrackedPromptRow = {
  id: string; tenant_id: string; account_id: string; text: string;
  topic_id: string | null; location_scope: string | null; service_scope: string | null;
  intent_type: string; platforms: string[]; tags: string[]; is_active: boolean;
  created_at: string; updated_at: string;
};

type CandidateDraft = { text: string; groupSlug: string; groupName: string; intent: PromptIntent; recommended: boolean };

// ── injectable dependencies ─────────────────────────────────────────────────

export type OnboardingStore = {
  updateTenantDomain(tenantId: string, domain: string, now: string): Promise<"ok" | "not_pending">;
  updateTenantGoal(tenantId: string, goal: string, now: string): Promise<"ok" | "not_pending">;
  activateTenant(tenantId: string, now: string): Promise<"activated" | "already_active" | "blocked">;
  readPrompts(tenantId: string): Promise<TrackedPromptRow[]>;
  upsertPrompts(rows: TrackedPromptRow[]): Promise<void>;
};

export type OnboardingDeps = {
  store?: OnboardingStore;
  getAccount?: (id: string) => Promise<Account | null>;
  loadProfile?: (id: string) => Promise<BusinessProfile>;
  saveProfile?: typeof saveBusinessProfile;
  loadCrawl?: (id: string) => Promise<CrawlFrontierState | null>;
  startCrawl?: typeof startColdStartCrawl;
  runBatch?: typeof runCrawlBatch;
  probe?: typeof fetchPageHtml;
  connectorInfo?: (p: ConnectorProvider, tid: string) => Promise<ConnectorInfo>;
  complete?: CompleteFn;
  coldStartScan?: typeof runInProcessColdStartScan;
  scheduleResearch?: (id: string) => void;
  now?: () => Date;
};
type Resolved = Required<OnboardingDeps>;

export function resolve(deps?: OnboardingDeps): Resolved {
  return {
    store: deps?.store ?? supabaseOnboardingStore(),
    getAccount: deps?.getAccount ?? getTenant,
    loadProfile: deps?.loadProfile ?? loadBusinessProfile,
    saveProfile: deps?.saveProfile ?? saveBusinessProfile,
    loadCrawl: deps?.loadCrawl ?? loadCrawlFrontier,
    startCrawl: deps?.startCrawl ?? startColdStartCrawl,
    runBatch: deps?.runBatch ?? runCrawlBatch,
    probe: deps?.probe ?? fetchPageHtml,
    connectorInfo: deps?.connectorInfo ?? ((p, tid) => getConnectorInfo(p, tid)),
    complete: deps?.complete as CompleteFn,
    coldStartScan: deps?.coldStartScan ?? runInProcessColdStartScan,
    scheduleResearch: deps?.scheduleResearch ?? ensureResearchRunOnVisit,
    now: deps?.now ?? (() => new Date()),
  };
}

// ── pure prompt helpers (internal) ──────────────────────────────────────────

function normalizePromptText(text: string): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function promptRowId(tenantId: string, normalizedText: string): string {
  return "prompt-" + createHash("sha256").update(`${tenantId}|${normalizedText}`).digest("hex").slice(0, 16);
}
function slugify(name: string): string {
  return (name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "group";
}
function dedupeCandidates(cands: CandidateDraft[]): CandidateDraft[] {
  const seen = new Set<string>();
  const out: CandidateDraft[] = [];
  for (const c of cands) {
    const key = normalizePromptText(c.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
function countFamily(list: CandidateDraft[], intent: PromptIntent): number {
  return list.filter((r) => r.intent === intent).length;
}
/** Force EXACTLY `target` recommended, preferring balance across the seven families. Pure. */
function fixRecommendedCount(cands: CandidateDraft[], target: number): CandidateDraft[] {
  const rows = cands.map((c) => ({ ...c }));
  const rec = () => rows.filter((r) => r.recommended);
  if (rec().length > target) {
    const ordered = [...rec()].sort((a, b) => countFamily(rec(), b.intent) - countFamily(rec(), a.intent));
    for (const r of ordered) {
      if (rec().length <= target) break;
      if (countFamily(rec(), r.intent) <= 1) continue;
      r.recommended = false;
    }
    for (const r of rec()) { if (rec().length <= target) break; r.recommended = false; }
    return rows;
  }
  let need = target - rec().length;
  let progressed = true;
  while (need > 0 && progressed) {
    progressed = false;
    for (const fam of PROMPT_INTENTS) {
      if (need <= 0) break;
      const next = rows.find((c) => c.intent === fam && !c.recommended);
      if (next) { next.recommended = true; need -= 1; progressed = true; }
    }
  }
  return rows;
}
function clean(values: string[], fallback: string[]): string[] {
  const out = (values ?? []).map((v) => v.trim().toLowerCase()).filter((v) => v.length >= 2 && v.length <= 80);
  return out.length ? [...new Set(out)] : [...new Set(fallback.map((f) => f.toLowerCase()))];
}
/** Deterministic candidate set from the confirmed profile: >= 60 unique, exactly 50 recommended. */
function deterministicCandidates(profile: BusinessProfile): CandidateDraft[] {
  const name = profile.name.value.trim() || "us";
  const offerings = clean(profile.offerings.value, ["what we offer"]);
  const audiences = clean(profile.audiences.value, ["customers"]);
  const problems = clean(profile.customerProblems.value, []);
  const geos = clean(profile.geographicScope.value, []);
  const topics = clean(profile.topicsToOwn.value, offerings);
  const diffs = clean(profile.differentiators.value, []);
  const out: CandidateDraft[] = [];
  const add = (text: string, group: string, intent: PromptIntent) => out.push({ text, groupSlug: slugify(group), groupName: group, intent, recommended: false });
  for (const o of offerings.slice(0, 8)) {
    add(`best ${o}`, "Category leaders", "category");
    add(`top ${o} providers`, "Category leaders", "category");
    add(`${o} vs alternatives`, "Comparisons", "comparison");
    add(`how much does ${o} cost`, "Buying decisions", "commercial");
    add(`how does ${o} work`, "How it works", "factual");
  }
  for (const p of problems.slice(0, 8)) { add(`how to ${p}`, "Problems we solve", "problem"); add(`why is ${p} hard`, "Problems we solve", "problem"); }
  for (const g of geos.slice(0, 6)) for (const o of offerings.slice(0, 3)) add(`${o} in ${g}`, "Where we serve", "commercial");
  for (const a of audiences.slice(0, 6)) for (const o of offerings.slice(0, 2)) add(`${o} for ${a}`, "Who we help", "commercial");
  for (const t of topics.slice(0, 10)) add(`what is ${t}`, "Explainers", "factual");
  for (const d of diffs.slice(0, 6)) add(`${d}`, "Why choose us", "trust");
  add(`${name} reviews`, "Your brand", "brand");
  add(`is ${name} legit`, "Your brand", "trust");
  add(`is ${name} a good choice`, "Your brand", "brand");
  add(`${name} vs competitors`, "Your brand", "comparison");
  add(`what does ${name} do`, "Your brand", "brand");
  add(`${name} pricing`, "Your brand", "commercial");
  add(`${name} guarantees`, "Your brand", "trust");
  const bank = offerings.length ? offerings : ["our service"];
  for (let i = 1; out.length < 66 && i <= 40; i += 1) {
    for (const o of bank) {
      add(`${o} guide ${i}`, "More topics", "factual");
      add(`best ${o} for beginners`, "Category leaders", "category");
      add(`${o} checklist ${i}`, "How it works", "problem");
      if (out.length >= 66) break;
    }
  }
  const unique = dedupeCandidates(out);
  const seeded = unique.map((c, i) => ({ ...c, recommended: i < LIMITS.recommendedTarget }));
  return fixRecommendedCount(seeded, Math.min(LIMITS.recommendedTarget, seeded.length));
}
function uniqueTags(tags: string[]): string[] { return [...new Set(tags)]; }

// ── durable store (Supabase-backed default) ─────────────────────────────────

export function supabaseOnboardingStore(): OnboardingStore {
  return {
    async updateTenantDomain(tenantId, domain, now) {
      const { data, error } = await getSupabaseAdmin().from("tenants").update({ domain, updated_at: now }).eq("id", tenantId).eq("status", "pending_onboarding").select("id");
      if (error) throw new Error(error.message);
      return data && data.length > 0 ? "ok" : "not_pending";
    },
    async updateTenantGoal(tenantId, goal, now) {
      const { data, error } = await getSupabaseAdmin().from("tenants").update({ growth_goal: goal, updated_at: now }).eq("id", tenantId).eq("status", "pending_onboarding").select("id");
      if (error) throw new Error(error.message);
      return data && data.length > 0 ? "ok" : "not_pending";
    },
    async activateTenant(tenantId, now) {
      const { data, error } = await getSupabaseAdmin().from("tenants").update({ status: "active", tos_accepted_at: now, updated_at: now }).eq("id", tenantId).eq("status", "pending_onboarding").is("tos_accepted_at", null).select("id");
      if (error) throw new Error(error.message);
      if (data && data.length > 0) return "activated";
      const { data: cur } = await getSupabaseAdmin().from("tenants").select("status").eq("id", tenantId).maybeSingle();
      return cur?.status === "active" ? "already_active" : "blocked";
    },
    async readPrompts(tenantId) {
      const { data, error } = await getSupabaseAdmin().from("tracked_prompts").select("*").eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
      return (data ?? []) as TrackedPromptRow[];
    },
    async upsertPrompts(rows) {
      if (rows.length === 0) return;
      const { error } = await getSupabaseAdmin().from("tracked_prompts").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(error.message);
    },
  };
}

// ── commands: candidates, approval, activation ──────────────────────────────

type GenerateResult = { ok: true; candidateCount: number; recommendedCount: number } | { ok: false; error: string };

export async function generatePromptCandidates(tenantId: string, deps?: OnboardingDeps): Promise<GenerateResult> {
  const d = resolve(deps);
  const account = await d.getAccount(tenantId);
  const canonicalId = account?.id ?? tenantId;
  // Status rail: prompt writes happen only while the account is still onboarding.
  if (account?.status !== "pending_onboarding") return { ok: false, error: "Your account is already running, so its prompts are locked here." };
  const profile = await d.loadProfile(tenantId);
  if (profile.name.origin !== "operator_confirmed") return { ok: false, error: "Confirm your business first, then I will build your prompts." };
  if ((account?.growth_goal ?? null) === null) return { ok: false, error: "Pick your goal first, then I will build your prompts." };

  const existing = await d.store.readPrompts(canonicalId);
  const existingCandidates = existing.filter((r) => r.tags?.includes(PROMPT_TAGS.candidate));
  if (existingCandidates.length > 0) {
    return { ok: true, candidateCount: existingCandidates.length, recommendedCount: existingCandidates.filter((r) => r.tags.includes(PROMPT_TAGS.recommended)).length };
  }

  let candidates: CandidateDraft[] = [];
  const llm = await callStructuredLLM({
    kind: "prompt_candidates", tenantId, budgetPlatform: "onboarding-openai",
    system: CANDIDATES_SYSTEM, user: buildCandidatesUser(profile, account?.growth_goal ?? "balanced"),
    grounded: profile.topicsToOwn.value.join(" ").slice(0, 2000), complete: d.complete, now: d.now(),
  });
  if (llm.status === "drafted") {
    for (const g of llm.value.groups) {
      const slug = slugify(g.slug || g.name);
      for (const p of g.prompts) candidates.push({ text: p.text, groupSlug: slug, groupName: g.name, intent: g.intent, recommended: p.recommended });
    }
    candidates = fixRecommendedCount(dedupeCandidates(candidates), LIMITS.recommendedTarget);
  }
  if (candidates.length < 60) candidates = deterministicCandidates(profile);

  const nowIso = d.now().toISOString();
  const byId = new Map<string, TrackedPromptRow>();
  for (const c of candidates) {
    const id = promptRowId(canonicalId, normalizePromptText(c.text));
    byId.set(id, {
      id, tenant_id: canonicalId, account_id: canonicalId, text: c.text.trim(),
      topic_id: c.groupSlug, location_scope: null, service_scope: null, intent_type: c.intent,
      platforms: ["perplexity", "chatgpt"],
      tags: c.recommended ? [PROMPT_TAGS.candidate, PROMPT_TAGS.set, PROMPT_TAGS.recommended] : [PROMPT_TAGS.candidate, PROMPT_TAGS.set],
      is_active: false, created_at: nowIso, updated_at: nowIso,
    });
  }
  const finalRows = [...byId.values()];
  await d.store.upsertPrompts(finalRows);
  return { ok: true, candidateCount: finalRows.length, recommendedCount: finalRows.filter((r) => r.tags.includes(PROMPT_TAGS.recommended)).length };
}

type ApproveResult = { ok: true; approvedCount: number } | { ok: false; error: string };

export async function approvePrompts(tenantId: string, selection: PromptSelection, deps?: OnboardingDeps): Promise<ApproveResult> {
  const d = resolve(deps);
  const account = await d.getAccount(tenantId);
  const canonicalId = account?.id ?? tenantId;
  if (account?.status !== "pending_onboarding") return { ok: false, error: "Your account is already running, so its prompts are locked here." };
  const rows = await d.store.readPrompts(canonicalId);
  const candidates = rows.filter((r) => r.tags?.includes(PROMPT_TAGS.candidate));
  if (candidates.length === 0) return { ok: false, error: "I have not built your prompts yet." };

  const removed = new Set(selection.removedIds ?? []);
  const approvedIds = new Set<string>();
  if (selection.useRecommendedDefault) for (const r of candidates) if (r.tags.includes(PROMPT_TAGS.recommended)) approvedIds.add(r.id);
  for (const id of selection.approvedIds ?? []) approvedIds.add(id);
  if (selection.approvedGroups?.length) {
    const groups = new Set(selection.approvedGroups);
    for (const r of candidates) if (r.topic_id && groups.has(r.topic_id)) approvedIds.add(r.id);
  }
  for (const id of removed) approvedIds.delete(id);

  const nowIso = d.now().toISOString();
  const writes: TrackedPromptRow[] = [];
  for (const r of candidates) if (approvedIds.has(r.id)) writes.push({ ...r, is_active: true, tags: uniqueTags([...r.tags, PROMPT_TAGS.core]), updated_at: nowIso });
  const editedTexts = new Set<string>();
  for (const edit of selection.edits ?? []) {
    const norm = normalizePromptText(edit.text);
    if (!norm || editedTexts.has(norm)) continue;
    editedTexts.add(norm);
    const source = candidates.find((r) => r.id === edit.fromId);
    writes.push({
      id: promptRowId(canonicalId, norm), tenant_id: canonicalId, account_id: canonicalId, text: edit.text.trim(),
      topic_id: source?.topic_id ?? null, location_scope: null, service_scope: null, intent_type: source?.intent_type ?? "category",
      platforms: ["perplexity", "chatgpt"], tags: [PROMPT_TAGS.candidate, PROMPT_TAGS.set, PROMPT_TAGS.edited, PROMPT_TAGS.core], is_active: true,
      created_at: nowIso, updated_at: nowIso,
    });
  }

  // Approval is DECLARATIVE: this selection IS the active core set. Dedupe by id
  // (an edit whose text matches an approved candidate collapses to one row), bound
  // the true resulting count, then deactivate any previously-approved row the new
  // selection dropped, so a back-and-reapprove can never accumulate past the bound.
  const byId = new Map(writes.map((w) => [w.id, w]));
  const activeCount = byId.size;
  if (activeCount < LIMITS.minActive) return { ok: false, error: `Pick at least ${LIMITS.minActive} prompts so I can track something meaningful. You have ${activeCount}.` };
  if (activeCount > LIMITS.maxActive) return { ok: false, error: `That is ${activeCount} prompts. Keep it to ${LIMITS.maxActive} or fewer so each one gets real attention.` };
  const finalWrites = [...byId.values()];
  for (const r of candidates) {
    if (r.is_active && r.tags?.includes(PROMPT_TAGS.core) && !byId.has(r.id)) {
      finalWrites.push({ ...r, is_active: false, updated_at: nowIso });
    }
  }
  await d.store.upsertPrompts(finalWrites);
  return { ok: true, approvedCount: activeCount };
}

type ActivateResult = { ok: true; redirect: "/" } | { ok: false; error: string };

export async function activateAccount(tenantId: string, tosAccepted: boolean, deps?: OnboardingDeps): Promise<ActivateResult> {
  const d = resolve(deps);
  if (!tosAccepted) return { ok: false, error: "Check the box to start tracking your site." };
  const [account, profile] = await Promise.all([d.getAccount(tenantId), d.loadProfile(tenantId)]);
  const canonicalId = account?.id ?? tenantId;
  if (account?.status === "active") return { ok: true, redirect: "/" };
  if (!account?.domain?.trim()) return { ok: false, error: "Add your website first." };
  if (profile.name.origin !== "operator_confirmed") return { ok: false, error: "Confirm your business first." };
  if ((account.growth_goal ?? null) === null) return { ok: false, error: "Pick your goal first." };
  const rows = await d.store.readPrompts(canonicalId);
  if (rows.filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core)).length < 1) return { ok: false, error: "Approve your prompts first." };

  const nowIso = d.now().toISOString();
  const outcome = await d.store.activateTenant(canonicalId, nowIso).catch(() => "blocked" as const);
  if (outcome === "blocked") return { ok: false, error: "I could not start your account just now. Try again in a moment." };
  if (outcome === "activated") {
    try {
      const inventory = await d.loadCrawl(canonicalId).catch(() => null);
      if (!inventory || inventory.pages_crawled === 0) await d.coldStartScan({ tenantId: canonicalId, domain: account.domain.trim() });
    } catch { /* cold-start is fail-soft; research still schedules below */ }
    d.scheduleResearch(canonicalId);
  }
  return { ok: true, redirect: "/" };
}

// ── candidate prompt (concise; the schema + facade enforce the real contract) ─
const CANDIDATES_SYSTEM =
  "You generate a broad universe of AI-search prompts a business's customers would ask, as JSON grouped by topic. " +
  "Cover all seven intent families (category, problem, comparison, commercial, factual, trust, brand). " +
  "Aim for about 100 unique prompts in 5 to 10 groups, with EXACTLY 50 marked recommended:true. No dashes.";
function buildCandidatesUser(p: BusinessProfile, goal: string): string {
  return [
    `Business: ${p.name.value}`, `Type: ${p.businessType.value ?? "unknown"}`, `Goal: ${goal}`,
    `Offerings: ${p.offerings.value.join(", ")}`, `Audiences: ${p.audiences.value.join(", ")}`,
    `Problems: ${p.customerProblems.value.join(", ")}`, `Geography: ${p.geographicScope.value.join(", ")}`,
    `Topics to own: ${p.topicsToOwn.value.join(", ")}`,
  ].join("\n");
}

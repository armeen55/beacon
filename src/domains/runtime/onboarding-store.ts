import "server-only";

/**
 * onboarding-store (Slice 5, 2026-07-24) - the shared core of the onboarding
 * facade: the injectable deps, the durable Supabase seam, the pure prompt helpers,
 * and the three commands that persist + activate (generate, approve, activate).
 * The profile + state commands live in onboarding.ts and import from here (one
 * direction, no cycle). Trust rails: every write is status-guarded (pending only,
 * or the atomic activation flip); no paid run before activation; every prompt row
 * carries tenant_id = account_id = the canonical tenant id (never the slug).
 */

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { Account, BusinessProfile, BusinessType } from "@/domains/account";
import { getTenant, loadBusinessProfile, saveBusinessProfile } from "@/domains/account";
import { loadCrawlFrontier, runCrawlBatch, runInProcessColdStartScan, fetchPageHtml, ALL_ENGINES } from "@/domains/evidence";
import { startColdStartCrawl, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { getConnectorInfo, type ConnectorInfo, type ConnectorProvider } from "@/lib/connector-store";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { ensureResearchRunOnVisit } from "./ops/on-visit-refresh";

// ── shared public shapes ────────────────────────────────────────────────────

export type OnboardingGoal = "recover" | "grow" | "balanced";
type PromptIntent = "category" | "problem" | "comparison" | "commercial" | "factual" | "trust" | "brand";
export const PROMPT_INTENTS: readonly PromptIntent[] = ["category", "problem", "comparison", "commercial", "factual", "trust", "brand"];

/** Tags + limits that define the core-prompt lifecycle (one export each, bundled). */
export const PROMPT_TAGS = { candidate: "candidate_v1", set: "set_v1", recommended: "recommended", core: "core_v1", edited: "edited", added: "added" } as const;
const LIMITS = { recommendedTarget: 50, minActive: 10, maxActive: 100 };

/** The prompt-generation recipe version. Bump ONLY when generation changes enough
 *  that old rows should regenerate; a bump is a basis input, so it strands every
 *  prior basis as inactive history. */
const PROMPT_GENERATION_VERSION = 1;
/** Reserved basis separators: control chars that never appear in normalized
 *  business text, so no field value can forge one. */
const SEP_TOP = "\x1e", SEP_FIELD = "\x1f", SEP_LIST = "\x1d";

/** The confirmable/patchable business fields; confirmed only when EVERY one carries operator_confirmed provenance. */
export const CONFIRMABLE_FIELDS = [
  "name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems",
  "geographicScope", "differentiators", "trustClaims", "topicsToOwn", "topicsToExclude",
] as const;

/** Truthful confirmation (D3): confirmed ONLY when every confirmable section is
 *  operator-confirmed, so a name-only edit never advances the wizard past confirm. Pure. */
export function isProfileConfirmed(profile: BusinessProfile): boolean {
  return CONFIRMABLE_FIELDS.every(
    (k) => (profile as unknown as Record<string, { origin?: string }>)[k]?.origin === "operator_confirmed",
  );
}

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
  /** Step 7 first-look preview, composed from crawl facts behind the facade so the page never imports the scanner. */
  findings: { firstWin: { action: string; plainWhy: string; exactFix: string; url: string } | null };
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
  /** Brand-new prompts typed into a group: the group's intent is inherited; text is normalized, deduped, validated server-side. */
  additions?: Array<{ groupSlug: string; text: string }>;
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
  /** Atomic website replacement (D1): sets the domain and, only on a real change,
   *  clears the goal, deactivates prompts, and resets the profile in one
   *  transaction. 'unchanged' = same domain re-submitted; 'not_pending' = locked. */
  replaceWebsite(tenantId: string, domain: string, now: string): Promise<"replaced" | "unchanged" | "not_pending">;
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
function sha16(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
/** Row id keyed by (tenant, basis, text): a new basis writes NEW rows and old ones survive untouched as inactive history. */
function promptRowId(tenantId: string, basisTag: string, normalizedText: string): string {
  return "prompt-" + sha16(`${tenantId}|${basisTag}|${normalizedText}`);
}
function normField(value: unknown): string {
  // Strip the reserved separator range so no field value can forge a boundary.
  return String(value ?? "").replace(/[\x1c-\x1f]/g, "").trim().toLowerCase();
}
function normList(value: unknown): string {
  return (Array.isArray(value) ? value : [])
    .map((v) => normField(v))
    .filter(Boolean)
    .sort()
    .join(SEP_LIST);
}
/** Basis fingerprint (D2): a stable "basis_" + 16-hex tag over the research-
 *  affecting inputs (tenant, domain, goal, generation version, confirmed profile
 *  facts, lists lowercased/trimmed/sorted). Any change mints a new basis; the
 *  old set survives only as inactive history. Pure. */
export function basisTag(tenantId: string, domain: string, profile: BusinessProfile, goal: string | null): string {
  const p = profile as unknown as Record<string, { value?: unknown }>;
  const profileSegment = [
    normField(profile.name.value), normField(profile.businessType.value), normField(profile.siteArchetype.value),
    normList(p.offerings?.value), normList(p.audiences?.value), normList(p.customerProblems?.value),
    normList(p.geographicScope?.value), normList(p.topicsToOwn?.value), normList(p.topicsToExclude?.value),
  ].join(SEP_FIELD);
  const canonical = [
    normField(tenantId), normField(domain), normField(goal), String(PROMPT_GENERATION_VERSION), profileSegment,
  ].join(SEP_TOP);
  return "basis_" + sha16(canonical);
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
function norm(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim().toLowerCase()).filter((v) => v.length >= 2 && v.length <= 80))];
}
/**
 * Honest deterministic candidates from CONFIRMED facts only (D7): natural customer
 * questions per intent family (category, problem, comparison, commercial, factual,
 * trust, brand), deduped, NEVER padded with numbered filler. A thin profile yields
 * FEWER prompts, not junk; fixRecommendedCount balances the recommended set.
 */
function deterministicCandidates(profile: BusinessProfile): CandidateDraft[] {
  const name = profile.name.value.trim();
  const offerings = norm(profile.offerings.value);
  const audiences = norm(profile.audiences.value);
  const problems = norm(profile.customerProblems.value);
  const geos = norm(profile.geographicScope.value);
  const topics = norm(profile.topicsToOwn.value);
  const out: CandidateDraft[] = [];
  const add = (text: string, group: string, intent: PromptIntent) => out.push({ text, groupSlug: slugify(group), groupName: group, intent, recommended: false });
  for (const o of offerings.slice(0, 8)) {
    add(`best ${o}`, "Category leaders", "category");
    add(`top ${o}`, "Category leaders", "category");
    add(`${o} compared with alternatives`, "Comparisons", "comparison");
    add(`how much does ${o} cost`, "Buying decisions", "commercial");
    add(`where to get ${o}${geos.length ? ` in ${geos[0]}` : ""}`, "Buying decisions", "commercial");
    add(`how does ${o} work`, "How it works", "factual");
  }
  for (const p of problems.slice(0, 8)) add(`how do I ${p}`, "Problems we solve", "problem");
  for (const a of audiences.slice(0, 6)) for (const o of offerings.slice(0, 2)) add(`${o} for ${a}`, "Who we help", "commercial");
  for (const t of topics.slice(0, 10)) add(`what is ${t}`, "Explainers", "factual");
  if (name) {
    add(`${name} vs competitors`, "Your brand", "comparison");
    add(`${name} reviews`, "Your brand", "brand");
    add(`what does ${name} do`, "Your brand", "brand");
    add(`is ${name} legit`, "Your brand", "trust");
    add(`can I trust reviews of ${name}`, "Your brand", "trust");
  }
  const unique = dedupeCandidates(out);
  const target = Math.min(LIMITS.recommendedTarget, unique.length);
  const seeded = unique.map((c, i) => ({ ...c, recommended: i < target }));
  return fixRecommendedCount(seeded, target);
}
function uniqueTags(tags: string[]): string[] { return [...new Set(tags)]; }

// ── durable store (Supabase-backed default) ─────────────────────────────────

export function supabaseOnboardingStore(): OnboardingStore {
  return {
    async replaceWebsite(tenantId, domain) {
      // One atomic RPC: sets the domain and, only on a real change, clears the goal, deactivates prompts, resets the profile.
      const { data, error } = await getSupabaseAdmin().rpc("replace_onboarding_website", { p_tenant_id: tenantId, p_domain: domain });
      if (error) throw new Error(error.message);
      const outcome = String(data ?? "");
      return outcome === "replaced" || outcome === "unchanged" || outcome === "not_pending" ? outcome : "not_pending";
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
  if (!isProfileConfirmed(profile)) return { ok: false, error: "Confirm your business first, then I will build your prompts." };
  const goal = account?.growth_goal ?? null;
  if (goal === null) return { ok: false, error: "Pick your goal first, then I will build your prompts." };

  const basis = basisTag(canonicalId, account?.domain?.trim() ?? "", profile, goal);
  const existing = await d.store.readPrompts(canonicalId);
  const currentCandidates = existing.filter((r) => r.tags?.includes(PROMPT_TAGS.candidate) && r.tags?.includes(basis));
  if (currentCandidates.length > 0) {
    // A prompt set already exists for this exact basis: reuse it, spend nothing.
    return { ok: true, candidateCount: currentCandidates.length, recommendedCount: currentCandidates.filter((r) => r.tags.includes(PROMPT_TAGS.recommended)).length };
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
    const id = promptRowId(canonicalId, basis, normalizePromptText(c.text));
    byId.set(id, {
      id, tenant_id: canonicalId, account_id: canonicalId, text: c.text.trim(),
      topic_id: c.groupSlug, location_scope: null, service_scope: null, intent_type: c.intent,
      platforms: [...ALL_ENGINES],
      tags: c.recommended ? [PROMPT_TAGS.candidate, PROMPT_TAGS.set, PROMPT_TAGS.recommended, basis] : [PROMPT_TAGS.candidate, PROMPT_TAGS.set, basis],
      is_active: false, created_at: nowIso, updated_at: nowIso,
    });
  }
  // In the SAME write, deactivate any still-active rows from OTHER bases so a changed basis never leaves an old prompt tracked.
  const stale: TrackedPromptRow[] = [];
  for (const r of existing) {
    if (r.is_active && !r.tags?.includes(basis)) stale.push({ ...r, is_active: false, updated_at: nowIso });
  }
  await d.store.upsertPrompts([...byId.values(), ...stale]);
  return { ok: true, candidateCount: byId.size, recommendedCount: [...byId.values()].filter((r) => r.tags.includes(PROMPT_TAGS.recommended)).length };
}

type ApproveResult = { ok: true; approvedCount: number } | { ok: false; error: string };

export async function approvePrompts(tenantId: string, selection: PromptSelection, deps?: OnboardingDeps): Promise<ApproveResult> {
  const d = resolve(deps);
  const account = await d.getAccount(tenantId);
  const canonicalId = account?.id ?? tenantId;
  if (account?.status !== "pending_onboarding") return { ok: false, error: "Your account is already running, so its prompts are locked here." };
  const profile = await d.loadProfile(tenantId);
  const basis = basisTag(canonicalId, account?.domain?.trim() ?? "", profile, account?.growth_goal ?? null);
  const rows = await d.store.readPrompts(canonicalId);
  const candidates = rows.filter((r) => r.tags?.includes(PROMPT_TAGS.candidate) && r.tags?.includes(basis));
  if (candidates.length === 0) return { ok: false, error: "I have not built your prompts yet." };

  // Every referenced id must be one of THIS account's current-basis candidates; a foreign or superseded-basis id is rejected.
  const validId = new Set(candidates.map((r) => r.id));
  const referenced = [...(selection.approvedIds ?? []), ...(selection.removedIds ?? []), ...(selection.edits ?? []).map((e) => e.fromId)];
  for (const id of referenced) if (!validId.has(id)) return { ok: false, error: "One of those prompts is not part of your current set. Refresh the page and try again." };
  const groupSlugs = new Set(candidates.map((r) => r.topic_id).filter((s): s is string => Boolean(s)));
  for (const a of selection.additions ?? []) if (!groupSlugs.has(a.groupSlug)) return { ok: false, error: "You can only add a prompt to one of your own topics." };

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
  const usedTexts = new Set<string>();
  // Edits + additions become NEW current-basis rows (an edit supersedes its source
  // candidate; an addition inherits the group's intent), built FIRST so a
  // superseded source never also lands as an approved active row.
  for (const edit of selection.edits ?? []) {
    const norm = normalizePromptText(edit.text);
    if (!norm || usedTexts.has(norm)) continue;
    usedTexts.add(norm);
    const source = candidates.find((r) => r.id === edit.fromId)!;
    approvedIds.delete(source.id); // the source is replaced by this edited row
    writes.push(coreRow(canonicalId, basis, edit.text, source.topic_id, source.intent_type, PROMPT_TAGS.edited, nowIso));
  }
  for (const addn of selection.additions ?? []) {
    const norm = normalizePromptText(addn.text);
    if (!norm || usedTexts.has(norm)) continue;
    usedTexts.add(norm);
    const intent = candidates.find((r) => r.topic_id === addn.groupSlug)?.intent_type ?? "category";
    writes.push(coreRow(canonicalId, basis, addn.text, addn.groupSlug, intent, PROMPT_TAGS.added, nowIso));
  }
  for (const r of candidates) if (approvedIds.has(r.id)) writes.push({ ...r, is_active: true, tags: uniqueTags([...r.tags, PROMPT_TAGS.core]), updated_at: nowIso });

  // Approval is DECLARATIVE: this selection IS the active core set. Dedupe by id,
  // bound the true resulting count, then deactivate any previously-approved row
  // the new selection dropped, so a re-approve can never accumulate past the bound.
  const byId = new Map(writes.map((w) => [w.id, w]));
  const activeCount = byId.size;
  if (activeCount < LIMITS.minActive) return { ok: false, error: `Pick at least ${LIMITS.minActive} prompts so I can track something meaningful. You have ${activeCount}.` };
  if (activeCount > LIMITS.maxActive) return { ok: false, error: `That is ${activeCount} prompts. Keep it to ${LIMITS.maxActive} or fewer so each one gets real attention.` };
  const finalWrites = [...byId.values()];
  // Sweep EVERY active prompt row not in this selection, across ALL bases: a goal
  // toggled back reuses old candidates without the mint sweep, so approval is what
  // keeps abandoned-basis rows from staying live and paid-for.
  for (const r of rows) {
    if (r.is_active && !byId.has(r.id) && (r.tags?.includes(PROMPT_TAGS.candidate) || r.tags?.includes(PROMPT_TAGS.core))) {
      finalWrites.push({ ...r, is_active: false, updated_at: nowIso });
    }
  }
  await d.store.upsertPrompts(finalWrites);
  return { ok: true, approvedCount: activeCount };
}

/** One active core prompt row (edited or added), basis-tagged to the current set with the four-engine tracking scope. */
function coreRow(canonicalId: string, basis: string, text: string, topicId: string | null, intent: string, kind: string, nowIso: string): TrackedPromptRow {
  return {
    id: promptRowId(canonicalId, basis, normalizePromptText(text)), tenant_id: canonicalId, account_id: canonicalId, text: text.trim(),
    topic_id: topicId, location_scope: null, service_scope: null, intent_type: intent,
    platforms: [...ALL_ENGINES], tags: [PROMPT_TAGS.candidate, PROMPT_TAGS.set, kind, PROMPT_TAGS.core, basis], is_active: true,
    created_at: nowIso, updated_at: nowIso,
  };
}

type ActivateResult = { ok: true; redirect: "/" } | { ok: false; error: string };

export async function activateAccount(tenantId: string, tosAccepted: boolean, deps?: OnboardingDeps): Promise<ActivateResult> {
  const d = resolve(deps);
  if (!tosAccepted) return { ok: false, error: "Check the box to start tracking your site." };
  const [account, profile] = await Promise.all([d.getAccount(tenantId), d.loadProfile(tenantId)]);
  const canonicalId = account?.id ?? tenantId;
  if (account?.status === "active") return { ok: true, redirect: "/" };
  if (!account?.domain?.trim()) return { ok: false, error: "Add your website first." };
  if (!isProfileConfirmed(profile)) return { ok: false, error: "Confirm your business first." };
  const goal = account.growth_goal ?? null;
  if (goal === null) return { ok: false, error: "Pick your goal first." };
  // Only CURRENT-basis core rows owned by this account count: a stale superseded-basis row, or a foreign id, can never activate.
  const basis = basisTag(canonicalId, account.domain.trim(), profile, goal);
  const rows = await d.store.readPrompts(canonicalId);
  const activeCore = rows.filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core) && r.tags?.includes(basis) && r.tenant_id === canonicalId && r.account_id === canonicalId);
  if (activeCore.length < LIMITS.minActive) return { ok: false, error: "Approve your prompts first." };
  if (activeCore.length > LIMITS.maxActive) return { ok: false, error: "That is more prompts than I can track well. Trim your set first." };

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

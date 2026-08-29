import "server-only";

/** onboarding-store (Slice 5, 2026-07-24) - the shared core of the onboarding facade: the injectable deps, the durable Supabase seam, the
 *  pure prompt helpers, and the three commands that persist + activate. The profile + state commands live in onboarding.ts and import from
 *  here (one direction, no cycle). Trust rails: every write is status-guarded (pending, or a running account at the exact step it is still
 *  missing, or the atomic activation flip); no paid run before activation; every prompt row carries tenant_id = account_id = the canonical
 *  tenant id (never the slug). */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { LIMITS, PROMPT_TAGS, normalizePromptText, promptIdFor, type TrackedPromptRow } from "./prompt-set";
export { PROMPT_TAGS };
export type { TrackedPromptRow };
import type { Account, BusinessProfile, BusinessType } from "@/domains/account";
import { basisTag, getTenant, loadBusinessProfile, saveBusinessProfile } from "@/domains/account";
export { basisTag };
import { loadCrawlFrontier, runCrawlBatch, runInProcessColdStartScan, fetchPageHtml, ALL_ENGINES } from "@/domains/evidence";
import { startColdStartCrawl, type CrawlFrontierState } from "@/domains/evidence/scanning/crawl-frontier";
import { getConnectorInfo, type ConnectorInfo, type ConnectorProvider } from "@/lib/connector-store";
import { callStructuredLLM, type CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { ensureResearchRunOnVisit } from "./ops/on-visit-refresh";

// ── shared public shapes ────────────────────────────────────────────────────

export type OnboardingGoal = "recover" | "grow" | "balanced";
type PromptIntent = "category" | "problem" | "comparison" | "commercial" | "factual" | "trust" | "brand";
export const PROMPT_INTENTS: readonly PromptIntent[] = ["category", "problem", "comparison", "commercial", "factual", "trust", "brand"];

/** The confirmable/patchable business fields; confirmed only when EVERY one carries operator_confirmed provenance. */
export const CONFIRMABLE_FIELDS = [
  "name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems",
  "geographicScope", "differentiators", "trustClaims", "topicsToOwn", "topicsToExclude",
] as const;

/** EVERY SECTION THE CONFIRM STEP PUTS ON SCREEN, and therefore every section a confirmation may speak for: exactly the nine the basis
 *  fingerprints, which is exactly the nine that steer research. It used to be three, so approving "your business basics" approved eight
 *  facts never shown, six of which decide what gets researched. `differentiators` and `trustClaims` are absent: nothing reads them. */
export const SHOWN_FIELDS = ["name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems", "geographicScope", "topicsToOwn", "topicsToExclude"] as const;

/** THE FLOOR THAT LETS SETUP CONTINUE: the three the step asks the operator to TYPE. The other six are shown to be read and corrected,
 *  and most accounts leave several empty, so demanding their provenance would strand every setup on step 3 and lock out the live
 *  account that confirmed three before this existed. */
const CONFIRM_FLOOR = ["name", "offerings", "audiences"] as const;

/** Truthful confirmation (D3): confirmed ONLY when every section the operator was ASKED FOR carries their own provenance, so a
 *  name-only edit never advances the wizard past confirm. Pure. */
export function isProfileConfirmed(profile: BusinessProfile): boolean {
  return CONFIRM_FLOOR.every((k) => (profile as unknown as Record<string, { origin?: string }>)[k]?.origin === "operator_confirmed");
}

/** The account facts setup is judged against, passed in by the caller that already read the row, never re-read here: a tenants read fails
 *  SOFT to null, and a null read must never be mistaken for a customer who never filled anything in. */
type SetupAccount = { status: Account["status"]; domain: string | null; growth_goal: string | null; tos_accepted_at: string | null };

/** WHAT THIS ACCOUNT IS STILL MISSING, and nothing else. `{ step }` is the first genuinely incomplete step, so the operator resumes where
 *  they stopped; null means nothing is owed. A PENDING account owes the whole activation contract, because activation is what it is walking
 *  toward. A RUNNING ACCOUNT'S GAP IS THE OPERATIONAL CONTRACT: what it cannot function without, NEVER a re-derivation of the inputs
 *  required the day it launched, because legitimate later states violate those inputs and the product still works. The live account
 *  predates goals and runs with growth_goal NULL, so demanding one would bounce every surface to setup and writing one would re-mint the
 *  basis and orphan every prompt behind it. Its questions are counted the way the research funnel counts them, basis-agnostically and
 *  against Settings' own 10 to 100 window, because a basis that moved is not something an operator can see. AN OUTAGE IS NOT
 *  INCOMPLETENESS, so this THROWS rather than guessing: the profile read fails SOFT to an empty profile, the exact shape of one nobody ever
 *  filled in, so a blank profile on an active account is unreadable and never a reason to bounce a customer who finished setup months ago.
 *  Free: one memoized profile read and one lean row read, no provider and no crawl. */
export async function setupGap(tenantId: string, account: SetupAccount, deps?: OnboardingDeps): Promise<{ step: 1 | 3 | 4 | 5 | 7 } | null> {
  const d = resolve(deps);
  const running = account.status === "active";
  const domain = (account.domain ?? "").trim();
  if (!domain) return { step: 1 }; // proven off the same account row the caller was resolved from
  const profile = await d.loadProfile(tenantId);
  const held = (k: string): boolean => { const v = (profile as unknown as Record<string, { value?: unknown }>)[k]?.value;
    return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== ""; };
  if (!isProfileConfirmed(profile)) {
    if (!CONFIRMABLE_FIELDS.some(held)) throw new Error("I could not read this account's business profile, so I cannot say whether its setup is finished.");
    return { step: 3 };
  }
  const g = account.growth_goal;
  const goal: OnboardingGoal | null = g === "recover" || g === "grow" || g === "balanced" ? g : null;
  if (!running && goal === null) return { step: 4 }; // a running account is nudged toward a goal on Today, never locked out of the product
  const rows = await d.store.readPrompts(tenantId);
  const core = running
    ? rows.filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core)) // exactly projectTrackedQuestions, which is what actually gets asked
    : rows.filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core) && r.tags?.includes(basisTag(tenantId, domain, profile, goal))
      && r.tenant_id === tenantId && r.account_id === tenantId);
  if (core.length < LIMITS.minActive || core.length > (running ? LIMITS.maxActive : LIMITS.onboardingMax)) return { step: 5 };
  return account.tos_accepted_at ? null : { step: 7 };
}

/** MAY THIS ACCOUNT STILL BE SET UP AT THIS STEP? Pending always. ACTIVE only where this exact step is the one genuinely missing: the
 *  product guard sends an active account back to the step it owes, so a write that refused every active account left the operator bouncing
 *  between two redirects with no way out. Nothing else about a running account is editable here. */
async function resumableAt(account: Account | null, step: 4 | 5 | 7, d: Resolved): Promise<boolean> {
  if (account?.status === "pending_onboarding") return true;
  if (account?.status !== "active") return false;
  return (await setupGap(account.id, account, d).catch(() => null))?.step === step;
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
  /** `connected` is TRI-STATE: "unknown" means the source could not be checked just now, which is not the same fact as disconnected. */
  connections: Array<{ kind: ConnectorProvider; connected: boolean | "unknown"; lastSyncedAt: string | null }>;
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
type CandidateDraft = { text: string; groupSlug: string; groupName: string; intent: PromptIntent; recommended: boolean };

// ── injectable dependencies ─────────────────────────────────────────────────

export type OnboardingStore = {
  /** Atomic website replacement (D1): sets the domain and, only on a real change, clears the goal, deactivates prompts, and resets the
   *  profile in one transaction. 'unchanged' = same domain re-submitted; 'not_pending' = locked. */
  replaceWebsite(tenantId: string, domain: string, now: string): Promise<"replaced" | "unchanged" | "not_pending">;
  updateTenantGoal(tenantId: string, goal: string, now: string, statuses: readonly string[]): Promise<"ok" | "not_pending">;
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
    scheduleResearch: deps?.scheduleResearch ?? ((id: string) => ensureResearchRunOnVisit(id, true)), // finishing onboarding is a person acting, not a repaint
    now: deps?.now ?? (() => new Date()),
  };
}

// ── pure candidate helpers (internal; ids + normalization live in prompt-set) ─

const slugify = (name: string): string =>
  (name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "group";
function dedupeCandidates(cands: CandidateDraft[]): CandidateDraft[] {
  const seen = new Set<string>();
  const out: CandidateDraft[] = [];
  for (const c of cands) {
    const key = normalizePromptText(c.text);
    if (key && !seen.has(key)) { seen.add(key); out.push(c); }
  }
  return out;
}
const countFamily = (list: CandidateDraft[], intent: PromptIntent): number => list.filter((r) => r.intent === intent).length;
/** Force EXACTLY `target` recommended, preferring balance across the seven families. Pure. */
function fixRecommendedCount(cands: CandidateDraft[], target: number): CandidateDraft[] {
  const rows = cands.map((c) => ({ ...c }));
  const rec = () => rows.filter((r) => r.recommended);
  if (rec().length > target) {
    const ordered = [...rec()].sort((a, b) => countFamily(rec(), b.intent) - countFamily(rec(), a.intent));
    for (const r of ordered) {
      if (rec().length <= target) break;
      if (countFamily(rec(), r.intent) > 1) r.recommended = false;
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
/** Honest deterministic candidates from CONFIRMED facts only (D7): natural customer questions per intent family, deduped, NEVER padded with
 *  numbered filler. A thin profile yields FEWER prompts, not junk. */
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

// ── durable store (Supabase-backed default) ─────────────────────────────────

export function supabaseOnboardingStore(): OnboardingStore {
  return {
    async replaceWebsite(tenantId, domain, now) {
      // One atomic RPC: sets the domain and, only on a real change, clears the goal, deactivates prompts, resets the profile.
      const { data, error } = await getSupabaseAdmin().rpc("replace_onboarding_website", { p_tenant_id: tenantId, p_domain: domain });
      if (error) throw new Error(error.message);
      const outcome = String(data ?? "");
      if (outcome === "not_pending") {
        // AN ACTIVE ACCOUNT WITH NO WEBSITE ON FILE still owes one, and the guard that sends it back here needs the write to land or the
        // operator loops forever. ONLY a blank domain is filled in; a running site is never replaced.
        const { data: cur } = await getSupabaseAdmin().from("tenants").select("status, domain").eq("id", tenantId).maybeSingle();
        if (cur?.status !== "active" || String(cur.domain ?? "").trim()) return "not_pending";
        const { data: filled } = await getSupabaseAdmin().from("tenants").update({ domain, updated_at: now }).eq("id", tenantId).eq("status", "active").select("id");
        return filled && filled.length > 0 ? "replaced" : "not_pending";
      }
      return outcome === "replaced" || outcome === "unchanged" ? outcome : "not_pending";
    },
    async updateTenantGoal(tenantId, goal, now, statuses) {
      const { data, error } = await getSupabaseAdmin().from("tenants").update({ growth_goal: goal, updated_at: now }).eq("id", tenantId).in("status", statuses).select("id");
      if (error) throw new Error(error.message);
      return data && data.length > 0 ? "ok" : "not_pending";
    },
    async activateTenant(tenantId, now) {
      // The terms guard is what makes this idempotent: a row that already carries them is never rewritten, so an account flipped active
      // WITHOUT them can still accept them here and one already running is untouched.
      const { data, error } = await getSupabaseAdmin().from("tenants").update({ status: "active", tos_accepted_at: now, updated_at: now }).eq("id", tenantId).in("status", ["pending_onboarding", "active"]).is("tos_accepted_at", null).select("id");
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
  // Status rail: prompt writes happen while the account is still onboarding, or on a running account whose question set is the exact thing
  // it is missing. Anything else is locked.
  if (!(await resumableAt(account, 5, d))) return { ok: false, error: "Your account is already running, so its prompts are locked here." };
  const profile = await d.loadProfile(tenantId);
  if (!isProfileConfirmed(profile)) return { ok: false, error: "Confirm your business first, then I will build your prompts." };
  const goal = account?.growth_goal ?? null;
  if (goal === null) return { ok: false, error: "Pick your goal first, then I will build your prompts." };

  const basis = basisTag(canonicalId, account?.domain?.trim() ?? "", profile, goal);
  const existing = await d.store.readPrompts(canonicalId);
  const currentCandidates = existing.filter((r) => r.tags?.includes(PROMPT_TAGS.candidate) && r.tags?.includes(basis));
  // A prompt set already exists for this exact basis: reuse it, spend nothing.
  if (currentCandidates.length > 0) return { ok: true, candidateCount: currentCandidates.length, recommendedCount: currentCandidates.filter((r) => r.tags.includes(PROMPT_TAGS.recommended)).length };

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
    const id = promptIdFor(canonicalId, basis, c.text);
    byId.set(id, {
      id, tenant_id: canonicalId, account_id: canonicalId, text: c.text.trim(),
      topic_id: c.groupSlug, location_scope: null, service_scope: null, intent_type: c.intent,
      platforms: [...ALL_ENGINES],
      tags: c.recommended ? [PROMPT_TAGS.candidate, PROMPT_TAGS.set, PROMPT_TAGS.recommended, basis] : [PROMPT_TAGS.candidate, PROMPT_TAGS.set, basis],
      is_active: false, version: 1, core: false, created_at: nowIso, updated_at: nowIso,
    });
  }
  // In the SAME write, deactivate any still-active rows from OTHER bases so a changed basis never leaves an old prompt tracked.
  const stale: TrackedPromptRow[] = [];
  for (const r of existing) if (r.is_active && !r.tags?.includes(basis)) stale.push({ ...r, is_active: false, updated_at: nowIso });
  await d.store.upsertPrompts([...byId.values(), ...stale]);
  return { ok: true, candidateCount: byId.size, recommendedCount: [...byId.values()].filter((r) => r.tags.includes(PROMPT_TAGS.recommended)).length };
}

type ApproveResult = { ok: true; approvedCount: number } | { ok: false; error: string };

export async function approvePrompts(tenantId: string, selection: PromptSelection, deps?: OnboardingDeps): Promise<ApproveResult> {
  const d = resolve(deps);
  const account = await d.getAccount(tenantId);
  const canonicalId = account?.id ?? tenantId;
  if (!(await resumableAt(account, 5, d))) return { ok: false, error: "Your account is already running, so its prompts are locked here." };
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

  const approvedIds = new Set<string>();
  if (selection.useRecommendedDefault) for (const r of candidates) if (r.tags.includes(PROMPT_TAGS.recommended)) approvedIds.add(r.id);
  for (const id of selection.approvedIds ?? []) approvedIds.add(id);
  const groups = new Set(selection.approvedGroups ?? []);
  if (groups.size > 0) for (const r of candidates) if (r.topic_id && groups.has(r.topic_id)) approvedIds.add(r.id);
  for (const id of selection.removedIds ?? []) approvedIds.delete(id);

  const nowIso = d.now().toISOString();
  const writes: TrackedPromptRow[] = [];
  const usedTexts = new Set<string>();
  // Edits + additions become NEW current-basis rows (an edit supersedes its source candidate; an addition inherits the group's intent),
  // built FIRST so a superseded source never also lands as an approved active row.
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
  for (const r of candidates) if (approvedIds.has(r.id)) writes.push({ ...r, is_active: true, tags: [...new Set([...r.tags, PROMPT_TAGS.core])], updated_at: nowIso });

  // Approval is DECLARATIVE: this selection IS the active core set. Dedupe by id, bound the true resulting count, then deactivate any row
  // the new selection dropped, so a re-approve never accumulates past the bound.
  const byId = new Map(writes.map((w) => [w.id, w]));
  const activeCount = byId.size;
  // THE UI'S 20-50 WINDOW HOLDS HERE TOO, so no other caller can say yes where the page said no. The floor bends to a thin candidate pool
  // (a 16 question profile approves its 16), never below minActive.
  const floor = Math.max(LIMITS.minActive, Math.min(LIMITS.onboardingMin, candidates.length));
  if (activeCount < floor) return { ok: false, error: `Pick at least ${floor} prompts so I can track something meaningful. You have ${activeCount}.` };
  if (activeCount > LIMITS.onboardingMax) return { ok: false, error: `That is ${activeCount} prompts. Keep it to ${LIMITS.onboardingMax} or fewer so each one gets real attention.` };
  const finalWrites = [...byId.values()];
  // Sweep EVERY active prompt row not in this selection, across ALL bases, and FOR A RUNNING ACCOUNT TOO: skipping it there stacked the
  // strays under the new set, and the funnel counts basis-agnostically, so five orphans plus a fresh thirty-five became forty questions I
  // pay for daily and nobody chose. A row this selection KEEPS is never swept. Settings edits through its own door.
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
    id: promptIdFor(canonicalId, basis, text), tenant_id: canonicalId, account_id: canonicalId, text: text.trim(),
    topic_id: topicId, location_scope: null, service_scope: null, intent_type: intent,
    platforms: [...ALL_ENGINES], tags: [PROMPT_TAGS.candidate, PROMPT_TAGS.set, kind, PROMPT_TAGS.core, basis], is_active: true,
    version: 1, core: true, created_at: nowIso, updated_at: nowIso,
  };
}

type ActivateResult = { ok: true; redirect: "/" } | { ok: false; error: string };

export async function activateAccount(tenantId: string, tosAccepted: boolean, deps?: OnboardingDeps): Promise<ActivateResult> {
  const d = resolve(deps);
  if (!tosAccepted) return { ok: false, error: "Check the box to start tracking your site." };
  const [account, profile] = await Promise.all([d.getAccount(tenantId), d.loadProfile(tenantId)]);
  const canonicalId = account?.id ?? tenantId;
  // AN ACCOUNT ALREADY RUNNING WITH ITS TERMS ON FILE HAS NOTHING TO DO HERE. One flipped active WITHOUT them still owes that step, and the
  // guard that sends it back to the launch step needs somewhere to send it.
  const wasActive = account?.status === "active";
  if (wasActive && !(await resumableAt(account, 7, d))) return { ok: true, redirect: "/" };
  if (!account?.domain?.trim()) return { ok: false, error: "Add your website first." };
  if (!isProfileConfirmed(profile)) return { ok: false, error: "Confirm your business first." };
  const goal = account.growth_goal ?? null;
  if (goal === null) return { ok: false, error: "Pick your goal first." };
  // Only CURRENT-basis core rows owned by this account count: a stale superseded-basis row, or a foreign id, can never activate.
  const basis = basisTag(canonicalId, account.domain.trim(), profile, goal);
  const rows = await d.store.readPrompts(canonicalId);
  const activeCore = rows.filter((r) => r.is_active && r.tags?.includes(PROMPT_TAGS.core) && r.tags?.includes(basis) && r.tenant_id === canonicalId && r.account_id === canonicalId);
  // THE SETUP WINDOW, THE SAME ONE APPROVAL ENFORCED. Activation used to allow 10 to 100 while approval allowed 20 to 50 bent down to a
  // thin candidate pool, so the two gates disagreed about the same set. Approval already held the bent floor, so activation asks only that
  // a real set survived it and that nothing pushed it past the setup ceiling.
  if (activeCore.length < LIMITS.minActive) return { ok: false, error: "Approve your prompts first." };
  if (activeCore.length > LIMITS.onboardingMax) return { ok: false, error: `That is ${activeCore.length} prompts. Keep it to ${LIMITS.onboardingMax} or fewer so each one gets real attention.` };

  const nowIso = d.now().toISOString();
  const outcome = await d.store.activateTenant(canonicalId, nowIso).catch(() => "blocked" as const);
  if (outcome === "blocked") return { ok: false, error: "I could not start your account just now. Try again in a moment." };
  // THE SIDE EFFECTS BELONG TO THE FIRST ACTIVATION AND NOWHERE ELSE. Stamping the terms an already running account never accepted must
  // never start a second research run over the top of the one already going.
  if (outcome === "activated" && !wasActive) {
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

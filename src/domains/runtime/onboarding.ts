import "server-only";

/**
 * onboarding (Slice 5, 2026-07-24) - the state read plus the website + profile
 * commands of the onboarding facade. Thin "use server" actions call these; the
 * candidate/approve/activate commands and the shared core (types, deps,
 * `resolve`, the durable store) live in onboarding-store.ts, imported here.
 *
 * Trust rails: every write is status-guarded; the LLM is optional and injected
 * (an off/refused/budget-blocked model falls back to a deterministic result read
 * from the site, honestly labeled, and onboarding still proceeds); the model can
 * never touch identity, the domain, provenance, status, or cost (not
 * representable in the schemas, and re-checked against a field whitelist here).
 */

import type { BusinessProfile, BusinessType, ProfileSection } from "@/domains/account";
import { normalizeSiteUrl } from "@/domains/account";
import type { CrawlPageFact } from "@/domains/evidence/scanning/crawl-frontier";
import { callStructuredLLM } from "@/domains/decision/llm/structured-drafter";
import {
  resolve, PROMPT_INTENTS, PROMPT_TAGS,
  type OnboardingDeps, type OnboardingState, type OnboardingGoal,
  type ProfileEdits, type ProfilePatch, type PromptSelection, type TrackedPromptRow,
} from "./onboarding-store";

// Re-export the candidate/approve/activate commands + the store type so the whole
// facade is one import surface (runtime/index re-exports from here). The shared
// types imported above are re-exported by name just below.
export { generatePromptCandidates, approvePrompts, activateAccount, type OnboardingStore } from "./onboarding-store";
export type {
  OnboardingState, OnboardingGoal, OnboardingDeps,
  ProfileEdits, ProfilePatch, PromptSelection, TrackedPromptRow,
};

type CommandResult = { ok: true } | { ok: false; error: string };

/** The editable business fields a natural-language patch (or a direct edit) may touch. */
const PATCHABLE_FIELDS = [
  "name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems",
  "geographicScope", "differentiators", "trustClaims", "topicsToOwn", "topicsToExclude",
] as const;
type PatchField = (typeof PATCHABLE_FIELDS)[number];

// ── loadOnboardingState ─────────────────────────────────────────────────────

export async function loadOnboardingState(tenantId: string, deps?: OnboardingDeps): Promise<OnboardingState> {
  const d = resolve(deps);
  const [account, profile, crawl] = await Promise.all([
    d.getAccount(tenantId), d.loadProfile(tenantId), d.loadCrawl(tenantId).catch(() => null),
  ]);
  const domain = account?.domain?.trim() ?? "";
  const confirmed = profile.name.origin === "operator_confirmed";
  const hasInference = profile.name.value.trim() !== "" || profile.businessType.value !== null;
  const goal = (account?.growth_goal ?? null) as OnboardingGoal | null;
  const rows = await d.store.readPrompts(tenantId).catch(() => [] as TrackedPromptRow[]);
  const prompts = projectPrompts(rows);
  const connections = await Promise.all(
    (["google_gsc", "google_ga4", "wix", "clarity"] as const).map(async (kind) => {
      const info = await d.connectorInfo(kind, tenantId).catch(() => null);
      return { kind, connected: info?.status === "connected", lastSyncedAt: info?.last_synced_at ?? null };
    }),
  );
  return {
    status: account?.status ?? "pending_onboarding",
    currentStep: firstIncompleteStep(domain, hasInference, confirmed, goal, prompts.approvedCount),
    website: { domain, crawl: { pagesRead: crawl?.pages_crawled ?? 0, status: (crawl?.status ?? "none") as OnboardingState["website"]["crawl"]["status"] } },
    profile: {
      name: profile.name.value, businessType: profile.businessType.value, siteArchetype: profile.siteArchetype.value,
      offerings: profile.offerings.value, audiences: profile.audiences.value, customerProblems: profile.customerProblems.value,
      geographicScope: profile.geographicScope.value, differentiators: profile.differentiators.value, trustClaims: profile.trustClaims.value,
      topicsToOwn: profile.topicsToOwn.value, topicsToExclude: profile.topicsToExclude.value,
      confirmed, hasInference, source: confirmed ? "you" : hasInference ? "site" : "none",
    },
    goal, prompts, connections,
  };
}

function firstIncompleteStep(domain: string, hasInference: boolean, confirmed: boolean, goal: OnboardingGoal | null, approvedCount: number): OnboardingState["currentStep"] {
  if (!domain) return 1;
  if (!hasInference) return 2;
  if (!confirmed) return 3;
  if (!goal) return 4;
  if (approvedCount < 1) return 5;
  return 6; // connections are skippable; step 7 is reached by explicit navigation
}

function projectPrompts(rows: TrackedPromptRow[]): OnboardingState["prompts"] {
  const candidates = rows.filter((r) => r.tags?.includes(PROMPT_TAGS.candidate));
  const byGroup = new Map<string, OnboardingState["prompts"]["groups"][number]>();
  let recommendedCount = 0;
  for (const r of candidates) {
    const slug = r.topic_id ?? "group";
    const intent = (PROMPT_INTENTS.includes(r.intent_type as (typeof PROMPT_INTENTS)[number]) ? r.intent_type : "category") as (typeof PROMPT_INTENTS)[number];
    const g = byGroup.get(slug) ?? { slug, name: titleize(slug), intent, total: 0, recommended: 0, approved: 0, prompts: [] };
    const recommended = r.tags.includes(PROMPT_TAGS.recommended);
    const approved = r.is_active && r.tags.includes(PROMPT_TAGS.core);
    if (recommended) recommendedCount += 1;
    g.total += 1;
    if (recommended) g.recommended += 1;
    if (approved) g.approved += 1;
    g.prompts.push({ id: r.id, text: r.text, recommended, approved });
    byGroup.set(slug, g);
  }
  return {
    candidateCount: candidates.length,
    recommendedCount,
    approvedCount: candidates.filter((r) => r.is_active && r.tags.includes(PROMPT_TAGS.core)).length,
    groups: [...byGroup.values()],
  };
}
function titleize(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── submitWebsite ───────────────────────────────────────────────────────────

export async function submitWebsite(tenantId: string, url: string, deps?: OnboardingDeps): Promise<CommandResult & { domain?: string }> {
  const d = resolve(deps);
  const normalized = normalizeSiteUrl(url ?? "");
  if (!normalized) return { ok: false, error: "That does not look like a website address. Enter it like acme.com." };

  const probe = await d.probe(normalized.homepageUrl, new Map(), { timeoutMs: 10_000 });
  if (!probe.ok) {
    return {
      ok: false,
      error: probe.reason === "robots_blocked"
        ? `${normalized.domain} asks readers to stay out of its pages, so I cannot read it. If this is your site, allow BeaconBot and try again.`
        : `I could not reach ${normalized.domain}. Check the spelling, or try it with www in front.`,
    };
  }
  const wrote = await d.store.updateTenantDomain(tenantId, normalized.domain, d.now().toISOString()).catch(() => "not_pending" as const);
  if (wrote !== "ok") return { ok: false, error: "Your account has already started. Head to your dashboard." };

  // Bounded crawl (discovery + one batch). Fail-soft; NO prompt writes, NO paid checks.
  try {
    const start = await d.startCrawl({ tenantId, domain: normalized.domain });
    if (start.status !== "unreachable") await d.runBatch({ tenantId, deps: { batchBudgetMs: 15_000 } });
  } catch { /* the crawl is best-effort; step 2 reads whatever landed */ }
  return { ok: true, domain: normalized.domain };
}

// ── inferProfile ────────────────────────────────────────────────────────────

type InferResult = { status: "inferred" | "empty"; source?: "site_model" | "site_read" };

export async function inferProfile(tenantId: string, deps?: OnboardingDeps): Promise<InferResult> {
  const d = resolve(deps);
  const crawl = await d.loadCrawl(tenantId).catch(() => null);
  const facts = crawl?.page_facts ?? [];
  if (facts.length === 0) return { status: "empty" };

  const current = await d.loadProfile(tenantId);
  const alreadyInferred = current.businessType.value !== null || current.offerings.value.length > 0 || current.topicsToOwn.value.length > 0;
  if (alreadyInferred) return { status: "inferred", source: current.name.confidence != null ? "site_model" : "site_read" };

  const suppliedUrls = new Set(facts.map((f) => f.url));
  const domain = crawl?.domain ?? "";
  const llm = await callStructuredLLM({
    kind: "business_profile_inference", tenantId, budgetPlatform: "onboarding-openai",
    system: INFER_SYSTEM, user: buildInferUser(domain, facts), grounded: factsGrounding(facts),
    complete: d.complete, now: d.now(),
  });

  if (llm.status === "drafted") {
    const v = llm.value;
    const validUrls = v.sourceUrls.filter((u) => suppliedUrls.has(u));
    const mk = <T,>(value: T): ProfileSection<T> => ({ value, origin: "inferred", confidence: v.confidence, sourceUrls: validUrls });
    await d.saveProfile(tenantId, {
      name: mk(v.name), businessType: mk<BusinessType | null>(v.businessType), siteArchetype: mk<string | null>(v.siteArchetype),
      offerings: mk(v.offerings), audiences: mk(v.audiences), customerProblems: mk(v.customerProblems),
      geographicScope: mk(v.geographicScope), differentiators: mk(v.differentiators), trustClaims: mk(v.trustClaims),
      topicsToOwn: mk(v.topicsToOwn), topicsToExclude: mk(v.topicsToExclude), importantPages: mk(v.importantPages),
    });
    return { status: "inferred", source: "site_model" };
  }
  await d.saveProfile(tenantId, deterministicProfileFromCrawl(domain, facts));
  return { status: "inferred", source: "site_read" };
}

function deterministicProfileFromCrawl(domain: string, facts: readonly CrawlPageFact[]): Partial<BusinessProfile> {
  const urls = facts.map((f) => f.url);
  const mk = <T,>(value: T): ProfileSection<T> => ({ value, origin: "inferred", confidence: null, sourceUrls: urls });
  const biggest = [...facts].sort((a, b) => b.word_count - a.word_count);
  const terms = new Set<string>();
  for (const f of biggest) {
    for (const q of f.questions) { const t = q.trim().toLowerCase(); if (t.length >= 4 && t.length <= 90) terms.add(t); }
    const title = (f.title ?? "").split(/[|\u2013\u2014:]/)[0]!.trim().toLowerCase();
    if (title.length >= 4 && title.length <= 80 && f.path !== "/") terms.add(title);
    if (terms.size >= 20) break;
  }
  return { name: mk(nameFromDomain(domain)), importantPages: mk(biggest.slice(0, 8).map((f) => f.url)), topicsToOwn: mk([...terms].slice(0, 20)) };
}
function nameFromDomain(domain: string): string {
  const base = (domain ?? "").toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  return base.split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── profile edits + confirm ─────────────────────────────────────────────────

export async function saveProfileEdits(tenantId: string, edits: ProfileEdits, deps?: OnboardingDeps): Promise<CommandResult> {
  const d = resolve(deps);
  const patch: Partial<BusinessProfile> = {};
  for (const key of PATCHABLE_FIELDS) {
    if (!(key in edits)) continue;
    (patch as Record<string, unknown>)[key] = confirmedSection((edits as Record<string, unknown>)[key]);
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  const saved = await d.saveProfile(tenantId, patch);
  return saved.persisted ? { ok: true } : { ok: false, error: "I could not save that just now. Try again in a moment." };
}

export async function confirmProfile(tenantId: string, deps?: OnboardingDeps): Promise<CommandResult> {
  const d = resolve(deps);
  const current = await d.loadProfile(tenantId);
  const patch: Partial<BusinessProfile> = {};
  for (const key of PATCHABLE_FIELDS) {
    const section = (current as unknown as Record<string, ProfileSection<unknown>>)[key];
    (patch as Record<string, unknown>)[key] = { ...section, origin: "operator_confirmed" };
  }
  const saved = await d.saveProfile(tenantId, patch);
  return saved.persisted ? { ok: true } : { ok: false, error: "I could not confirm that just now. Try again." };
}

function confirmedSection(value: unknown): ProfileSection<unknown> {
  return { value, origin: "operator_confirmed", confidence: 1, sourceUrls: [] };
}

// ── natural-language patch ──────────────────────────────────────────────────

type PatchProposal =
  | { ok: true; patch: ProfilePatch; diff: Array<{ field: string; before: string; after: string }>; summary: string }
  | { ok: false; error: string };

export async function proposeProfilePatch(tenantId: string, instruction: string, deps?: OnboardingDeps): Promise<PatchProposal> {
  const d = resolve(deps);
  if (!instruction?.trim()) return { ok: false, error: "Tell me what to change first." };
  const current = await d.loadProfile(tenantId);
  const llm = await callStructuredLLM({
    kind: "business_profile_patch", tenantId, budgetPlatform: "onboarding-openai",
    system: PATCH_SYSTEM, user: buildPatchUser(current, instruction), grounded: instruction, complete: d.complete, now: d.now(),
  });
  if (llm.status !== "drafted") return { ok: false, error: "I could not turn that into a safe change. Try describing it another way." };
  const patch = whitelistPatch(llm.value as Record<string, unknown>);
  const diff = diffPatch(current, patch);
  if (diff.length === 0) return { ok: false, error: "I did not find a change to make from that. Try being more specific." };
  return { ok: true, patch, diff, summary: String((llm.value as { changeSummary?: string }).changeSummary ?? "").slice(0, 400) };
}

export async function applyConfirmedPatch(tenantId: string, patch: ProfilePatch, deps?: OnboardingDeps): Promise<CommandResult> {
  const d = resolve(deps);
  const clean = whitelistPatch(patch as Record<string, unknown>);
  if (Object.keys(clean).length === 0) return { ok: false, error: "There is nothing to apply." };
  const dbPatch: Partial<BusinessProfile> = {};
  for (const [key, value] of Object.entries(clean)) {
    if (value === null) continue;
    (dbPatch as Record<string, unknown>)[key] = confirmedSection(value);
  }
  const saved = await d.saveProfile(tenantId, dbPatch);
  return saved.persisted ? { ok: true } : { ok: false, error: "I could not apply that just now. Try again." };
}

/** Keep ONLY whitelisted business fields; identity/URL/provenance/status are never representable. */
function whitelistPatch(raw: Record<string, unknown>): ProfilePatch {
  const out: ProfilePatch = {};
  const listFields = new Set<PatchField>(["offerings", "audiences", "customerProblems", "geographicScope", "differentiators", "trustClaims", "topicsToOwn", "topicsToExclude"]);
  for (const key of PATCHABLE_FIELDS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value === null || value === undefined) continue;
    if (listFields.has(key)) { if (Array.isArray(value)) out[key] = value.filter((x): x is string => typeof x === "string"); }
    else if (typeof value === "string") out[key] = value;
  }
  return out;
}
function diffPatch(current: BusinessProfile, patch: ProfilePatch): Array<{ field: string; before: string; after: string }> {
  const rows: Array<{ field: string; before: string; after: string }> = [];
  for (const [key, next] of Object.entries(patch)) {
    const section = (current as unknown as Record<string, ProfileSection<unknown>>)[key];
    const before = renderValue(section?.value);
    const after = renderValue(next as string | string[]);
    if (before !== after) rows.push({ field: key, before, after });
  }
  return rows;
}
function renderValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

// ── goal ────────────────────────────────────────────────────────────────────
// Without trustworthy trend evidence, the honest default recommendation is
// 'balanced'; the wizard shows that recommendation on Step 4.

export async function saveGoal(tenantId: string, goal: OnboardingGoal, deps?: OnboardingDeps): Promise<CommandResult> {
  const d = resolve(deps);
  if (goal !== "recover" && goal !== "grow" && goal !== "balanced") return { ok: false, error: "Pick one of the three goals." };
  const wrote = await d.store.updateTenantGoal(tenantId, goal, d.now().toISOString()).catch(() => "not_pending" as const);
  return wrote === "ok" ? { ok: true } : { ok: false, error: "Your account has already started, so the goal is locked." };
}

// ── prompt builders (concise; the schema + facade enforce the real contract) ─

const INFER_SYSTEM =
  "You read a website's crawled pages and return a structured business profile as JSON. " +
  "Use ONLY facts present in the supplied pages. Every sourceUrls entry MUST be one of the supplied page URLs. " +
  "Never invent a fact with no page to back it. Set confidence between 0 and 1. No dashes.";
const PATCH_SYSTEM =
  "You turn one plain-English instruction into a strict patch of a business profile as JSON. " +
  "Set ONLY the fields the instruction changes; leave every other field null. " +
  "You may only touch business facts (name, type, offerings, audiences, problems, geography, differentiators, trust claims, topics). " +
  "Never touch identity, the website, status, or cost. Write a one-sentence changeSummary. No dashes.";

function factsGrounding(facts: readonly CrawlPageFact[]): string {
  return facts.map((f) => `${f.path} ${f.title ?? ""} ${f.h1 ?? ""}`).join(" ").slice(0, 4000);
}
function buildInferUser(domain: string, facts: readonly CrawlPageFact[]): string {
  const pages = facts.slice(0, 30).map((f) => `URL: ${f.url}\nTitle: ${f.title ?? ""}\nH1: ${f.h1 ?? ""}\nWords: ${f.word_count}\nQuestions: ${f.questions.slice(0, 4).join("; ")}`).join("\n---\n");
  return `Domain: ${domain}\nSupplied pages (use only these URLs for sourceUrls):\n${pages}`;
}
function buildPatchUser(profile: BusinessProfile, instruction: string): string {
  const cur = PATCHABLE_FIELDS.map((k) => `${k}: ${renderValue((profile as unknown as Record<string, ProfileSection<unknown>>)[k]?.value)}`).join("\n");
  return `Current profile:\n${cur}\n\nInstruction: ${instruction}`;
}

/** PRODUCT - the onboarding + 50-core-prompt approval contract (Slice 5). One behavioral contract over the Runtime onboarding facade, driven by injected seams (fake durable store + profile repo, an injected CompleteFn for all LLM kinds, injected crawl/probe) with NO network. The one real seam is the durable budget ledger, mocked as a tiny accumulating row so the $2 reserve-then-reconcile cap is exercised. Each scenario states the customer stake it protects. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { emptyBusinessProfile, type Account, type BusinessProfile } from "@/domains/account";
import type { OnboardingDeps, OnboardingStore, TrackedPromptRow } from "@/domains/runtime";
import {
  loadOnboardingState, submitWebsite, inferProfile, saveProfileEdits, proposeProfilePatch,
  applyConfirmedPatch, saveGoal, generatePromptCandidates, approvePrompts, activateAccount,
  applyTrackedSelection, projectTrackedQuestions, confirmProfile, setupGap,
} from "@/domains/runtime";
import { SHOWN_FIELDS, isProfileConfirmed } from "@/domains/runtime/onboarding-store";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import { historyNote } from "@/app/(shell)/settings/config/tracked-prompts-section";
import { reserveOnboardingSpend, reconcileOnboardingSpend } from "@/domains/decision/llm/adjudicator-budget";
import { getTenantLifetimeSpendUsd } from "@/lib/cost/budget-ledger-supabase";
// Durable ledger: one accumulating aggregate row. Reads sum it; a write applies the row recordSpendSupabase computed (clamped at zero). ledgerThrows = unreadable; ledgerWriteFails = rejected write.
let ledger = { usd: 0, has: false };
let ledgerThrows = false;
let ledgerWriteFails = false;
function guard() { if (ledgerThrows) throw new Error("ledger unreadable"); }
function chain(): any {
  let insertRow: any = null, updateRow: any = null;
  const p: any = {
    select: () => p, eq: () => p, is: () => p, gte: () => p, order: () => p, limit: () => p,
    insert: (r: any) => { insertRow = r; return p; },
    update: (r: any) => { updateRow = r; return p; },
    maybeSingle: () => { guard(); return Promise.resolve({ data: ledger.has ? { spent_usd: ledger.usd, call_count: 0, prompt_count: 0, chunk_count: 0 } : null, error: null }); },
    then: (res: any, rej: any) => Promise.resolve().then(() => {
      guard();
      const w = insertRow ?? updateRow;
      if (w) { if (ledgerWriteFails) return { error: { message: "write failed" } }; ledger = { usd: Math.max(0, Number(w.spent_usd) || 0), has: true }; return { error: null }; }
      return { data: ledger.has ? [{ spent_usd: ledger.usd }] : [], error: null };
    }).then(res, rej),};
  return p;}
vi.mock("@/lib/persistence/supabase", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // THE SPEND WRITE IS ONE ATOMIC INCREMENT: the ledger is handed a DELTA and adds it, never a total this process computed and could lose a concurrent charge from.
  getSupabaseAdmin: () => ({ from: () => chain(), rpc: async (_fn: string, a: any) => { guard(); if (ledgerWriteFails) return { data: null, error: { message: "write failed" } }; ledger = { usd: Math.max(0, ledger.usd + (Number(a.p_delta) || 0)), has: true }; return { data: true, error: null }; } }),
  isSupabaseConfigured: () => true,}));
// ── in-memory world ─────────────────────────────────────────────────────────
const NOW = new Date("2026-07-24T00:00:00Z");
type TenantRow = { status: Account["status"]; domain: string; growth_goal: string | null; tos: string | null };
function makeWorld() {
  const tenants = new Map<string, TenantRow>();
  const profiles = new Map<string, BusinessProfile>();
  let prompts: TrackedPromptRow[] = [];
  const crawls = new Map<string, any>();
  const scheduled: string[] = [];
  // The fake store models replace_onboarding_website: a real domain change is one atomic invalidation (clears goal, deactivates prompts, resets profile).
  const store: OnboardingStore = {
    async replaceWebsite(id, domain) {
      const t = tenants.get(id); if (!t || t.status !== "pending_onboarding") return "not_pending";
      if (t.domain === domain) return "unchanged";
      t.domain = domain; t.growth_goal = null;
      for (const r of prompts) if (r.tenant_id === id && r.is_active) r.is_active = false;
      profiles.set(id, emptyBusinessProfile(id));
      return "replaced";},
    async updateTenantGoal(id, goal, _at, statuses) { const t = tenants.get(id); if (!t || !(statuses ?? ["pending_onboarding"]).includes(t.status)) return "not_pending"; t.growth_goal = goal; return "ok"; },
    // Mirrors the one statement: it writes only where the terms are unstamped, so an account already running with its terms on file is untouched and one flipped active without them can still accept them.
    async activateTenant(id, now) { const t = tenants.get(id); if (!t) return "blocked";
      if (t.tos) return t.status === "active" ? "already_active" : "blocked";
      if (t.status !== "pending_onboarding" && t.status !== "active") return "blocked";
      t.status = "active"; t.tos = now; return "activated"; },
    async readPrompts(id) { return prompts.filter((r) => r.tenant_id === id).map((r) => ({ ...r, tags: [...r.tags] })); },
    async upsertPrompts(rows) { for (const row of rows) { const i = prompts.findIndex((r) => r.id === row.id); if (i >= 0) prompts[i] = { ...row }; else prompts.push({ ...row }); } },};
  const deps: OnboardingDeps = {
    store,
    getAccount: async (id) => { const t = tenants.get(id); return t ? { id, slug: id.replace(/^tenant-/, ""), provisional_name: "", domain: t.domain, status: t.status, signup_date: "", tos_accepted_at: t.tos, daily_budget_usd: 0, growth_goal: t.growth_goal as Account["growth_goal"], created_at: "", updated_at: "" } : null; },
    loadProfile: async (id) => profiles.get(id) ?? emptyBusinessProfile(id),
    saveProfile: async (id, patch) => { const cur = profiles.get(id) ?? emptyBusinessProfile(id); const updated = { ...cur, ...patch, accountId: id, schemaVersion: 2, updatedAt: "" } as BusinessProfile; profiles.set(id, updated); return { profile: updated, persisted: true }; },
    loadCrawl: async (id) => crawls.get(id) ?? null,
    startCrawl: (async () => ({ status: "in_progress", discovered: 3 })) as any,
    runBatch: (async () => ({ ran: true, status: "in_progress", crawled: 3, failed: 0, totalCrawled: 3, remaining: 0, complete: false })) as any,
    probe: (async () => ({ ok: true, html: "<html></html>", status: 200 })) as any,
    connectorInfo: async () => ({ status: "disconnected", connected_at: null, expires_at: null, last_synced_at: null }) as any,
    coldStartScan: (async () => ({ status: "no_pages", pagesDiscovered: 0, pagesCrawled: 0, snapshotsWritten: 0, durationMs: 0, source: "none" })) as any,
    scheduleResearch: (id: string) => { scheduled.push(id); },
    now: () => NOW,};
  return { tenants, profiles, get prompts() { return prompts; }, crawls, scheduled, deps };}
const CONFIRMABLE = ["name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems", "geographicScope", "differentiators", "trustClaims", "topicsToOwn", "topicsToExclude"] as const;
// A fully operator-confirmed profile (every confirmable section), with optional sparser facts for the thin case.
function confirmedProfile(id: string, facts: Record<string, any> = {}): BusinessProfile {
  const p = emptyBusinessProfile(id);
  const merged: Record<string, any> = { name: "Acme Rugs", businessType: "local_service", siteArchetype: "service",
    offerings: ["rug cleaning", "rug repair"], audiences: ["homeowners"], customerProblems: ["dirty rugs"], geographicScope: ["denver"],
    differentiators: ["same day service"], trustClaims: ["insured"], topicsToOwn: ["rug care"], topicsToExclude: [], ...facts };
  for (const k of CONFIRMABLE) (p as any)[k] = { value: merged[k], origin: "operator_confirmed", confidence: 1, sourceUrls: [] };
  return p;}
function seedPending(w: ReturnType<typeof makeWorld>, id: string, over: Partial<TenantRow> = {}) {
  w.tenants.set(id, { status: "pending_onboarding", domain: "", growth_goal: null, tos: null, ...over });}
function seedConfirmedProfile(w: ReturnType<typeof makeWorld>, id: string) { w.profiles.set(id, confirmedProfile(id)); }
/** N extra live core questions under a basis nobody holds any more: exactly what a Settings edit or an old goal leaves behind. */
const seedCore = (w: ReturnType<typeof makeWorld>, id: string, n: number) => { for (let i = 0; i < n; i += 1) w.prompts.push({ id: `seeded-${w.prompts.length}`, tenant_id: id,
  account_id: id, text: `seeded question ${i}`, topic_id: "t", location_scope: null, service_scope: null, intent_type: "category", platforms: [], is_active: true,
  tags: ["candidate_v1", "set_v1", "core_v1", "basis_longgone"], version: 1, core: true, created_at: "", updated_at: "" } as TrackedPromptRow); };
function seedCrawl(w: ReturnType<typeof makeWorld>, id: string) {
  w.crawls.set(id, { tenant_id: id, domain: "acme.test", status: "in_progress", frontier: [], visited: [], pages_crawled: 3, pages_failed: 0,
    page_cap: 150, source: "homepage", started_at: "", updated_at: "", last_batch_at: null, batches_run: 1,
    page_facts: [{ url: "https://acme.test/", path: "/", title: "Acme Rugs", h1: "Acme", has_meta_description: true, word_count: 200, faq_count: 0, questions: ["how to clean a rug"] }] });
}
// Injected model outputs (firewall-safe: no superlatives, no digits, no dashes).
const inferValue = (sourceUrls: string[]) => ({ value: {
  name: "Acme Rugs", businessType: "local_service", siteArchetype: null, offerings: ["rug cleaning"], audiences: ["homeowners"],
  customerProblems: ["dirty rugs"], geographicScope: ["denver"], differentiators: ["same day service"], trustClaims: ["insured"],
  topicsToOwn: ["rug care"], topicsToExclude: [], importantPages: ["https://acme.test/"], confidence: 0.7, sourceUrls } });
const completeInfer = (sourceUrls: string[]): CompleteFn => async () => inferValue(sourceUrls);
const completeRefuse: CompleteFn = async () => ({ error: "refusal", retryable: false });
const INTENTS = ["category", "problem", "comparison", "commercial", "factual", "trust", "brand"] as const;
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
const completeCandidates: CompleteFn = async () => ({ value: { groups: INTENTS.map((intent) => ({
  slug: `g-${intent}`, name: `${intent} topics`, intent, prompts: WORDS.map((word, i) => ({ text: `${intent} ${word} question`, recommended: i < 4 })) })) } });
beforeEach(() => { ledger = { usd: 0, has: false }; ledgerThrows = false; ledgerWriteFails = false; });
const A = "tenant-aaaa1111";
const B = "tenant-bbbb2222";
const activeCore = (w: ReturnType<typeof makeWorld>, id: string) => w.prompts.filter((p) => p.tenant_id === id && p.is_active && p.tags.includes("core_v1"));
describe("onboarding contract (Slice 5)", () => {
  it("1. submitWebsite normalizes + persists the domain, writes no prompts or paid checks, and never leaks across accounts", async () => {
    const w = makeWorld();
    seedPending(w, A); seedPending(w, B);
    expect((await submitWebsite(A, "https://www.acme.com/pricing", w.deps)).ok).toBe(true);
    expect(w.tenants.get(A)!.domain).toBe("acme.com"); // normalized, www + path stripped
    expect(w.prompts.length).toBe(0); // no tracked_prompts written during website submit
    await saveGoal(A, "grow", w.deps); const sB = await loadOnboardingState(B, w.deps);
    expect(w.tenants.get(B)!.domain).toBe(""); expect(sB.website.domain).toBe(""); expect(sB.goal).toBeNull(); // no bleed
  });
  it("2. inferProfile keeps model provenance + rejects any sourceUrl outside the crawl, and a refused model falls back to a deterministic profile that still advances", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.test" }); seedCrawl(w, A);
    const r = await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/", "https://evil.test/steal"]) }); const p = w.profiles.get(A)!;
    expect([r.status, p.name.origin, p.offerings.value.includes("rug cleaning"), p.name.sourceUrls]).toEqual(["inferred", "inferred", true, ["https://acme.test/"]]); // the outside URL is stripped
    // ONE SLOW CALL IS NOT A DOWNGRADE, TWO IS. The deterministic profile makes this whole step read as already inferred forever, so a single call abandoned at my own deadline used to cost this account its model read permanently with no way back. That call bought no answer and left no receipt, so it is asked once more, and only a second deadline settles for the profile I can read off the crawl myself.
    const ladder = async (slow: number, failure: "client_timeout" | "provider_refused" = "client_timeout") => { let asks = 0; const w2 = makeWorld();
      seedPending(w2, A, { domain: "acme.test" }); seedCrawl(w2, A); const slowAsk = { error: "the reader would not serve this call", retryable: false, failure };
      const got = await inferProfile(A, { ...w2.deps, complete: async (a) => ((asks += 1) <= slow ? slowAsk : completeInfer(["https://acme.test/"])(a)) }); return [got.source, asks]; };
    expect([await ladder(1), await ladder(2), await ladder(1, "provider_refused")]).toEqual([["site_model", 2], ["site_read", 2], ["site_read", 1]]); // only a receiptless deadline earns the re-ask; a refusal carried a receipt and settles first time
  });
  it("3. the goal vocabulary is closed and a single field edit never confirms the whole profile", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com" });
    expect((await saveGoal(A, "balanced", w.deps)).ok && w.tenants.get(A)!.growth_goal).toBe("balanced");
    expect((await saveGoal(A, "aggressive" as any, w.deps)).ok).toBe(false); // vocabulary is closed
    const p = emptyBusinessProfile(A); p.name = { value: "Acme", origin: "inferred", confidence: 0.5, sourceUrls: [] }; w.profiles.set(A, p);
    await saveProfileEdits(A, { name: "Acme Rugs" }, w.deps); // confirms ONLY the name
    const s = await loadOnboardingState(A, w.deps);
    expect(s.profile.confirmed).toBe(false); expect(s.currentStep).toBe(3); // one confirmed field != all sections; still on confirm
  });
  it("4. a natural-language patch persists nothing on preview, is stripped to the business whitelist on apply, and confirms only the patched field", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com" }); seedConfirmedProfile(w, A); w.profiles.get(A)!.offerings.origin = "inferred";
    const patchModel: CompleteFn = async () => ({ value: { changeSummary: "Add law firms.", name: null, businessType: null, siteArchetype: null, offerings: null, audiences: ["law firms"], customerProblems: null, geographicScope: null, differentiators: null, trustClaims: null, topicsToOwn: null, topicsToExclude: null, constraints: null, trustedSourceDomains: null, competitors: null } });
    expect((await proposeProfilePatch(A, "we also serve law firms", { ...w.deps, complete: patchModel })).ok).toBe(true);
    expect(w.profiles.get(A)!.audiences.value).toEqual(["homeowners"]); // preview persisted NOTHING
    await applyConfirmedPatch(A, { audiences: ["law firms"], accountId: "tenant-evil", domain: "evil.com" } as any, w.deps);
    const after = w.profiles.get(A)! as any; // whitelist holds; a confirmed patch confirms ONLY what it patched
    expect(after.audiences.value).toEqual(["law firms"]); expect(after.accountId).toBe(A); expect(after.domain).toBeUndefined(); expect(after.offerings.origin).toBe("inferred");});
  it("5. candidate generation yields ~100 unique prompts in 5-10 groups covering all seven intents with exactly 50 recommended, inactive, canonical-id, current-basis, four-engine, and a retry never duplicates", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    const r = await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); expect(r.ok && r.candidateCount).toBeGreaterThanOrEqual(60); expect(r.ok && r.recommendedCount).toBe(50);
    const rows = w.prompts.filter((p) => p.tenant_id === A);
    expect(new Set(rows.map((p) => p.intent_type)).size).toBe(7); // all seven intent families
    expect(rows.every((p) => !p.is_active && p.tenant_id === A && p.account_id === A)).toBe(true); // inactive, canonical id (never the slug)
    expect(rows.every((p) => /^prompt-[0-9a-f]{16}$/.test(p.id) && p.tags.some((t) => t.startsWith("basis_")))).toBe(true); // stable id + current basis tag
    expect(rows.every((p) => JSON.stringify([...p.platforms].sort()) === JSON.stringify(["chatgpt", "claude", "gemini", "perplexity"]))).toBe(true); // all four engines
    const before = rows.length; await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // retry reuses the basis, spends nothing
    expect(w.prompts.filter((p) => p.tenant_id === A).length).toBe(before); // no duplicate rows
  });
  it("6. approval is declarative over the current-basis candidates: default 50, include/edit/add/remove work, foreign ids are rejected, the 20..50 setup window holds server side, and it never accumulates", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); expect((await approvePrompts(A, { useRecommendedDefault: true }, w.deps)).ok && activeCore(w, A).length).toBe(50);
    expect((await approvePrompts(A, { approvedIds: ["prompt-deadbeefdeadbeef"] }, w.deps)).ok).toBe(false); // foreign id rejected, never kept
    const src = w.prompts.find((p) => p.tenant_id === A)!;
    expect((await approvePrompts(A, { approvedIds: [src.id] }, w.deps)).ok).toBe(false); // 1 row is below the floor of 10
    const twelve = w.prompts.filter((p) => p.tenant_id === A && p.tags.includes("recommended")).slice(0, 12).map((p) => p.id);
    expect((await approvePrompts(A, { approvedIds: twelve }, w.deps)).ok).toBe(false); // 12 is under the setup window's floor of 20 when the pool holds 50
    const keep = w.prompts.filter((p) => p.tenant_id === A && p.tags.includes("recommended")).slice(0, 22).map((p) => p.id);
    const ok = await approvePrompts(A, { approvedIds: keep, edits: [{ fromId: keep[0]!, text: "rug cleaning quote request" }], additions: [{ groupSlug: src.topic_id!, text: "brand new rug question" }], removedIds: [keep[1]!] }, w.deps);
    expect(ok.ok).toBe(true);
    expect(w.prompts.some((p) => p.tenant_id === A && p.text === "rug cleaning quote request" && p.tags.includes("edited"))).toBe(true); // edit versions a new row
    expect(w.prompts.some((p) => p.tenant_id === A && p.text === "brand new rug question" && p.tags.includes("added"))).toBe(true); // addition inherits its group
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps); // re-approve the default set
    expect(activeCore(w, A).length).toBe(50); // never accumulates past the bound
  });
  it("6b. a thin candidate pool bends the setup floor server side: sixteen questions approve sixteen, eleven do not", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); const cands = w.prompts.filter((p) => p.tenant_id === A && p.tags.includes("candidate_v1"));
    for (const p of cands.slice(16)) w.prompts.splice(w.prompts.indexOf(p), 1);
    const ids = cands.slice(0, 16).map((p) => p.id);
    expect((await approvePrompts(A, { approvedIds: ids.slice(0, 11) }, w.deps)).ok).toBe(false); // under the bent floor of sixteen
    expect((await approvePrompts(A, { approvedIds: ids }, w.deps)).ok && activeCore(w, A).length).toBe(16);});
  it("7. activation is blocked until website + confirmed profile + goal + approved prompts + TOS, never schedules on a block, is double-click safe, and schedules exactly one research run", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com" }); // missing profile + goal + prompts
    expect((await activateAccount(A, true, w.deps)).ok).toBe(false);
    expect(w.scheduled).toEqual([]); // a blocked activation does no work
    seedConfirmedProfile(w, A); w.tenants.get(A)!.growth_goal = "balanced";
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect((await activateAccount(A, false, w.deps)).ok).toBe(false); // TOS still required
    expect((await activateAccount(A, true, w.deps)).ok).toBe(true); expect(w.tenants.get(A)!.status).toBe("active");
    expect(w.scheduled).toEqual([A]);
    expect((await activateAccount(A, true, w.deps)).ok).toBe(true); // double click
    expect(w.scheduled).toEqual([A]); // idempotent: no second schedule
  });
  it("8. changing to a NEW website clears the goal, deactivates the old prompts, resets the profile, force-restarts the crawl, and drops readiness back to step 2", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "grow" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect(activeCore(w, A).length).toBe(50); let forced = false;
    const deps = { ...w.deps, startCrawl: (async (a: any) => { forced = a.force === true; return { status: "in_progress", discovered: 3 }; }) as any }; expect((await submitWebsite(A, "newsite.com", deps)).ok).toBe(true);
    expect(forced).toBe(true); // crawl force-restarted for the new site
    const t = w.tenants.get(A)!;
    expect(t.domain).toBe("newsite.com"); expect(t.growth_goal).toBeNull(); // domain replaced, goal cleared
    expect(w.prompts.filter((p) => p.tenant_id === A && p.is_active).length).toBe(0); // old rows are inactive history
    const s = await loadOnboardingState(A, deps);
    expect(s.profile.confirmed).toBe(false); expect(s.currentStep).toBe(2); // profile reset, readiness resumes at inference
  });
  it("9. a research-affecting change strands the approved set on the old basis: it vanishes from the projection, a stale-basis core row never activates, and only a regenerated new-basis set activates", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "grow" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    const basisXids = activeCore(w, A).map((p) => p.id); expect(basisXids.length).toBe(50);
    await saveGoal(A, "balanced", w.deps); // the goal is a basis input
    expect((await loadOnboardingState(A, w.deps)).prompts.candidateCount).toBe(0); // old basis vanishes from the projection
    expect((await activateAccount(A, true, w.deps)).ok).toBe(false); // a stale-basis core row never activates
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // mints basis Y, deactivates X in one write
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps); const now = activeCore(w, A);
    expect(now.length).toBe(50); expect(now.every((p) => !basisXids.includes(p.id))).toBe(true); // only the new basis is active
    await saveGoal(A, "grow", w.deps); await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // toggle BACK to basis X: reuse skips the mint sweep
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect(w.prompts.filter((p) => p.tenant_id === A && p.is_active).length).toBe(50); // approval sweeps ALL other-basis actives: never 100
  });
  it("10. the deterministic fallback yields honest per-family prompts with NO numbered filler, and a thin profile yields fewer without junk", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    expect((await generatePromptCandidates(A, { ...w.deps, complete: completeRefuse })).ok).toBe(true); const rows = w.prompts.filter((p) => p.tenant_id === A);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((p) => p.intent_type)).size).toBeGreaterThanOrEqual(5); // several real families from real facts
    expect(rows.some((p) => /\s\d+$/.test(p.text))).toBe(false); // never padded with a trailing number
    const w2 = makeWorld();
    seedPending(w2, B, { domain: "thin.com", growth_goal: "balanced" });
    w2.profiles.set(B, confirmedProfile(B, { name: "Thin", offerings: ["one thing"], audiences: [], customerProblems: [], geographicScope: [], differentiators: [], trustClaims: [], topicsToOwn: [] }));
    expect((await generatePromptCandidates(B, { ...w2.deps, complete: completeRefuse })).ok).toBe(true); const thinRows = w2.prompts.filter((p) => p.tenant_id === B);
    expect(thinRows.length).toBeLessThan(rows.length); expect(thinRows.some((p) => /\s\d+$/.test(p.text))).toBe(false); // fewer, still no filler
  });
  it("11. the $2 pre-activation cap: at/over the cap and an unreadable ledger both refuse the model and continue deterministically, and reserve-then-reconcile is conservative under failure + concurrency", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.test" }); seedCrawl(w, A);
    ledger = { usd: 2.5, has: true }; // already over the $2 cap
    expect((await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/"]) })).source).toBe("site_read"); // no model call
    w.profiles.delete(A); ledger = { usd: 0, has: false }; ledgerThrows = true; // ledger unreadable => fail closed
    expect((await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/"]) })).source).toBe("site_read");
    ledgerThrows = false;
    // A reservation the ledger will not persist REFUSES (no call).
    ledger = { usd: 0, has: false }; ledgerWriteFails = true;
    expect((await reserveOnboardingSpend(0.02, { tenantId: A })).allowed).toBe(false);
    // A reserved call whose reconcile write fails KEEPS the conservative reservation (overcount, never undercount).
    ledgerWriteFails = false; ledger = { usd: 0, has: false };
    expect((await reserveOnboardingSpend(0.02, { tenantId: A })).allowed).toBe(true);
    ledgerWriteFails = true;
    await reconcileOnboardingSpend(0.02, 0.005, { tenantId: A }); // the refund write fails
    ledgerWriteFails = false;
    expect(await getTenantLifetimeSpendUsd(A, "onboarding-openai")).toBeCloseTo(0.02, 6); // not reduced to the real 0.005
    // Reserve writes BEFORE it reads, so the later reader sees both reservations: only one clears the $2 boundary.
    ledger = { usd: 1.98, has: true };
    const r1 = await reserveOnboardingSpend(0.02, { tenantId: A }); const r2 = await reserveOnboardingSpend(0.02, { tenantId: A });
    expect([r1.allowed, r2.allowed].filter(Boolean).length).toBe(1);});
  it("12. an already-active account is never mutated by onboarding commands", async () => {
    const w = makeWorld();
    seedPending(w, A, { status: "active", domain: "live.com", growth_goal: "grow" });
    seedConfirmedProfile(w, A);
    expect((await submitWebsite(A, "changed.com", w.deps)).ok).toBe(false); expect((await saveGoal(A, "recover", w.deps)).ok).toBe(false);
    const t = w.tenants.get(A)!; expect(t.domain).toBe("live.com"); expect(t.growth_goal).toBe("grow");});
  it("13. a live account is never stranded: approval cannot sweep it, kept wording keeps its id, a rewording versions itself, legacy rows are untouched, bounds hold, and both projections agree", async () => {
    const w = makeWorld(); seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A); await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps); w.tenants.get(A)!.status = "active"; const live = activeCore(w, A); const keep = live.slice(0, 12).map((p) => p.id);
    // THE RAIL: a running account's questions can never be swept by any caller of approval.
    expect([(await approvePrompts(A, { approvedIds: keep }, w.deps)).ok, activeCore(w, A).length]).toEqual([false, 50]);
    const rows = [...w.prompts.filter((p) => p.tenant_id === A), { ...live[0]!, id: "prompt-seedprofound01", tags: ["seed_profound"], text: "legacy seed row" }];
    const ctx = { tenantId: A, basis: "basis_next", nowIso: "2026-07-26T00:00:00.000Z" };
    const r = applyTrackedSelection(rows, { keepIds: keep, edits: [{ id: keep[0]!, newText: "  Reworded   QUESTION " }], additions: ["one more question", "ONE  more question", "   "] }, ctx);
    const writes = r.ok ? r.writes : []; // 11 kept + 1 reworded + 1 added; dedupe is normalized, the blank line is dropped
    expect(r.ok && [r.activeCount, r.added, r.skippedDuplicates, r.skippedBlank]).toEqual([13, 1, 1, 1]);
    // The replaced wording retires as history, and its successor names the row it replaced.
    expect([writes.some((x) => x.id === keep[0] && !x.is_active), writes.some((x) => x.is_active && x.tags.includes("core_v1") && x.tags.includes(`superseded:${keep[0]}`))]).toEqual([true, true]);
    expect(writes.some((x) => x.id === keep[1] || x.id === "prompt-seedprofound01")).toBe(false); // kept ids are untouched (continuity); a non-core seed row is NEVER written
    const n = (k: number) => applyTrackedSelection(rows, { keepIds: [], edits: [], additions: Array.from({ length: k }, (_, i) => `question number ${i}`) }, ctx).ok; expect([n(9), n(10), n(100), n(101)]).toEqual([false, true, true, false]);
    const funnelWay = rows.filter((p) => p.is_active && p.tags.includes("core_v1")).sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at))).map((p) => p.id).slice(0, 100);
    expect(projectTrackedQuestions(rows).active.map((q) => q.id)).toEqual(funnelWay); // what the operator reads is exactly what I check
  });});
/** PHASE 8 SURFACES. The three promises the setup and settings screens make to a customer: approving the recommendation is ONE action over topics rather than a hundred and fifty rows, an account that stopped halfway comes back to the step it actually reached, and Connections offers the customer's own tools and nothing Beacon runs on  its own account. */
/** Fourteen topics of five questions: a broad candidate universe (70) an operator must never be asked to read row by row. The first seven topics are the ones approved as a group below. */
const TOPICS = [
  ...INTENTS.map((intent) => ({ slug: `${intent}first`, half: "first", intent, size: 5 })),
  ...INTENTS.slice(0, 5).map((intent) => ({ slug: `${intent}second`, half: "second", intent, size: 7 })),
];
const FIVE_PER_TOPIC: CompleteFn = async () => ({ value: { groups: TOPICS.map((t, gi) => ({
  slug: t.slug, name: `${t.intent} ${t.half} topics`, intent: t.intent,
  prompts: WORDS.slice(0, t.size).map((word) => ({ text: `${t.intent} ${t.half} ${word} question`, recommended: gi < 7 })) })) } });
const FIRST_SEVEN_TOPICS = TOPICS.slice(0, 7).map((t) => t.slug);
describe("setup and settings surfaces (Phase 8)", () => {
  it("approves 35 grouped questions in ONE action, without the operator reading a single row", async () => {
    const w = makeWorld(); seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A); const built = await generatePromptCandidates(A, { ...w.deps, complete: FIVE_PER_TOPIC });
    expect(built.ok && built.candidateCount).toBe(70);
    // ONE call, seven topic slugs, no individual ids: the group IS the unit of approval.
    const r = await approvePrompts(A, { approvedGroups: FIRST_SEVEN_TOPICS }, w.deps); expect(r.ok && r.approvedCount).toBe(35);
    expect(activeCore(w, A)).toHaveLength(35); // exactly 35, which is itself inside the 20 to 50 core set an account starts on
  });
  it("brings an account that stopped halfway back to the step it actually reached, not to the start", async () => {
    const w = makeWorld(); seedPending(w, A, { domain: "acme.com" }); seedConfirmedProfile(w, A);
    // Website, understanding and confirmation are done; the goal is not.
    expect((await loadOnboardingState(A, w.deps)).currentStep).toBe(4);
    await saveGoal(A, "grow", w.deps); expect((await loadOnboardingState(A, w.deps)).currentStep).toBe(5); // questions are what is left
    await generatePromptCandidates(A, { ...w.deps, complete: FIVE_PER_TOPIC }); await approvePrompts(A, { approvedGroups: FIRST_SEVEN_TOPICS }, w.deps);
    const resumed = await loadOnboardingState(A, w.deps); expect(resumed.currentStep).toBe(6); // connections are skippable, so a finished question set lands on the last optional step
    expect(resumed.connections.map((c) => c.kind)).toEqual(["google_gsc", "google_ga4", "clarity"]); // no Wix, and none is required to get here
    // Step 7 hands back a REAL technical gap out of the crawl catalogue, named with that page's own count.
    seedCrawl(w, A); Object.assign(w.crawls.get(A)!.page_facts[0], { path: "/rugs", has_meta_description: false });
    const win = (await loadOnboardingState(A, w.deps)).findings.firstWin!; expect(win.action).toBe("Add a search description"); expect(win.plainWhy).toContain("(200 words)");});
  /** PHASE 6E.1 + 6E.2 + P1-1. Being ACTIVE is a status, not proof of setup, and the whole activation contract gates now. The opposite error is worse: a profile read that failed comes back EMPTY, indistinguishable from never filled in, so treating that as a gap would bounce a fully onboarded customer into onboarding over a five  second outage. */
  it("asks a RUNNING account only for what it cannot run without, and a PENDING one for the whole activation contract", async () => {
    const w = makeWorld(); const acct = (over: Record<string, unknown> = {}) => ({ status: "active", domain: "acme.com", growth_goal: "grow", tos_accepted_at: "2026-07-24T00:00:00.000Z", ...over });
    const live = async (over: Record<string, unknown> = {}) => setupGap(A, acct(over) as any, w.deps);
    seedPending(w, A, { domain: "acme.com", growth_goal: "grow" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: FIVE_PER_TOPIC }); await approvePrompts(A, { approvedGroups: FIRST_SEVEN_TOPICS }, w.deps);
    w.tenants.get(A)!.status = "active"; w.tenants.get(A)!.tos = "2026-07-24T00:00:00.000Z"; // setup finished, the account is live
    expect(await live()).toBeNull(); // set up: the product renders, nothing resumes
    // A RUNNING ACCOUNT'S GAP IS OPERATIONAL, NEVER A RE-DERIVATION OF THE ACTIVATION INPUTS. The live account predates goals and runs with growth_goal NULL: the product works, so that is a nudge, never a lockout, and forcing the write would re-mint the basis and orphan every prompt behind it. Its questions are counted the way the research funnel counts them, basis-agnostically, because a basis that moved is not something an operator can see or fix. Website, a confirmed profile and terms are the real floor.
    expect([await live({ growth_goal: null }), await live({ domain: "" }), await live({ tos_accepted_at: null })]).toEqual([null, { step: 1 }, { step: 7 }]);
    for (const r of w.prompts) if (r.is_active) r.tags = [...r.tags.filter((t) => !t.startsWith("basis_")), "basis_longgone"];
    // A basis nobody re-approved is still 35 questions I am really asking; a PENDING account still owes every activation input, goal included.
    expect([await live({ growth_goal: null }), await setupGap(A, acct({ status: "pending_onboarding", growth_goal: null }) as any, w.deps)]).toEqual([null, { step: 4 }]);
    // ONE LADDER: what the gate calls finished, the wizard may never re-ask. THIS is where the two used to disagree, because the wizard counted only current-basis rows: no gap at all, and a setup screen sitting on step 5 with zero approved questions.
    expect((await loadOnboardingState(A, w.deps)).currentStep).toBe(6);
    seedCore(w, A, 25); expect(await live()).toBeNull(); // 60 live questions: legal in Settings' 10..100 window, so never a lockout
    seedCore(w, A, 45); expect(await live()).toEqual({ step: 5 }); // 105 is past the cap the funnel enforces, and that IS operational
    for (const r of w.prompts.filter((p) => p.is_active).slice(5)) r.is_active = false; // five is under the floor of ten
    expect(await live()).toEqual({ step: 5 });
    for (const r of w.prompts) r.is_active = false; // and nothing to ask the assistants at all is the same owed step
    expect(await live()).toEqual({ step: 5 });
    // THE RENDERED PICKER MUST LAND: the wizard draws the goal step for a gapped running account, so that save may not answer "locked" under a live button.
    w.tenants.get(A)!.growth_goal = null;
    expect((await saveGoal(A, "balanced", w.deps)).ok && w.tenants.get(A)!.growth_goal).toBe("balanced");
    for (const r of w.prompts) r.is_active = true;
    // A profile with real content that nobody confirmed IS a gap and names the confirm step; an EMPTY one is exactly what a failed read hands back, so it is unreadable, never a gap.
    const unconfirmed = confirmedProfile(A); (unconfirmed as any).offerings = { value: ["rug cleaning"], origin: "inferred", confidence: 0.7, sourceUrls: [] };
    w.profiles.set(A, unconfirmed); expect(await live()).toEqual({ step: 3 });
    w.profiles.set(A, emptyBusinessProfile(A)); await expect(live()).rejects.toThrow();
    w.profiles.set(A, confirmedProfile(A));
    await expect(setupGap(A, acct() as any, { ...w.deps, store: { ...w.deps.store!, readPrompts: async () => { throw new Error("prompts unreadable"); } } })).rejects.toThrow(); });
  /** P0-5. The product guard sent an ACTIVE account with a real setup gap to /onboard, /onboard rendered it, and every mutation there refused it and redirected home, which sent it straight back: a loop with no way out. */
  it("lets an ACTIVE account finish the step it is actually missing, and never activates it a second time", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "grow" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: FIVE_PER_TOPIC }); await approvePrompts(A, { approvedGroups: FIRST_SEVEN_TOPICS }, w.deps);
    const gap = async () => { const t = w.tenants.get(A)!; return setupGap(A, { status: t.status, domain: t.domain, growth_goal: t.growth_goal, tos_accepted_at: t.tos } as any, w.deps); };
    expect([(await activateAccount(A, true, w.deps)).ok, w.tenants.get(A)!.status, w.scheduled.length]).toEqual([true, "active", 1]);
    for (const r of w.prompts) r.is_active = false; // the account is live with nothing to ask: a genuine gap
    seedCore(w, A, 5); // five strays under a basis nobody holds: enough to be swept, not enough to answer anything
    expect(await gap()).toEqual({ step: 5 }); expect((await approvePrompts(A, { approvedGroups: FIRST_SEVEN_TOPICS }, w.deps)).ok).toBe(true);
    // THE SWEEP RUNS FOR A RUNNING ACCOUNT TOO. Skipping it stacked the strays under the new set, and the funnel counts basis-agnostically, so 5 + 35 would have become 40 questions I pay for every day and nobody chose. The gap then closes, and nothing started a second research run.
    expect([activeCore(w, A).length, await gap(), w.scheduled.length]).toEqual([35, null, 1]);
    // A running account with nothing missing is still locked out of setup.
    expect((await approvePrompts(A, { approvedGroups: FIRST_SEVEN_TOPICS }, w.deps)).ok).toBe(false);
    // Terms nobody ever accepted are the one thing the launch step still owes, and accepting them starts nothing.
    w.tenants.get(A)!.tos = null;
    expect(await gap()).toEqual({ step: 7 }); expect((await activateAccount(A, true, w.deps)).ok).toBe(true);
    expect([w.tenants.get(A)!.tos, w.scheduled.length]).toEqual([NOW.toISOString(), 1]);});
  /** PHASE 6E.3, corrected. Confirm once stamped ALL eleven sections including eight never rendered; the repair then swung too far and stamped THREE while six more facts that decide what gets researched sat on screen still labelled as my guess. A confirmation now speaks for exactly what the step renders. */
  it("confirms every research-driving field it puts on screen, claims nothing it holds nothing for, and never locks out the account that confirmed three", async () => {
    const w = makeWorld(); seedPending(w, A, { domain: "acme.com" }); const inferred = emptyBusinessProfile(A);
    for (const k of CONFIRMABLE) (inferred as any)[k] = { value: (confirmedProfile(A) as any)[k].value, origin: "inferred", confidence: 0.7, sourceUrls: ["https://acme.com/"] };
    w.profiles.set(A, inferred);
    await confirmProfile(A, w.deps); const after = w.profiles.get(A)! as any;
    // THE LITERAL NINE, never SHOWN_FIELDS itself: iterating the module's own list passed just as happily when that list held three, so it falsified nothing.
    expect([...SHOWN_FIELDS].sort()).toEqual(["audiences", "businessType", "customerProblems", "geographicScope", "name", "offerings", "siteArchetype", "topicsToExclude", "topicsToOwn"]);
    for (const k of ["name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems", "geographicScope", "topicsToOwn"]) expect(after[k].origin, `${k} steers research and was on screen`).toBe("operator_confirmed");
    // Nothing reads these two, so nothing is owed a confirmation for them; the excluded-topics list is empty, so it is not on screen either.
    for (const k of ["trustClaims", "differentiators", "topicsToExclude"]) expect(after[k].origin, `${k} was never shown`).toBe("inferred");
    expect((await loadOnboardingState(A, w.deps)).profile.confirmed).toBe(true); // and the step still completes
    // THE LIVE ACCOUNT confirmed three before this existed. Its setup is finished, and widening what confirm covers must never send it back to step 3.
    const legacy = emptyBusinessProfile(A);
    for (const k of CONFIRMABLE) (legacy as any)[k] = { value: (confirmedProfile(A) as any)[k].value, origin: ["name", "offerings", "audiences"].includes(k) ? "operator_confirmed" : "inferred", confidence: 1, sourceUrls: [] };
    expect(isProfileConfirmed(legacy)).toBe(true);
    // AN ARRAY OF BLANKS IS NOT A FACT. The step joins a list and drops it when the join is blank, so [""] never reaches the screen and may not be stamped either.
    const blanks = emptyBusinessProfile(A);
    for (const k of CONFIRMABLE) (blanks as any)[k] = { value: k === "offerings" ? ["", "  "] : (confirmedProfile(A) as any)[k].value, origin: "inferred", confidence: 0.7, sourceUrls: [] };
    const w2 = makeWorld(); seedPending(w2, A, { domain: "acme.com" }); w2.profiles.set(A, blanks); await confirmProfile(A, w2.deps);
    expect((w2.profiles.get(A)! as any).offerings.origin).toBe("inferred"); });
  /** PHASE 6E.4. The first finding is read off a CRAWL. It has no Google evidence at all, so it may not speak for Google. */
  it("names the first finding's real address and never claims what Google does or does not have without Google evidence", async () => {
    const w = makeWorld(); seedPending(w, A, { domain: "acme.com" }); seedCrawl(w, A);
    Object.assign(w.crawls.get(A)!.page_facts[0], { url: "https://acme.com/rug-cleaning", path: "/rug-cleaning", title: "", word_count: 220 });
    const win = (await loadOnboardingState(A, w.deps)).findings.firstWin!; expect(win.url).toBe("https://acme.com/rug-cleaning");
    expect(win.plainWhy).toContain("https://acme.com/rug-cleaning"); // the real address, not a bare path the operator has to reassemble
    const copy = [win.action, win.plainWhy, win.exactFix].join(" "); expect(copy.toLowerCase()).not.toMatch(/google has nothing|nothing to show|stay signed in|keep this tab|each time you visit/);
    expect(copy).not.toMatch(/[–—]/); });
  it("never locks a thin business out of its own setup: it approves what it found and says why that is fewer", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server"); const { createElement } = await import("react");
    const { PromptsEditor } = await import("@/components/prompts-editor");
    const editor = (n: number) => renderToStaticMarkup(createElement(PromptsEditor, {
      groups: [{ slug: "g", name: "Choosing", prompts: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `question ${i}`, recommended: true, approved: false })) }],
      mode: "onboarding" as const, submitLabel: "Approve my selection", onSubmit: () => {},}));
    const thin = editor(16); expect(thin).toContain("16 strong questions found for your business. 20 to 50 is the range that works best, and more arrive as Beacon learns your market.");
    expect(thin).toContain("Approve my selection");
    expect(thin).not.toContain('disabled=""'); // the one primary action on the step is live, not a dead end
    // The 20 to 50 framing is what an account WITH the questions still reads, and the button still works.
    const full = editor(24); expect(full).toContain("Between 20 and 50 questions stay tracked, and this is the range that works best.");});
  it("offers the customer's own three sources on Connections, and nothing Beacon runs on its own account", () => {
    expect(CONNECTOR_REGISTRY.map((c) => c.id).sort()).toEqual(["clarity", "google_ga4", "google_gsc"]); const words = CONNECTOR_REGISTRY.map((c) => `${c.label} ${c.summary}`).join(" ").toLowerCase();
    expect(words).not.toMatch(/openai|dataforseo|crawler|perplexity|gemini/); expect(CONNECTOR_REGISTRY.find((c) => c.id === "google_gsc")!.summary).toContain("Strongly recommended");});
  it("tells an operator where each tracked question's trend starts, so a rewording never looks like a drop", () => {
    expect(historyNote({ version: 1, createdAt: "2026-05-10T00:00:00Z" }))
      .toBe("This exact question has been asked since May 10, and its trend runs from there.");
    expect(historyNote({ version: 3, createdAt: "2026-05-10T00:00:00Z" }))
      .toBe("This is version 3 of this question. It changed 2 times, and each change restarts its trend, so it is only compared against readings of the wording it has now.");
    for (const note of [historyNote({ version: 1, createdAt: "2026-05-10T00:00:00Z" }), historyNote({ version: 2, createdAt: "2026-05-10T00:00:00Z" })]) {
      expect(note!).not.toMatch(/[–—]/); expect(note!).not.toMatch(/\d{4}-\d{2}-\d{2}/);}});});

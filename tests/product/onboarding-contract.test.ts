/**
 * PRODUCT - the onboarding + 50-core-prompt approval contract (Slice 5). One
 * behavioral contract over the Runtime onboarding facade, driven by injected seams
 * (fake durable store + profile repo, an injected CompleteFn for all LLM kinds,
 * injected crawl/probe) with NO network. The one real seam is the durable budget
 * ledger, mocked as a tiny accumulating row so the $2 reserve-then-reconcile cap is
 * exercised. Each scenario states the customer stake it protects.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyBusinessProfile, type Account, type BusinessProfile } from "@/domains/account";
import type { OnboardingDeps, OnboardingStore, TrackedPromptRow } from "@/domains/runtime";
import {
  loadOnboardingState, submitWebsite, inferProfile, saveProfileEdits, proposeProfilePatch,
  applyConfirmedPatch, saveGoal, generatePromptCandidates, approvePrompts, activateAccount,
} from "@/domains/runtime";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
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
    }).then(res, rej),
  };
  return p;
}
vi.mock("@/lib/persistence/supabase", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSupabaseAdmin: () => ({ from: () => chain() }),
  isSupabaseConfigured: () => true,
}));
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
      return "replaced";
    },
    async updateTenantGoal(id, goal) { const t = tenants.get(id); if (!t || t.status !== "pending_onboarding") return "not_pending"; t.growth_goal = goal; return "ok"; },
    async activateTenant(id, now) { const t = tenants.get(id); if (!t) return "blocked"; if (t.status === "active") return "already_active"; if (t.status !== "pending_onboarding") return "blocked"; t.status = "active"; t.tos = now; return "activated"; },
    async readPrompts(id) { return prompts.filter((r) => r.tenant_id === id).map((r) => ({ ...r, tags: [...r.tags] })); },
    async upsertPrompts(rows) { for (const row of rows) { const i = prompts.findIndex((r) => r.id === row.id); if (i >= 0) prompts[i] = { ...row }; else prompts.push({ ...row }); } },
  };
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
    now: () => NOW,
  };
  return { tenants, profiles, get prompts() { return prompts; }, crawls, scheduled, deps };
}
const CONFIRMABLE = ["name", "businessType", "siteArchetype", "offerings", "audiences", "customerProblems", "geographicScope", "differentiators", "trustClaims", "topicsToOwn", "topicsToExclude"] as const;
// A fully operator-confirmed profile (every confirmable section), with optional sparser facts for the thin case.
function confirmedProfile(id: string, facts: Record<string, any> = {}): BusinessProfile {
  const p = emptyBusinessProfile(id);
  const merged: Record<string, any> = { name: "Acme Rugs", businessType: "local_service", siteArchetype: "service",
    offerings: ["rug cleaning", "rug repair"], audiences: ["homeowners"], customerProblems: ["dirty rugs"], geographicScope: ["denver"],
    differentiators: ["same day service"], trustClaims: ["insured"], topicsToOwn: ["rug care"], topicsToExclude: [], ...facts };
  for (const k of CONFIRMABLE) (p as any)[k] = { value: merged[k], origin: "operator_confirmed", confidence: 1, sourceUrls: [] };
  return p;
}
function seedPending(w: ReturnType<typeof makeWorld>, id: string, over: Partial<TenantRow> = {}) {
  w.tenants.set(id, { status: "pending_onboarding", domain: "", growth_goal: null, tos: null, ...over });
}
function seedConfirmedProfile(w: ReturnType<typeof makeWorld>, id: string) { w.profiles.set(id, confirmedProfile(id)); }
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
beforeEach(() => { process.env.BEACON_LLM_PROVIDER = "openai"; ledger = { usd: 0, has: false }; ledgerThrows = false; ledgerWriteFails = false; });
afterEach(() => { delete process.env.BEACON_LLM_PROVIDER; });
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
    const r = await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/", "https://evil.test/steal"]) });
    expect(r.status).toBe("inferred");
    const p = w.profiles.get(A)!;
    expect(p.name.origin).toBe("inferred"); expect(p.offerings.value).toContain("rug cleaning");
    expect(p.name.sourceUrls).toEqual(["https://acme.test/"]); // the outside URL is stripped
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
    expect(after.audiences.value).toEqual(["law firms"]); expect(after.accountId).toBe(A); expect(after.domain).toBeUndefined(); expect(after.offerings.origin).toBe("inferred");
  });
  it("5. candidate generation yields ~100 unique prompts in 5-10 groups covering all seven intents with exactly 50 recommended, inactive, canonical-id, current-basis, four-engine, and a retry never duplicates", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    const r = await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    expect(r.ok && r.candidateCount).toBeGreaterThanOrEqual(60); expect(r.ok && r.recommendedCount).toBe(50);
    const rows = w.prompts.filter((p) => p.tenant_id === A);
    expect(new Set(rows.map((p) => p.intent_type)).size).toBe(7); // all seven intent families
    expect(rows.every((p) => !p.is_active && p.tenant_id === A && p.account_id === A)).toBe(true); // inactive, canonical id (never the slug)
    expect(rows.every((p) => /^prompt-[0-9a-f]{16}$/.test(p.id) && p.tags.some((t) => t.startsWith("basis_")))).toBe(true); // stable id + current basis tag
    expect(rows.every((p) => JSON.stringify([...p.platforms].sort()) === JSON.stringify(["chatgpt", "claude", "gemini", "perplexity"]))).toBe(true); // all four engines
    const before = rows.length; await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // retry reuses the basis, spends nothing
    expect(w.prompts.filter((p) => p.tenant_id === A).length).toBe(before); // no duplicate rows
  });
  it("6. approval is declarative over the current-basis candidates: default 50, include/edit/add/remove work, foreign ids are rejected, 10..100 bounds hold, and it never accumulates", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    expect((await approvePrompts(A, { useRecommendedDefault: true }, w.deps)).ok && activeCore(w, A).length).toBe(50);
    expect((await approvePrompts(A, { approvedIds: ["prompt-deadbeefdeadbeef"] }, w.deps)).ok).toBe(false); // foreign id rejected, never kept
    const src = w.prompts.find((p) => p.tenant_id === A)!;
    expect((await approvePrompts(A, { approvedIds: [src.id] }, w.deps)).ok).toBe(false); // 1 row is below the floor of 10
    const keep = w.prompts.filter((p) => p.tenant_id === A && p.tags.includes("recommended")).slice(0, 12).map((p) => p.id);
    const ok = await approvePrompts(A, { approvedIds: keep, edits: [{ fromId: keep[0]!, text: "rug cleaning quote request" }], additions: [{ groupSlug: src.topic_id!, text: "brand new rug question" }], removedIds: [keep[1]!] }, w.deps);
    expect(ok.ok).toBe(true);
    expect(w.prompts.some((p) => p.tenant_id === A && p.text === "rug cleaning quote request" && p.tags.includes("edited"))).toBe(true); // edit versions a new row
    expect(w.prompts.some((p) => p.tenant_id === A && p.text === "brand new rug question" && p.tags.includes("added"))).toBe(true); // addition inherits its group
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps); // re-approve the default set
    expect(activeCore(w, A).length).toBe(50); // never accumulates past the bound
  });
  it("7. activation is blocked until website + confirmed profile + goal + approved prompts + TOS, never schedules on a block, is double-click safe, and schedules exactly one research run", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com" }); // missing profile + goal + prompts
    expect((await activateAccount(A, true, w.deps)).ok).toBe(false);
    expect(w.scheduled).toEqual([]); // a blocked activation does no work
    seedConfirmedProfile(w, A); w.tenants.get(A)!.growth_goal = "balanced";
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect((await activateAccount(A, false, w.deps)).ok).toBe(false); // TOS still required
    expect((await activateAccount(A, true, w.deps)).ok).toBe(true);
    expect(w.tenants.get(A)!.status).toBe("active");
    expect(w.scheduled).toEqual([A]);
    expect((await activateAccount(A, true, w.deps)).ok).toBe(true); // double click
    expect(w.scheduled).toEqual([A]); // idempotent: no second schedule
  });
  it("8. changing to a NEW website clears the goal, deactivates the old prompts, resets the profile, force-restarts the crawl, and drops readiness back to step 2", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "grow" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect(activeCore(w, A).length).toBe(50);
    let forced = false;
    const deps = { ...w.deps, startCrawl: (async (a: any) => { forced = a.force === true; return { status: "in_progress", discovered: 3 }; }) as any };
    expect((await submitWebsite(A, "newsite.com", deps)).ok).toBe(true);
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
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    const basisXids = activeCore(w, A).map((p) => p.id); expect(basisXids.length).toBe(50);
    await saveGoal(A, "balanced", w.deps); // the goal is a basis input
    expect((await loadOnboardingState(A, w.deps)).prompts.candidateCount).toBe(0); // old basis vanishes from the projection
    expect((await activateAccount(A, true, w.deps)).ok).toBe(false); // a stale-basis core row never activates
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // mints basis Y, deactivates X in one write
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    const now = activeCore(w, A);
    expect(now.length).toBe(50); expect(now.every((p) => !basisXids.includes(p.id))).toBe(true); // only the new basis is active
    await saveGoal(A, "grow", w.deps); await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // toggle BACK to basis X: reuse skips the mint sweep
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect(w.prompts.filter((p) => p.tenant_id === A && p.is_active).length).toBe(50); // approval sweeps ALL other-basis actives: never 100
  });
  it("10. the deterministic fallback yields honest per-family prompts with NO numbered filler, and a thin profile yields fewer without junk", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com", growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    expect((await generatePromptCandidates(A, { ...w.deps, complete: completeRefuse })).ok).toBe(true);
    const rows = w.prompts.filter((p) => p.tenant_id === A);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(new Set(rows.map((p) => p.intent_type)).size).toBeGreaterThanOrEqual(5); // several real families from real facts
    expect(rows.some((p) => /\s\d+$/.test(p.text))).toBe(false); // never padded with a trailing number
    const w2 = makeWorld();
    seedPending(w2, B, { domain: "thin.com", growth_goal: "balanced" });
    w2.profiles.set(B, confirmedProfile(B, { name: "Thin", offerings: ["one thing"], audiences: [], customerProblems: [], geographicScope: [], differentiators: [], trustClaims: [], topicsToOwn: [] }));
    expect((await generatePromptCandidates(B, { ...w2.deps, complete: completeRefuse })).ok).toBe(true);
    const thinRows = w2.prompts.filter((p) => p.tenant_id === B);
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
    const r1 = await reserveOnboardingSpend(0.02, { tenantId: A });
    const r2 = await reserveOnboardingSpend(0.02, { tenantId: A });
    expect([r1.allowed, r2.allowed].filter(Boolean).length).toBe(1);
  });
  it("12. an already-active account is never mutated by onboarding commands", async () => {
    const w = makeWorld();
    seedPending(w, A, { status: "active", domain: "live.com", growth_goal: "grow" });
    seedConfirmedProfile(w, A);
    expect((await submitWebsite(A, "changed.com", w.deps)).ok).toBe(false);
    expect((await saveGoal(A, "recover", w.deps)).ok).toBe(false);
    const t = w.tenants.get(A)!;
    expect(t.domain).toBe("live.com"); expect(t.growth_goal).toBe("grow");
  });
});

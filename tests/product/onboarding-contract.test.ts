/**
 * PRODUCT - the onboarding + 50-core-prompt approval contract (Slice 5).
 *
 * One readable behavioral contract over the Runtime onboarding facade, driven
 * entirely by injected seams (a fake durable store + profile repo, an injected
 * CompleteFn for all three LLM kinds, injected crawl/probe) with NO network. The
 * only real seam is the durable budget ledger, mocked so the $2 pre-activation
 * lifetime cap can be exercised. Every scenario states the customer stake it
 * protects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyBusinessProfile, type Account, type BusinessProfile } from "@/domains/account";
import type { OnboardingDeps, OnboardingStore, TrackedPromptRow } from "@/domains/runtime";
import {
  loadOnboardingState, submitWebsite, inferProfile, saveProfileEdits, confirmProfile,
  proposeProfilePatch, applyConfirmedPatch, saveGoal, generatePromptCandidates, approvePrompts, activateAccount,
} from "@/domains/runtime";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";

// Durable budget ledger is the one real seam; everything else is injected.
let ledgerRows: Array<{ spent_usd: number }> = [];
let ledgerThrows = false;
function chain(): any {
  const p: any = {
    select: () => p, eq: () => p, is: () => p, gte: () => p, order: () => p, limit: () => p,
    insert: () => Promise.resolve({ error: null }), update: () => p, upsert: () => Promise.resolve({ error: null }),
    maybeSingle: () => Promise.resolve(result()),
    then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
  };
  function result() { if (ledgerThrows) throw new Error("ledger unreadable"); return { data: ledgerRows, error: null }; }
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

  const store: OnboardingStore = {
    async updateTenantDomain(id, domain) { const t = tenants.get(id); if (!t || t.status !== "pending_onboarding") return "not_pending"; t.domain = domain; return "ok"; },
    async updateTenantGoal(id, goal) { const t = tenants.get(id); if (!t || t.status !== "pending_onboarding") return "not_pending"; t.growth_goal = goal; return "ok"; },
    async activateTenant(id, now) { const t = tenants.get(id); if (!t) return "blocked"; if (t.status === "active") return "already_active"; if (t.status !== "pending_onboarding") return "blocked"; t.status = "active"; t.tos = now; return "activated"; },
    async readPrompts(id) { return prompts.filter((r) => r.tenant_id === id).map((r) => ({ ...r, tags: [...r.tags] })); },
    async upsertPrompts(rows) { for (const row of rows) { const i = prompts.findIndex((r) => r.id === row.id); if (i >= 0) prompts[i] = { ...row }; else prompts.push({ ...row }); } },
  };

  const account = (id: string): Account | null => {
    const t = tenants.get(id);
    if (!t) return null;
    return { id, slug: id.replace(/^tenant-/, ""), provisional_name: "", domain: t.domain, status: t.status, signup_date: "", tos_accepted_at: t.tos, daily_budget_usd: 0, growth_goal: t.growth_goal as Account["growth_goal"], created_at: "", updated_at: "" };
  };

  const deps: OnboardingDeps = {
    store,
    getAccount: async (id) => account(id),
    loadProfile: async (id) => profiles.get(id) ?? emptyBusinessProfile(id),
    saveProfile: async (id, patch) => { const cur = profiles.get(id) ?? emptyBusinessProfile(id); const updated = { ...cur, ...patch, accountId: id, schemaVersion: 2, updatedAt: "" } as BusinessProfile; profiles.set(id, updated); return { profile: updated, persisted: true }; },
    loadCrawl: async (id) => crawls.get(id) ?? null,
    startCrawl: (async () => ({ status: "in_progress", discovered: 3 })) as any,
    runBatch: (async () => ({ ran: true, status: "in_progress", crawled: 3, failed: 0, totalCrawled: 3, remaining: 0, complete: false })) as any,
    probe: (async () => ({ ok: true, html: "<html></html>", status: 200 })) as any,
    connectorInfo: async (kind) => ({ status: "disconnected", connected_at: null, expires_at: null, last_synced_at: null }) as any,
    coldStartScan: (async () => ({ status: "no_pages", pagesDiscovered: 0, pagesCrawled: 0, snapshotsWritten: 0, durationMs: 0, source: "none" })) as any,
    scheduleResearch: (id: string) => { scheduled.push(id); },
    now: () => NOW,
  };
  return { tenants, profiles, get prompts() { return prompts; }, crawls, scheduled, deps };
}

function seedPending(w: ReturnType<typeof makeWorld>, id: string, over: Partial<TenantRow> = {}) {
  w.tenants.set(id, { status: "pending_onboarding", domain: "", growth_goal: null, tos: null, ...over });
}
function seedConfirmedProfile(w: ReturnType<typeof makeWorld>, id: string) {
  const p = emptyBusinessProfile(id);
  const conf = <T,>(v: T) => ({ value: v, origin: "operator_confirmed" as const, confidence: 1, sourceUrls: [] });
  p.name = conf("Acme Rugs"); p.offerings = conf(["rug cleaning", "rug repair"]); p.audiences = conf(["homeowners"]);
  p.customerProblems = conf(["dirty rugs"]); p.geographicScope = conf(["denver"]); p.topicsToOwn = conf(["rug care"]);
  w.profiles.set(id, p);
}
function seedCrawl(w: ReturnType<typeof makeWorld>, id: string) {
  w.crawls.set(id, {
    tenant_id: id, domain: "acme.test", status: "in_progress", frontier: [], visited: [], pages_crawled: 3, pages_failed: 0,
    page_cap: 150, source: "homepage", started_at: "", updated_at: "", last_batch_at: null, batches_run: 1,
    page_facts: [{ url: "https://acme.test/", path: "/", title: "Acme Rugs", h1: "Acme", has_meta_description: true, word_count: 200, faq_count: 0, questions: ["how to clean a rug"] }],
    day0: { question_seeding: null, serp_terms: [] },
  });
}

// Injected model outputs (firewall-safe: no superlatives, no digits, no dashes).
const inferValue = (sourceUrls: string[]) => ({ value: {
  name: "Acme Rugs", businessType: "local_service", siteArchetype: null, offerings: ["rug cleaning"], audiences: ["homeowners"],
  customerProblems: ["dirty rugs"], geographicScope: ["denver"], differentiators: ["same day service"], trustClaims: ["insured"],
  topicsToOwn: ["rug care"], topicsToExclude: [], importantPages: ["https://acme.test/"], confidence: 0.7, sourceUrls,
} });
const completeInfer = (sourceUrls: string[]): CompleteFn => async () => inferValue(sourceUrls);
const completeRefuse: CompleteFn = async () => ({ error: "refusal", retryable: false });
const INTENTS = ["category", "problem", "comparison", "commercial", "factual", "trust", "brand"] as const;
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
const completeCandidates: CompleteFn = async () => ({ value: { groups: INTENTS.map((intent) => ({
  slug: `g-${intent}`, name: `${intent} topics`, intent,
  prompts: WORDS.map((w, i) => ({ text: `${intent} ${w} question`, recommended: i < 4 })),
})) } });

beforeEach(() => { process.env.BEACON_LLM_PROVIDER = "openai"; ledgerRows = []; ledgerThrows = false; });
afterEach(() => { delete process.env.BEACON_LLM_PROVIDER; });

const A = "tenant-aaaa1111";
const B = "tenant-bbbb2222";

describe("onboarding contract (Slice 5)", () => {
  it("1. keeps two accounts isolated: one account's website/goal never leak into another's state or rows", async () => {
    const w = makeWorld();
    seedPending(w, A); seedPending(w, B);
    await submitWebsite(A, "acme.com", w.deps);
    await saveGoal(A, "grow", w.deps);
    expect(w.tenants.get(A)!.domain).toBe("acme.com");
    expect(w.tenants.get(B)!.domain).toBe(""); // B untouched
    const sB = await loadOnboardingState(B, w.deps);
    expect(sB.website.domain).toBe(""); // no cross-account bleed
    expect(sB.goal).toBeNull();
  });

  it("2. submitWebsite persists the canonical domain and starts only the bounded crawl - never writes prompts or calls a paid check", async () => {
    const w = makeWorld();
    seedPending(w, A);
    const r = await submitWebsite(A, "https://www.acme.com/pricing", w.deps);
    expect(r.ok).toBe(true);
    expect(w.tenants.get(A)!.domain).toBe("acme.com"); // normalized, www + path stripped
    expect(w.prompts.length).toBe(0); // no tracked_prompts written during website submit
  });

  it("3. inferProfile persists provenance-carrying sections and REJECTS any sourceUrl outside the supplied crawl set", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.test" }); seedCrawl(w, A);
    const r = await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/", "https://evil.test/steal"]) });
    expect(r.status).toBe("inferred");
    const p = w.profiles.get(A)!;
    expect(p.name.origin).toBe("inferred");
    expect(p.name.sourceUrls).toEqual(["https://acme.test/"]); // the outside URL is stripped
    expect(p.offerings.value).toContain("rug cleaning");
  });

  it("4. a refused/blocked model produces NO model artifact, falls back to a deterministic editable profile read from the site, and onboarding proceeds", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.test" }); seedCrawl(w, A);
    const r = await inferProfile(A, { ...w.deps, complete: completeRefuse });
    expect(r.source).toBe("site_read"); // deterministic path
    const p = w.profiles.get(A)!;
    expect(p.name.value).toBe("Acme"); // from the domain, not the model
    expect(p.name.origin).toBe("inferred");
    expect(p.name.confidence).toBeNull(); // honestly labeled as read, not model-scored
    const state = await loadOnboardingState(A, w.deps);
    expect(state.currentStep).toBe(3); // proceeds to confirm
  });

  it("5. a natural-language patch is only proposed until confirmed, persists nothing before applyConfirmedPatch, and can never touch identity or provenance", async () => {
    const w = makeWorld();
    seedPending(w, A); seedConfirmedProfile(w, A);
    const patchModel: CompleteFn = async () => ({ value: {
      changeSummary: "Add law firms to who you help.", name: null, businessType: null, siteArchetype: null,
      offerings: null, audiences: ["law firms"], customerProblems: null, geographicScope: null, differentiators: null,
      trustClaims: null, topicsToOwn: null, topicsToExclude: null, constraints: null, trustedSourceDomains: null, competitors: null,
    } });
    const proposal = await proposeProfilePatch(A, "we also serve law firms", { ...w.deps, complete: patchModel });
    expect(proposal.ok).toBe(true);
    expect(w.profiles.get(A)!.audiences.value).toEqual(["homeowners"]); // nothing persisted on propose
    // A malicious patch carrying identity/url fields is stripped to the whitelist before it can persist.
    await applyConfirmedPatch(A, { audiences: ["law firms"], accountId: "tenant-evil", domain: "evil.com" } as any, w.deps);
    const p = w.profiles.get(A)!;
    expect(p.audiences.value).toEqual(["law firms"]);
    expect(p.accountId).toBe(A); // identity untouched
    expect((p as any).domain).toBeUndefined();
  });

  it("6. the goal persists independently of the profile, with exactly the recover/grow/balanced vocabulary", async () => {
    const w = makeWorld();
    seedPending(w, A);
    expect((await saveGoal(A, "balanced", w.deps)).ok).toBe(true);
    expect(w.tenants.get(A)!.growth_goal).toBe("balanced");
    expect((await saveGoal(A, "aggressive" as any, w.deps)).ok).toBe(false); // vocabulary is closed
  });

  it("7. candidate generation yields ~100 unique prompts in 5-10 groups covering all seven intents with exactly 50 recommended, inactive, canonical-id, and a retry never duplicates", async () => {
    const w = makeWorld();
    seedPending(w, A, { growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    const r = await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    expect(r.ok && r.candidateCount).toBeGreaterThanOrEqual(60);
    expect(r.ok && r.recommendedCount).toBe(50);
    const rows = w.prompts.filter((p) => p.tenant_id === A);
    expect(new Set(rows.map((p) => p.intent_type)).size).toBe(7); // all seven families
    expect(rows.every((p) => !p.is_active)).toBe(true); // candidates are inactive
    expect(rows.every((p) => p.tenant_id === A && p.account_id === A)).toBe(true); // never the slug
    expect(rows.every((p) => /^prompt-[0-9a-f]{16}$/.test(p.id))).toBe(true);
    const before = rows.length;
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates }); // retry
    expect(w.prompts.filter((p) => p.tenant_id === A).length).toBe(before); // no duplicate rows
  });

  it("8. group approval activates exactly the 50 recommended by default, an edit versions a new row, bounds reject <10, and inactive/unapproved stay hidden from active readers", async () => {
    const w = makeWorld();
    seedPending(w, A, { growth_goal: "balanced" }); seedConfirmedProfile(w, A);
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    const approved = await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect(approved.ok && approved.approvedCount).toBe(50);
    const active = w.prompts.filter((p) => p.tenant_id === A && p.is_active);
    expect(active.length).toBe(50);
    expect(active.every((p) => p.tags.includes("core_v1"))).toBe(true);
    // An edit creates a NEW versioned row (edited + core), superseding a candidate.
    const src = w.prompts.find((p) => p.tenant_id === A)!;
    const bounds = await approvePrompts(A, { approvedIds: [src.id] }, w.deps); // only 1 -> below the floor
    expect(bounds.ok).toBe(false);
    const edited = await approvePrompts(A, { useRecommendedDefault: true, edits: [{ fromId: src.id, text: "rug cleaning quote request" }] }, w.deps);
    expect(edited.ok).toBe(true);
    expect(w.prompts.some((p) => p.tenant_id === A && p.text === "rug cleaning quote request" && p.tags.includes("edited"))).toBe(true);
    // Approval is declarative: re-approving just the recommended set drops the edit again.
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect(w.prompts.filter((p) => p.tenant_id === A && p.is_active).length).toBe(50); // never accumulates
  });

  it("9. activation is blocked until website + confirmed profile + goal + approved prompts + TOS, is double-click safe, and schedules exactly one research run", async () => {
    const w = makeWorld();
    seedPending(w, A);
    expect((await activateAccount(A, true, w.deps)).ok).toBe(false); // nothing set up yet
    w.tenants.get(A)!.domain = "acme.com"; seedConfirmedProfile(w, A); w.tenants.get(A)!.growth_goal = "balanced";
    await generatePromptCandidates(A, { ...w.deps, complete: completeCandidates });
    await approvePrompts(A, { useRecommendedDefault: true }, w.deps);
    expect((await activateAccount(A, false, w.deps)).ok).toBe(false); // TOS still required
    const first = await activateAccount(A, true, w.deps);
    expect(first.ok).toBe(true);
    expect(w.tenants.get(A)!.status).toBe("active");
    expect(w.scheduled).toEqual([A]); // exactly one research run scheduled
    const again = await activateAccount(A, true, w.deps); // double click
    expect(again.ok).toBe(true);
    expect(w.scheduled).toEqual([A]); // idempotent: no second schedule
  });

  it("10. a blocked activation never schedules research (no work before an account is truly active)", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.com" }); // missing profile + goal + prompts
    await activateAccount(A, true, w.deps);
    expect(w.scheduled).toEqual([]);
    expect(w.tenants.get(A)!.status).toBe("pending_onboarding");
  });

  it("11. the $2 pre-activation lifetime cap stops paid inference at/over the cap and fails closed when the ledger is unreadable, both continuing onboarding deterministically", async () => {
    const w = makeWorld();
    seedPending(w, A, { domain: "acme.test" }); seedCrawl(w, A);
    ledgerRows = [{ spent_usd: 2.5 }]; // already over the $2 cap
    const capped = await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/"]) });
    expect(capped.source).toBe("site_read"); // no model call; deterministic fallback
    w.profiles.delete(A); ledgerRows = []; ledgerThrows = true; // ledger unreadable => fail closed
    const failClosed = await inferProfile(A, { ...w.deps, complete: completeInfer(["https://acme.test/"]) });
    expect(failClosed.source).toBe("site_read");
  });

  it("12. an already-active account is never mutated by onboarding commands", async () => {
    const w = makeWorld();
    seedPending(w, A, { status: "active", domain: "live.com", growth_goal: "grow" });
    seedConfirmedProfile(w, A);
    expect((await submitWebsite(A, "changed.com", w.deps)).ok).toBe(false);
    expect((await saveGoal(A, "recover", w.deps)).ok).toBe(false);
    const t = w.tenants.get(A)!;
    expect(t.domain).toBe("live.com");
    expect(t.growth_goal).toBe("grow");
  });
});

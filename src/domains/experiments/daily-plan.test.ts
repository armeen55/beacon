import { describe, it, expect } from "vitest";

import type { BuiltCandidate } from "./build-daily-candidates";
import { buildDailyPlanRecord } from "./build-daily-plan-record";
import { validatePlanAcceptance, type AcceptanceContext } from "./validate-plan-acceptance";
import { stableHash, normalizePath, reservationId } from "./daily-plan-types";

const NOW = new Date("2026-07-01T12:00:00Z");

const control = (slug: string) => ({ url: `https://iranopedia.com/iran-flags/${slug}`, score: 0.8, why: "same family", impressionsRatio: 1, positionDifference: 1, pageFamilyMatch: true });

function cand(over: Partial<BuiltCandidate> & { url: string }): BuiltCandidate {
  return {
    pageLabel: "x", pageFamily: "iran-flags", actionFamily: "meta", targetQuery: "q",
    impressions: 2000, position: 5, ctr: 0.004, ownership: 0.5, ctrOpportunityClicks: 100, effortMinutes: 1,
    external: {}, leverField: "meta", currentText: "old meta", proposedText: "A factual new meta about the entity.",
    whyNow: "why", rollbackText: "old meta",
    eligibility: { eligible: true, reason: "clean" } as BuiltCandidate["eligibility"],
    suggestedControls: [control("c1"), control("c2"), control("c3"), control("c4"), control("c5")],
    enoughControls: true, ...over,
  };
}

const SNAP = { proofIds: ["/iran-animals/persian-wolf::2026-06-30"], treatedUrls: ["https://iranopedia.com/iran-animals/persian-wolf"], controlUrls: ["https://iranopedia.com/iran-animals/persian-cat"], influencedUrls: [] };

describe("buildDailyPlanRecord", () => {
  it("freezes a reproducible content-addressed plan with frozen hashes + distribution", () => {
    const selected = [
      cand({ url: "https://iranopedia.com/iran-flags/umayyad", leverField: "meta" }),
      cand({ url: "https://iranopedia.com/cuisine", pageFamily: "cuisine", leverField: "answer_block", effortMinutes: 3,
        answerDetail: { question: "What is X?", answerText: "X is a thing.", sourceSentence: "X is a thing.", paragraphIndex: 1, sentenceIndex: 0, operation: "move_existing_text", supportMode: "exact_sentence", proposedLocation: "below_h1", exactInstruction: "move it", rollbackInstruction: "move back", factualSafety: { volatileClaims: [], superlatives: [], unsupportedNumbers: [], unsupportedNames: [], passed: true, reasons: [] } } }),
    ];
    const plan = buildDailyPlanRecord({ tenantId: "tenant-iranopedia", date: "2026-07-01", now: NOW, selected, backups: [], activeSnapshot: SNAP });
    expect(plan.status).toBe("preview");
    expect(plan.tenantId).toBe("tenant-iranopedia");
    expect(plan.id.startsWith("tenant-iranopedia::2026-07-01::")).toBe(true);
    expect(plan.distribution.byLever).toEqual({ meta: 1, answer_block: 1 });
    expect(plan.estimatedMinutes).toBe(4);
    expect(plan.selected[0].currentTextHash).toBe(stableHash("old meta"));
    expect(plan.selected[1].detail.kind).toBe("answer_block");
    expect(plan.activeExperimentSnapshot.treatedUrls).toContain("https://iranopedia.com/iran-animals/persian-wolf");
    // expires a full operating day after now by default (survives plan-in-morning / apply-in-evening)
    expect(new Date(plan.expiresAt).getTime() - NOW.getTime()).toBe(24 * 60 * 60_000);
  });

  it("is content-addressed: same inputs → same id; changed proposal → different id", () => {
    const a = buildDailyPlanRecord({ tenantId: "t", date: "2026-07-01", now: NOW, selected: [cand({ url: "https://i.com/a" })], backups: [], activeSnapshot: SNAP });
    const b = buildDailyPlanRecord({ tenantId: "t", date: "2026-07-01", now: NOW, selected: [cand({ url: "https://i.com/a" })], backups: [], activeSnapshot: SNAP });
    const c = buildDailyPlanRecord({ tenantId: "t", date: "2026-07-01", now: NOW, selected: [cand({ url: "https://i.com/a", proposedText: "different" })], backups: [], activeSnapshot: SNAP });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  it("never uses a TREATED page (another selected experiment's source) as a control", () => {
    // umayyad is treated; make it a proposed control of a second experiment → it must be dropped.
    const treatedAsControl = { url: "https://iranopedia.com/iran-flags/umayyad", score: 0.9, why: "x", pageFamilyMatch: true, impressionsRatio: 1, positionDifference: 1 };
    const a = cand({ url: "https://iranopedia.com/iran-flags/umayyad" });
    const b = cand({ url: "https://iranopedia.com/iran-flags/pahlavi", suggestedControls: [treatedAsControl, control("c1"), control("c2"), control("c3")] });
    const plan = buildDailyPlanRecord({ tenantId: "t", date: "2026-07-01", now: NOW, selected: [a, b], backups: [], activeSnapshot: SNAP });
    const bRec = plan.selected.find((e) => e.url.endsWith("/pahlavi"))!;
    expect(bRec.controls.map((c) => c.controlPath)).not.toContain("/iran-flags/umayyad");
    expect(bRec.controls.length).toBe(3); // the treated page dropped, 3 clean remain
  });

  // R14a - the "Why not the others?" substrate: exclusions freeze onto the record.
  it("freezes the planner's exclusions on the record, capped at 8 with plain-sentence holds first (R14a)", () => {
    const excluded = [
      ...Array.from({ length: 6 }, (_, i) => ({ url: `https://i.com/x${i}`, actionFamily: "meta", reason: "page_family_cap" })),
      {
        url: "https://i.com/hold",
        actionFamily: "meta",
        reason: "query_overlap_hold",
        plainReason: "I am holding this because it competes for the same searches as tonight's pick for /persian-cat.",
      },
      ...Array.from({ length: 4 }, (_, i) => ({ url: `https://i.com/y${i}`, actionFamily: "meta", reason: "budget_full" })),
    ];
    const plan = buildDailyPlanRecord({
      tenantId: "t", date: "2026-07-01", now: NOW,
      selected: [cand({ url: "https://i.com/a" })], backups: [], activeSnapshot: SNAP, excluded,
    });
    expect(plan.excluded).toHaveLength(8);
    // the planner's own frozen sentence leads the capped list
    expect(plan.excluded![0]!.url).toBe("https://i.com/hold");
    expect(plan.excluded![0]!.plainReason).toContain("competes for the same searches");
    // exclusions never enter the content-addressed id (same picks -> same plan)
    const without = buildDailyPlanRecord({
      tenantId: "t", date: "2026-07-01", now: NOW,
      selected: [cand({ url: "https://i.com/a" })], backups: [], activeSnapshot: SNAP,
    });
    expect(plan.id).toBe(without.id);
  });

  it("omits the excluded field entirely when nothing was excluded (older plans parse unchanged)", () => {
    const plan = buildDailyPlanRecord({ tenantId: "t", date: "2026-07-01", now: NOW, selected: [cand({ url: "https://i.com/a" })], backups: [], activeSnapshot: SNAP });
    expect(plan.excluded).toBeUndefined();
  });

  it("records internal-link influencedUrls on the experiment", () => {
    const link = cand({ url: "https://i.com/src", leverField: "internal_link", actionFamily: "link", effortMinutes: 3,
      influencedUrls: ["/cities/san-diego"],
      linkDetail: { destinationPath: "/cities/san-diego", destinationUrl: "https://iranopedia.com/cities/san-diego", destinationLabel: "san diego", destinationFamily: "cities", anchorText: "San Diego", exactSourceText: "We love San Diego.", exactReplacementText: "We love <a>San Diego</a>.", paragraphIndex: 0, paragraphExcerpt: "We love San Diego.", relationship: "contextual_related", ownershipReason: "owns it", wixInstructions: "link it" } });
    const plan = buildDailyPlanRecord({ tenantId: "t", date: "2026-07-01", now: NOW, selected: [link], backups: [], activeSnapshot: SNAP });
    expect(plan.selected[0].influencedUrls).toEqual(["/cities/san-diego"]);
    expect(plan.selected[0].detail.kind).toBe("internal_link");
  });
});

describe("reservationId / normalizePath — deterministic + idempotent", () => {
  it("is deterministic and canonical", () => {
    expect(reservationId("t", "plan1", "exp1", "https://www.iranopedia.com/Iran-Flags/X/")).toBe("t::plan1::exp1::/iran-flags/x");
    expect(normalizePath("https://iranopedia.com/a?x=1#h")).toBe("/a");
  });
});

describe("validatePlanAcceptance — all-or-none, explicit reasons", () => {
  const plan = buildDailyPlanRecord({ tenantId: "tenant-iranopedia", date: "2026-07-01", now: NOW, selected: [cand({ url: "https://iranopedia.com/iran-flags/umayyad" })], backups: [], activeSnapshot: SNAP });
  const baseCtx = (): AcceptanceContext => ({ tenantId: "tenant-iranopedia", now: new Date("2026-07-01T12:10:00Z"), activeTreatedPaths: new Set(), activeControlPaths: new Set(), reservedControlPaths: new Map() });

  it("accepts a clean plan and counts reservations", () => {
    const r = validatePlanAcceptance(plan, baseCtx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reservationsToCreate).toBe(5);
  });
  it("rejects cross-tenant acceptance", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), tenantId: "tenant-ritz-founder" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.planLevelReason).toBe("tenant_mismatch");
  });
  it("rejects an expired plan", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), now: new Date("2026-07-03T00:00:00Z") }); // > 24h after NOW
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.planLevelReason).toBe("plan_expired");
  });
  it("rejects a changed input hash", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), expectedInputHash: "deadbeef" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.planLevelReason).toBe("input_hash_changed");
  });
  it("rejects when the source became an active control (candidate_no_longer_eligible)", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), activeControlPaths: new Set(["/iran-flags/umayyad"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures[0].reason).toBe("candidate_no_longer_eligible");
  });
  it("rejects when a proposed control is now an active treatment (control_unavailable)", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), activeTreatedPaths: new Set(["/iran-flags/c1"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((f) => f.reason === "control_unavailable")).toBe(true);
  });
  it("allows a control reserved as a baseline by another plan (shared baselines are compatible)", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), reservedControlPaths: new Map([["/iran-flags/c2", "other-plan"]]) });
    expect(r.ok).toBe(true);
  });
  it("rejects current_text_changed when fresh source text differs", () => {
    const r = validatePlanAcceptance(plan, { ...baseCtx(), currentTextByPath: new Map([["/iran-flags/umayyad", "DIFFERENT now"]]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((f) => f.reason === "current_text_changed")).toBe(true);
  });
  it("rejects insufficient controls", () => {
    const thin = buildDailyPlanRecord({ tenantId: "tenant-iranopedia", date: "2026-07-01", now: NOW, selected: [cand({ url: "https://iranopedia.com/iran-flags/u2", suggestedControls: [control("c1"), control("c2")] })], backups: [], activeSnapshot: SNAP });
    const r = validatePlanAcceptance(thin, baseCtx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((f) => f.reason === "insufficient_controls")).toBe(true);
  });
  it("rejects an internal-link influenced page that is now active (influenced_page_conflict)", () => {
    const link = cand({ url: "https://iranopedia.com/src", pageFamily: "src", leverField: "internal_link", actionFamily: "link", influencedUrls: ["/cities/san-diego"],
      linkDetail: { destinationPath: "/cities/san-diego", destinationUrl: "https://iranopedia.com/cities/san-diego", destinationLabel: "san diego", destinationFamily: "cities", anchorText: "San Diego", exactSourceText: "x San Diego.", exactReplacementText: "x <a>San Diego</a>.", paragraphIndex: 0, paragraphExcerpt: "x", relationship: "contextual_related", ownershipReason: "o", wixInstructions: "w" } });
    const p2 = buildDailyPlanRecord({ tenantId: "tenant-iranopedia", date: "2026-07-01", now: NOW, selected: [link], backups: [], activeSnapshot: SNAP });
    const r = validatePlanAcceptance(p2, { ...baseCtx(), activeControlPaths: new Set(["/cities/san-diego"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.some((f) => f.reason === "influenced_page_conflict")).toBe(true);
  });
});

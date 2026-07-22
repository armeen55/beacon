/** Recrawl demotion + runner (Core 100K Phase 6 merge). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { evaluateRecPrecondition, selectRecrawlDemotions, latestSnapshotByPath, snapshotPathOf } from "@/domains/recommendations/recrawl-demotion";
import { type RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { type PageSnapshot } from "@/domains/pages/types";
import { type ActionType } from "@/domains/recommendations/action-types";
import { demoteResolvedForTenant } from "@/domains/recommendations/recrawl-demotion-runner";

// ===== from tests/domains/recommendations/recrawl-demotion.test.ts =====
/**
 * N13 recrawl demotion (2026-07-03): retire a rec whose precondition a fresh
 * crawl proves is already met. Pins:
 *   • each proven precondition (title / meta / h1 copy, schema presence, named
 *     H2 section) is DETECTED and retired with an honest note;
 *   • a rec whose precondition still holds is left untouched (byte-identical);
 *   • only pending rows are candidates; accepted/pushed rows are never retired;
 *   • the note carries the observed value and no banned em/en dashes.
 */



function row(o: {
  id?: string;
  action_type: ActionType;
  target_url?: string;
  proposed_text?: string | null;
  display_label?: string | null;
  implementation_status?: RecommendedEditRow["implementation_status"];
}): RecommendedEditRow {
  return {
    id: o.id ?? "edit-1",
    tenant_id: "t",
    rec_id: "rec-1",
    action_type: o.action_type,
    target_url: o.target_url ?? "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    target_element_key: null,
    display_label: o.display_label ?? null,
    current_text: null,
    proposed_text: o.proposed_text ?? null,
    why: "original why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    implementation_status: o.implementation_status ?? "recommended",
  };
}

function snap(o: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "p-1",
    url: "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    canonical_url: null,
    fetched_at: "2026-07-03T00:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    tenant_id: "t",
    ...o,
  };
}

describe("evaluateRecPrecondition proven-case detection", () => {
  it("edit_title: retires when the title now reads the proposed copy", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "edit_title", proposed_text: "Persian Koobideh Kabob Recipe" }),
      snap({ title: "Persian Koobideh Kabob Recipe" }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.note).toBe(
      'You already fixed this. I retired it. Your title now reads "Persian Koobideh Kabob Recipe".',
    );
    expect(r.observedText).toBe("Persian Koobideh Kabob Recipe");
  });

  it("edit_title: still-holds when the title does NOT contain the proposed copy", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "edit_title", proposed_text: "Persian Koobideh Kabob Recipe" }),
      snap({ title: "Kabob (old title)" }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.note).toBeNull();
  });

  it("edit_meta: retires when the meta now matches the proposed copy", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "edit_meta", proposed_text: "The best koobideh recipe, step by step." }),
      snap({ meta_description: "The best koobideh recipe, step by step." }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.note).toContain("Your page description now reads");
  });

  it("change_h1: retires when the h1 now reads the proposed copy", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "change_h1", proposed_text: "Koobideh Kabob Recipe" }),
      snap({ h1: "Koobideh Kabob Recipe" }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.note).toContain("Your headline now reads");
  });

  it("add_schema: retires when the named schema type is now on the page", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "add_schema", proposed_text: "Recipe" }),
      snap({ schema_types: ["Recipe", "BreadcrumbList"] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.note).toBe(
      "You already fixed this. I retired it. Your page now has Recipe structured data.",
    );
  });

  it("add_schema: still-holds when the named type is absent", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "add_schema", proposed_text: "Recipe" }),
      snap({ schema_types: ["BreadcrumbList"] }),
    );
    expect(r.satisfied).toBe(false);
  });

  it("add_schema (no named type): retires when any schema now exists on a bare page", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "add_schema", proposed_text: null }),
      snap({ schema_types: ["FAQPage"] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.note).toContain("FAQPage structured data");
  });

  it("add_h2_section: retires when the named section now exists in the h2 list", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "add_h2_section", proposed_text: "Nutrition Facts" }),
      snap({ h2_list: ["Ingredients", "Nutrition Facts", "Tips"] }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.note).toBe(
      'You already fixed this. I retired it. Your page now has a "Nutrition Facts" section.',
    );
  });

  it("an unhandled action type is never demoted (proof-only)", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "create_page", proposed_text: "anything" }),
      snap({ title: "anything" }),
    );
    expect(r.satisfied).toBe(false);
  });

  it("no note ever contains an em or en dash (Beacon voice)", () => {
    const r = evaluateRecPrecondition(
      row({ action_type: "edit_title", proposed_text: "Persian Koobideh Kabob Recipe" }),
      snap({ title: "Persian Koobideh Kabob Recipe" }),
    );
    expect(/[‒–—―]/.test(r.note ?? "")).toBe(false);
  });
});

describe("selectRecrawlDemotions pure selection", () => {
  it("returns [] (byte-identical passthrough) when nothing is resolved", () => {
    const rows = [
      row({ action_type: "edit_title", proposed_text: "New Title" }),
    ];
    const byPath = latestSnapshotByPath([snap({ title: "Old Title" })]);
    expect(selectRecrawlDemotions(rows, byPath)).toEqual([]);
  });

  it("selects only the resolved rows, keyed by path", () => {
    const rows = [
      row({
        id: "resolved",
        action_type: "edit_title",
        proposed_text: "New Title",
      }),
      row({
        id: "still-open",
        action_type: "change_h1",
        proposed_text: "New Headline",
      }),
    ];
    const byPath = latestSnapshotByPath([snap({ title: "New Title", h1: "Old Headline" })]);
    const out = selectRecrawlDemotions(rows, byPath);
    expect(out).toHaveLength(1);
    expect(out[0]!.row.id).toBe("resolved");
  });

  it("never retires an already-accepted / pushed row", () => {
    const rows = [
      row({
        id: "accepted",
        action_type: "edit_title",
        proposed_text: "New Title",
        implementation_status: "accepted",
      }),
    ];
    const byPath = latestSnapshotByPath([snap({ title: "New Title" })]);
    expect(selectRecrawlDemotions(rows, byPath)).toEqual([]);
  });

  it("matches the snapshot by path even when host differs", () => {
    const rows = [
      row({
        action_type: "edit_title",
        target_url: "https://iranopedia.com/persian-food/koobideh-kabob-recipe?ref=x",
        proposed_text: "New Title",
      }),
    ];
    const byPath = latestSnapshotByPath([
      snap({ url: "https://www.iranopedia.com/persian-food/koobideh-kabob-recipe", title: "New Title" }),
    ]);
    expect(selectRecrawlDemotions(rows, byPath)).toHaveLength(1);
  });
});

describe("latestSnapshotByPath newest crawl wins", () => {
  it("keeps the most recent snapshot per path", () => {
    const older = snap({ id: "old", fetched_at: "2026-07-01T00:00:00Z", title: "Old" });
    const newer = snap({ id: "new", fetched_at: "2026-07-03T00:00:00Z", title: "New" });
    const byPath = latestSnapshotByPath([older, newer]);
    const path = snapshotPathOf("https://iranopedia.com/persian-food/koobideh-kabob-recipe");
    expect(byPath.get(path)!.id).toBe("new");
  });
});

// ===== from tests/domains/recommendations/recrawl-demotion-runner.test.ts =====
/**
 * N13 recrawl demotion runner (2026-07-03): the tenant I/O shell. Pins:
 *   • a resolved rec is marked `expired` with the honest note stamped on `why`;
 *   • a queue with nothing resolved makes ZERO writes (byte-identical);
 *   • a sync failure is captured, not thrown.
 */



function row_f1(o: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "t",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: "Persian Koobideh Kabob Recipe",
    why: "original why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    implementation_status: "recommended",
    ...o,
  };
}

function snap_f1(o: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: "snap_f1-1",
    page_id: "p-1",
    url: "https://iranopedia.com/persian-food/koobideh-kabob-recipe",
    canonical_url: null,
    fetched_at: "2026-07-03T00:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    tenant_id: "t",
    ...o,
  };
}

describe("demoteResolvedForTenant", () => {
  it("retires a resolved rec: expired + honest note on why", async () => {
    let persisted: RecommendedEditRow[] = [];
    const r = await demoteResolvedForTenant("tenant-x", {
      loadRows: async () => [row_f1()],
      loadSnapshots: async () => [snap_f1({ title: "Persian Koobideh Kabob Recipe" })],
      persistLocal: async (rows) => {
        persisted = rows;
      },
      syncRows: async () => {},
    });
    expect(r.retired).toBe(1);
    expect(r.sync_warning).toBeNull();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.implementation_status).toBe("expired");
    expect(persisted[0]!.why).toBe(
      'You already fixed this. I retired it. Your title now reads "Persian Koobideh Kabob Recipe".',
    );
  });

  it("makes zero writes when nothing is resolved (byte-identical)", async () => {
    let persistCalled = false;
    const r = await demoteResolvedForTenant("tenant-x", {
      loadRows: async () => [row_f1()],
      loadSnapshots: async () => [snap_f1({ title: "A completely different title" })],
      persistLocal: async () => {
        persistCalled = true;
      },
      syncRows: async () => {
        persistCalled = true;
      },
    });
    expect(r.retired).toBe(0);
    expect(persistCalled).toBe(false);
  });

  it("captures a sync failure instead of throwing", async () => {
    const r = await demoteResolvedForTenant("tenant-x", {
      loadRows: async () => [row_f1()],
      loadSnapshots: async () => [snap_f1({ title: "Persian Koobideh Kabob Recipe" })],
      persistLocal: async () => {},
      syncRows: async () => {
        throw new Error("supabase down");
      },
    });
    expect(r.retired).toBe(1);
    expect(r.sync_warning).toBe("supabase down");
  });
});

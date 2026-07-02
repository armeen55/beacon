/**
 * BEACON_500 item 15 (2026-07-02): "Stage in Wix" entry-point contract.
 * All Wix client calls are mocked; nothing here ever touches a live site
 * or the network (the live probe gets an injected fetch).
 *
 * Safety pins (these tests ARE the contract):
 *   1. RITZ NEVER STAGES - the entry point refuses before any rail runs.
 *   2. ARMED REQUIRED - staged (default) mode fails closed to paste with a
 *      pointer at the publishing settings; no write, no cap slot.
 *   3. NEVER STAGE WITHOUT A SNAPSHOT - a failed snapshot write means no
 *      live write (through executePush's fail-closed rail).
 *   4. DAILY PUSH CAP RESPECTED - the existing reserve-before-write cap
 *      refuses stage number 11.
 *   5. Fail-closed paste fallback for: no route (internal links), unmapped
 *      pages, missing records, QA-downgraded moves, un-accepted plans.
 *   6. Receipt shapes: staged receipts carry the time + restore promise;
 *      NO receipt or reason ever carries a banned dash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// in-memory json-store (push-ledger + push-snapshots live here via the real modules)
const _stores = new Map<string, unknown[]>();
let _failSnapshotWrite = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    if (name === "push-snapshots" && _failSnapshotWrite) throw new Error("disk full");
    _stores.set(name, data);
  },
}));

// No Supabase in tests: every durable path falls back to the mocked file store,
// so the cap + snapshot pins are deterministic regardless of shell env.
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("no supabase in tests");
  },
}));

let _ambientTenant = "tenant-iranopedia";
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => _ambientTenant,
}));

let _canPublish = true;
vi.mock("@/lib/auth/can-publish", () => ({
  canPublishForCurrentTenant: async () => _canPublish,
}));

let _mode: "armed" | "staged" = "armed";
vi.mock("@/domains/push/publishing-mode-store", () => ({
  getPublishingMode: async () => ({ mode: _mode, armedAt: null, armedBy: null }),
}));

let _tenant: Record<string, unknown> | null = null;
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => _tenant,
}));

let _urlMapEntry: Record<string, unknown> | null = null;
let _deriveFieldKey: string | null = null;
let _bodyResolved: { entry: Record<string, unknown>; bodyField: { key: string; kind: string } } | null = null;
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: async () => _urlMapEntry,
  deriveWixContentFieldKey: async () => _deriveFieldKey,
  resolveWixBodyFieldForUrl: async () => _bodyResolved,
}));

let _itemData: Record<string, unknown> = {};
let _updateCalls: Array<Record<string, unknown>> = [];
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixGetDataItem: async () => ({
      ok: true,
      value: { id: "item-1", dataCollectionId: "col", data: { ..._itemData } },
    }),
    wixQueryDataItems: async () => ({ ok: true, value: [] }),
    wixQueryAllDataItems: async () => ({ ok: true, value: [] }),
    wixUpdateDataItem: async (args: Record<string, unknown>) => {
      _updateCalls.push(args);
      _itemData = { ..._itemData, [String(args.field)]: args.value };
      return { ok: true, value: { id: "item-1", dataCollectionId: "col", data: { ..._itemData } } };
    },
    wixInsertDataItem: async () => ({ ok: true, value: { id: "n", dataCollectionId: "col", data: {} } }),
  };
});

let _plan: Record<string, unknown> | null = null;
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  getPlan: async () => _plan,
}));

let _edits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => ({ getRecommendedEdits: async () => _edits }),
  }),
}));

let _pushResults: Array<Record<string, unknown>> = [];
vi.mock("@/domains/recommendations/recommended-edits-persistence", () => ({
  markRecommendedEditPushResult: async (args: Record<string, unknown>) => {
    _pushResults.push(args);
  },
}));

let _actionRow: { status: string; detail: { qaVerdict: unknown } } | null = null;
vi.mock("@/domains/recommendations/load-action-row-by-edit", () => ({
  loadActionRowByEditId: async () => _actionRow,
}));

import { stageChangeForRecord, getStagingAvailability } from "@/domains/push/stage-change";
import {
  stageRouteForActionType,
  stageRouteForLever,
  stagedReceiptLine,
  pasteFallbackLine,
} from "@/domains/push/stage-route";
import { MAX_PUSHES_PER_DAY } from "@/domains/push/caps";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const PAGE_URL = "https://www.iranopedia.com/famous-iranian-poets";
const NOW = new Date("2026-07-02T09:14:00Z"); // 2:14am America/Los_Angeles (PDT)

/** A stubbed fetch for the move probe - never the network. */
const fetchWith = (html: string): typeof fetch =>
  (async () => ({
    ok: true,
    status: 200,
    text: async () => html,
  })) as unknown as typeof fetch;

function dailyPick(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "plan-1::/famous-iranian-poets",
    candidateId: "cand-1",
    url: PAGE_URL,
    canonicalUrl: PAGE_URL,
    pageLabel: "Famous Iranian Poets",
    pageFamily: "poets",
    lever: "title",
    targetQuery: "famous iranian poets",
    whyNow: "biggest striking-distance query on the page",
    currentText: "Old Title",
    proposedText: "Famous Iranian Poets and Their Work",
    placement: "title",
    leaveUnchanged: [],
    rollbackText: "Old Title",
    effortMinutes: 2,
    risk: "low",
    controls: [],
    influencedUrls: [],
    evidenceHash: "eh1",
    currentTextHash: "cth1",
    eligibilityHash: "elh1",
    detail: { kind: "edit_field", field: "title" },
    ...over,
  };
}

function acceptedPlan(exp: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: "plan-1",
    tenantId: "tenant-iranopedia",
    date: "2026-07-02",
    status: "accepted",
    selected: [exp],
    backups: [],
    ...over,
  };
}

function moveEdit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "edit-1",
    tenant_id: "tenant-iranopedia",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: PAGE_URL,
    target_element_key: null,
    current_text: "Old Title",
    proposed_text: "Famous Iranian Poets and Their Work",
    why: "striking distance",
    evidence: [],
    difficulty: "low",
    confidence: "high",
    risks: [],
    source: "deterministic",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    implementation_status: "recommended",
    ...over,
  };
}

beforeEach(() => {
  _stores.clear();
  _failSnapshotWrite = false;
  _ambientTenant = "tenant-iranopedia";
  _canPublish = true;
  _mode = "armed";
  _tenant = { id: "tenant-iranopedia", publish_target: "wix_cms" };
  _urlMapEntry = {
    url: PAGE_URL,
    dataCollectionId: "col",
    dataItemId: "item-1",
    slugField: "slug",
    label: null,
    syncedAt: "2026-07-01T00:00:00Z",
  };
  _deriveFieldKey = "field:title";
  _bodyResolved = null;
  _itemData = { title: "Old Title" };
  _updateCalls = [];
  _plan = acceptedPlan(dailyPick());
  _edits = [moveEdit()];
  _pushResults = [];
  _actionRow = null;
});

// ---------------------------------------------------------------------------
// Pure route classification (the map that OFFERS the button).
// ---------------------------------------------------------------------------

describe("stage-route - deterministic route classification", () => {
  it("maps title/meta/h1 to the field route and add_schema to the schema route", () => {
    expect(stageRouteForActionType("edit_title")).toBe("field");
    expect(stageRouteForActionType("edit_meta")).toBe("field");
    expect(stageRouteForActionType("change_h1")).toBe("field");
    expect(stageRouteForActionType("add_schema")).toBe("schema");
  });

  it("maps additive body sections to the body route", () => {
    expect(stageRouteForActionType("add_answer_block")).toBe("body");
    expect(stageRouteForActionType("add_faq")).toBe("body");
    expect(stageRouteForActionType("add_h2_section")).toBe("body");
  });

  it("an explicit element key wins (field:/section:), exactly like the push service", () => {
    expect(stageRouteForActionType("refresh_content", "field:description")).toBe("field");
    expect(stageRouteForActionType("refresh_content", "section:History")).toBe("body");
  });

  it("everything without a write path returns null (internal links, UX, new pages)", () => {
    expect(stageRouteForActionType("add_internal_link")).toBeNull();
    expect(stageRouteForActionType("fix_page_experience")).toBeNull();
    expect(stageRouteForActionType("create_page")).toBeNull();
    expect(stageRouteForActionType(null)).toBeNull();
  });

  it("daily levers map through the lever table; internal_link has no path", () => {
    expect(stageRouteForLever("title")).toBe("field");
    expect(stageRouteForLever("meta")).toBe("field");
    expect(stageRouteForLever("h1")).toBe("field");
    expect(stageRouteForLever("answer_block")).toBe("body");
    expect(stageRouteForLever("internal_link")).toBeNull();
    expect(stageRouteForLever(null)).toBeNull();
  });

  it("receipt copy carries the time + restore promise, and no banned dash anywhere", () => {
    const line = stagedReceiptLine(NOW);
    expect(line).toBe("Staged in Wix at 2:14am. I saved the old version first; one click restores it.");
    expect(hasBannedDash(line)).toBe(false);
    const paste = pasteFallbackLine("no Wix CMS item mapped — run the sync");
    expect(paste).toContain("copy and paste it yourself");
    expect(hasBannedDash(paste)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pin 1: Ritz never stages.
// ---------------------------------------------------------------------------

describe("stage-change - Ritz hard block (Invariant 2 regression)", () => {
  it("refuses for Ritz before ANY rail runs: no write, no ledger, no snapshot", async () => {
    _ambientTenant = "tenant-ritz-founder";
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.receiptLine).toContain("copy and paste it yourself");
    expect(r.reason).toContain("advise mode");
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-ledger") ?? []).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
  });

  it("getStagingAvailability is OFF for Ritz even when everything says armed", async () => {
    const a = await getStagingAvailability("tenant-ritz-founder");
    expect(a).toEqual({ enabled: false, armed: false, wixTarget: false });
  });
});

// ---------------------------------------------------------------------------
// Pin 2: armed required (staged default fails closed).
// ---------------------------------------------------------------------------

describe("stage-change - armed-required pin", () => {
  it("staged (default) mode fails closed to paste with a settings pointer; no write", async () => {
    _mode = "staged";
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("publishing settings");
    expect(_updateCalls).toHaveLength(0);
  });

  it("no publish permission fails closed; no write", async () => {
    _canPublish = false;
    const r = await stageChangeForRecord({ kind: "move", moveId: "rec-1" }, { now: NOW });
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("permission");
    expect(_updateCalls).toHaveLength(0);
  });

  it("a non-Wix publish target fails closed; no write", async () => {
    _tenant = { id: "tenant-iranopedia", publish_target: "dev_note" };
    const r = await stageChangeForRecord({ kind: "move", moveId: "rec-1" }, { now: NOW });
    expect(r.staged).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });

  it("getStagingAvailability mirrors the gates (armed+permitted+wix -> enabled)", async () => {
    expect(await getStagingAvailability("tenant-iranopedia")).toEqual({
      enabled: true,
      armed: true,
      wixTarget: true,
    });
    _mode = "staged";
    expect(await getStagingAvailability("tenant-iranopedia")).toEqual({
      enabled: false,
      armed: false,
      wixTarget: true,
    });
    _mode = "armed";
    expect(await getStagingAvailability("some-other-tenant")).toEqual({
      enabled: false,
      armed: false,
      wixTarget: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Daily pick staging (happy path + fail-closed paths).
// ---------------------------------------------------------------------------

describe("stage-change - daily-plan picks", () => {
  it("stages a title pick through the existing field route with snapshot + ledger + receipt", async () => {
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(true);
    expect(r.receiptLine).toContain("Staged in Wix at 2:14am.");
    expect(r.receiptLine).toContain("I saved the old version first; one click restores it.");
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.field).toBe("title");
    expect(_updateCalls[0]!.value).toBe("Famous Iranian Poets and Their Work");
    // The existing rails ran: snapshot BEFORE write + a finalized ledger row.
    const snaps = _stores.get("push-snapshots") ?? [];
    expect(snaps).toHaveLength(1);
    expect((snaps[0] as { previous_text: string }).previous_text).toBe("Old Title");
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string }>;
    expect(ledger.some((e) => e.result === "pushed")).toBe(true);
  });

  it("stages the operator's inline tweak (edited text), not the frozen proposal", async () => {
    const r = await stageChangeForRecord(
      {
        kind: "daily_pick",
        planId: "plan-1",
        experimentId: "plan-1::/famous-iranian-poets",
        editedText: "Famous Iranian Poets, from Ferdowsi to Forugh",
      },
      { now: NOW },
    );
    expect(r.staged).toBe(true);
    expect(_updateCalls[0]!.value).toBe("Famous Iranian Poets, from Ferdowsi to Forugh");
  });

  it("an internal_link pick has no one-click path: paste fallback, no write", async () => {
    _plan = acceptedPlan(dailyPick({ lever: "internal_link" }));
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.receiptLine).toContain("copy and paste it yourself");
    expect(_updateCalls).toHaveLength(0);
  });

  it("an answer_block pick with NO mapped body field fails closed to paste (today's behavior)", async () => {
    _deriveFieldKey = null;
    _plan = acceptedPlan(dailyPick({ lever: "answer_block", proposedText: "A direct 45-word answer." }));
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });

  it("a preview (un-accepted) plan refuses: approval comes first", async () => {
    _plan = acceptedPlan(dailyPick(), { status: "preview" });
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("approve");
    expect(_updateCalls).toHaveLength(0);
  });

  it("an already-live item never re-stages (proof-window protection)", async () => {
    _plan = acceptedPlan(dailyPick(), {
      execution: {
        items: {
          "plan-1::/famous-iranian-poets": { experimentId: "plan-1::/famous-iranian-poets", status: "active", receipts: [] },
        },
        updatedAt: "2026-07-02T00:00:00Z",
      },
    });
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("already live");
    expect(_updateCalls).toHaveLength(0);
  });

  it("a missing plan / missing item fails closed to paste", async () => {
    _plan = null;
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-x", experimentId: "nope" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pin 3: never stage without a snapshot.
// ---------------------------------------------------------------------------

describe("stage-change - never-stage-without-snapshot pin", () => {
  it("a failed snapshot write means NO live write and a paste fallback", async () => {
    _failSnapshotWrite = true;
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("snapshot");
    expect(_updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pin 4: the daily push cap holds in the staging path.
// ---------------------------------------------------------------------------

describe("stage-change - daily push cap pin", () => {
  it(`refuses stage number ${MAX_PUSHES_PER_DAY + 1} with the cap reason (no write)`, async () => {
    const day = NOW.toISOString().slice(0, 10);
    _stores.set(
      "push-ledger",
      Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => ({
        id: `p-${i}`,
        tenant_id: "tenant-iranopedia",
        edit_id: `e-${i}`,
        target_url: PAGE_URL,
        adapter: "wix_cms",
        pushed_at: NOW.toISOString(),
        day,
        result: "pushed",
        detail: null,
      })),
    );
    const r = await stageChangeForRecord(
      { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
      { now: NOW },
    );
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("cap");
    expect(_updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Worklist moves (resolution + QA backstop + verify rail).
// ---------------------------------------------------------------------------

describe("stage-change - worklist moves", () => {
  it("resolves by rec id, stages via the field route, probes live, persists the push result", async () => {
    const r = await stageChangeForRecord(
      { kind: "move", moveId: "rec-1" },
      { now: NOW, fetchImpl: fetchWith("<title>Famous Iranian Poets and Their Work</title>") },
    );
    expect(r.staged).toBe(true);
    expect(r.receiptLine).toContain("Staged in Wix at 2:14am.");
    expect(r.receiptLine).toContain("I already see it on the live page.");
    expect(_updateCalls).toHaveLength(1);
    expect(_pushResults).toHaveLength(1);
    expect(_pushResults[0]).toMatchObject({
      editId: "edit-1",
      tenantId: "tenant-iranopedia",
      result: "pushed",
      verifiedByProbe: true,
    });
  });

  it("an inconclusive probe still stages (scan cadence verifies later)", async () => {
    const r = await stageChangeForRecord(
      { kind: "move", moveId: "edit-1" }, // resolves by edit id too
      { now: NOW, fetchImpl: fetchWith("<title>Something else entirely</title>") },
    );
    expect(r.staged).toBe(true);
    expect(r.receiptLine).not.toContain("I already see it on the live page.");
    expect(_pushResults[0]).toMatchObject({ verifiedByProbe: false });
  });

  it("a QA-downgraded move never stages (the armed one-click backstop)", async () => {
    _actionRow = { status: "new", detail: { qaVerdict: { approve: false, pushReadiness: "review_only" } } };
    const r = await stageChangeForRecord(
      { kind: "move", moveId: "rec-1" },
      { now: NOW, fetchImpl: fetchWith("") },
    );
    expect(r.staged).toBe(false);
    expect(r.reason).toContain("quality check");
    expect(_updateCalls).toHaveLength(0);
  });

  it("a move without a pushable route (internal link) fails closed to paste", async () => {
    _edits = [moveEdit({ action_type: "add_internal_link" })];
    const r = await stageChangeForRecord({ kind: "move", moveId: "rec-1" }, { now: NOW });
    expect(r.staged).toBe(false);
    expect(r.receiptLine).toContain("copy and paste it yourself");
    expect(_updateCalls).toHaveLength(0);
  });

  it("an unknown move id fails closed to paste", async () => {
    const r = await stageChangeForRecord({ kind: "move", moveId: "rec-does-not-exist" }, { now: NOW });
    expect(r.staged).toBe(false);
    expect(_updateCalls).toHaveLength(0);
  });

  it("an unmapped page fails closed to paste (executePush's mapping rail)", async () => {
    _urlMapEntry = null;
    _deriveFieldKey = null;
    const r = await stageChangeForRecord({ kind: "move", moveId: "rec-1" }, { now: NOW });
    expect(r.staged).toBe(false);
    expect(r.receiptLine).toContain("copy and paste it yourself");
    expect(_updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pin 6: no banned dash can reach a card through any receipt path.
// ---------------------------------------------------------------------------

describe("stage-change - dash guard on every receipt", () => {
  it("staged, refused, and raw push-service reasons all render dash-free", async () => {
    const outcomes = [] as Array<{ staged: boolean; receiptLine: string; reason?: string }>;
    outcomes.push(
      await stageChangeForRecord(
        { kind: "daily_pick", planId: "plan-1", experimentId: "plan-1::/famous-iranian-poets" },
        { now: NOW },
      ),
    );
    _urlMapEntry = null; // the push-service unmapped reason historically carried an em dash
    _deriveFieldKey = null;
    outcomes.push(await stageChangeForRecord({ kind: "move", moveId: "rec-1" }, { now: NOW }));
    _mode = "staged";
    outcomes.push(await stageChangeForRecord({ kind: "move", moveId: "rec-1" }, { now: NOW }));
    for (const o of outcomes) {
      expect(hasBannedDash(o.receiptLine)).toBe(false);
      expect(hasBannedDash(o.reason ?? "")).toBe(false);
    }
  });
});

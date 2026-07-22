/**
 * "Stage in Wix" entry point + body-merge engine + Wix deep links
 * (Core 100K Phase 6 merge of tests/domains/push/stage-change.test.ts,
 * body-merge.test.ts, wix-deep-link.test.ts — boundary cases only).
 *
 * Safety pins (these tests ARE the contract):
 *   1. RITZ NEVER STAGES - the entry point refuses before any rail runs.
 *   2. ARMED REQUIRED - staged (default) mode fails closed to paste.
 *   3. NEVER STAGE WITHOUT A SNAPSHOT - a failed snapshot write means no
 *      live write.
 *   4. DAILY PUSH CAP RESPECTED in the staging path.
 *   5. Approval comes first: un-accepted plans and QA-downgraded moves
 *      never stage; already-live items never re-stage.
 *   6. Merge engine: prepend/append never wipe the original, replace swaps
 *      exactly one section, everything unsafe fails closed to paste, and
 *      no receipt or reason ever carries a banned dash.
 *   7. Deep links: honest null when unmapped, never a dead link.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const _stores = new Map<string, unknown[]>();
let _failSnapshotWrite = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    if (name === "push-snapshots" && _failSnapshotWrite) throw new Error("disk full");
    _stores.set(name, data);
  },
}));

// No Supabase in tests: every durable path falls back to the mocked file store.
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

import { stageChangeForRecord } from "@/domains/push/stage-change";
import { stageRouteForActionType } from "@/domains/push/stage-route";
import { MAX_PUSHES_PER_DAY } from "@/domains/push/caps";
import {
  mergeBodyContent,
  bodyMergeModeForAction,
  originalContentRetained,
  MIN_ORIGINAL_KEEP_RATIO,
} from "@/domains/push/body-merge";
import { buildWixEditorLink, WIX_STORES_PRODUCTS_COLLECTION_ID } from "@/domains/push/wix-deep-link";
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

describe("stage-route - deterministic route classification", () => {
  it("maps title/meta/h1/schema/body to their routes; everything without a write path returns null", () => {
    expect(stageRouteForActionType("edit_title")).toBe("field");
    expect(stageRouteForActionType("edit_meta")).toBe("field");
    expect(stageRouteForActionType("add_schema")).toBe("schema");
    expect(stageRouteForActionType("add_answer_block")).toBe("body");
    expect(stageRouteForActionType("add_internal_link")).toBeNull();
    expect(stageRouteForActionType("create_page")).toBeNull();
    expect(stageRouteForActionType(null)).toBeNull();
  });
});

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
});

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
});

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
});

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
});

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

// ── body-merge engine (pure) ────────────────────────────────────────────

const BODY_PLAIN = [
  "Persian cats are a long-haired breed known for their calm temperament.",
  "",
  "History",
  "",
  "The breed arrived in Europe in the 1600s and became a favorite of royalty across the continent.",
  "",
  "Care",
  "",
  "Daily brushing keeps the coat healthy. Most owners groom in the morning.",
].join("\n");

const ANSWER_DRAFT =
  "Persian cats live 12 to 17 years on average. Indoor cats with regular vet care live the longest.";

describe("body-merge - non-destructive merge discipline", () => {
  it("prepend_answer puts the draft first and keeps the whole original (dash-free summary)", () => {
    const r = mergeBodyContent({ existing: BODY_PLAIN, draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.startsWith(ANSWER_DRAFT)).toBe(true);
    expect(r.merged).toContain(BODY_PLAIN);
    expect(hasBannedDash(r.summary)).toBe(false);
  });

  it("replace_section swaps exactly the matched section and keeps everything around it", () => {
    const draft = [
      "History",
      "",
      "Traders brought the breed to Europe in the early 1600s, where noble households prized it; written records span four centuries.",
    ].join("\n");
    const r = mergeBodyContent({
      existing: BODY_PLAIN,
      draft,
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "History" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged).toContain("Persian cats are a long-haired breed"); // intro kept
    expect(r.merged).toContain("Daily brushing keeps the coat healthy"); // Care kept
    expect(r.merged).toContain("Traders brought the breed to Europe"); // new section in
    expect(r.merged).not.toContain("became a favorite of royalty"); // old section out
  });

  it("replace_section fails closed when the heading is not on the page", () => {
    const r = mergeBodyContent({
      existing: BODY_PLAIN,
      draft: "Something new",
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "Pricing" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("could not find");
      expect(r.reason).toContain("paste");
      expect(hasBannedDash(r.reason)).toBe(false);
    }
  });

  it("replace_section refuses a deletion-shaped replacement (tiny draft over a big section)", () => {
    const bigSection = ["Care", "", "Daily brushing keeps the coat healthy. ".repeat(20)].join("\n");
    const body = `Intro sentence for the page.\n\n${bigSection}`;
    const r = mergeBodyContent({
      existing: body,
      draft: "Care\nBrush.",
      kind: "plain",
      mode: "replace_section",
      opts: { sectionHeading: "Care" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("deletion");
  });

  it("html prepend wraps a plain draft in ESCAPED <p> tags and keeps the original", () => {
    const HTML_BODY = "<p>Ghormeh sabzi is a herb stew.</p><h2>Ingredients</h2><p>Herbs, kidney beans.</p>";
    const r = mergeBodyContent({
      existing: HTML_BODY,
      draft: "Ghormeh sabzi takes 3 hours to cook & serves 4 to 6 people.",
      kind: "html",
      mode: "prepend_answer",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.merged.startsWith("<p>Ghormeh sabzi takes 3 hours to cook &amp; serves 4 to 6 people.</p>")).toBe(true);
    expect(r.merged).toContain(HTML_BODY);
  });

  it("RICOS: replace_section and unparseable docs fail closed (we never restructure rich content)", () => {
    const RICOS_DOC = JSON.stringify({
      type: "DOC",
      nodes: [
        {
          type: "PARAGRAPH",
          id: "orig-1",
          nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text: "Original paragraph.", decorations: [] } }],
          paragraphData: {},
        },
      ],
      metadata: { version: 1 },
    });
    const replace = mergeBodyContent({
      existing: RICOS_DOC,
      draft: "x",
      kind: "ricos",
      mode: "replace_section",
      opts: { sectionHeading: "History" },
    });
    expect(replace.ok).toBe(false);
    if (!replace.ok) {
      expect(replace.reason).toContain("cannot safely replace");
      expect(replace.reason).toContain("paste");
    }
    expect(mergeBodyContent({ existing: "not json {", draft: "x", kind: "ricos", mode: "append_faq" }).ok).toBe(false);
  });

  it("an unrecognized field kind fails closed with the paste receipt", () => {
    const r = mergeBodyContent({ existing: "body", draft: "x", kind: "markdown", mode: "append_faq" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("I could not safely write");
      expect(r.reason).toContain("left it for you to paste");
      expect(hasBannedDash(r.reason)).toBe(false);
    }
  });

  it("never-wipe assertion: a merged value missing the original or below the keep ratio is rejected", () => {
    expect(originalContentRetained({ existing: "the original body", merged: "only the draft" })).toBe(false);
    expect(originalContentRetained({ existing: "the original body", merged: "draft\n\nthe original body" })).toBe(true);
    expect(originalContentRetained({ existing: "", merged: "anything" })).toBe(true); // nothing to wipe
    const existing = "a".repeat(1000);
    expect(MIN_ORIGINAL_KEEP_RATIO).toBeGreaterThan(0.9);
    expect(originalContentRetained({ existing, merged: "a".repeat(900) })).toBe(false);
  });

  it("re-pushing the exact same answer block onto its own result is a no-op (plain)", () => {
    const first = mergeBodyContent({ existing: BODY_PLAIN, draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = mergeBodyContent({ existing: first.merged, draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyApplied).toBe(true);
    expect(second.merged).toBe(first.merged); // byte-identical, no duplicate
    expect(second.summary).toContain("already on the page");
  });

  it("a DIFFERENT section is not treated as already applied (no false positive)", () => {
    const first = mergeBodyContent({ existing: BODY_PLAIN, draft: ANSWER_DRAFT, kind: "plain", mode: "prepend_answer" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const different = mergeBodyContent({
      existing: first.merged,
      draft: "Persian cats need weekly nail trims and daily eye cleaning.",
      kind: "plain",
      mode: "prepend_answer",
    });
    expect(different.ok).toBe(true);
    if (!different.ok) return;
    expect(different.alreadyApplied).toBeUndefined();
    expect(different.merged).not.toBe(first.merged);
  });

  it("maps the section-producing action types and nothing else (rewrites never implicitly merge)", () => {
    expect(bodyMergeModeForAction("add_answer_block")).toBe("prepend_answer");
    expect(bodyMergeModeForAction("add_faq")).toBe("append_faq");
    expect(bodyMergeModeForAction("add_h2_section")).toBe("append_faq");
    expect(bodyMergeModeForAction("rewrite_h2")).toBeNull();
    expect(bodyMergeModeForAction("edit_title")).toBeNull();
    expect(bodyMergeModeForAction("add_schema")).toBeNull();
  });
});

// ── Wix deep links (pure) ───────────────────────────────────────────────

describe("buildWixEditorLink - real URL shapes + honest null when unmapped", () => {
  const SITE_ID = "a1b2c3d4-0000-1111-2222-333344445555";

  it("resolves Stores/Products + an item id to the product editor URL; plain CMS to Content Manager", () => {
    const product = buildWixEditorLink({
      siteId: SITE_ID,
      dataCollectionId: WIX_STORES_PRODUCTS_COLLECTION_ID,
      dataItemId: "product-99",
    });
    expect(product!.toString()).toBe(
      `https://manage.wix.com/dashboard/${SITE_ID}/stores/products/product-99`,
    );
    const cms = buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: "FamousIranians", dataItemId: "item-42" });
    expect(cms!.toString()).toBe(
      `https://manage.wix.com/dashboard/${SITE_ID}/database/data/FamousIranians`,
    );
  });

  it("a Stores product with no item id resolves to null (never a dead link)", () => {
    const link = buildWixEditorLink({
      siteId: SITE_ID,
      dataCollectionId: WIX_STORES_PRODUCTS_COLLECTION_ID,
      dataItemId: null,
    });
    expect(link).toBeNull();
  });

  it("no site id / no collection mapping resolves to null and never throws", () => {
    expect(buildWixEditorLink({ siteId: null, dataCollectionId: "Recipes", dataItemId: "x" })).toBeNull();
    expect(buildWixEditorLink({ siteId: SITE_ID, dataCollectionId: null })).toBeNull();
    expect(() => buildWixEditorLink({ siteId: null, dataCollectionId: null })).not.toThrow();
  });
});

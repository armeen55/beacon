/**
 * BEACON_500 item 2 (2026-07-01): the body-section PUSH path contract.
 * All Wix client calls are mocked; nothing here ever touches a live site.
 *
 * Pins:
 *   - Ritz hard-block stays first: a body card for Ritz exports a dev
 *     note, never a write (regression on Invariant 2).
 *   - happy path: snapshot of the FULL prior body written BEFORE the
 *     write, merge applied (prepend/append), one wixUpdateDataItem call
 *     with the full merged value, verify-by-re-read, ledger "pushed".
 *   - RICOS object bodies: written back as an OBJECT, snapshot stores
 *     the JSON string.
 *   - daily cap + 1MB ceiling + fail-closed snapshot + dry-run rails.
 *   - no body mapping -> the card refuses and stays paste-ready.
 *   - revert restores the exact prior body through buildRevertEdit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// in-memory json-store (push-ledger + push-snapshots)
const _stores = new Map<string, unknown[]>();
let _failSnapshotWrite = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    if (name === "push-snapshots" && _failSnapshotWrite) throw new Error("disk full");
    _stores.set(name, data);
  },
}));

let _tenant: Record<string, unknown> | null = null;
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => _tenant,
}));

let _urlMapEntry: Record<string, unknown> | null = null;
let _bodyResolved: { entry: Record<string, unknown>; bodyField: { key: string; kind: string } } | null = null;
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: async () => _urlMapEntry,
  deriveWixContentFieldKey: async () => null,
  resolveWixBodyFieldForUrl: async () => _bodyResolved,
}));

// One mutable fake CMS item; updates land on it so the verify re-read
// genuinely observes the write (not a canned answer).
let _itemData: Record<string, unknown> = {};
let _updateCalls: Array<Record<string, unknown>> = [];
let _updateResult: { ok: boolean; reason?: string; detail?: string } = { ok: true };
let _getFails = false;
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixGetDataItem: async () => {
      if (_getFails) return { ok: false, reason: "api_error", detail: "http_500" };
      return { ok: true, value: { id: "item-1", dataCollectionId: "Recipes", data: { ..._itemData } } };
    },
    wixQueryDataItems: async () => ({ ok: true, value: [] }),
    wixQueryAllDataItems: async () => ({ ok: true, value: [] }),
    wixUpdateDataItem: async (args: Record<string, unknown>) => {
      _updateCalls.push(args);
      if (!_updateResult.ok) return _updateResult;
      _itemData = { ..._itemData, [String(args.field)]: args.value };
      return { ok: true, value: { id: "item-1", dataCollectionId: "Recipes", data: { ..._itemData } } };
    },
    wixInsertDataItem: async () => ({ ok: true, value: { id: "n", dataCollectionId: "Recipes", data: {} } }),
  };
});

import { executePush, RITZ_TENANT_ID } from "@/domains/push/push-service";
import { MAX_PUSHES_PER_DAY } from "@/domains/push/caps";
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import { buildRevertEdit, findLatestSnapshotForEdit } from "@/domains/push/push-snapshots";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const PAGE_URL = "https://www.iranopedia.com/persian-food/kabob";
const ORIGINAL_BODY =
  "Kabob koobideh is Iran's most beloved grilled dish.\n\n" +
  "History\n\n" +
  "Street vendors in Tehran popularized koobideh in the Qajar era.";
const ANSWER_DRAFT =
  "Koobideh kabob is ground meat kabob seasoned with grated onion and grilled on flat skewers.";

function edit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-body-1",
    tenant_id: "tenant-iranopedia",
    rec_id: "rec-body-1",
    action_type: "add_answer_block" as RecommendedEditRow["action_type"],
    target_url: PAGE_URL,
    target_element_key: null,
    display_label: "Add an answer block to the kabob page",
    current_text: null,
    proposed_text: ANSWER_DRAFT,
    why: "AI answers quote a rival page for this question",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    implementation_status: "accepted",
    ...over,
  } as RecommendedEditRow;
}

beforeEach(() => {
  _stores.clear();
  _failSnapshotWrite = false;
  _tenant = { id: "tenant-iranopedia", publish_target: "wix_cms" };
  _urlMapEntry = {
    url: PAGE_URL,
    dataCollectionId: "Recipes",
    dataItemId: "item-1",
    slugField: "slug",
    label: "Kabob",
    syncedAt: "2026-07-01T00:00:00Z",
  };
  _bodyResolved = {
    entry: _urlMapEntry,
    bodyField: { key: "content", kind: "plain" },
  };
  _itemData = { slug: "kabob", title: "Kabob", content: ORIGINAL_BODY };
  _updateCalls = [];
  _updateResult = { ok: true };
  _getFails = false;
});

describe("Ritz hard-block regression (Invariant 2 stays first)", () => {
  it("a body card for Ritz exports a dev note and never writes, even fully mapped", async () => {
    _tenant = { id: RITZ_TENANT_ID, publish_target: "wix_cms" };
    const r = await executePush({ tenantId: RITZ_TENANT_ID, edit: edit() });
    expect(r.kind).toBe("dev_note");
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
  });
});

describe("body-section push - happy path (plain body)", () => {
  it("add_answer_block: snapshot first, PREPENDS the draft, verifies by re-read, ledgers pushed", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("pushed");

    // Snapshot captured the FULL prior body before the write.
    const snaps = (_stores.get("push-snapshots") ?? []) as Array<Record<string, unknown>>;
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.field).toBe("content");
    expect(snaps[0]!.previous_text).toBe(ORIGINAL_BODY);

    // Exactly one write, full merged value, draft first, original intact.
    expect(_updateCalls).toHaveLength(1);
    expect(_updateCalls[0]!.field).toBe("content");
    const written = String(_updateCalls[0]!.value);
    expect(written.startsWith(ANSWER_DRAFT)).toBe(true);
    expect(written).toContain(ORIGINAL_BODY);

    // Verified on re-read + honest first-person receipt.
    if (r.kind === "pushed") {
      expect(r.detail).toContain("I saved the previous version first");
      expect(r.detail).toContain("new section is in place");
      expect(hasBannedDash(r.detail)).toBe(false);
    }
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string; detail: string | null }>;
    expect(ledger.some((e) => e.result === "pushed" && (e.detail ?? "").includes("verified"))).toBe(true);
  });

  it("add_faq APPENDS the section after the existing body", async () => {
    const faqDraft = "Frequently asked questions\nHow long does koobideh take? About 20 minutes on the grill.";
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ action_type: "add_faq" as RecommendedEditRow["action_type"], proposed_text: faqDraft }),
    });
    expect(r.kind).toBe("pushed");
    const written = String(_updateCalls[0]!.value);
    expect(written.startsWith(ORIGINAL_BODY)).toBe(true);
    expect(written.endsWith(faqDraft)).toBe(true);
  });

  it('an explicit "section:<heading>" key REPLACES that section', async () => {
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({
        target_element_key: "section:History",
        proposed_text: "History\n\nQajar-era street vendors in Tehran made koobideh a national staple; the recipe spread nationwide.",
      }),
    });
    expect(r.kind).toBe("pushed");
    const written = String(_updateCalls[0]!.value);
    expect(written).toContain("Kabob koobideh is Iran's most beloved grilled dish.");
    expect(written).toContain("national staple");
    expect(written).not.toContain("popularized koobideh in the Qajar era");
  });
});

describe("body-section push - RICOS object bodies", () => {
  const RICOS_OBJECT = {
    type: "DOC",
    nodes: [
      {
        type: "PARAGRAPH",
        id: "orig-1",
        nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text: "Existing paragraph.", decorations: [] } }],
        paragraphData: {},
      },
    ],
  };

  beforeEach(() => {
    _bodyResolved = { entry: _urlMapEntry!, bodyField: { key: "richContent", kind: "ricos" } };
    _itemData = { slug: "kabob", richContent: RICOS_OBJECT };
  });

  it("writes the merged doc back as an OBJECT and snapshots the JSON string", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    const value = _updateCalls[0]!.value as { nodes: Array<{ id: string }> };
    expect(typeof value).toBe("object");
    expect(value.nodes).toHaveLength(2);
    expect(value.nodes[1]!.id).toBe("orig-1"); // prepend keeps original after the answer
    const snaps = (_stores.get("push-snapshots") ?? []) as Array<Record<string, unknown>>;
    expect(snaps[0]!.previous_text).toBe(JSON.stringify(RICOS_OBJECT));
  });

  it("replace_section on a RICOS body fails closed with the paste receipt", async () => {
    const r = await executePush({
      tenantId: "tenant-iranopedia",
      edit: edit({ target_element_key: "section:History", proposed_text: "History\n\nLong replacement text here." }),
    });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("paste");
    expect(_updateCalls).toHaveLength(0);
  });
});

describe("body-section push - fail-closed rails", () => {
  it("no body mapping -> refused, card stays paste-ready, nothing written", async () => {
    _bodyResolved = null;
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
  });

  it("an unrecognized configured kind fails closed with the honest receipt", async () => {
    _bodyResolved = { entry: _urlMapEntry!, bodyField: { key: "content", kind: "markdown" } };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") {
      expect(r.reason).toContain("I could not safely write");
      expect(r.reason).toContain("left it for you to paste");
    }
    expect(_updateCalls).toHaveLength(0);
  });

  it("a plain/html mapping over an OBJECT value fails closed (kind mismatch beats corruption)", async () => {
    _itemData = { slug: "kabob", content: { nodes: [] } };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("does not hold plain content");
    expect(_updateCalls).toHaveLength(0);
  });

  it("daily cap refuses before any body write", async () => {
    const day = new Date().toISOString().slice(0, 10);
    _stores.set(
      "push-ledger",
      Array.from({ length: MAX_PUSHES_PER_DAY }, (_, i) => ({
        id: `p${i}`, tenant_id: "tenant-iranopedia", edit_id: `e${i}`,
        target_url: "x", adapter: "wix_cms", pushed_at: new Date().toISOString(),
        day, result: "pushed", detail: null,
      })),
    );
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/daily push cap/);
    expect(_updateCalls).toHaveLength(0);
  });

  it("snapshot persistence failure refuses BEFORE the live write (fail-closed undo)", async () => {
    _failSnapshotWrite = true;
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("snapshot");
    expect(_updateCalls).toHaveLength(0);
  });

  it("a merged item past the 1MB ceiling refuses locally", async () => {
    _itemData = { slug: "kabob", content: ORIGINAL_BODY, blob: "x".repeat(1_100_000) };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toMatch(/bytes/);
    expect(_updateCalls).toHaveLength(0);
  });

  it("a failed Wix write lands push_failed in the ledger", async () => {
    _updateResult = { ok: false, reason: "api_error", detail: "http_500" };
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string }>;
    expect(ledger.some((e) => e.result === "push_failed")).toBe(true);
  });

  it("dry-run runs the full guard path with ZERO side effects", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit(), dryRun: true });
    expect(r.kind).toBe("dry_run");
    if (r.kind === "dry_run") expect(r.detail).toContain("previous version saved first");
    expect(_updateCalls).toHaveLength(0);
    expect(_stores.get("push-snapshots") ?? []).toHaveLength(0);
    expect(_stores.get("push-ledger") ?? []).toHaveLength(0);
  });

  it("an unverified re-read still ships but reads honestly", async () => {
    // After the write, make the re-read fail: the push already landed, so the
    // receipt must say we could not confirm rather than pretending.
    let calls = 0;
    const origData = { ..._itemData };
    _getFails = false;
    // First get = pre-write read; the verify get fails.
    const failOnSecondGet = async () => {
      calls += 1;
      if (calls >= 2) return { ok: false, reason: "api_error" as const };
      return { ok: true as const, value: { id: "item-1", dataCollectionId: "Recipes", data: { ...origData } } };
    };
    const client = await import("@/lib/connectors/wix/client");
    const spy = vi.spyOn(client, "wixGetDataItem").mockImplementation(failOnSecondGet as never);
    try {
      const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
      expect(r.kind).toBe("pushed");
      if (r.kind === "pushed") expect(r.detail).toContain("could not confirm");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("body-section push - idempotent re-push (no duplicate on re-click)", () => {
  it("pushing the same answer block twice writes once; the second push is an honest no-op", async () => {
    const original = edit();
    const first = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(first.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    const snapsAfterFirst = (_stores.get("push-snapshots") ?? []) as unknown[];
    expect(snapsAfterFirst).toHaveLength(1);

    // Re-push the identical card (e.g. a double click, or the operator
    // approves it again from a stale queue view). N41: a SAME-DAY identical
    // re-push is caught by the idempotent publish outbox FIRST (an earlier,
    // cheaper guard than the body-merge already-applied check), so the second
    // push returns the outbox replay receipt. The deeper merge-level
    // already-applied no-op remains the backstop for cross-day duplicates.
    const second = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(second.kind).toBe("pushed");
    if (second.kind === "pushed") {
      expect(second.detail).toContain("already published this exact change");
      expect(hasBannedDash(second.detail)).toBe(false);
    }

    // NO second Wix write and NO second snapshot: nothing changed, so
    // there is nothing to write and nothing new to be able to undo.
    expect(_updateCalls).toHaveLength(1);
    expect((_stores.get("push-snapshots") ?? []) as unknown[]).toHaveLength(1);

    // The body was not duplicated on the live item.
    const occurrences = String(_itemData.content).split(ANSWER_DRAFT).length - 1;
    expect(occurrences).toBe(1);

    // The replay does not count as a "pushed" ledger row (does not eat a
    // daily-cap slot for a push that changed nothing).
    const ledger = (_stores.get("push-ledger") ?? []) as Array<{ result: string; detail: string | null }>;
    const replayRow = ledger.find((e) => (e.detail ?? "").includes("outbox_idempotent_replay"));
    expect(replayRow).toBeDefined();
    expect(replayRow!.result).toBe("push_failed");
  });

  it("a dry-run re-push of an already-applied section reports the no-op with zero side effects", async () => {
    const original = edit();
    const first = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(first.kind).toBe("pushed");
    const ledgerAfterFirst = ((_stores.get("push-ledger") ?? []) as unknown[]).length;
    const snapsAfterFirst = ((_stores.get("push-snapshots") ?? []) as unknown[]).length;

    const dry = await executePush({ tenantId: "tenant-iranopedia", edit: original, dryRun: true });
    expect(dry.kind).toBe("dry_run");
    if (dry.kind === "dry_run") {
      expect(dry.detail).toContain("would make no change");
      expect(hasBannedDash(dry.detail)).toBe(false);
    }
    expect(_updateCalls).toHaveLength(1); // still just the one real write
    expect(((_stores.get("push-ledger") ?? []) as unknown[]).length).toBe(ledgerAfterFirst); // no new row
    expect(((_stores.get("push-snapshots") ?? []) as unknown[]).length).toBe(snapsAfterFirst);
  });

  it("add_faq re-push does not stack a second FAQ section either", async () => {
    const faqDraft = "Frequently asked questions\nHow long does koobideh take? About 20 minutes on the grill.";
    const faqEdit = edit({ action_type: "add_faq" as RecommendedEditRow["action_type"], proposed_text: faqDraft });
    const first = await executePush({ tenantId: "tenant-iranopedia", edit: faqEdit });
    expect(first.kind).toBe("pushed");
    const second = await executePush({ tenantId: "tenant-iranopedia", edit: faqEdit });
    expect(second.kind).toBe("pushed");
    expect(_updateCalls).toHaveLength(1);
    const occurrences = String(_itemData.content).split("How long does koobideh take?").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("body-section push - rollback restores the prior body", () => {
  it("buildRevertEdit targets the snapshot field and executePush restores the exact prior value", async () => {
    // 1. Push the body change.
    const original = edit();
    const push = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(push.kind).toBe("pushed");
    expect(String(_itemData.content).startsWith(ANSWER_DRAFT)).toBe(true);

    // 2. Build the revert from the captured snapshot.
    const snap = await findLatestSnapshotForEdit("tenant-iranopedia", original.id);
    expect(snap).not.toBeNull();
    const revert = buildRevertEdit(snap!, original, new Date());
    expect(revert.ok).toBe(true);
    if (!revert.ok) return;
    // The revert is field-targeted so it can NEVER re-run the merge path.
    expect(revert.edit.target_element_key).toBe("field:content");

    // 3. Ship the revert through the same push path.
    const restore = await executePush({ tenantId: "tenant-iranopedia", edit: revert.edit });
    expect(restore.kind).toBe("pushed");
    expect(_itemData.content).toBe(ORIGINAL_BODY);
  });

  it("a revert still restores when the prior body was much shorter than the merged value", async () => {
    // Tiny original body + big draft: the restore shrinks the live value by
    // far more than 80 percent, which the shrink heuristic would normally
    // refuse. A snapshot revert is exempt from that heuristic only.
    const tinyBody = "Short intro.";
    _itemData = { slug: "kabob", content: tinyBody };
    const bigDraft = ("Koobideh kabob details. ".repeat(40)).trim();
    const original = edit({ proposed_text: bigDraft });
    const push = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(push.kind).toBe("pushed");

    const snap = await findLatestSnapshotForEdit("tenant-iranopedia", original.id);
    const revert = buildRevertEdit(snap!, original, new Date());
    expect(revert.ok).toBe(true);
    if (!revert.ok) return;
    const restore = await executePush({ tenantId: "tenant-iranopedia", edit: revert.edit });
    expect(restore.kind).toBe("pushed");
    expect(_itemData.content).toBe(tinyBody);
  });

  it("a RICOS body revert restores the exact prior STRUCTURE (object, not a JSON string)", async () => {
    const ricos = {
      type: "DOC",
      nodes: [
        {
          type: "PARAGRAPH",
          id: "orig-1",
          nodes: [{ type: "TEXT", id: "", nodes: [], textData: { text: "Existing paragraph.", decorations: [] } }],
          paragraphData: {},
        },
      ],
    };
    _bodyResolved = { entry: _urlMapEntry!, bodyField: { key: "richContent", kind: "ricos" } };
    _itemData = { slug: "kabob", richContent: ricos };

    const original = edit();
    const push = await executePush({ tenantId: "tenant-iranopedia", edit: original });
    expect(push.kind).toBe("pushed");
    expect((_itemData.richContent as { nodes: unknown[] }).nodes).toHaveLength(2);

    const snap = await findLatestSnapshotForEdit("tenant-iranopedia", original.id);
    const revert = buildRevertEdit(snap!, original, new Date());
    expect(revert.ok).toBe(true);
    if (!revert.ok) return;
    const restore = await executePush({ tenantId: "tenant-iranopedia", edit: revert.edit });
    expect(restore.kind).toBe("pushed");
    // Restored as a real object with the original single node.
    expect(_itemData.richContent).toEqual(ricos);
  });

  it("an empty prior body refuses to build a revert (blanking needs a human)", async () => {
    const snap = {
      id: "s1", tenant_id: "tenant-iranopedia", edit_id: "edit-body-1", target_url: PAGE_URL,
      dataCollectionId: "Recipes", dataItemId: "item-1", field: "content",
      previous_text: "   ", captured_at: "2026-07-01T00:00:00Z",
    };
    const revert = buildRevertEdit(snap, edit(), new Date());
    expect(revert.ok).toBe(false);
  });
});

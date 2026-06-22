/**
 * 2026-06-11 (night shift, #82/A#29) — pre-push snapshots + revert.
 * Pins: executePush captures the previous field value BEFORE writing
 * (fail-closed when the capture can't persist); buildRevertEdit
 * restores via a synthetic edit through the SAME push path; empty
 * previous values refuse (deletion-shaped).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const _stores = new Map<string, unknown[]>();
let _failSnapshotWrite = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => _stores.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    if (name === "push-snapshots" && _failSnapshotWrite) {
      throw new Error("disk full");
    }
    _stores.set(name, data);
  },
}));

let _tenant: Record<string, unknown> | null = null;
vi.mock("@/domains/tenants/store", () => ({ getTenant: async () => _tenant }));

let _urlMapEntry: Record<string, unknown> | null = null;
vi.mock("@/lib/connectors/wix/url-map", () => ({
  resolveWixItemForUrl: async () => _urlMapEntry,
}));

let _updateCalls: Array<Record<string, unknown>> = [];
vi.mock("@/lib/connectors/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/wix/client")>();
  return {
    ...actual,
    wixQueryDataItems: async () => ({
      ok: true,
      value: [{ id: "item-1", dataCollectionId: "col", data: { description: "the original text" } }],
    }),
    // The field route now fetches the exact item by id (get-by-id).
    wixGetDataItem: async () => ({
      ok: true,
      value: { id: "item-1", dataCollectionId: "col", data: { description: "the original text" } },
    }),
    wixUpdateDataItem: async (args: Record<string, unknown>) => {
      _updateCalls.push(args);
      return { ok: true, value: { id: "item-1", dataCollectionId: "col", data: {} } };
    },
    wixInsertDataItem: async () => ({ ok: true, value: { id: "n", dataCollectionId: "col", data: {} } }),
  };
});

import { executePush } from "@/domains/push/push-service";
import {
  buildRevertEdit,
  findLatestSnapshotForEdit,
  type PushSnapshotRow,
} from "@/domains/push/push-snapshots";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function edit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-iranopedia",
    rec_id: "rec-1",
    action_type: "refresh_content" as RecommendedEditRow["action_type"],
    target_url: "https://www.iranopedia.com/famous-iranian-poets",
    target_element_key: "field:description",
    display_label: "Refresh the poets intro",
    current_text: "the original text",
    proposed_text: "A refreshed introduction covering Ferdowsi, Hafez, and Rumi with dates.",
    why: "stale copy",
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
    created_at: "2026-06-11T00:00:00Z",
    updated_at: "2026-06-11T00:00:00Z",
    implementation_status: "accepted",
    ...over,
  } as RecommendedEditRow;
}

beforeEach(() => {
  _stores.clear();
  _failSnapshotWrite = false;
  _updateCalls = [];
  _tenant = { id: "tenant-iranopedia", publish_target: "wix_cms" };
  _urlMapEntry = {
    url: "https://www.iranopedia.com/famous-iranian-poets",
    dataCollectionId: "col",
    dataItemId: "item-1",
    slugField: "slug",
    label: null,
    syncedAt: "2026-06-11T00:00:00Z",
  };
});

describe("pre-push snapshot capture", () => {
  it("captures the previous field value BEFORE the write", async () => {
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("pushed");
    const snaps = _stores.get("push-snapshots") as PushSnapshotRow[];
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.previous_text).toBe("the original text");
    expect(snaps[0]!.field).toBe("description");
    expect(snaps[0]!.edit_id).toBe("edit-1");
  });

  it("FAIL-CLOSED: capture failure refuses the push (live site untouched)", async () => {
    _failSnapshotWrite = true;
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.reason).toContain("pre-push snapshot");
    expect(_updateCalls).toHaveLength(0); // never reached the write
  });
});

describe("revert", () => {
  it("buildRevertEdit restores the previous text through a synthetic edit", async () => {
    await executePush({ tenantId: "tenant-iranopedia", edit: edit() });
    const snap = await findLatestSnapshotForEdit("tenant-iranopedia", "edit-1");
    expect(snap).not.toBeNull();
    const revert = buildRevertEdit(snap!, edit(), new Date("2026-06-11T06:00:00Z"));
    expect(revert.ok).toBe(true);
    if (!revert.ok) return;
    expect(revert.edit.proposed_text).toBe("the original text");
    expect(revert.edit.id).toBe("edit-1__revert");

    // The revert ships through the SAME push path.
    const r = await executePush({ tenantId: "tenant-iranopedia", edit: revert.edit });
    expect(r.kind).toBe("pushed");
    expect(_updateCalls[1]!.field).toBe("description");
    expect(_updateCalls[1]!.value).toBe("the original text");
  });

  it("refuses deletion-shaped reverts (empty previous value)", () => {
    const snap: PushSnapshotRow = {
      id: "s",
      tenant_id: "t",
      edit_id: "edit-1",
      target_url: "u",
      dataCollectionId: "col",
      dataItemId: "item-1",
      field: "description",
      previous_text: "   ",
      captured_at: "2026-06-11T00:00:00Z",
    };
    const r = buildRevertEdit(snap, edit(), new Date());
    expect(r).toEqual({ ok: false, reason: "empty_previous_value" });
  });
});

/**
 * Phase 5 — push receipt composer tests.
 *
 * Pins the READ-ONLY join (ledger + snapshot + rec → PushReceipt):
 *   • full receipt join (every field from the right store)
 *   • never-pushed (no ledger entry) → null
 *   • before-null (no snapshot) → diff shows "(added)" via before=null
 *   • revertable logic (pushed + non-empty before + not a __revert)
 *   • verify-status mapping (verified_live / pending / unverified / failed)
 *   • tenant-scoped reads (another tenant's ledger row never matches)
 *   • soft-fail (a missing rec/snapshot still yields a coherent receipt)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// In-memory stores, keyed by store name (matches caps.ts / push-snapshots.ts).
const _stores = new Map<string, unknown[]>();
let _throwLedger = false;
let _throwSnapshots = false;
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => {
    if (name === "push-ledger" && _throwLedger) throw new Error("ledger down");
    if (name === "push-snapshots" && _throwSnapshots) throw new Error("snap down");
    return _stores.get(name) ?? [];
  },
  writeStore: async (name: string, data: unknown[]) => {
    _stores.set(name, data);
  },
}));

// Repository: returns the recommended-edit rows we seed. The composer calls
// getRepository().forTenant(tid).getRecommendedEdits().
let _editsByTenant = new Map<string, unknown[]>();
let _throwRepo = false;
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tid: string) => ({
      getRecommendedEdits: async () => {
        if (_throwRepo) throw new Error("repo down");
        return _editsByTenant.get(tid) ?? [];
      },
    }),
  }),
}));

import { loadPushReceipt, deriveVerifyStatus } from "@/domains/push/push-receipt";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const TENANT = "tenant-iranopedia";
const OTHER = "tenant-other";
const EDIT = "rec-1__edit_meta__field:description";

function ledgerRow(over: Record<string, unknown> = {}) {
  return {
    id: "push-1",
    tenant_id: TENANT,
    edit_id: EDIT,
    target_url: "https://www.iranopedia.com/poets",
    adapter: "wix_cms",
    pushed_at: "2026-06-15T10:00:00.000Z",
    day: "2026-06-15",
    result: "pushed",
    detail: 'updated "description" on col/item-1',
    ...over,
  };
}

function snapshotRow(over: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    tenant_id: TENANT,
    edit_id: EDIT,
    target_url: "https://www.iranopedia.com/poets",
    dataCollectionId: "col",
    dataItemId: "item-1",
    field: "description",
    previous_text: "The old meta description.",
    captured_at: "2026-06-15T09:59:00.000Z",
    ...over,
  };
}

function editRow(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: EDIT,
    tenant_id: TENANT,
    rec_id: "rec-1",
    action_type: "edit_meta",
    target_url: "https://www.iranopedia.com/poets",
    target_element_key: "field:description",
    display_label: "Rewrite the poets meta description",
    current_text: "The old meta description.",
    proposed_text: "A richer meta description naming Ferdowsi, Hafez, and Rumi.",
    why: "The page ranks #8 but few click through.",
    evidence: [],
    expected_impact: "Recover lost clicks from search.",
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-15T08:00:00.000Z",
    updated_at: "2026-06-15T10:00:00.000Z",
    implementation_status: "pushed",
    ...over,
  } as RecommendedEditRow;
}

function seed(args: {
  ledger?: unknown[];
  snapshots?: unknown[];
  edits?: Record<string, unknown[]>;
}) {
  _stores.set("push-ledger", args.ledger ?? []);
  _stores.set("push-snapshots", args.snapshots ?? []);
  _editsByTenant = new Map(Object.entries(args.edits ?? {}));
}

beforeEach(() => {
  _stores.clear();
  _editsByTenant = new Map();
  _throwLedger = false;
  _throwSnapshots = false;
  _throwRepo = false;
});

describe("loadPushReceipt — full join", () => {
  it("joins ledger + snapshot + rec into one coherent receipt", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r).not.toBeNull();
    expect(r!.editId).toBe(EDIT);
    expect(r!.url).toBe("https://www.iranopedia.com/poets"); // ledger
    expect(r!.field).toBe("description"); // snapshot
    expect(r!.before).toBe("The old meta description."); // snapshot
    expect(r!.after).toBe(
      "A richer meta description naming Ferdowsi, Hafez, and Rumi.",
    ); // rec
    expect(r!.actionLabel).toBe("Rewrite the poets meta description"); // rec label
    expect(r!.result).toBe("pushed"); // ledger
    expect(r!.pushedAt).toBe("2026-06-15T10:00:00.000Z"); // ledger
    expect(r!.detail).toBe('updated "description" on col/item-1'); // ledger
    expect(r!.verifyStatus).toBe("pending"); // rec status "pushed"
    expect(r!.revertable).toBe(true); // pushed + before non-empty + not __revert
  });

  it("evidence falls back to the rec's why + expected impact (no AEO ref)", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r!.evidence).toContain("The page ranks #8 but few click through.");
    expect(r!.evidence).toContain("Recover lost clicks from search.");
  });

  it("surfaces a white-label AEO evidence line from the rec's evidence array", async () => {
    const aeoEvidence = [
      {
        // tolerant shape: buildAeoEvidenceLines reads `.detail`
        detail:
          "profound_aeo_gap category=poets; ai_answers=12; models=4; own_mentions=0; competitor=RivalSite; competitor_mentions=9; competitor_sov=60%",
      },
    ];
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: {
        [TENANT]: [
          editRow({ evidence: aeoEvidence as unknown as RecommendedEditRow["evidence"] }),
        ],
      },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    // AEO label leads; never names the vendor ("Profound") — white-label.
    expect(r!.evidence.some((l) => /AI answers cite a rival/i.test(l))).toBe(true);
    expect(r!.evidence.join(" ")).not.toMatch(/profound/i);
  });
});

describe("loadPushReceipt — never pushed → null", () => {
  it("returns null when there is no ledger entry for the edit", async () => {
    seed({
      ledger: [], // nothing pushed
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r).toBeNull();
  });
});

describe("loadPushReceipt — before-null → (added)", () => {
  it("before is null when no snapshot exists; revertable is false", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [], // no snapshot → no BEFORE value, no field
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r!.before).toBeNull();
    expect(r!.field).toBeNull();
    // Empty/absent before → not revertable (restoring nothing = deletion).
    expect(r!.revertable).toBe(false);
  });
});

describe("loadPushReceipt — revertable logic", () => {
  it("a __revert edit is itself never revertable", async () => {
    const revertId = `${EDIT}__revert`;
    seed({
      ledger: [ledgerRow({ edit_id: revertId })],
      snapshots: [snapshotRow({ edit_id: revertId })],
      edits: { [TENANT]: [editRow({ id: revertId })] },
    });
    const r = await loadPushReceipt(TENANT, revertId);
    expect(r!.revertable).toBe(false);
  });

  it("a failed push is never revertable", async () => {
    seed({
      ledger: [ledgerRow({ result: "push_failed", detail: "write: 502" })],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow({ implementation_status: "push_failed" })] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r!.result).toBe("push_failed");
    expect(r!.revertable).toBe(false);
  });
});

describe("loadPushReceipt — verify-status mapping", () => {
  it("verified_live rec → verified_live", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow({ implementation_status: "verified_live" })] },
    });
    expect((await loadPushReceipt(TENANT, EDIT))!.verifyStatus).toBe(
      "verified_live",
    );
  });

  it("pushed rec → pending", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow({ implementation_status: "pushed" })] },
    });
    expect((await loadPushReceipt(TENANT, EDIT))!.verifyStatus).toBe("pending");
  });

  it("push_failed ledger → failed (rec status irrelevant)", async () => {
    seed({
      ledger: [ledgerRow({ result: "push_failed" })],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow({ implementation_status: "verified_live" })] },
    });
    expect((await loadPushReceipt(TENANT, EDIT))!.verifyStatus).toBe("failed");
  });

  it("successful push with no rec → pending (ledger says it landed)", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: {}, // rec missing
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r!.verifyStatus).toBe("pending");
    expect(r!.after).toBeNull();
    expect(r!.actionLabel).toBe("Change"); // null-rec fallback
  });

  it("deriveVerifyStatus is pure over the rule set", () => {
    expect(
      deriveVerifyStatus({ result: "push_failed", lifecycleStatus: "verified_live" }),
    ).toBe("failed");
    expect(
      deriveVerifyStatus({ result: "pushed", lifecycleStatus: "verified_live_modified" }),
    ).toBe("verified_live");
    expect(
      deriveVerifyStatus({ result: "pushed", lifecycleStatus: "pushed" }),
    ).toBe("pending");
    expect(
      deriveVerifyStatus({ result: "pushed", lifecycleStatus: "accepted" }),
    ).toBe("pending");
    expect(
      deriveVerifyStatus({ result: "pushed", lifecycleStatus: null }),
    ).toBe("pending");
  });
});

describe("loadPushReceipt — tenant scope", () => {
  it("does not match a ledger row belonging to another tenant", async () => {
    seed({
      ledger: [ledgerRow({ tenant_id: OTHER })], // same edit id, wrong tenant
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r).toBeNull(); // no in-tenant ledger entry
  });

  it("reads only the requested tenant's recommended edits", async () => {
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: {
        [OTHER]: [editRow({ proposed_text: "WRONG TENANT TEXT" })],
        [TENANT]: [editRow()],
      },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r!.after).not.toContain("WRONG TENANT");
  });

  it("picks the newest ledger entry for the (tenant, edit)", async () => {
    seed({
      ledger: [
        ledgerRow({ id: "old", pushed_at: "2026-06-14T10:00:00.000Z", result: "push_failed" }),
        ledgerRow({ id: "new", pushed_at: "2026-06-15T10:00:00.000Z", result: "pushed" }),
      ],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r!.pushedAt).toBe("2026-06-15T10:00:00.000Z");
    expect(r!.result).toBe("pushed");
  });
});

describe("loadPushReceipt — soft-fail", () => {
  it("a missing snapshot still yields a coherent receipt (before/field null)", async () => {
    _throwSnapshots = true;
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r).not.toBeNull();
    expect(r!.before).toBeNull();
    expect(r!.field).toBeNull();
    expect(r!.after).toBe(editRow().proposed_text); // rec still joined
  });

  it("a repo failure still yields a coherent receipt (rec fields null)", async () => {
    _throwRepo = true;
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r).not.toBeNull();
    expect(r!.after).toBeNull();
    expect(r!.evidence).toEqual([]);
    expect(r!.before).toBe("The old meta description."); // snapshot still joined
  });

  it("a ledger read failure returns null (cannot prove a push happened)", async () => {
    _throwLedger = true;
    seed({
      ledger: [ledgerRow()],
      snapshots: [snapshotRow()],
      edits: { [TENANT]: [editRow()] },
    });
    const r = await loadPushReceipt(TENANT, EDIT);
    expect(r).toBeNull();
  });
});

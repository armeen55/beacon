import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * The bundle is an ORCHESTRATOR over executePush. We mock executePush (and the
 * snapshot/revert helpers used only on the rollback path) so we test the
 * all-or-nothing logic precisely. executePush's own rails (Ritz hard-block,
 * caps, snapshot, non-destructive) are covered by their own suites; here we prove
 * the bundle NEVER bypasses them (it only ever calls executePush) and correctly
 * aborts / rolls back. NO Wix, NO network.
 */
const executePushMock = vi.fn();
vi.mock("./push-service", () => ({
  executePush: (...a: unknown[]) => executePushMock(...a),
  RITZ_TENANT_ID: "tenant-ritz-founder",
}));

const findLatestSnapshotForEditMock = vi.fn();
const buildRevertEditMock = vi.fn();
vi.mock("./push-snapshots", () => ({
  findLatestSnapshotForEdit: (...a: unknown[]) => findLatestSnapshotForEditMock(...a),
  buildRevertEdit: (...a: unknown[]) => buildRevertEditMock(...a),
}));

import { executePushBundle } from "./push-bundle";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function edit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: "e-title",
    rec_id: "r-title",
    tenant_id: "t1",
    action_type: "edit_title",
    target_url: "https://x.com/p",
    target_element_key: "field:title",
    display_label: "Title",
    current_text: "Old Title",
    proposed_text: "New Title",
    why: "",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-07-03T00:00:00Z",
    updated_at: "2026-07-03T00:00:00Z",
    implementation_status: "accepted",
    ...over,
  } as RecommendedEditRow;
}

beforeEach(() => {
  executePushMock.mockReset();
  findLatestSnapshotForEditMock.mockReset();
  buildRevertEditMock.mockReset();
});

describe("executePushBundle - single-field byte-identical pin", () => {
  it("a ONE-edit bundle makes EXACTLY one executePush call and returns it verbatim (pin)", async () => {
    const result = { kind: "pushed", adapter: "wix_cms", detail: "updated title" };
    executePushMock.mockResolvedValueOnce(result);
    const out = await executePushBundle({ tenantId: "t1", edits: [edit()] });
    expect(out).toEqual({ kind: "single", result });
    // Exactly one call, and NO dry-run pre-pass (byte-identical to executePush).
    expect(executePushMock).toHaveBeenCalledTimes(1);
    expect(executePushMock).toHaveBeenCalledWith({ tenantId: "t1", edit: edit() }, {});
  });

  it("a one-edit bundle passes a REFUSED result through unchanged", async () => {
    const result = { kind: "refused", reason: "daily push cap reached" };
    executePushMock.mockResolvedValueOnce(result);
    const out = await executePushBundle({ tenantId: "t1", edits: [edit()] });
    expect(out).toEqual({ kind: "single", result });
    expect(executePushMock).toHaveBeenCalledTimes(1);
  });
});

describe("executePushBundle - all-or-nothing multi-field", () => {
  const title = edit({ id: "e-title", action_type: "edit_title", target_element_key: "field:title" });
  const meta = edit({ id: "e-meta", action_type: "edit_meta", target_element_key: "field:metaDescription", proposed_text: "New meta" });
  const schema = edit({ id: "e-schema", action_type: "add_schema", target_element_key: null, proposed_text: "<script>...</script>" });

  it("ALL fields land -> bundled, in ONE receipt, with a real write per field", async () => {
    // Phase 1: 3 dry-runs clean; Phase 2: 3 real pushes land.
    executePushMock
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "would update title" })
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "would update meta" })
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "would apply schema" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "updated title" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "updated meta" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "applied schema" });

    const out = await executePushBundle({ tenantId: "t1", edits: [title, meta, schema] });
    expect(out.kind).toBe("bundled");
    if (out.kind === "bundled") {
      expect(out.committed.map((c) => c.status)).toEqual(["committed", "committed", "committed"]);
      expect(out.receipt).toContain("all 3 changes");
      expect(out.receipt).not.toMatch(/[—–]/);
    }
    // 3 dry-runs + 3 real pushes = 6 calls. NO rollback fired.
    expect(executePushMock).toHaveBeenCalledTimes(6);
    expect(buildRevertEditMock).not.toHaveBeenCalled();
  });

  it("ABORTS before ANY write when one field's dry-run refuses (all-or-nothing)", async () => {
    // Second dry-run (meta) refuses -> bundle aborts, NOTHING is committed.
    executePushMock
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "would update title" })
      .mockResolvedValueOnce({ kind: "refused", reason: "proposed meta description is 200 chars, over the 160 push limit" });

    const out = await executePushBundle({ tenantId: "t1", edits: [title, meta, schema] });
    expect(out.kind).toBe("aborted");
    if (out.kind === "aborted") {
      expect(out.reason).toContain("over the 160 push limit");
      expect(out.outcomes.every((o) => o.status === "aborted")).toBe(true);
      expect(out.receipt).toContain("did not publish anything");
    }
    // Only 2 dry-runs ran; NO real push (a real push would return "pushed", not
    // "dry_run" - the mock proves phase 2 never started).
    expect(executePushMock).toHaveBeenCalledTimes(2);
    // Every call in an abort is a DRY-RUN (side-effect-free) - prove it.
    for (const call of executePushMock.mock.calls) {
      expect((call[0] as { dryRun?: boolean }).dryRun).toBe(true);
    }
  });

  it("ROLLS BACK already-landed fields when a commit fails partway", async () => {
    // Phase 1: all 3 dry-runs clean.
    executePushMock
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "t" })
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "m" })
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "s" })
      // Phase 2: title lands, meta lands, schema FAILS.
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "updated title" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "updated meta" })
      .mockResolvedValueOnce({ kind: "refused", reason: "wix seoData write failed: 500" })
      // Rollback: revert meta, then revert title (reverse order), both land.
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "reverted meta" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "reverted title" });

    findLatestSnapshotForEditMock.mockResolvedValue({
      id: "s", tenant_id: "t1", edit_id: "x", target_url: "https://x.com/p",
      dataCollectionId: "C", dataItemId: "i1", field: "title",
      previous_text: "Old", captured_at: "2026-07-03T10:00:00Z",
    });
    buildRevertEditMock.mockImplementation((_snap, orig) => ({ ok: true, edit: { ...orig, id: `${orig.id}__revert` } }));

    const out = await executePushBundle({ tenantId: "t1", edits: [title, meta, schema] });
    expect(out.kind).toBe("rolled_back");
    if (out.kind === "rolled_back") {
      expect(out.reason).toContain("wix seoData write failed");
      // title + meta were landed then rolled_back; schema failed.
      const byId = Object.fromEntries(out.outcomes.map((o) => [o.editId, o.status]));
      expect(byId["e-title"]).toBe("rolled_back");
      expect(byId["e-meta"]).toBe("rolled_back");
      expect(byId["e-schema"]).toBe("failed");
      expect(out.receipt).toContain("undid the 2 changes");
      expect(out.receipt).not.toMatch(/[—–]/);
    }
    // 3 dry + 3 commit + 2 revert = 8 calls.
    expect(executePushMock).toHaveBeenCalledTimes(8);
    expect(buildRevertEditMock).toHaveBeenCalledTimes(2);
  });

  it("RITZ: the first dry-run returns dev_note -> bundle aborts, NOTHING committed (pin)", async () => {
    // executePush returns dev_note for Ritz on EVERY call (its hard-block).
    executePushMock.mockResolvedValue({
      kind: "dev_note",
      note: "ticket",
      reason: "Ritz is advise-mode only (Invariant 2) — exported as a dev ticket",
    });
    const out = await executePushBundle({
      tenantId: "tenant-ritz-founder",
      edits: [title, meta],
    });
    expect(out.kind).toBe("aborted");
    if (out.kind === "aborted") {
      expect(out.reason).toContain("advise-mode only");
    }
    // Only the first dry-run ran; no commit ever started.
    expect(executePushMock).toHaveBeenCalledTimes(1);
    expect((executePushMock.mock.calls[0]![0] as { dryRun?: boolean }).dryRun).toBe(true);
  });

  it("CAP reached: a dry-run cap refusal aborts the whole bundle before any write (pin)", async () => {
    executePushMock
      .mockResolvedValueOnce({ kind: "refused", reason: "daily push cap reached (10/10 for 2026-07-03)" });
    const out = await executePushBundle({ tenantId: "t1", edits: [title, meta] });
    expect(out.kind).toBe("aborted");
    if (out.kind === "aborted") expect(out.reason).toContain("daily push cap reached");
    expect(executePushMock).toHaveBeenCalledTimes(1);
  });

  it("an empty bundle aborts plainly with no push calls", async () => {
    const out = await executePushBundle({ tenantId: "t1", edits: [] });
    expect(out.kind).toBe("aborted");
    expect(executePushMock).not.toHaveBeenCalled();
  });

  it("a revert that itself fails is reported honestly, never throws", async () => {
    executePushMock
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "t" })
      .mockResolvedValueOnce({ kind: "dry_run", adapter: "wix_cms", detail: "m" })
      .mockResolvedValueOnce({ kind: "pushed", adapter: "wix_cms", detail: "updated title" })
      .mockResolvedValueOnce({ kind: "refused", reason: "wix write failed: 500" })
      // Rollback of title FAILS.
      .mockResolvedValueOnce({ kind: "refused", reason: "wix write failed again" });
    findLatestSnapshotForEditMock.mockResolvedValue({
      id: "s", tenant_id: "t1", edit_id: "e-title", target_url: "https://x.com/p",
      dataCollectionId: "C", dataItemId: "i1", field: "title",
      previous_text: "Old", captured_at: "2026-07-03T10:00:00Z",
    });
    buildRevertEditMock.mockImplementation((_snap, orig) => ({ ok: true, edit: { ...orig, id: `${orig.id}__revert` } }));

    const out = await executePushBundle({ tenantId: "t1", edits: [title, meta] });
    expect(out.kind).toBe("rolled_back");
    if (out.kind === "rolled_back") {
      const titleOutcome = out.outcomes.find((o) => o.editId === "e-title");
      // Title landed but could NOT be undone -> reported plainly.
      expect(titleOutcome!.detail).toContain("could not be undone");
    }
  });
});

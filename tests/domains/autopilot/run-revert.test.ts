/**
 * Revert executor + nightly revert pass (2026-07-02, BEACON 500 item 11).
 *
 * Injected deps only (no real push, no Supabase, no filesystem). Pins:
 *   - the happy path: snapshot -> revert edit -> push -> ADDITIVE note on the
 *     original row -> the revert recorded as its own shipped change carrying
 *     the lesson -> an autopilot receipt with kind "revert",
 *   - idempotency (note marker AND existing revert record both stop a second
 *     revert before any push),
 *   - the Ritz hard-block (early refuse + the executePush dev_note backstop
 *     writes nothing),
 *   - refused pushes leave measurement history untouched,
 *   - dry-run stops before every side effect,
 *   - the nightly pass is bounded to 2 reverts and only auto-reverts what the
 *     policy pre-approved.
 */

import { describe, it, expect, vi } from "vitest";

import {
  runRevertForProofRecord,
  runNightlyRevertPass,
  resolveRevertSource,
  hasRevertNote,
  findExistingRevertRecord,
  REVERTED_NOTE_MARKER,
  type RevertRunDeps,
} from "@/domains/autopilot/run-revert";
import { DEFAULT_AUTOPILOT_CONFIG } from "@/domains/autopilot/autopilot-policy";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PushSnapshotRow } from "@/domains/push/push-snapshots";

const TENANT = "tenant-iranopedia";
const NOW = new Date("2026-07-02T09:00:00Z");
const LESSON =
  "That title change hurt the click rate, so I put the old title back on July 2. Lesson: this style of title is not working on pages like this.";

function makeWindow(day: 7 | 14 | 28, ran: boolean, liftOverrides: Record<string, number> = {}) {
  return {
    day,
    checkOn: `2026-06-${10 + day}`,
    ran,
    treatedDelta: 0,
    controlDelta: 0,
    adjustedLift: 0,
    treatedCtrDelta: 0,
    controlCtrDelta: 0,
    adjustedCtrLift: 0,
    treatedPosDelta: 0,
    controlPosDelta: 0,
    adjustedPosLift: 0,
    controlsUsed: ran ? 3 : 0,
    treatedPostImpressions: ran ? 500 : 0,
    ...liftOverrides,
  };
}

function makeRecord(partial: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "/cities::2026-06-15",
    page: "https://www.iranopedia.com/cities",
    path: "/cities",
    actionType: "edit_title",
    before: "Old title",
    after: "New title",
    shippedAt: "2026-06-15T08:00:00.000Z",
    baseline: { clicks: 100, impressions: 4000, ctr: 0.025, position: 6, windowDays: 28 },
    targetQueries: ["cities in iran"],
    controlPages: ["https://www.iranopedia.com/a", "https://www.iranopedia.com/b"],
    windows: [
      makeWindow(7, true, { adjustedCtrLift: -0.005 }),
      makeWindow(14, true, { adjustedCtrLift: -0.006 }),
      makeWindow(28, false),
    ],
    verdict: "lost",
    confidence: "medium",
    measuredAt: "2026-06-30T00:00:00.000Z",
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: "2026-06-15T08:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    ...partial,
  };
}

function makeEdit(
  partial: Partial<Omit<RecommendedEditRow, "action_type">> & { action_type?: string } = {},
): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: TENANT,
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: "https://www.iranopedia.com/cities",
    target_element_key: "field:title",
    display_label: "Title update",
    current_text: "Old title",
    proposed_text: "New title",
    why: "test",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T08:00:00.000Z",
    implementation_status: "pushed",
    ...partial,
  } as unknown as RecommendedEditRow;
}

function makeSnapshot(partial: Partial<PushSnapshotRow> = {}): PushSnapshotRow {
  return {
    id: "snap-1",
    tenant_id: TENANT,
    edit_id: "edit-1",
    target_url: "https://www.iranopedia.com/cities",
    dataCollectionId: "Pages",
    dataItemId: "item-1",
    field: "title",
    previous_text: "Old title",
    captured_at: "2026-06-15T08:00:00.000Z",
    ...partial,
  };
}

function makeDeps(overrides: Partial<RevertRunDeps> = {}) {
  const spies = {
    push: vi.fn(async (_args: { tenantId: string; edit: RecommendedEditRow; dryRun?: boolean }) => ({
      kind: "pushed" as const,
      adapter: "wix_cms" as const,
      detail: "updated field title",
    })),
    appendNote: vi.fn(async (_recordId: string, _note: string) => undefined),
    autoRecord: vi.fn(
      async (_args: {
        tenantId: string;
        pageUrl: string;
        actionType: string;
        targetQuery?: string | null;
        verifiedLive?: boolean;
        notes?: string;
      }) => ({ recorded: true, reason: "recorded" }),
    ),
    appendReceipt: vi.fn(async (_receipt: Parameters<RevertRunDeps["appendReceipt"]>[0]) => undefined),
    loadShippedChanges: vi.fn(async () => [makeRecord()]),
  };
  const deps: Partial<RevertRunDeps> = {
    loadShippedChanges: spies.loadShippedChanges,
    appendNote: spies.appendNote,
    loadEdits: async () => [makeEdit()],
    findSnapshot: async () => makeSnapshot(),
    push: spies.push,
    probeLive: async () => ({ kind: "found" }),
    autoRecord: spies.autoRecord,
    appendReceipt: spies.appendReceipt,
    readLatestGscDate: async () => "2026-06-30",
    now: () => NOW,
    ...overrides,
  };
  return { deps, spies };
}

const baseArgs = {
  tenantId: TENANT,
  recordId: "/cities::2026-06-15",
  lessonLine: LESSON,
  source: "operator" as const,
};

describe("runRevertForProofRecord", () => {
  it("happy path: pushes the old value, notes the original row, records the revert + receipt", async () => {
    const { deps, spies } = makeDeps();
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.ok).toBe(true);
    expect(res.code).toBe("reverted");

    // The push carried the snapshot's previous value as the revert edit.
    expect(spies.push).toHaveBeenCalledTimes(1);
    const pushed = spies.push.mock.calls[0][0];
    expect(pushed.tenantId).toBe(TENANT);
    expect(pushed.edit.id).toBe("edit-1__revert");
    expect(pushed.edit.proposed_text).toBe("Old title");

    // ADDITIVE note on the original row - never a verdict/window mutation.
    expect(spies.appendNote).toHaveBeenCalledTimes(1);
    expect(spies.appendNote.mock.calls[0][0]).toBe("/cities::2026-06-15");
    expect(spies.appendNote.mock.calls[0][1]).toContain(REVERTED_NOTE_MARKER);

    // The revert is its own shipped change, lesson as notes.
    expect(spies.autoRecord).toHaveBeenCalledTimes(1);
    const recorded = spies.autoRecord.mock.calls[0][0];
    expect(recorded.actionType).toBe("revert_edit_title");
    expect(recorded.notes).toBe(LESSON);
    expect(recorded.verifiedLive).toBe(true);

    // Autopilot receipt with kind "revert" (never eats the ship budget).
    expect(spies.appendReceipt).toHaveBeenCalledTimes(1);
    const receipt = spies.appendReceipt.mock.calls[0][0];
    expect(receipt.kind).toBe("revert");
    expect(receipt.result).toBe("pushed");
    expect(receipt.receiptLine).toBe(LESSON);
    expect(receipt.receiptLine).not.toMatch(/[\u2013\u2014]/);
  });

  it("Ritz is refused before anything loads (never weakened)", async () => {
    const { deps, spies } = makeDeps();
    const res = await runRevertForProofRecord(
      { ...baseArgs, tenantId: "tenant-ritz-founder" },
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("advise_only");
    expect(spies.loadShippedChanges).not.toHaveBeenCalled();
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("executePush dev_note (advise-mode backstop) writes NO bookkeeping", async () => {
    const { deps, spies } = makeDeps({
      push: vi.fn(async () => ({
        kind: "dev_note" as const,
        note: "ticket",
        reason: "Ritz is advise-mode only (Invariant 2)",
      })),
    });
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("advise_only");
    expect(spies.appendNote).not.toHaveBeenCalled();
    expect(spies.autoRecord).not.toHaveBeenCalled();
    // A failure receipt IS written so the attempt is visible.
    expect(spies.appendReceipt).toHaveBeenCalledTimes(1);
    expect(spies.appendReceipt.mock.calls[0][0].result).toBe("failed");
  });

  it("idempotent: a note-marked row is never reverted twice", async () => {
    const { deps, spies } = makeDeps({
      loadShippedChanges: async () => [
        makeRecord({ notes: `${REVERTED_NOTE_MARKER} 2026-07-01.` }),
      ],
    });
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("already_reverted");
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("idempotent: an existing revert record in the ledger also stops it", async () => {
    const { deps, spies } = makeDeps({
      loadShippedChanges: async () => [
        makeRecord(),
        makeRecord({
          id: "/cities::2026-07-01",
          actionType: "revert_edit_title",
          shippedAt: "2026-07-01T08:00:00.000Z",
        }),
      ],
    });
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.code).toBe("already_reverted");
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("a revert record itself is never re-reverted", async () => {
    const { deps, spies } = makeDeps({
      loadShippedChanges: async () => [
        makeRecord({ id: "/cities::2026-07-01", actionType: "revert_edit_title" }),
      ],
    });
    const res = await runRevertForProofRecord(
      { ...baseArgs, recordId: "/cities::2026-07-01" },
      deps,
    );
    expect(res.code).toBe("already_reverted");
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("unknown record id refuses plainly", async () => {
    const { deps } = makeDeps();
    const res = await runRevertForProofRecord({ ...baseArgs, recordId: "/nope::x" }, deps);
    expect(res.code).toBe("record_not_found");
  });

  it("no snapshot on file = no push, hand-rollback message", async () => {
    const { deps, spies } = makeDeps({ findSnapshot: async () => null });
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.code).toBe("no_snapshot");
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("an empty previous value is deletion-shaped and never ships", async () => {
    const { deps, spies } = makeDeps({
      findSnapshot: async () => makeSnapshot({ previous_text: "   " }),
    });
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.code).toBe("no_snapshot"); // skipped at resolution
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("a refused push writes a failed receipt and NO note / proof record", async () => {
    const { deps, spies } = makeDeps({
      push: vi.fn(async () => ({ kind: "refused" as const, reason: "daily cap reached" })),
    });
    const res = await runRevertForProofRecord(baseArgs, deps);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("refused");
    expect(res.detail).toContain("daily cap");
    expect(spies.appendNote).not.toHaveBeenCalled();
    expect(spies.autoRecord).not.toHaveBeenCalled();
    expect(spies.appendReceipt).toHaveBeenCalledTimes(1);
    const receipt = spies.appendReceipt.mock.calls[0][0];
    expect(receipt.result).toBe("failed");
    expect(receipt.kind).toBe("revert");
    expect(receipt.receiptLine).toContain("stopped");
  });

  it("dry run exercises the push rails and stops before every side effect", async () => {
    const { deps, spies } = makeDeps({
      push: vi.fn(async (args: { dryRun?: boolean }) => {
        expect(args.dryRun).toBe(true);
        return { kind: "dry_run" as const, adapter: "wix_cms" as const, detail: "would update title" };
      }),
    });
    const res = await runRevertForProofRecord({ ...baseArgs, dryRun: true }, deps);
    expect(res.ok).toBe(true);
    expect(res.code).toBe("dry_run");
    expect(spies.appendNote).not.toHaveBeenCalled();
    expect(spies.autoRecord).not.toHaveBeenCalled();
    expect(spies.appendReceipt).not.toHaveBeenCalled();
  });
});

describe("resolveRevertSource", () => {
  it("prefers the edit whose action type matches the record", async () => {
    const { deps } = makeDeps({
      loadEdits: async () => [
        makeEdit({ id: "edit-meta", action_type: "edit_meta" }),
        makeEdit({ id: "edit-title", action_type: "edit_title" }),
      ],
      findSnapshot: async (_t, editId) => makeSnapshot({ edit_id: editId }),
    });
    const source = await resolveRevertSource(TENANT, makeRecord(), deps);
    expect(source?.edit.id).toBe("edit-title");
  });

  it("returns null when no edit targets the record's page", async () => {
    const { deps } = makeDeps({
      loadEdits: async () => [
        makeEdit({ target_url: "https://www.iranopedia.com/other" }),
      ],
    });
    expect(await resolveRevertSource(TENANT, makeRecord(), deps)).toBeNull();
  });

  it("rejects a mismatched-type snapshot captured far from the ship date", async () => {
    const { deps } = makeDeps({
      loadEdits: async () => [makeEdit({ action_type: "edit_meta" })],
      findSnapshot: async () =>
        makeSnapshot({ captured_at: "2026-01-01T00:00:00.000Z" }),
    });
    expect(await resolveRevertSource(TENANT, makeRecord(), deps)).toBeNull();
  });
});

describe("runNightlyRevertPass", () => {
  const ARMED = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true };

  function negativeRecord(path: string, id: string): ShippedChangeRecord {
    // Distinct ship times so the oldest-first ordering is deterministic.
    const shipDay = id.split("::")[1] ?? "2026-06-15";
    return makeRecord({
      id,
      path,
      page: `https://www.iranopedia.com${path}`,
      shippedAt: `${shipDay}T08:00:00.000Z`,
      windows: [
        makeWindow(7, true, { adjustedCtrLift: -0.004 }),
        makeWindow(14, true, { adjustedCtrLift: -0.005 }),
        makeWindow(28, false),
      ],
      verdict: "lost",
    });
  }

  function nightlyDeps(records: ShippedChangeRecord[]) {
    return makeDeps({
      loadShippedChanges: async () => records,
      loadEdits: async () =>
        records.map((r) =>
          makeEdit({
            id: `edit-${r.id}`,
            target_url: r.page,
            action_type: r.actionType,
          }),
        ),
      findSnapshot: async (_t, editId) => makeSnapshot({ edit_id: editId }),
    });
  }

  it("auto-reverts settled negatives, bounded to 2 per night", async () => {
    const records = [
      negativeRecord("/a", "/a::2026-06-10"),
      negativeRecord("/b", "/b::2026-06-12"),
      negativeRecord("/c", "/c::2026-06-14"),
    ];
    const { deps, spies } = nightlyDeps(records);
    const summary = await runNightlyRevertPass(TENANT, ARMED, NOW, deps);
    expect(summary.reverted).toBe(2);
    expect(summary.receiptLines).toHaveLength(2);
    expect(spies.push).toHaveBeenCalledTimes(2);
    // Oldest ship first: /a then /b.
    expect(spies.push.mock.calls[0][0].edit.id).toContain("/a::2026-06-10");
    expect(spies.push.mock.calls[1][0].edit.id).toContain("/b::2026-06-12");
  });

  it("a 7-day-only negative is never auto-reverted (proposal territory)", async () => {
    const early = makeRecord({
      id: "/early::2026-06-28",
      path: "/early",
      page: "https://www.iranopedia.com/early",
      shippedAt: "2026-06-28T08:00:00.000Z",
      windows: [
        makeWindow(7, true, { adjustedCtrLift: -0.004 }),
        makeWindow(14, false),
        makeWindow(28, false),
      ],
      verdict: "lost",
    });
    const { deps, spies } = nightlyDeps([early]);
    const summary = await runNightlyRevertPass(TENANT, ARMED, NOW, deps);
    expect(summary.reverted).toBe(0);
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("a positive or measuring row is never considered", async () => {
    const won = makeRecord({ verdict: "won" });
    const { deps, spies } = nightlyDeps([won]);
    const summary = await runNightlyRevertPass(TENANT, ARMED, NOW, deps);
    expect(summary.considered).toBe(0);
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("a lever outside the allowlist stays a proposal (no auto push)", async () => {
    const records = [negativeRecord("/a", "/a::2026-06-10")];
    const { deps, spies } = nightlyDeps(records);
    const summary = await runNightlyRevertPass(
      TENANT,
      { ...ARMED, leverAllowlist: ["edit_meta"] },
      NOW,
      deps,
    );
    expect(summary.autoEligible).toBe(0);
    expect(summary.reverted).toBe(0);
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("overlapping same-page changes weaken attribution and block auto-revert", async () => {
    // Two records on the SAME path shipped 5 days apart: both attribution-limited.
    const a = negativeRecord("/same", "/same::2026-06-10");
    const b = negativeRecord("/same", "/same::2026-06-15");
    b.shippedAt = "2026-06-15T08:00:00.000Z";
    const { deps, spies } = nightlyDeps([a, b]);
    const summary = await runNightlyRevertPass(TENANT, ARMED, NOW, deps);
    expect(summary.reverted).toBe(0);
    expect(spies.push).not.toHaveBeenCalled();
  });

  it("already-restored rows are skipped before any snapshot lookup", async () => {
    const done = negativeRecord("/a", "/a::2026-06-10");
    done.notes = `${REVERTED_NOTE_MARKER} 2026-07-01.`;
    const findSnapshot = vi.fn(async () => makeSnapshot());
    const { deps, spies } = makeDeps({
      loadShippedChanges: async () => [done],
      findSnapshot,
    });
    const summary = await runNightlyRevertPass(TENANT, ARMED, NOW, deps);
    expect(summary.considered).toBe(0);
    expect(summary.reverted).toBe(0);
    expect(findSnapshot).not.toHaveBeenCalled();
    expect(spies.push).not.toHaveBeenCalled();
  });
});

describe("pure helpers", () => {
  it("hasRevertNote detects the marker only", () => {
    expect(hasRevertNote({ notes: `${REVERTED_NOTE_MARKER} 2026-07-01.` })).toBe(true);
    expect(hasRevertNote({ notes: "manual wix edit" })).toBe(false);
    expect(hasRevertNote({ notes: null })).toBe(false);
  });

  it("findExistingRevertRecord matches lever + path + later ship", () => {
    const original = makeRecord();
    const revert = makeRecord({
      id: "/cities::2026-07-01",
      actionType: "revert_edit_title",
      shippedAt: "2026-07-01T08:00:00.000Z",
    });
    const unrelated = makeRecord({
      id: "/other::2026-07-01",
      path: "/other",
      actionType: "revert_edit_title",
      shippedAt: "2026-07-01T08:00:00.000Z",
    });
    expect(findExistingRevertRecord([original, revert], original)?.id).toBe(
      "/cities::2026-07-01",
    );
    expect(findExistingRevertRecord([original, unrelated], original)).toBeNull();
  });
});

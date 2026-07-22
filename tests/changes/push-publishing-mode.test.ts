/**
 * Publishing authority — the armed-publishing behavior layer (Core 100K Phase 6).
 *
 * Merges tests/domains/push/publishing-mode.test.ts + publishing-mode-store.test.ts.
 * This is the surviving behavioral pin for "nothing goes live without approval"
 * (static tripwire: tests/architecture/14 + 14b):
 *   • default (staged) NEVER publishes on Accept;
 *   • armed + safe + mapped + live target → one-click live publish;
 *   • armed REFUSES rejected / low / needs-more-evidence (QA !approve);
 *   • a non-live target (Ritz dev_note / git_pr) can never one-click publish;
 *   • arming requires connector + mapping + dry-run + confirmed rails;
 *   • store default (no record) → staged; fail-safe read errors → staged, NEVER armed;
 *   • TENANT ISOLATION — arming tenant A never arms tenant B.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "no_env" | "no_table" | "read_error",
  rows: [] as Array<Record<string, unknown>>,
  tenant: "tenant-default",
  files: new Map<string, unknown[]>(),
}));

const undef = { code: "42P01", message: "undefined_table" };
const otherErr = { code: "57014", message: "statement timeout" };

function fakeAdmin() {
  return {
    from(_table: string) {
      return {
        select(_cols?: string) {
          return {
            eq(col: string, val: unknown) {
              return {
                maybeSingle: async () => {
                  if (mockState.mode === "no_table") return { data: null, error: undef };
                  if (mockState.mode === "read_error") return { data: null, error: otherErr };
                  const row = mockState.rows.find((r) => r[col] === val) ?? null;
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        upsert(row: Record<string, unknown>, opts?: { onConflict?: string }) {
          if (mockState.mode === "no_table") return Promise.resolve({ error: undef });
          const key = opts?.onConflict ?? "tenant_id";
          const idx = mockState.rows.findIndex((r) => r[key] === row[key]);
          if (idx >= 0) mockState.rows[idx] = { ...row };
          else mockState.rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (mockState.mode === "no_env") throw new Error("no supabase env");
    return fakeAdmin();
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => mockState.tenant,
}));

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => mockState.files.get(name) ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    mockState.files.set(name, data);
  },
}));

import {
  decideAcceptDisposition,
  isOneClickPublish,
  evaluateArmingPreconditions,
  type AcceptDispositionInput,
  type PublishingMode,
} from "@/domains/push/publishing-mode";
import {
  getPublishingMode,
  setPublishingMode,
} from "@/domains/push/publishing-mode-store";
import type { RecPushReadiness } from "@/domains/recommendations/recommendation-qa";

beforeEach(() => {
  mockState.mode = "ok";
  mockState.rows = [];
  mockState.tenant = "tenant-default";
  mockState.files = new Map();
});

function input(o: Partial<AcceptDispositionInput> & { approve?: boolean; pushReadiness?: RecPushReadiness }): AcceptDispositionInput {
  return {
    mode: o.mode ?? "armed",
    canPublish: o.canPublish ?? true,
    publishTarget: o.publishTarget ?? "wix_cms",
    isSuggestion: o.isSuggestion ?? true,
    qaVerdict:
      o.qaVerdict !== undefined
        ? o.qaVerdict
        : { approve: o.approve ?? true, pushReadiness: o.pushReadiness ?? "paste_ready" },
  };
}

describe("decideAcceptDisposition — the per-site one-click gate", () => {
  it("DEFAULT (staged) never publishes on Accept — even a perfect rec stages", () => {
    expect(decideAcceptDisposition(input({ mode: "staged" }))).toBe("stage");
  });

  it("ARMED + safe + mapped field edit + live target → publish_live", () => {
    expect(decideAcceptDisposition(input({ mode: "armed" }))).toBe("publish_live");
    expect(isOneClickPublish(input({ mode: "armed" }))).toBe(true);
  });

  it("ARMED REFUSES an unapproved rec (QA !approve, incl. low / needs-more-evidence) → review_only", () => {
    expect(decideAcceptDisposition(input({ approve: false }))).toBe("review_only");
    expect(decideAcceptDisposition(input({ approve: false, pushReadiness: "paste_ready" }))).toBe(
      "review_only",
    );
  });

  it("ARMED routes a manual build (new page) to paste_ready, not a live write", () => {
    expect(decideAcceptDisposition(input({ pushReadiness: "manual" }))).toBe("paste_ready");
  });

  it("ARMED refuses a non-publishable directive (review_only readiness) → review_only", () => {
    expect(decideAcceptDisposition(input({ pushReadiness: "review_only" }))).toBe("review_only");
  });

  it("a non-live target (Ritz dev_note) can NEVER one-click publish → stage", () => {
    expect(decideAcceptDisposition(input({ publishTarget: "dev_note" }))).toBe("stage");
    expect(decideAcceptDisposition(input({ publishTarget: "git_pr" }))).toBe("stage");
  });

  it("no publish permission → stage even when armed", () => {
    expect(decideAcceptDisposition(input({ canPublish: false }))).toBe("stage");
  });

  it("DISARMING (staged again) returns to two-click → stage", () => {
    const armed: PublishingMode = "armed";
    const staged: PublishingMode = "staged";
    expect(decideAcceptDisposition(input({ mode: armed }))).toBe("publish_live");
    expect(decideAcceptDisposition(input({ mode: staged }))).toBe("stage");
  });

  it("an already-actioned row (not a suggestion) never re-publishes → stage", () => {
    expect(decideAcceptDisposition(input({ isSuggestion: false }))).toBe("stage");
  });

  it("missing verdict → review_only (fail-safe)", () => {
    expect(decideAcceptDisposition(input({ qaVerdict: null }))).toBe("review_only");
  });
});

describe("evaluateArmingPreconditions — arming requires real readiness", () => {
  const ready = {
    publishTarget: "wix_cms" as const,
    connectorConnected: true,
    mappingCount: 3,
    dryRunPassed: true,
    safetyRailsConfirmed: true,
  };

  it("all preconditions met → canArm", () => {
    const e = evaluateArmingPreconditions(ready);
    expect(e.canArm).toBe(true);
    expect(e.blockers).toEqual([]);
  });

  it("no live target → cannot arm (connector precondition unmet)", () => {
    const e = evaluateArmingPreconditions({ ...ready, publishTarget: "dev_note" });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("connector_connected");
  });

  it("no mappings → cannot arm", () => {
    const e = evaluateArmingPreconditions({ ...ready, mappingCount: 0 });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("collection_mapped");
  });

  it("dry-run not passed → cannot arm", () => {
    const e = evaluateArmingPreconditions({ ...ready, dryRunPassed: false });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("dry_run_passed");
  });

  it("safety rails not confirmed → cannot arm", () => {
    const e = evaluateArmingPreconditions({ ...ready, safetyRailsConfirmed: false });
    expect(e.canArm).toBe(false);
    expect(e.blockers).toContain("safety_rails_confirmed");
  });
});

describe("publishing-mode-store — durable per-site mode", () => {
  it("default (no record) → staged", async () => {
    const s = await getPublishingMode();
    expect(s.mode).toBe("staged");
    expect(s.armedAt).toBeNull();
  });

  it("arm → get round-trips through Supabase (armed + armed_at stamped)", async () => {
    mockState.tenant = "tenant-a";
    const set = await setPublishingMode({ mode: "armed", armedBy: "u1", now: new Date("2026-06-16T12:00:00Z") });
    expect(set.mode).toBe("armed");
    expect(set.armedAt).toBe("2026-06-16T12:00:00.000Z");
    const got = await getPublishingMode();
    expect(got.mode).toBe("armed");
    expect(got.armedBy).toBe("u1");
  });

  it("disarm clears it (staged, armed_at null)", async () => {
    mockState.tenant = "tenant-a";
    await setPublishingMode({ mode: "armed" });
    const dis = await setPublishingMode({ mode: "staged" });
    expect(dis.mode).toBe("staged");
    expect(dis.armedAt).toBeNull();
    expect((await getPublishingMode()).mode).toBe("staged");
  });

  it("TENANT ISOLATION — arming tenant A never arms tenant B", async () => {
    mockState.tenant = "tenant-a";
    await setPublishingMode({ mode: "armed" });
    mockState.tenant = "tenant-b";
    expect((await getPublishingMode()).mode).toBe("staged");
  });

  it("FILE FALLBACK (no Supabase env or table not migrated, 42P01) round-trips via the file store", async () => {
    mockState.mode = "no_env";
    await setPublishingMode({ mode: "armed" });
    expect((await getPublishingMode()).mode).toBe("armed");
    mockState.files = new Map();
    mockState.mode = "no_table";
    await setPublishingMode({ mode: "armed" });
    expect((await getPublishingMode()).mode).toBe("armed");
  });

  it("FAIL-SAFE — an unexpected read error resolves to staged, never armed", async () => {
    mockState.mode = "read_error";
    expect((await getPublishingMode()).mode).toBe("staged");
  });
});

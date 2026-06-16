/**
 * MAX_SEO_AEO Phase 6 (final) — Golden Path composer tests.
 *
 * Pins the READ-ONLY composition of the five built controls into one cockpit
 * state: each step's status transitions, the blocked-when-no-source rule, the
 * `currentStepKey` selection (first current/blocked wins), the per-step counts,
 * soft-fail (a throwing read never breaks the state), and tenant-scoping (the
 * tenant id flows into the repository + connector reads).
 *
 * All five dependencies are mocked so the composer's logic is exercised in
 * isolation, deterministically (with an injected `now`).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { GscReadiness } from "@/lib/connectors/gsc/readiness";
import type { PushLedgerEntry } from "@/domains/push/caps";
import type { ProvenWin } from "@/domains/attribution/load-proven-wins";

// ── Mocks (hoisted so vi.mock factories can close over them) ───────────────

const connectorMocks = vi.hoisted(() => ({
  hasAnyConnectedDataSource: vi.fn<(t?: string) => Promise<boolean>>(),
  getConnectorInfo: vi.fn(),
}));
vi.mock("@/lib/connector-store", () => ({
  hasAnyConnectedDataSource: connectorMocks.hasAnyConnectedDataSource,
  getConnectorInfo: connectorMocks.getConnectorInfo,
}));

const readinessMocks = vi.hoisted(() => ({
  loadGscReadiness: vi.fn<(t: string, now?: Date) => Promise<GscReadiness>>(),
}));
vi.mock("@/lib/connectors/gsc/readiness", () => ({
  loadGscReadiness: readinessMocks.loadGscReadiness,
}));

const repoMocks = vi.hoisted(() => ({
  getRecommendedEdits: vi.fn<() => Promise<RecommendedEditRow[]>>(),
  forTenant: vi.fn<(t: string) => unknown>(),
}));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (t: string) => repoMocks.forTenant(t),
  }),
}));

const capsMocks = vi.hoisted(() => ({
  readPushLedger: vi.fn<() => Promise<PushLedgerEntry[]>>(),
}));
vi.mock("@/domains/push/caps", () => ({
  readPushLedger: capsMocks.readPushLedger,
}));

const proofMocks = vi.hoisted(() => ({
  loadProvenWins: vi.fn<() => Promise<ProvenWin[]>>(),
}));
vi.mock("@/domains/attribution/load-proven-wins", () => ({
  loadProvenWins: proofMocks.loadProvenWins,
}));

import { loadGoldenPathState } from "./golden-path";

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-16T18:00:00Z");
const TENANT = "tenant-a";

function edit(
  id: string,
  status: RecommendedEditRow["implementation_status"],
): RecommendedEditRow {
  return {
    id,
    tenant_id: TENANT,
    rec_id: `rec-${id}`,
    action_type: "edit_title" as RecommendedEditRow["action_type"],
    target_url: "https://x.com/p",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "low",
    measurement_plan: null,
    risks: [],
    source: "deterministic" as RecommendedEditRow["source"],
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    implementation_status: status,
  };
}

function readiness(freshnessDays: number | null): GscReadiness {
  return {
    verdict: freshnessDays == null ? "connected_no_data" : "ready",
    // The composer reads only `freshnessDays`; the property value is
    // irrelevant — keep it neutral (no `sc-domain:` literal, which the
    // gsc-no-hardcoded-site-url architecture test forbids in src/).
    property: freshnessDays == null ? null : "example-property",
    coverage: null,
    lastDataDate: null,
    freshnessDays,
  };
}

function ledgerEntry(editId: string): PushLedgerEntry {
  return {
    id: `led-${editId}`,
    tenant_id: TENANT,
    edit_id: editId,
    target_url: "https://x.com/p",
    adapter: "wix",
    pushed_at: NOW.toISOString(),
    day: "2026-06-16",
    result: "pushed",
    detail: null,
  };
}

function setEdits(rows: RecommendedEditRow[]) {
  repoMocks.getRecommendedEdits.mockResolvedValue(rows);
  repoMocks.forTenant.mockReturnValue({
    getRecommendedEdits: repoMocks.getRecommendedEdits,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible "connected + fresh + nothing pending + no proof" baseline; each
  // test overrides only what it exercises.
  connectorMocks.hasAnyConnectedDataSource.mockResolvedValue(true);
  connectorMocks.getConnectorInfo.mockResolvedValue({
    status: "disconnected",
    connected_at: null,
    expires_at: null,
    last_synced_at: null,
  });
  readinessMocks.loadGscReadiness.mockResolvedValue(readiness(0));
  setEdits([]);
  capsMocks.readPushLedger.mockResolvedValue([]);
  proofMocks.loadProvenWins.mockResolvedValue([]);
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("loadGoldenPathState — step shape", () => {
  it("always returns the five steps in loop order", async () => {
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.steps.map((s) => s.key)).toEqual([
      "refresh",
      "review",
      "approve",
      "verify",
      "learn",
    ]);
  });
});

describe("refresh step", () => {
  it("is BLOCKED with the connect prompt when no source is connected", async () => {
    connectorMocks.hasAnyConnectedDataSource.mockResolvedValue(false);
    const state = await loadGoldenPathState(TENANT, NOW);
    const refresh = state.steps.find((s) => s.key === "refresh")!;
    expect(refresh.status).toBe("blocked");
    expect(refresh.detail).toMatch(/connect a data source/i);
    expect(state.connectedAnySource).toBe(false);
  });

  it("is DONE when data is fresh (within the freshness window)", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(1));
    const state = await loadGoldenPathState(TENANT, NOW);
    const refresh = state.steps.find((s) => s.key === "refresh")!;
    expect(refresh.status).toBe("done");
    expect(refresh.detail).toMatch(/current/i);
  });

  it("is CURRENT when connected but stale", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(9));
    const state = await loadGoldenPathState(TENANT, NOW);
    const refresh = state.steps.find((s) => s.key === "refresh")!;
    expect(refresh.status).toBe("current");
    expect(refresh.detail).toMatch(/pull your latest data/i);
  });

  it("is CURRENT when connected but never pulled (no freshness anywhere)", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(null));
    const state = await loadGoldenPathState(TENANT, NOW);
    const refresh = state.steps.find((s) => s.key === "refresh")!;
    expect(refresh.status).toBe("current");
  });

  it("falls back to a connected source's last_synced_at when GSC has no rows", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(null));
    connectorMocks.getConnectorInfo.mockImplementation(async (p: string) =>
      p === "google_ga4"
        ? {
            status: "connected",
            connected_at: null,
            expires_at: null,
            // synced ~1 day ago → fresh
            last_synced_at: new Date(
              NOW.getTime() - 24 * 60 * 60 * 1000,
            ).toISOString(),
          }
        : {
            status: "disconnected",
            connected_at: null,
            expires_at: null,
            last_synced_at: null,
          },
    );
    const state = await loadGoldenPathState(TENANT, NOW);
    const refresh = state.steps.find((s) => s.key === "refresh")!;
    expect(refresh.status).toBe("done");
  });
});

describe("review step", () => {
  it("counts recommended + needs_review and is CURRENT when > 0", async () => {
    setEdits([
      edit("a", "recommended"),
      edit("b", "needs_review"),
      edit("c", "accepted"), // not a review row
    ]);
    const state = await loadGoldenPathState(TENANT, NOW);
    const review = state.steps.find((s) => s.key === "review")!;
    expect(review.count).toBe(2);
    expect(review.status).toBe("current");
    expect(review.detail).toMatch(/2 recommendations to review/i);
  });

  it("treats undefined implementation_status as recommended", async () => {
    const row = edit("a", "recommended");
    delete (row as { implementation_status?: unknown }).implementation_status;
    setEdits([row]);
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.steps.find((s) => s.key === "review")!.count).toBe(1);
  });

  it("is UPCOMING with zero pending review", async () => {
    setEdits([]);
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.steps.find((s) => s.key === "review")!.status).toBe(
      "upcoming",
    );
  });
});

describe("approve step", () => {
  it("counts accepted and is CURRENT when > 0", async () => {
    setEdits([edit("a", "accepted"), edit("b", "accepted")]);
    const state = await loadGoldenPathState(TENANT, NOW);
    const approve = state.steps.find((s) => s.key === "approve")!;
    expect(approve.count).toBe(2);
    expect(approve.status).toBe("current");
    expect(approve.detail).toMatch(/ready to publish/i);
  });
});

describe("verify step", () => {
  it("counts pushed edits cross-checked against the ledger and is CURRENT", async () => {
    setEdits([edit("a", "pushed"), edit("b", "pushed")]);
    capsMocks.readPushLedger.mockResolvedValue([ledgerEntry("a")]); // only a landed
    const state = await loadGoldenPathState(TENANT, NOW);
    const verify = state.steps.find((s) => s.key === "verify")!;
    // b is "pushed" in the rec store but has no ledger entry → not counted.
    expect(verify.count).toBe(1);
    expect(verify.status).toBe("current");
    expect(verify.detail).toMatch(/confirming it's live/i);
  });

  it("is UPCOMING when nothing is awaiting confirmation", async () => {
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.steps.find((s) => s.key === "verify")!.status).toBe(
      "upcoming",
    );
  });
});

describe("learn step", () => {
  it("is DONE when there is at least one proven win", async () => {
    proofMocks.loadProvenWins.mockResolvedValue([
      { headline: "win" } as ProvenWin,
    ]);
    const state = await loadGoldenPathState(TENANT, NOW);
    const learn = state.steps.find((s) => s.key === "learn")!;
    expect(learn.status).toBe("done");
    expect(learn.detail).toMatch(/what your changes drove/i);
  });

  it("is UPCOMING with no proof yet", async () => {
    const state = await loadGoldenPathState(TENANT, NOW);
    const learn = state.steps.find((s) => s.key === "learn")!;
    expect(learn.status).toBe("upcoming");
    expect(learn.detail).toMatch(/proof appears/i);
  });
});

describe("currentStepKey selection — first current/blocked wins", () => {
  it("blocked refresh is the focus even if later steps would be current", async () => {
    connectorMocks.hasAnyConnectedDataSource.mockResolvedValue(false);
    setEdits([edit("a", "recommended")]); // would make review current
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.currentStepKey).toBe("refresh");
  });

  it("picks review when refresh is done and review has work", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(0));
    setEdits([edit("a", "recommended"), edit("b", "accepted")]);
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.currentStepKey).toBe("review");
  });

  it("picks approve when refresh+review are settled but approvals wait", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(0));
    setEdits([edit("a", "accepted")]);
    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.currentStepKey).toBe("approve");
  });

  it("defaults to refresh when the whole loop is settled (nothing current/blocked)", async () => {
    readinessMocks.loadGscReadiness.mockResolvedValue(readiness(0));
    setEdits([]);
    proofMocks.loadProvenWins.mockResolvedValue([
      { headline: "win" } as ProvenWin,
    ]);
    const state = await loadGoldenPathState(TENANT, NOW);
    // refresh=done, review/approve/verify=upcoming, learn=done → no current.
    expect(state.currentStepKey).toBe("refresh");
  });
});

describe("soft-fail — a throwing read never breaks the state", () => {
  it("degrades each failing piece to a coherent step and never throws", async () => {
    connectorMocks.hasAnyConnectedDataSource.mockRejectedValue(
      new Error("boom"),
    );
    readinessMocks.loadGscReadiness.mockRejectedValue(new Error("boom"));
    repoMocks.getRecommendedEdits.mockRejectedValue(new Error("boom"));
    repoMocks.forTenant.mockReturnValue({
      getRecommendedEdits: repoMocks.getRecommendedEdits,
    });
    capsMocks.readPushLedger.mockRejectedValue(new Error("boom"));
    proofMocks.loadProvenWins.mockRejectedValue(new Error("boom"));

    const state = await loadGoldenPathState(TENANT, NOW);
    expect(state.steps).toHaveLength(5);
    // No source provable → blocked refresh; everything else upcoming.
    expect(state.steps.find((s) => s.key === "refresh")!.status).toBe(
      "blocked",
    );
    expect(state.currentStepKey).toBe("refresh");
    expect(state.connectedAnySource).toBe(false);
  });
});

describe("tenant-scoping", () => {
  it("threads the tenant id into the repository + connector reads", async () => {
    await loadGoldenPathState(TENANT, NOW);
    expect(repoMocks.forTenant).toHaveBeenCalledWith(TENANT);
    expect(connectorMocks.hasAnyConnectedDataSource).toHaveBeenCalledWith(
      TENANT,
    );
    expect(readinessMocks.loadGscReadiness).toHaveBeenCalledWith(TENANT, NOW);
  });
});

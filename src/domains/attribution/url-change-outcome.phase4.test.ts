/**
 * Recommendation Lifecycle OS — Phase 4 (2026-04-27).
 *
 * Tests for the verdict engine's `live_at` baseline-split + the
 * `not_implemented` synthetic verdict. All gated by
 * `BEACON_LIFECYCLE_VERDICT_ENABLED`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { UrlCitationHistory } from "@/domains/product/url-citation-history";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

// ── Pure-helper tests (no mocks needed) ──────────────────────────────────

import {
  computeChangeVerdict,
  lifecycleLookupKey,
  resolveChangeDate,
} from "./url-change-outcome";

function makeChange(o: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    id: "cl-1",
    tenant_id: "tenant-test",
    timestamp: "2026-04-20T12:00:00.000Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://example.com/services/braces",
    asset_name: "x",
    change_description: "Set title tag to Hello",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-20T12:00:00.000Z",
    updated_at: "2026-04-20T12:00:00.000Z",
    ...o,
  };
}

// Helper: build a URL citation history with a flat baseline + flat post
// window. Used to verify which date the engine uses as the change date.
// `daily` omits zero-count dates per UrlCitationSeries contract; we use
// non-zero counts on every day so the series is dense.
function flatHistory(args: {
  url: string;
  start: string;
  preCounts: number[];
  postCounts: number[];
}): UrlCitationHistory {
  const daily: { date: string; count: number; by_platform: Record<string, number> }[] = [];
  const t0 = new Date(args.start + "T00:00:00Z").getTime();
  const all = [...args.preCounts, ...args.postCounts];
  for (let i = 0; i < all.length; i++) {
    const iso = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    if (all[i]! > 0) daily.push({ date: iso, count: all[i]!, by_platform: {} });
  }
  // Normalized URL key per url-citation-history.ts (strips scheme/host).
  const norm = args.url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return {
    built_at: new Date().toISOString(),
    date_range: {
      first: daily[0]?.date ?? null,
      last: daily[daily.length - 1]?.date ?? null,
    },
    distinct_urls: 1,
    series: [
      {
        url: norm,
        raw_urls: [args.url],
        is_owned: true,
        daily,
      },
    ],
  };
}

describe("resolveChangeDate (Phase 4 pure helper)", () => {
  it("useLiveAt=false → returns timestamp slice (pre-Phase-4 behavior)", () => {
    const c = makeChange({
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: "2026-04-25T08:00:00.000Z",
    });
    expect(resolveChangeDate(c, false)).toBe("2026-04-20");
  });

  it("useLiveAt=true + live_at present → returns live_at slice", () => {
    const c = makeChange({
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: "2026-04-25T08:00:00.000Z",
    });
    expect(resolveChangeDate(c, true)).toBe("2026-04-25");
  });

  it("useLiveAt=true + no live_at → falls back to timestamp slice", () => {
    const c = makeChange({
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: null,
    });
    expect(resolveChangeDate(c, true)).toBe("2026-04-20");
  });

  it("useLiveAt=true + live_at empty string → falls back to timestamp", () => {
    const c = makeChange({
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: "",
    });
    expect(resolveChangeDate(c, true)).toBe("2026-04-20");
  });
});

describe("lifecycleLookupKey (Phase 4 pure helper)", () => {
  it("builds rec::action::elementKey for a fully-linked entry", () => {
    expect(
      lifecycleLookupKey({
        source_rec_id: "rec-A",
        action_type: "edit_title",
        target_element_key: "title[0]:abc",
      }),
    ).toBe("rec-A::edit_title::title[0]:abc");
  });

  it("encodes null target_element_key as empty string (page-level edits)", () => {
    expect(
      lifecycleLookupKey({
        source_rec_id: "rec-A",
        action_type: "watch",
        target_element_key: null,
      }),
    ).toBe("rec-A::watch::");
  });

  it("returns null when source_rec_id is missing or empty", () => {
    expect(
      lifecycleLookupKey({
        source_rec_id: undefined,
        action_type: "edit_title",
      }),
    ).toBeNull();
    expect(
      lifecycleLookupKey({
        source_rec_id: "",
        action_type: "edit_title",
      }),
    ).toBeNull();
    expect(
      lifecycleLookupKey({
        source_rec_id: null,
        action_type: "edit_title",
      }),
    ).toBeNull();
  });

  it("returns null when action_type is missing or empty (legacy / imported rows)", () => {
    expect(
      lifecycleLookupKey({
        source_rec_id: "rec-A",
        action_type: undefined,
      }),
    ).toBeNull();
    expect(
      lifecycleLookupKey({
        source_rec_id: "rec-A",
        action_type: "",
      }),
    ).toBeNull();
  });
});

describe("computeChangeVerdict — Phase 4 options", () => {
  const URL = "https://example.com/services/braces";

  it("options omitted → uses timestamp (pre-Phase-4 behavior preserved)", () => {
    // Baseline ends 2026-04-19, post starts 2026-04-21 (timestamp = Apr 20).
    // Build a history with strong lift starting Apr 21.
    const change = makeChange({
      url: URL,
      timestamp: "2026-04-20T12:00:00.000Z",
    });
    const history = flatHistory({
      url: URL,
      start: "2026-04-06",
      preCounts: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], // 14 days at 5
      postCounts: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15], // 10 days at 15
    });
    const result = computeChangeVerdict(change, history, "2026-04-30");
    expect(result).not.toBeNull();
    expect(result!.verdict.verdict).toBe("helping");
  });

  it("{ useLiveAt: false } → identical to options omitted (uses timestamp)", () => {
    const change = makeChange({
      url: URL,
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: "2026-04-25T12:00:00.000Z",
    });
    const history = flatHistory({
      url: URL,
      start: "2026-04-06",
      preCounts: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      postCounts: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15],
    });
    const a = computeChangeVerdict(change, history, "2026-04-30");
    const b = computeChangeVerdict(change, history, "2026-04-30", undefined, {
      useLiveAt: false,
    });
    expect(a!.verdict.verdict).toBe(b!.verdict.verdict);
    expect(a!.verdict.explanation.math).toEqual(b!.verdict.explanation.math);
  });

  it("{ useLiveAt: true } with live_at → uses live_at as baseline split", () => {
    // timestamp is Apr 20; live_at is Apr 25. The lift starts Apr 21.
    // With timestamp, post-window includes Apr 21..Apr 30 = HELPING.
    // With live_at, post-window starts Apr 26 (5 days of lift only) →
    // either too_early (N<14) or different math. The math.mu_pre will
    // also include Apr 21-25 in the BASELINE since baseline ends day
    // before live_at. We verify the change date affects the math.
    const change = makeChange({
      url: URL,
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: "2026-04-25T12:00:00.000Z",
    });
    const history = flatHistory({
      url: URL,
      start: "2026-04-06",
      preCounts: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], // Apr 6-19
      postCounts: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15], // Apr 20-29
    });
    const withLiveAt = computeChangeVerdict(change, history, "2026-04-29", undefined, {
      useLiveAt: true,
    });
    const withTimestamp = computeChangeVerdict(change, history, "2026-04-29");
    expect(withLiveAt).not.toBeNull();
    expect(withTimestamp).not.toBeNull();
    // The post-window length differs because the change date moved.
    // Either the post_days differ OR mu_pre differs (because baseline
    // pulls in some of the now-pre-change "lift" days).
    const a = withLiveAt!.verdict.explanation.math;
    const b = withTimestamp!.verdict.explanation.math;
    expect(a.post_days_used !== b.post_days_used || a.mu_pre !== b.mu_pre).toBe(
      true,
    );
  });

  it("{ useLiveAt: true } + no live_at → falls back to timestamp", () => {
    const change = makeChange({
      url: URL,
      timestamp: "2026-04-20T12:00:00.000Z",
      live_at: null,
    });
    const history = flatHistory({
      url: URL,
      start: "2026-04-06",
      preCounts: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      postCounts: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15],
    });
    const fallback = computeChangeVerdict(change, history, "2026-04-30", undefined, {
      useLiveAt: true,
    });
    const baseline = computeChangeVerdict(change, history, "2026-04-30");
    expect(fallback!.verdict.verdict).toBe(baseline!.verdict.verdict);
    expect(fallback!.verdict.explanation.math).toEqual(
      baseline!.verdict.explanation.math,
    );
  });

  it("{ forceVerdict: 'not_implemented' } → synthetic verdict, empty series, no Z-score", () => {
    const change = makeChange({
      url: URL,
      timestamp: "2026-04-20T12:00:00.000Z",
    });
    // History present — should be IGNORED for not_implemented short-circuit.
    const history = flatHistory({
      url: URL,
      start: "2026-04-06",
      preCounts: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      postCounts: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15],
    });
    const result = computeChangeVerdict(change, history, "2026-04-30", undefined, {
      forceVerdict: "not_implemented",
    });
    expect(result).not.toBeNull();
    expect(result!.verdict.verdict).toBe("not_implemented");
    expect(result!.series).toEqual([]); // no series consumed
    expect(result!.verdict.z).toBeNull();
    expect(result!.verdict.delta_pct).toBeNull();
    expect(result!.verdict.explanation.math.mu_pre).toBe(0);
    expect(result!.verdict.explanation.math.mu_post).toBe(0);
    expect(result!.verdict.confidence).toBe("high");
  });

  it("{ forceVerdict: 'not_implemented' } works when URL has NO citation history at all", () => {
    const change = makeChange({
      url: URL,
      timestamp: "2026-04-20T12:00:00.000Z",
    });
    // Empty history — would normally make computeChangeVerdict return null
    // (via getSeriesForUrl finding nothing), but the short-circuit fires
    // BEFORE the series lookup.
    const emptyHistory: UrlCitationHistory = {
      built_at: new Date().toISOString(),
      date_range: { first: null, last: null },
      distinct_urls: 0,
      series: [],
    };
    const result = computeChangeVerdict(change, emptyHistory, undefined, undefined, {
      forceVerdict: "not_implemented",
    });
    expect(result).not.toBeNull();
    expect(result!.verdict.verdict).toBe("not_implemented");
  });
});

// ── Integration tests for materializeUrlOutcomes (heavy mocks) ───────────

const flagMocks = vi.hoisted(() => ({
  isLifecycleVerdictEnabled: vi.fn<() => boolean>(),
}));
vi.mock("@/lib/flags", () => ({
  isLifecycleVerdictEnabled: flagMocks.isLifecycleVerdictEnabled,
  // Other flags consumed transitively.
  isEventTruthPreviewEnabled: () => false,
  isSchemaAutoPromoteEnabled: () => false,
  isFindingAutoLinkEnabled: () => false,
  isLifecycleEnabled: () => false,
}));

const repoMocks = vi.hoisted(() => ({
  getRecommendedEdits: vi.fn<() => Promise<RecommendedEditRow[]>>(),
}));
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: () => repoMocks,
  }),
}));

const tenantMocks = vi.hoisted(() => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
  currentTenantSlug: vi.fn(async () => "test"),
}));
vi.mock("@/lib/tenant-context", () => tenantMocks);

const storeMocks = vi.hoisted(() => ({
  readStore: vi.fn<(name: string) => Promise<unknown>>(),
  writeStore: vi.fn<(name: string, data: unknown) => Promise<void>>(),
}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: storeMocks.readStore,
  writeStore: storeMocks.writeStore,
}));

const dualWriteMocks = vi.hoisted(() => ({
  syncUrlChangeOutcomes: vi.fn<
    (rows: unknown[], tenantId: string) => Promise<void>
  >(),
}));
vi.mock("@/lib/persistence/dual-write", () => ({
  syncUrlChangeOutcomes: dualWriteMocks.syncUrlChangeOutcomes,
}));

// Import AFTER mocks.
import { materializeUrlOutcomes } from "./url-change-outcome";

beforeEach(() => {
  flagMocks.isLifecycleVerdictEnabled.mockReset();
  flagMocks.isLifecycleVerdictEnabled.mockReturnValue(false);
  repoMocks.getRecommendedEdits.mockReset();
  repoMocks.getRecommendedEdits.mockResolvedValue([]);
  storeMocks.readStore.mockReset();
  storeMocks.readStore.mockResolvedValue([]);
  storeMocks.writeStore.mockReset();
  storeMocks.writeStore.mockResolvedValue(undefined);
  dualWriteMocks.syncUrlChangeOutcomes.mockReset();
  dualWriteMocks.syncUrlChangeOutcomes.mockResolvedValue(undefined);
});

function makeEdit(o: {
  id: string;
  rec_id: string;
  action_type: string;
  target_element_key?: string | null;
  status?: RecommendedEditRow["implementation_status"];
}): RecommendedEditRow {
  return {
    id: o.id,
    tenant_id: "tenant-test",
    rec_id: o.rec_id,
    action_type: o.action_type as RecommendedEditRow["action_type"],
    target_url: "https://example.com/x",
    target_element_key: o.target_element_key ?? null,
    display_label: null,
    current_text: null,
    proposed_text: "Hello",
    why: "x",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: "deterministic",
    evidence_hash: "h",
    model: null,
    cost_usd: null,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    implementation_status: o.status ?? "accepted",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
  };
}

describe("materializeUrlOutcomes — Phase 4 flag gating", () => {
  it("flag OFF: does NOT load recommended_edits (zero repo calls)", async () => {
    flagMocks.isLifecycleVerdictEnabled.mockReturnValue(false);
    await materializeUrlOutcomes({
      changes: [],
      history: {
        built_at: new Date().toISOString(),
        date_range: { first: null, last: null },
        distinct_urls: 0,
        series: [],
      },
    });
    expect(repoMocks.getRecommendedEdits).not.toHaveBeenCalled();
  });

  it("flag ON: loads recommended_edits once for the lifecycle map", async () => {
    flagMocks.isLifecycleVerdictEnabled.mockReturnValue(true);
    repoMocks.getRecommendedEdits.mockResolvedValue([
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        status: "not_found_after_7d",
      }),
    ]);
    await materializeUrlOutcomes({
      changes: [],
      history: {
        built_at: new Date().toISOString(),
        date_range: { first: null, last: null },
        distinct_urls: 0,
        series: [],
      },
    });
    expect(repoMocks.getRecommendedEdits).toHaveBeenCalledTimes(1);
  });

  it("flag ON: changelog linked to not_found_after_7d edit → recorded as not_implemented", async () => {
    flagMocks.isLifecycleVerdictEnabled.mockReturnValue(true);
    repoMocks.getRecommendedEdits.mockResolvedValue([
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        target_element_key: "title[0]:abc",
        status: "not_found_after_7d",
      }),
    ]);
    const captured: unknown[] = [];
    storeMocks.writeStore.mockImplementationOnce(async (_name, data) => {
      captured.push(data);
    });
    const change = makeChange({
      id: "cl-1",
      source_rec_id: "rec-A",
      action_type: "edit_title",
      target_element_key: "title[0]:abc",
    });
    await materializeUrlOutcomes({
      changes: [change],
      history: {
        built_at: new Date().toISOString(),
        date_range: { first: null, last: null },
        distinct_urls: 0,
        series: [],
      },
    });
    // Records get persisted via writeStore + dual-write.
    expect(dualWriteMocks.syncUrlChangeOutcomes).toHaveBeenCalled();
    const persisted = dualWriteMocks.syncUrlChangeOutcomes.mock.calls[0]![0];
    expect(persisted).toBeDefined();
    expect(Array.isArray(persisted)).toBe(true);
    const arr = persisted as { change_id: string; verdict: string }[];
    const recorded = arr.find((r) => r.change_id === "cl-1");
    expect(recorded?.verdict).toBe("not_implemented");
  });

  it("flag OFF: same not_found_after_7d setup → does NOT emit not_implemented (legacy behavior)", async () => {
    flagMocks.isLifecycleVerdictEnabled.mockReturnValue(false);
    // Even if the runner had marked an edit as not_found_after_7d,
    // the flag-OFF path never consults the lifecycle map.
    repoMocks.getRecommendedEdits.mockResolvedValue([
      makeEdit({
        id: "e1",
        rec_id: "rec-A",
        action_type: "edit_title",
        status: "not_found_after_7d",
      }),
    ]);
    // Unique change_id so this test doesn't see persisted state from
    // earlier tests (the url-change-outcomes store is module-level
    // cached). The assertion checks "no not_implemented THIS run" by
    // looking at THIS test's specific cl id.
    const change = makeChange({
      id: "cl-flag-off-test",
      source_rec_id: "rec-A",
      action_type: "edit_title",
    });
    await materializeUrlOutcomes({
      changes: [change],
      history: {
        built_at: new Date().toISOString(),
        date_range: { first: null, last: null },
        distinct_urls: 0,
        series: [],
      },
    });
    // Repository for recommended_edits never queried (proves flag-OFF
    // skips the lifecycle map load).
    expect(repoMocks.getRecommendedEdits).not.toHaveBeenCalled();
    // Confirm THIS test's change did NOT get persisted as not_implemented.
    const calls = dualWriteMocks.syncUrlChangeOutcomes.mock.calls;
    if (calls.length > 0) {
      const arr = calls[0]![0] as { change_id: string; verdict: string }[];
      const thisRecord = arr.find((r) => r.change_id === "cl-flag-off-test");
      expect(thisRecord?.verdict).not.toBe("not_implemented");
    }
  });

  it("flag ON: legacy changelog without source_rec_id → falls through to standard Z-score path", async () => {
    flagMocks.isLifecycleVerdictEnabled.mockReturnValue(true);
    repoMocks.getRecommendedEdits.mockResolvedValue([]);
    const change = makeChange({
      id: "cl-no-rec-link",
      source_rec_id: undefined, // no rec linkage
    });
    // No history for this URL → standard path returns null computed → no record.
    await materializeUrlOutcomes({
      changes: [change],
      history: {
        built_at: new Date().toISOString(),
        date_range: { first: null, last: null },
        distinct_urls: 0,
        series: [],
      },
    });
    // The unlinked legacy change-id was NOT persisted as not_implemented.
    const calls = dualWriteMocks.syncUrlChangeOutcomes.mock.calls;
    if (calls.length > 0) {
      const arr = calls[0]![0] as { change_id: string; verdict: string }[];
      const thisRecord = arr.find((r) => r.change_id === "cl-no-rec-link");
      expect(thisRecord?.verdict).not.toBe("not_implemented");
    }
  });
});

describe("isTerminalVerdict — Phase 4 extension", () => {
  it("not_implemented is terminal (will be persisted by recordUrlOutcome)", async () => {
    const { isTerminalVerdict } = await import("./url-change-outcome");
    expect(isTerminalVerdict("not_implemented")).toBe(true);
  });
});

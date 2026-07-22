/**
 * url-change-outcome — consolidated test file (2026-07-21).
 *
 * MERGED from three sibling files, keeping every distinct case:
 *   url-change-outcome.test.ts            — base pure helpers
 *     (isTerminalVerdict, findLandingDay, site-wide/no-URL handling)
 *   url-change-outcome.phase4.test.ts     — Recommendation Lifecycle OS
 *     Phase 4 (2026-04-27): live_at baseline-split, lifecycleLookupKey,
 *     not_implemented synthetic verdict, materializeUrlOutcomes flag
 *     gating (BEACON_LIFECYCLE_VERDICT_ENABLED)
 *   url-change-outcome.s4-sampling.test.ts — S4 (operator audit,
 *     2026-05-05): sampling-status wire-up onto the dense series and the
 *     M3 demotion guard (proof/partial post-window days block a
 *     measured win)
 *
 * The Phase 4 integration mocks (flags / repositories / tenant-context /
 * json-store / dual-write) are file-level; the pure-helper tests never
 * touch those modules at call time, so the mocks are inert for them.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { UrlCitationHistory } from "@/domains/product/url-citation-history";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyPoint } from "@/domains/attribution/url-verdict";

// ── Phase 4 integration mocks (hoisted; inert for pure-helper tests) ─────

const flagMocks = vi.hoisted(() => ({
  isLifecycleVerdictEnabled: vi.fn<() => boolean>(),
}));
vi.mock("@/lib/flags", () => ({
  isLifecycleVerdictEnabled: flagMocks.isLifecycleVerdictEnabled,
  // Other flags consumed transitively.
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

import {
  isTerminalVerdict,
  findLandingDay,
  computeChangeVerdict,
  lifecycleLookupKey,
  resolveChangeDate,
  buildSamplingStatusByDate,
  stampSamplingStatus,
  materializeUrlOutcomes,
} from "@/domains/attribution/url-change-outcome";

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

// ── Shared fixture helpers ───────────────────────────────────────────────

/** Dense daily series: one point per day from `start`, one count each. */
function denseFixture(start: string, counts: number[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < counts.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: iso, count: counts[i] });
  }
  return out;
}

function emptyHistory(): UrlCitationHistory {
  return {
    built_at: new Date().toISOString(),
    date_range: { first: "2026-03-01", last: "2026-03-29" },
    distinct_urls: 0,
    series: [],
  };
}

// ---------------------------------------------------------------------------
// isTerminalVerdict
// ---------------------------------------------------------------------------

describe("isTerminalVerdict", () => {
  it("returns true for helping / hurting / nothing_yet", () => {
    expect(isTerminalVerdict("helping")).toBe(true);
    expect(isTerminalVerdict("hurting")).toBe(true);
    expect(isTerminalVerdict("nothing_yet")).toBe(true);
  });

  it("returns false for too_early and not_enough_data", () => {
    expect(isTerminalVerdict("too_early")).toBe(false);
    expect(isTerminalVerdict("not_enough_data")).toBe(false);
  });

  it("not_implemented is terminal (Phase 4 extension; persisted by recordUrlOutcome)", () => {
    expect(isTerminalVerdict("not_implemented")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findLandingDay
// ---------------------------------------------------------------------------

describe("findLandingDay", () => {
  it("returns null when targetVerdict is nothing_yet (no discrete landing)", () => {
    const s = denseFixture("2026-03-01", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5]);
    expect(findLandingDay(s, "2026-03-15", "nothing_yet")).toBeNull();
  });

  it("finds the first day the verdict crosses into helping", () => {
    // 14d baseline at 5/day, then 14d post at 15/day — strong lift from day 1.
    // But sustain ≥5 requires at least 5 days of post data; walk returns the first day
    // the verdict is "helping" (i.e. sustain threshold also hit).
    const s = denseFixture("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
    ]);
    const result = findLandingDay(s, "2026-03-15", "helping");
    expect(result).not.toBeNull();
    expect(result!.day).toBeGreaterThanOrEqual(5); // sustain requires ≥5 days
    expect(result!.day).toBeLessThanOrEqual(10); // landed quickly with strong lift
    expect(result!.z).toBeGreaterThanOrEqual(2.0);
  });

  it("returns null when verdict never crosses within post window", () => {
    // Flat baseline, flat after — verdict stays nothing_yet / too_early, never helping.
    const s = denseFixture("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    ]);
    expect(findLandingDay(s, "2026-03-15", "helping")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeChangeVerdict — site-wide / no-URL handling
// ---------------------------------------------------------------------------

function makeBaseChange(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: "cl-t",
    timestamp: "2026-03-15T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: overrides.url ?? null,
    asset_name: "",
    change_description: overrides.change_description ?? "Set title tag",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-03-15T00:00:00Z",
    updated_at: "2026-03-15T00:00:00Z",
    tenant_id: "",
    ...overrides,
  };
}

describe("computeChangeVerdict", () => {
  it("returns null for site-wide changes (no URL)", () => {
    const change = makeBaseChange({ url: null });
    expect(computeChangeVerdict(change, emptyHistory())).toBeNull();
  });

  it("returns null for non-URL labels like 'Profound'", () => {
    const change = makeBaseChange({ url: "Profound" });
    expect(computeChangeVerdict(change, emptyHistory())).toBeNull();
  });

  it("returns null when URL has no series in history", () => {
    const change = makeBaseChange({ url: "/services/foo" });
    expect(computeChangeVerdict(change, emptyHistory())).toBeNull();
  });

  it("returns verdict when URL has a matching series", () => {
    const change = makeBaseChange({ url: "/services/foo" });
    const history: UrlCitationHistory = {
      built_at: new Date().toISOString(),
      date_range: { first: "2026-03-01", last: "2026-03-29" },
      distinct_urls: 1,
      series: [
        {
          url: "/services/foo",
          raw_urls: ["https://example.com/services/foo"],
          is_owned: true,
          daily: [
            ...Array.from({ length: 14 }, (_, i) => ({
              date: new Date(
                new Date("2026-03-01T00:00:00Z").getTime() + i * 86_400_000,
              )
                .toISOString()
                .slice(0, 10),
              count: 5,
              by_platform: { ChatGPT: 5 },
            })),
            ...Array.from({ length: 14 }, (_, i) => ({
              date: new Date(
                new Date("2026-03-16T00:00:00Z").getTime() + i * 86_400_000,
              )
                .toISOString()
                .slice(0, 10),
              count: 15,
              by_platform: { ChatGPT: 15 },
            })),
          ],
        },
      ],
    };
    const result = computeChangeVerdict(change, history, "2026-03-29");
    expect(result).not.toBeNull();
    expect(result!.normalizedUrl).toBe("/services/foo");
    expect(result!.verdict.verdict).toBe("helping");
  });
});

// ---------------------------------------------------------------------------
// Phase 4 (2026-04-27) — live_at baseline-split + not_implemented verdict
// ---------------------------------------------------------------------------

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
  // Phase v4 Commit 7A (2026-04-30): tag every entry as `derived` so the new
  // mixed-source filter in computeUrlVerdict treats this as a clean native
  // series. denseSeries prefers entry.source_type over its date-based
  // fallback, which would otherwise tag pre-2026-04-22 dates as benchmark
  // and trigger the partial-overlap abstain on these synthetic fixtures.
  const daily: {
    date: string;
    count: number;
    by_platform: Record<string, number>;
    source_type: "benchmark" | "derived";
  }[] = [];
  const t0 = new Date(args.start + "T00:00:00Z").getTime();
  const all = [...args.preCounts, ...args.postCounts];
  for (let i = 0; i < all.length; i++) {
    const iso = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    if (all[i]! > 0) {
      daily.push({
        date: iso,
        count: all[i]!,
        by_platform: {},
        source_type: "derived",
      });
    }
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
    const noHistory: UrlCitationHistory = {
      built_at: new Date().toISOString(),
      date_range: { first: null, last: null },
      distinct_urls: 0,
      series: [],
    };
    const result = computeChangeVerdict(change, noHistory, undefined, undefined, {
      forceVerdict: "not_implemented",
    });
    expect(result).not.toBeNull();
    expect(result!.verdict.verdict).toBe("not_implemented");
  });
});

// ── Phase 4 integration tests for materializeUrlOutcomes (heavy mocks) ───

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

// ---------------------------------------------------------------------------
// S4 (operator audit, 2026-05-05) — sampling-status attribution.
//
// The M3 guard in `computeUrlVerdict` demotes `helping` / `hurting` to
// `nothing_yet` when the post-window contains any `proof` day OR has zero
// `full` days. The guard was a no-op until S4 wired sampling tags onto the
// dense series. These tests pin the wire-up.
// ---------------------------------------------------------------------------

function obs(date: string, n: number): PromptAnswerObservation[] {
  // Build N synthetic observations all stamped at the same date. We
  // only need observed_at + a couple of fields the type insists on; the
  // rest are placeholder.
  return Array.from({ length: n }, (_, i) => ({
    id: `obs-${date}-${i}`,
    prompt_id: `p-${i}`,
    run_id: "run-x",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: null,
    tracked_brand_cited: null,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: `${date}T00:00:00.000Z`,
    platform: "perplexity",
    topic: "",
  })) as unknown as PromptAnswerObservation[];
}

function buildHistoryForDense(
  url: string,
  series: DailyPoint[],
): UrlCitationHistory {
  return {
    built_at: new Date().toISOString(),
    date_range: {
      first: series[0]?.date ?? null,
      last: series[series.length - 1]?.date ?? null,
    },
    distinct_urls: 1,
    series: [
      {
        url,
        raw_urls: [url],
        is_owned: true,
        daily: series.map((p) => ({
          date: p.date,
          count: p.count,
          by_platform: {},
          source_type: "derived" as const,
        })),
      },
    ],
  };
}

function changeFixture(url: string, changeDate: string): ChangelogEntry {
  return {
    id: "ch-test",
    url,
    timestamp: `${changeDate}T00:00:00.000Z`,
    asset_type: "page",
    change_description: "test change",
  } as unknown as ChangelogEntry;
}

describe("S4 — buildSamplingStatusByDate", () => {
  it("classifies counts using operator-locked thresholds (full / partial / proof)", () => {
    const observations: PromptAnswerObservation[] = [
      ...obs("2026-04-22", 100), // full (≥80)
      ...obs("2026-04-23", 80), //  full (boundary)
      ...obs("2026-04-24", 79), //  partial
      ...obs("2026-04-25", 10), //  partial (boundary)
      ...obs("2026-04-26", 9), //   proof (boundary)
      ...obs("2026-04-27", 1), //   proof
    ];
    const map = buildSamplingStatusByDate(observations);
    expect(map.get("2026-04-22")).toBe("full");
    expect(map.get("2026-04-23")).toBe("full");
    expect(map.get("2026-04-24")).toBe("partial");
    expect(map.get("2026-04-25")).toBe("partial");
    expect(map.get("2026-04-26")).toBe("proof");
    expect(map.get("2026-04-27")).toBe("proof");
  });

  it("dates with zero observations are absent from the map (not 'empty')", () => {
    const map = buildSamplingStatusByDate(obs("2026-04-22", 5));
    // Map only contains dates that had observations; an unobserved
    // date is undefined in the map (the verdict engine treats undefined
    // as 'no info' and leaves the point untouched).
    expect(map.get("2026-04-22")).toBe("proof");
    expect(map.get("2026-04-23")).toBeUndefined();
  });

  it("returns an empty map for empty input", () => {
    const map = buildSamplingStatusByDate([]);
    expect(map.size).toBe(0);
  });

  it("ignores rows with malformed observed_at", () => {
    const observations = [
      ...obs("2026-04-22", 5),
      // invalid observed_at — must be skipped, not crash
      {
        ...obs("2026-04-22", 1)[0],
        id: "bad",
        observed_at: "" as unknown as string,
      },
    ] as PromptAnswerObservation[];
    const map = buildSamplingStatusByDate(observations);
    expect(map.get("2026-04-22")).toBe("proof"); // 5 valid → proof, the bad row didn't bump the count
  });
});

describe("S4 — stampSamplingStatus", () => {
  it("stamps the tag on matching dates and leaves untagged dates alone", () => {
    const series = denseFixture("2026-04-22", [5, 5, 5]);
    const map = new Map<string, "full" | "partial" | "proof" | "empty">([
      ["2026-04-22", "full"],
      ["2026-04-24", "proof"],
    ]);
    const stamped = stampSamplingStatus(series, map);
    expect(stamped[0].sampling_status).toBe("full");
    expect(stamped[1].sampling_status).toBeUndefined(); // untagged
    expect(stamped[2].sampling_status).toBe("proof");
  });

  it("returns a copy without mutating the input series", () => {
    const series = denseFixture("2026-04-22", [5, 5]);
    const map = new Map<string, "full" | "partial" | "proof" | "empty">([
      ["2026-04-22", "full"],
    ]);
    const stamped = stampSamplingStatus(series, map);
    expect(series[0].sampling_status).toBeUndefined(); // not mutated
    expect(stamped[0].sampling_status).toBe("full");
    expect(stamped).not.toBe(series);
  });

  it("returns a shallow copy when map is undefined or empty (no-op)", () => {
    const series = denseFixture("2026-04-22", [5]);
    const fromUndefined = stampSamplingStatus(series, undefined);
    const fromEmpty = stampSamplingStatus(series, new Map());
    expect(fromUndefined).toEqual(series);
    expect(fromEmpty).toEqual(series);
  });
});

describe("S4 — computeChangeVerdict honors samplingStatusByDate", () => {
  // 14 baseline days @ 5/day, change on day 15, 14 post days @ 20/day:
  // strong helping signal in the absence of any sampling guard.
  const baselineDays = 14;
  const postDays = 14;
  const baselineCount = 5;
  const postCount = 20;
  const baselineStart = "2026-04-08";
  const changeDate = "2026-04-22";

  function buildStandardCase(
    postSamplingByDate?: ReadonlyMap<
      string,
      "full" | "partial" | "proof" | "empty"
    >,
  ): ReturnType<typeof computeChangeVerdict> {
    const counts: number[] = [
      ...Array(baselineDays).fill(baselineCount),
      0, // change day
      ...Array(postDays).fill(postCount),
    ];
    const dense = denseFixture(baselineStart, counts);
    const history = buildHistoryForDense("/x", dense);
    const change = changeFixture("/x", changeDate);
    return computeChangeVerdict(
      change,
      history,
      undefined,
      undefined,
      postSamplingByDate
        ? { samplingStatusByDate: postSamplingByDate }
        : undefined,
    );
  }

  it("[BASELINE] without samplingStatusByDate, strong post-window stays helping", () => {
    const r = buildStandardCase();
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("helping");
  });

  it("proof day in post-window demotes helping → nothing_yet", () => {
    // Tag every post-window day as full EXCEPT the last one as proof.
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStart + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    for (let i = 1; i <= postDays - 1; i++) {
      const d = new Date(t0 + (baselineDays + i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      map.set(d, "full");
    }
    const lastPost = new Date(t0 + (baselineDays + postDays) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    map.set(lastPost, "proof");
    const r = buildStandardCase(map);
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("nothing_yet");
  });

  it("partial-only post-window demotes helping → nothing_yet (no full days)", () => {
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStart + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    for (let i = 1; i <= postDays; i++) {
      const d = new Date(t0 + (baselineDays + i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      map.set(d, "partial");
    }
    const r = buildStandardCase(map);
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("nothing_yet");
  });

  it("full-only post-window keeps helping (the operator's daily-poll case)", () => {
    const map = new Map<string, "full" | "partial" | "proof" | "empty">();
    const t0 = new Date(baselineStart + "T00:00:00Z").getTime();
    for (let i = 0; i <= baselineDays + postDays; i++) {
      const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
      map.set(d, "full");
    }
    const r = buildStandardCase(map);
    expect(r).not.toBeNull();
    expect(r!.verdict.verdict).toBe("helping");
  });

});

import { readFileSync } from "node:fs";
import { resolve as resolvePath, join as joinPath } from "node:path";
import { computeUrlVerdict, DEFAULT_THRESHOLDS } from "@/domains/attribution/url-verdict";

describe("T6.7 materializer demotion semantics (source-text invariants)", () => {
const REPO_ROOT = resolvePath(__dirname, "../..");
const SRC = readFileSync(
  joinPath(REPO_ROOT, "src/domains/attribution/url-change-outcome.ts"),
  "utf-8",
);

describe("T6.7 — materializer demotion semantics (source-text invariants)", () => {
  it("FRESH_INSERT_VERDICTS set is declared and includes weak_signal", () => {
    expect(/const FRESH_INSERT_VERDICTS:\s*ReadonlySet<VerdictLabel>/.test(SRC)).toBe(true);
    expect(/"weak_signal"/.test(SRC)).toBe(true);
    // Pin the full set membership — this catches accidental re-additions
    // of pre-landing verdicts that would re-pollute the store.
    const setBlock = SRC.match(
      /const FRESH_INSERT_VERDICTS[\s\S]*?\]\)/,
    )?.[0];
    expect(setBlock).toBeTruthy();
    if (setBlock) {
      expect(setBlock).toContain('"helping"');
      expect(setBlock).toContain('"hurting"');
      expect(setBlock).toContain('"nothing_yet"');
      expect(setBlock).toContain('"not_implemented"');
      expect(setBlock).toContain('"weak_signal"');
      // Negative assertions — these MUST NOT be in the set.
      expect(setBlock).not.toContain('"too_early"');
      expect(setBlock).not.toContain('"not_enough_data"');
      expect(setBlock).not.toContain('"not_enough_native_baseline"');
    }
  });

  it("recordUrlOutcome skips fresh inserts of non-FRESH_INSERT verdicts", () => {
    expect(
      /if\s*\(\s*existingIdx\s*===\s*-1\s*&&\s*!FRESH_INSERT_VERDICTS\.has\(v\.verdict\)\s*\)/.test(
        SRC,
      ),
      "recordUrlOutcome must skip when existingIdx === -1 AND verdict is not in FRESH_INSERT_VERDICTS — pin the gate's exact source-text shape against drift.",
    ).toBe(true);
  });

  it("recordUrlOutcome no longer has the legacy isTerminalVerdict-only gate", () => {
    // Pre-T6.7 the gate was `if (!isTerminalVerdict(v.verdict)) return null;`
    // sitting BEFORE the existingIdx lookup. T6.7 replaces it with the
    // existingIdx-aware gate. This negative invariant catches a future
    // regression where someone re-introduces the old single-line gate.
    expect(
      /^\s*if\s*\(\s*!isTerminalVerdict\(v\.verdict\)\s*\)\s*return\s+null;\s*$/m.test(
        SRC.split("export async function recordUrlOutcome")[1] ?? "",
      ),
    ).toBe(false);
  });

  it("isTerminalVerdict membership is unchanged (pre-landing verdicts stay non-terminal)", () => {
    // T6.7 deliberately does NOT promote pre-landing verdicts to terminal.
    // The fix is at the persistence gate, not the verdict taxonomy.
    const setBlock = SRC.match(/const TERMINAL_VERDICTS[\s\S]*?\]\)/)?.[0];
    expect(setBlock).toBeTruthy();
    if (setBlock) {
      expect(setBlock).toContain('"helping"');
      expect(setBlock).toContain('"hurting"');
      expect(setBlock).toContain('"nothing_yet"');
      expect(setBlock).toContain('"not_implemented"');
      expect(setBlock).not.toContain('"weak_signal"');
      expect(setBlock).not.toContain('"too_early"');
    }
  });

});
});

describe("computeUrlVerdict boundary (folded from the url-verdict suite)", () => {
function series(start: string, counts: number[]): DailyPoint[] {
  const out: DailyPoint[] = [];
  const t0 = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < counts.length; i++) {
    const iso = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: iso, count: counts[i] });
  }
  return out;
}
describe("computeUrlVerdict — verdict classification", () => {
  it("returns helping when z ≥ 2 and sustain ≥ 5", () => {
    // Baseline 5±0 (sigma floors to 1). Post 10/day for 14d → z enormous.
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("helping");
    expect(r.z!).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.zBar);
    expect(r.sustain.up).toBe(7);
  });

  it("returns hurting when z ≤ −2 and sustain_down ≥ 5", () => {
    const s = series("2026-03-01", [
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
      0,
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("hurting");
    expect(r.z!).toBeLessThanOrEqual(-DEFAULT_THRESHOLDS.zBar);
    expect(r.sustain.down).toBe(7);
  });

  it("returns nothing_yet when |z| < 2 but ≥14d of post data", () => {
    // Baseline 10±1ish, post 10 — no real movement.
    const s = series("2026-03-01", [
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
      0,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.verdict).toBe("nothing_yet");
    expect(Math.abs(r.z!)).toBeLessThan(DEFAULT_THRESHOLDS.zBar);
  });

  it("returns too_early when post window has < 14 days", () => {
    // Strong lift but only 5 days after change.
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      10, 10, 10, 10, 10,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-20",
    });
    // Even though z is high, post window is only 5d which is < nothingYetMinDays (14).
    // But sustain up is 5, so helping verdict CAN still fire once we're in 5d.
    // The assertion: if sustain is hit, verdict can be helping even at N=5.
    // Otherwise too_early.
    expect(["helping", "too_early"]).toContain(r.verdict);
    if (r.verdict === "too_early") {
      expect(r.post_days).toBe(5);
    }
  });

});
describe("computeUrlVerdict — Poisson σ floor", () => {
  it("prevents a winner verdict on flat-baseline low-volume pages from a single citation blip", () => {
    // Baseline 14 days of 0, post 14 days of 1 (single citation/day).
    // Without σ floor: σ = 0, division by zero → fake infinite z → 'helping'.
    // With σ floor = 1, σ_used = 1, z = 1 / (1/√14) = √14 ≈ 3.74 → still helping, but
    // this is a true signal: 14 consecutive days with citations vs none before.
    const s = series("2026-03-01", [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    // This SHOULD be helping — 14 days of sustained citations is meaningful even if volume is tiny.
    expect(r.verdict).toBe("helping");
    expect(Number.isFinite(r.z!)).toBe(true); // σ floor prevents Infinity
  });

});
describe("computeUrlVerdict — confidence tier", () => {
  it("marks confidence high when |z| ≥ 3 and ≥14d of post data", () => {
    const s = series("2026-03-01", [
      5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
      0,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
    ]);
    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });
    expect(r.confidence).toBe("high");
  });

});
function tagSeries(
  points: DailyPoint[],
  tag: "benchmark" | "derived",
): DailyPoint[] {
  return points.map((p) => ({ ...p, source_type: tag }));
}
describe("computeUrlVerdict — mixed-source abstain guard", () => {
  it("abstains with not_enough_native_baseline when baseline is benchmark-only and post is derived-only", () => {
    // Baseline 5/day for 14d (benchmark era), then change, then 10/day for 14d (derived era).
    const baseline = tagSeries(
      series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "benchmark",
    );
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    // Change day is 2026-04-22 — not in either window.
    const changeDay: DailyPoint[] = [
      { date: "2026-04-22", count: 0, source_type: "derived" },
    ];
    const s = [...baseline, ...changeDay, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    expect(r.verdict).toBe("not_enough_native_baseline");
    expect(r.z).toBeNull();
    expect(r.delta_pct).toBeNull();
    expect(r.delta_abs).toBeNull();
    // Phase v4 Commit 7A (2026-04-30): summary now reflects the drop-benchmark
    // partial-overlap algorithm rather than the Commit 2 pure-split copy.
    expect(r.explanation.summary).toMatch(/pre-cutover/);
    expect(r.explanation.summary).toMatch(/native day/);
  });

  it("computes normally when baseline and post are both benchmark-tagged (pure same-source)", () => {
    const baseline = tagSeries(
      series("2026-03-01", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      "benchmark",
    );
    const afterChange = tagSeries(
      series("2026-03-16", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "benchmark",
    );
    const changeDay: DailyPoint[] = [
      { date: "2026-03-15", count: 0, source_type: "benchmark" },
    ];
    const s = [...baseline, ...changeDay, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-03-15",
      asOfDate: "2026-03-29",
    });

    expect(r.verdict).toBe("helping");
    expect(r.z).not.toBeNull();
  });

  it("does not fire the guard when ANY point is untagged (back-compat path)", () => {
    // Baseline has one untagged day — guard is disabled; normal Z-score math runs.
    const baseline: DailyPoint[] = [
      ...tagSeries(series("2026-04-08", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), "benchmark"),
      { date: "2026-04-21", count: 5 }, // untagged
    ];
    const afterChange = tagSeries(
      series("2026-04-23", [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      "derived",
    );
    const s = [...baseline, { date: "2026-04-22", count: 0 }, ...afterChange];

    const r = computeUrlVerdict({
      series: s,
      changeDate: "2026-04-22",
      asOfDate: "2026-05-06",
    });

    // Untagged baseline disables guard — engine computes normally.
    expect(r.verdict).toBe("helping");
    expect(r.verdict).not.toBe("not_enough_native_baseline");
  });

});

});

/**
 * Unit tests for the change-outcome store (thin persistence layer).
 * Covers pure converter + invariant enforcement + sparkline extraction + index projection.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type {
  NaturalControlResult,
  PlatformLift,
  RawPrePost,
} from "./natural-controls";
import type { UrlCitationHistory, UrlCitationSeries } from "../product/url-citation-history";

// The local store is mocked empty so loadAllChangeOutcomes falls through to the
// Supabase durable read (the hosted web-app path), the read whose silent
// failure site 1 fixes. Pure tests below never touch these mocks.
const localRows = { current: [] as unknown[] };
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => localRows.current,
  writeStore: async () => {},
}));
const supabaseRef = { throws: false };
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (supabaseRef.throws) throw new Error("supabase env unavailable");
    return {};
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
}));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildOutcomeSummaryIndex,
  buildSparklines,
  buildDrilldownView,
  fromNaturalControlResult,
  validateInvariants,
  loadAllChangeOutcomes,
} from "./change-outcome-store";
import { log } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CLASSIFIER_VERSION = "v1.0-test";

function mkLift(p: Partial<PlatformLift> = {}): PlatformLift {
  return {
    platform: p.platform ?? "overall",
    treated_pre_avg: p.treated_pre_avg ?? 5,
    treated_post_avg: p.treated_post_avg ?? 10,
    control_pre_avg: p.control_pre_avg ?? 5,
    control_post_avg: p.control_post_avg ?? 6,
    treated_delta: p.treated_delta ?? 5,
    control_delta: p.control_delta ?? 1,
    adjusted_lift: p.adjusted_lift ?? 4,
    relative_lift: p.relative_lift ?? 0.8,
    controls_used: p.controls_used ?? 3,
    pre_days_observed: p.pre_days_observed ?? 14,
    post_days_observed: p.post_days_observed ?? 14,
  };
}

function mkRaw(p: Partial<RawPrePost> = {}): RawPrePost {
  return {
    platform: p.platform ?? "overall",
    treated_pre_avg: p.treated_pre_avg ?? 0,
    treated_post_avg: p.treated_post_avg ?? 6,
    treated_delta: p.treated_delta ?? 6,
    pre_days_observed: p.pre_days_observed ?? 0,
    post_days_observed: p.post_days_observed ?? 14,
    caveat: p.caveat ?? "not a causal estimate",
  };
}

function mkResult(over: Partial<NaturalControlResult> = {}): NaturalControlResult {
  return {
    event_id: over.event_id ?? "e1",
    classifier_version: over.classifier_version ?? CLASSIFIER_VERSION,
    primary_bucket: over.primary_bucket ?? "content.faq.add",
    child_tags: over.child_tags ?? [],
    paired_with: over.paired_with ?? [],
    url: over.url ?? "/locations/t",
    url_type: over.url_type ?? "location",
    treatment_date: over.treatment_date ?? "2026-04-15",
    pre_window: over.pre_window ?? { start: "2026-04-01", end: "2026-04-14" },
    post_window: over.post_window ?? { start: "2026-04-16", end: "2026-04-29" },
    overall: over.overall ?? null,
    per_platform: over.per_platform ?? [],
    raw_overall: over.raw_overall ?? null,
    raw_per_platform: over.raw_per_platform ?? [],
    matched_control_count: over.matched_control_count ?? 0,
    matched_control_urls: over.matched_control_urls ?? [],
    excluded_control_count: over.excluded_control_count ?? 0,
    excluded_reasons: over.excluded_reasons ?? {},
    excluded_reasons_by_platform: over.excluded_reasons_by_platform ?? {},
    confidence: over.confidence ?? "low",
    status: over.status ?? "computed",
    warnings: over.warnings ?? [],
    rationale: over.rationale ?? "test",
    bundle_parent_id: over.bundle_parent_id ?? null,
    bundle_size: over.bundle_size ?? 1,
    computed_at: over.computed_at ?? new Date().toISOString(),
    ...over,
  };
}

function mkSeries(url: string, days: Array<{ date: string; count: number }>): UrlCitationSeries {
  return {
    url,
    raw_urls: [url],
    is_owned: true,
    daily: days.map((d) => ({ date: d.date, count: d.count, by_platform: { ChatGPT: d.count } })),
  };
}

function mkHistory(series: UrlCitationSeries[]): UrlCitationHistory {
  const allDates = new Set<string>();
  for (const s of series) for (const d of s.daily) allDates.add(d.date);
  const sorted = [...allDates].sort();
  return {
    built_at: new Date().toISOString(),
    date_range: { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null },
    distinct_urls: series.length,
    series,
  };
}

// ---------------------------------------------------------------------------
// fromNaturalControlResult — status branching
// ---------------------------------------------------------------------------

describe("fromNaturalControlResult", () => {
  it("computed status → computed block populated, raw is null", () => {
    const r = mkResult({ status: "computed", overall: mkLift(), per_platform: [mkLift({ platform: "ChatGPT" })], confidence: "medium" });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.computed).not.toBeNull();
    expect(s.computed!.overall.adjusted_lift).toBe(4);
    expect(s.computed!.per_platform).toHaveLength(1);
    expect(s.raw).toBeNull();
  });

  it("weak_estimate → raw block populated, computed is null, no adjusted_lift anywhere", () => {
    const r = mkResult({
      status: "weak_estimate",
      confidence: "low",
      raw_overall: mkRaw({ caveat: "1 control below threshold" }),
      raw_per_platform: [mkRaw({ platform: "ChatGPT" })],
    });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.computed).toBeNull();
    expect(s.raw).not.toBeNull();
    expect(s.raw!.overall.caveat).toMatch(/below threshold/);
    // Structural: the raw record has no adjusted_lift field at the type OR runtime level.
    expect((s.raw!.overall as unknown as Record<string, unknown>).adjusted_lift).toBeUndefined();
  });

  it("no_controls → raw block populated with explicit caveat, computed null", () => {
    const r = mkResult({
      status: "no_controls",
      confidence: "low",
      raw_overall: mkRaw({ caveat: "no viable controls — not a causal estimate" }),
    });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.computed).toBeNull();
    expect(s.raw).not.toBeNull();
    expect(s.raw!.overall.caveat).toMatch(/no viable controls/);
  });

  it("unsupported_scope → both computed and raw are null", () => {
    const r = mkResult({ status: "unsupported_scope", confidence: "low", url: null });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.computed).toBeNull();
    expect(s.raw).toBeNull();
  });

  it("ineligible_layer → both blocks null, but metadata preserved", () => {
    const r = mkResult({ status: "ineligible_layer", confidence: "low", primary_bucket: "finding.schema.invalid" });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.computed).toBeNull();
    expect(s.raw).toBeNull();
    expect(s.primary_bucket).toBe("finding.schema.invalid");
  });

  it("insufficient_baseline → both null (no lift can be emitted)", () => {
    const r = mkResult({ status: "insufficient_baseline", confidence: "low" });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.computed).toBeNull();
    expect(s.raw).toBeNull();
  });

  it("throws on computed status with null overall (type invariant violation)", () => {
    const r = mkResult({ status: "computed", overall: null });
    expect(() => fromNaturalControlResult(r, mkHistory([]))).toThrow(/invariant violation/);
  });

  it("throws on weak_estimate status with null raw_overall", () => {
    const r = mkResult({ status: "weak_estimate", raw_overall: null });
    expect(() => fromNaturalControlResult(r, mkHistory([]))).toThrow(/invariant violation/);
  });

  it("preserves excluded_reasons_by_platform", () => {
    const r = mkResult({
      status: "computed",
      overall: mkLift(),
      excluded_reasons_by_platform: {
        ChatGPT: { below_platform_floor: 2 },
        Perplexity: { below_platform_floor: 5, trend_slope_fail: 1 },
      },
    });
    const s = fromNaturalControlResult(r, mkHistory([]));
    expect(s.excluded_reasons_by_platform.Perplexity.below_platform_floor).toBe(5);
    expect(s.excluded_reasons_by_platform.Perplexity.trend_slope_fail).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// validateInvariants
// ---------------------------------------------------------------------------

describe("validateInvariants", () => {
  it("rejects both computed and raw populated", () => {
    const r = mkResult({ status: "computed", overall: mkLift() });
    const s = fromNaturalControlResult(r, mkHistory([]));
    s.raw = { kind: "raw", overall: mkRaw(), per_platform: [] };
    expect(() => validateInvariants(s)).toThrow(/both computed and raw are populated/);
  });

  it("rejects computed status without computed block", () => {
    const r = mkResult({ status: "computed", overall: mkLift() });
    const s = fromNaturalControlResult(r, mkHistory([]));
    s.computed = null;
    expect(() => validateInvariants(s)).toThrow(/requires computed block/);
  });

  it("rejects raw block on ineligible status", () => {
    const r = mkResult({ status: "ineligible_layer" });
    const s = fromNaturalControlResult(r, mkHistory([]));
    s.raw = { kind: "raw", overall: mkRaw(), per_platform: [] };
    expect(() => validateInvariants(s)).toThrow(/only weak\/no-controls\/insufficient-post may/);
  });
});

// ---------------------------------------------------------------------------
// Sparklines
// ---------------------------------------------------------------------------

describe("buildSparklines", () => {
  const treated = mkSeries("/locations/t", [
    { date: "2026-04-14", count: 3 },
    { date: "2026-04-15", count: 4 },
    { date: "2026-04-16", count: 7 },
    { date: "2026-04-17", count: 9 },
  ]);
  const c1 = mkSeries("/locations/c1", [
    { date: "2026-04-14", count: 4 },
    { date: "2026-04-15", count: 4 },
    { date: "2026-04-16", count: 5 },
    { date: "2026-04-17", count: 6 },
  ]);
  const c2 = mkSeries("/locations/c2", [
    { date: "2026-04-14", count: 2 },
    { date: "2026-04-15", count: 2 },
    { date: "2026-04-16", count: 3 },
    { date: "2026-04-17", count: 4 },
  ]);
  const history = mkHistory([treated, c1, c2]);

  it("includes treated series with per-platform breakdown", () => {
    const r = mkResult({
      status: "computed",
      overall: mkLift(),
      url: "/locations/t",
      pre_window: { start: "2026-04-14", end: "2026-04-15" },
      post_window: { start: "2026-04-16", end: "2026-04-17" },
      matched_control_urls: ["/locations/c1", "/locations/c2"],
    });
    const sp = buildSparklines(r, history);
    expect(sp).not.toBeNull();
    expect(sp!.treated.map((d) => d.count)).toEqual([3, 4, 7, 9]);
    expect(sp!.treated[0].by_platform.ChatGPT).toBe(3);
    expect(sp!.treatment_date).toBe(r.treatment_date);
  });

  it("populates control_reference only for computed status", () => {
    const r = mkResult({
      status: "computed",
      overall: mkLift(),
      url: "/locations/t",
      pre_window: { start: "2026-04-14", end: "2026-04-15" },
      post_window: { start: "2026-04-16", end: "2026-04-17" },
      matched_control_urls: ["/locations/c1", "/locations/c2"],
    });
    const sp = buildSparklines(r, history);
    expect(sp!.control_reference).not.toBeNull();
    expect(sp!.control_reference!.length).toBe(4);
    expect(sp!.control_reference![0]).toMatchObject({ date: "2026-04-14", mean: 3, min: 2, max: 4, n: 2 });
    expect(sp!.control_urls).toEqual(["/locations/c1", "/locations/c2"]);
  });

  it("suppresses control_reference for weak_estimate even if control URLs exist", () => {
    const r = mkResult({
      status: "weak_estimate",
      raw_overall: mkRaw(),
      url: "/locations/t",
      pre_window: { start: "2026-04-14", end: "2026-04-15" },
      post_window: { start: "2026-04-16", end: "2026-04-17" },
      matched_control_urls: ["/locations/c1"],
    });
    const sp = buildSparklines(r, history);
    expect(sp!.control_reference).toBeNull();
    expect(sp!.control_urls).toEqual([]);
  });

  it("returns null when treated URL has no series", () => {
    const r = mkResult({ url: "/nonexistent", pre_window: { start: "2026-04-14", end: "2026-04-15" }, post_window: { start: "2026-04-16", end: "2026-04-17" } });
    const sp = buildSparklines(r, history);
    expect(sp).toBeNull();
  });

  it("returns null when windows are missing", () => {
    const r = mkResult({ pre_window: null, post_window: null });
    const sp = buildSparklines(r, history);
    expect(sp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Summary index
// ---------------------------------------------------------------------------

describe("buildOutcomeSummaryIndex", () => {
  it("projects adjusted_lift ONLY for computed entries", () => {
    const computed = fromNaturalControlResult(
      mkResult({ event_id: "c1", status: "computed", overall: mkLift({ adjusted_lift: 3.5 }) }),
      mkHistory([]),
    );
    const weak = fromNaturalControlResult(
      mkResult({ event_id: "w1", status: "weak_estimate", raw_overall: mkRaw({ treated_delta: 8 }) }),
      mkHistory([]),
    );
    const nocon = fromNaturalControlResult(
      mkResult({ event_id: "n1", status: "no_controls", raw_overall: mkRaw({ treated_delta: 12 }) }),
      mkHistory([]),
    );
    const unsup = fromNaturalControlResult(
      mkResult({ event_id: "u1", status: "unsupported_scope" }),
      mkHistory([]),
    );
    const idx = buildOutcomeSummaryIndex([computed, weak, nocon, unsup]);

    const cEntry = idx.entries.find((e) => e.source_id === "c1")!;
    const wEntry = idx.entries.find((e) => e.source_id === "w1")!;
    const nEntry = idx.entries.find((e) => e.source_id === "n1")!;
    const uEntry = idx.entries.find((e) => e.source_id === "u1")!;

    expect(cEntry.adjusted_lift).toBe(3.5);
    expect(cEntry.raw_treated_delta).toBeNull();

    expect(wEntry.adjusted_lift).toBeNull();
    expect(wEntry.raw_treated_delta).toBe(8);

    expect(nEntry.adjusted_lift).toBeNull();
    expect(nEntry.raw_treated_delta).toBe(12);

    expect(uEntry.adjusted_lift).toBeNull();
    expect(uEntry.raw_treated_delta).toBeNull();

    expect(idx.by_status.computed).toBe(1);
    expect(idx.by_status.weak_estimate).toBe(1);
    expect(idx.by_status.no_controls).toBe(1);
    expect(idx.by_status.unsupported_scope).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Drilldown view
// ---------------------------------------------------------------------------

describe("buildDrilldownView", () => {
  it("uses computed tldr for computed outcomes", () => {
    const o = fromNaturalControlResult(
      mkResult({ status: "computed", overall: mkLift({ adjusted_lift: 4.2 }), confidence: "medium" }),
      mkHistory([]),
    );
    const v = buildDrilldownView(o);
    expect(v.status_label).toMatch(/Computed/);
    expect(v.tldr).toMatch(/adjusted_lift=4\.2/);
  });

  it("uses raw tldr with caveat for weak_estimate", () => {
    const o = fromNaturalControlResult(
      mkResult({ status: "weak_estimate", raw_overall: mkRaw({ treated_delta: 6.5, caveat: "below threshold" }) }),
      mkHistory([]),
    );
    const v = buildDrilldownView(o);
    expect(v.status_label).toMatch(/Weak estimate/);
    expect(v.tldr).toMatch(/raw treated_delta=6\.5/);
    expect(v.tldr).toMatch(/below threshold/);
  });

  it("buckets warnings into alert vs info", () => {
    const o = fromNaturalControlResult(
      mkResult({
        status: "computed",
        overall: mkLift(),
        warnings: [
          "treated_url_post_overlap: another change landed during post window",
          "thin_control_set: 2 controls, target ≥3 for HIGH",
        ],
      }),
      mkHistory([]),
    );
    const v = buildDrilldownView(o);
    expect(v.warnings_grouped.alert.length).toBe(1); // overlap → alert
    expect(v.warnings_grouped.info.length).toBe(1); // thin_control_set → info
  });
});

describe("loadAllChangeOutcomes: Supabase read failure is logged, never a silent empty list", () => {
  const prevDataSource = process.env.DATA_SOURCE;
  afterEach(() => {
    if (prevDataSource === undefined) delete process.env.DATA_SOURCE;
    else process.env.DATA_SOURCE = prevDataSource;
    localRows.current = [];
    supabaseRef.throws = false;
    vi.mocked(log.warn).mockClear();
  });

  it("logs and falls back to local ([]) when the durable Supabase read throws", async () => {
    process.env.DATA_SOURCE = "supabase"; // arm the READ gate
    localRows.current = []; // empty local -> fall through to Supabase
    supabaseRef.throws = true; // getSupabaseAdmin throws inside the try
    const out = await loadAllChangeOutcomes();
    expect(out).toEqual([]);
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![0]).toContain("change-outcome-store");
  });
});

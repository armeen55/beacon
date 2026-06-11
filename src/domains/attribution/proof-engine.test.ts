/**
 * proof-engine — END-TO-END Proof Engine activation (2026-06-11).
 *
 * The marquee pin: a tenant's changelog + citation history flow through
 * the WHOLE pipeline (classify → diff-in-diff → persist) and produce a
 * real `computed` causal lift — the customer-facing causal proof that
 * had zero runtime path before today. Plus: ineligible events are never
 * persisted as fake proof, and the engine stays deterministic/LLM-free.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildAndPersistTenantProof } from "./proof-engine";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type {
  UrlCitationHistory,
  UrlCitationSeries,
  UrlDailyCount,
} from "@/domains/product/url-citation-history";
import type { StoredChangeOutcome } from "./change-outcome-store";

const TENANT = "tenant-proof-e2e";

function days(start: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(start + "T00:00:00Z").getTime();
  for (let i = 0; i < n; i++) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Daily series at a flat per-day count across [start, start+n). */
function series(url: string, ranges: Array<{ start: string; n: number; perDay: number }>): UrlCitationSeries {
  const daily: UrlDailyCount[] = [];
  for (const r of ranges) {
    for (const d of days(r.start, r.n)) {
      if (r.perDay > 0) daily.push({ date: d, count: r.perDay, by_platform: { perplexity: r.perDay }, source_type: "derived" });
    }
  }
  return { url, raw_urls: [url], is_owned: true, daily };
}

function entry(over: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: "ch-roofing", timestamp: "2026-05-15T00:00:00.000Z", signal_type: "content",
    asset_type: "service_page", url: "/services/roofing", asset_name: "Roofing",
    change_description: "Rebuilt the roofing service page with a cost section + FAQs.",
    topic_targeted: "roofing", city_targeted: null, hypothesis: null,
    expected_impact_window: null, brief_id: null, opportunity_id: null, notes: null,
    created_at: "2026-05-15T00:00:00.000Z", updated_at: "2026-05-15T00:00:00.000Z",
    ...over,
  } as ChangelogEntry;
}

// Treated /services/roofing jumps 1→3 cit/day post-edit; two comparable
// untreated service URLs stay flat at 1/day → control delta ≈ 0 →
// adjusted lift ≈ +2 → status "computed".
function historyFixture(): UrlCitationHistory {
  return {
    built_at: "2026-05-30T00:00:00Z",
    date_range: { first: "2026-05-01", last: "2026-05-30" },
    distinct_urls: 3,
    series: [
      series("/services/roofing", [
        { start: "2026-05-01", n: 14, perDay: 1 }, // pre
        { start: "2026-05-16", n: 14, perDay: 3 }, // post — the lift
      ]),
      series("/services/siding", [
        { start: "2026-05-01", n: 14, perDay: 1 },
        { start: "2026-05-16", n: 14, perDay: 1 }, // flat control
      ]),
      series("/services/gutters", [
        { start: "2026-05-01", n: 14, perDay: 1 },
        { start: "2026-05-16", n: 14, perDay: 1 }, // flat control
      ]),
    ],
  };
}

describe("buildAndPersistTenantProof — end-to-end causal proof", () => {
  it("produces a COMPUTED positive causal lift and persists it", async () => {
    const persisted: StoredChangeOutcome[] = [];
    const result = await buildAndPersistTenantProof(TENANT, {
      loadChangelog: async () => [entry({})],
      loadHistory: async () => historyFixture(),
      persist: async (o) => { persisted.push(...o); },
      today: "2026-05-30",
    });

    expect(result.computed).toBe(1);
    expect(result.persisted).toBe(1);
    expect(persisted).toHaveLength(1);

    const outcome = persisted[0]!;
    expect(outcome.source_id).toBe("ch-roofing");
    // The causal block exists with a positive adjusted lift (treated +2,
    // controls flat → diff-in-diff ≈ +2 cit/day).
    expect(outcome.computed).not.toBeNull();
    expect(outcome.computed!.overall.adjusted_lift).toBeGreaterThan(1);
    expect(outcome.computed!.overall.controls_used).toBeGreaterThanOrEqual(2);
  });

  it("NEVER persists ineligible events as fake proof (review + no-url skipped)", async () => {
    const persisted: StoredChangeOutcome[] = [];
    const result = await buildAndPersistTenantProof(TENANT, {
      loadChangelog: async () => [
        entry({ id: "rev", signal_type: "review", url: null }),
        entry({ id: "vague", url: null }),
      ],
      loadHistory: async () => historyFixture(),
      persist: async (o) => { persisted.push(...o); },
      today: "2026-05-30",
    });
    expect(result.persisted).toBe(0);
    expect(persisted).toHaveLength(0);
    expect(result.skipped_ineligible).toBeGreaterThanOrEqual(2);
  });

  it("a treated URL with too few comparable controls → NOT computed (honest weak/raw, no causal claim)", async () => {
    const persisted: StoredChangeOutcome[] = [];
    const onlyTreated: UrlCitationHistory = {
      ...historyFixture(),
      distinct_urls: 1,
      series: [historyFixture().series[0]!], // treated only, no controls
    };
    const result = await buildAndPersistTenantProof(TENANT, {
      loadChangelog: async () => [entry({})],
      loadHistory: async () => onlyTreated,
      persist: async (o) => { persisted.push(...o); },
      today: "2026-05-30",
    });
    expect(result.computed).toBe(0); // the wedge: no causal claim without controls
    for (const o of persisted) expect(o.computed).toBeNull();
  });
});

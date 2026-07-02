/**
 * spike-store (2026-07-02, master plan item 14).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the
 * store real: GLOBAL classification (cron fan-out, rows carry tenant_id) and
 * the Supabase mirror entry (Vercel durability). Same discipline as the
 * pipeline-health-store sibling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

import {
  loadQuerySpikes,
  readQuerySpikeSummary,
  writeQuerySpikeSummary,
  type QuerySpikeSummaryRow,
} from "./spike-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import type { QuerySpike } from "./query-spikes";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function spike(over: Partial<QuerySpike> = {}): QuerySpike {
  return {
    query: "chaharshanbe suri 2026",
    thisWeek: 190,
    typicalWeek: 45,
    ratio: 4.2,
    thisWeekClicks: 12,
    topPage: "https://iranopedia.com/chaharshanbe-suri",
    sentence: 'Searches for "chaharshanbe suri 2026" are 4.2x their usual this week, about 190 times shown on Google versus 45 in a typical week.',
    ...over,
  };
}

function summary(over: Partial<QuerySpikeSummaryRow> = {}): QuerySpikeSummaryRow {
  return {
    tenant_id: "tenant-a",
    computed_at: NOW.toISOString(),
    anchor_date: "2026-06-28",
    spikes: [spike()],
    ...over,
  };
}

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("trend-query-spikes is a GLOBAL store (cron fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("trend-query-spikes")).toBe("global");
  });

  it("trend-query-spikes is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"trend-query-spikes"');
  });
});

describe("round-trip", () => {
  it("writes the latest pass and reads it back for the same tenant", async () => {
    await writeQuerySpikeSummary(summary());
    const back = await readQuerySpikeSummary("tenant-a", NOW);
    expect(back?.anchor_date).toBe("2026-06-28");
    expect(back?.spikes).toHaveLength(1);
    expect(await loadQuerySpikes("tenant-a", NOW)).toHaveLength(1);
  });

  it("latest write wins per tenant; other tenants are untouched", async () => {
    await writeQuerySpikeSummary(summary({ tenant_id: "tenant-b", spikes: [] }));
    await writeQuerySpikeSummary(summary({ computed_at: "2026-07-01T02:00:00.000Z", spikes: [] }));
    await writeQuerySpikeSummary(summary({ computed_at: "2026-07-02T02:00:00.000Z" }));
    expect(stored).toHaveLength(2);
    const back = await readQuerySpikeSummary("tenant-a", NOW);
    expect(back?.computed_at).toBe("2026-07-02T02:00:00.000Z");
    expect(back?.spikes).toHaveLength(1);
    expect(await loadQuerySpikes("tenant-b", NOW)).toHaveLength(0);
  });

  it("an empty spike list round-trips (checked-and-quiet is a real state)", async () => {
    await writeQuerySpikeSummary(summary({ spikes: [], anchor_date: null }));
    const back = await readQuerySpikeSummary("tenant-a", NOW);
    expect(back).not.toBeNull();
    expect(back?.spikes).toHaveLength(0);
  });

  it("a pass older than 7 days is honest staleness: reads as absent", async () => {
    await writeQuerySpikeSummary(summary({ computed_at: "2026-06-24T02:00:00.000Z" }));
    expect(await readQuerySpikeSummary("tenant-a", NOW)).toBeNull();
    expect(await loadQuerySpikes("tenant-a", NOW)).toHaveLength(0);
  });

  it("unknown tenant reads as absent", async () => {
    await writeQuerySpikeSummary(summary());
    expect(await readQuerySpikeSummary("tenant-z", NOW)).toBeNull();
  });
});

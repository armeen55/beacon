/**
 * algorithm-weather-store (2026-07-02, master plan item 32).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the
 * store real: GLOBAL classification (cron fan-out, rows carry tenant_id) and
 * the Supabase mirror entry (Vercel durability). Same discipline as the
 * trend-radar/spike-store.test.ts sibling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: unknown[] = [];
const readRef = { throws: false };
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => {
    if (readRef.throws) throw new Error("store read failed");
    return stored;
  },
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  loadDetectedChangepoints,
  readAlgorithmWeatherSummary,
  writeAlgorithmWeatherSummary,
  type AlgorithmWeatherRow,
} from "./algorithm-weather-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import { log } from "@/lib/logger";
import type { Changepoint } from "./changepoint";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function cp(over: Partial<Changepoint> = {}): Changepoint {
  return { date: "2026-06-28", direction: "up", magnitude: 0.55, ...over };
}

function summary(over: Partial<AlgorithmWeatherRow> = {}): AlgorithmWeatherRow {
  return {
    tenant_id: "tenant-a",
    computed_at: NOW.toISOString(),
    anchor_date: "2026-06-28",
    clicksChangepoints: [cp()],
    impressionsChangepoints: [],
    ...over,
  };
}

beforeEach(() => {
  stored = [];
  readRef.throws = false;
});

describe("registration pins", () => {
  it("algorithm-weather-shocks is a GLOBAL store (cron fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("algorithm-weather-shocks")).toBe("global");
  });

  it("algorithm-weather-shocks is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"algorithm-weather-shocks"');
  });
});

describe("round-trip", () => {
  it("writes the latest pass and reads it back for the same tenant", async () => {
    await writeAlgorithmWeatherSummary(summary());
    const back = await readAlgorithmWeatherSummary("tenant-a", NOW);
    expect(back?.anchor_date).toBe("2026-06-28");
    expect(back?.clicksChangepoints).toHaveLength(1);
    expect(await loadDetectedChangepoints("tenant-a", NOW)).toHaveLength(1);
  });

  it("latest write wins per tenant; other tenants are untouched", async () => {
    await writeAlgorithmWeatherSummary(summary({ tenant_id: "tenant-b", clicksChangepoints: [] }));
    await writeAlgorithmWeatherSummary(summary({ computed_at: "2026-07-01T02:00:00.000Z", clicksChangepoints: [] }));
    await writeAlgorithmWeatherSummary(summary({ computed_at: "2026-07-02T02:00:00.000Z" }));
    expect(stored).toHaveLength(2);
    const back = await readAlgorithmWeatherSummary("tenant-a", NOW);
    expect(back?.computed_at).toBe("2026-07-02T02:00:00.000Z");
    expect(back?.clicksChangepoints).toHaveLength(1);
    expect(await loadDetectedChangepoints("tenant-b", NOW)).toHaveLength(0);
  });

  it("an empty changepoint pair round-trips (checked-and-quiet is a real state)", async () => {
    await writeAlgorithmWeatherSummary(summary({ clicksChangepoints: [], anchor_date: null }));
    const back = await readAlgorithmWeatherSummary("tenant-a", NOW);
    expect(back).not.toBeNull();
    expect(back?.clicksChangepoints).toHaveLength(0);
  });

  it("a pass older than 30 days is honest staleness: reads as absent", async () => {
    await writeAlgorithmWeatherSummary(summary({ computed_at: "2026-05-01T02:00:00.000Z" }));
    expect(await readAlgorithmWeatherSummary("tenant-a", NOW)).toBeNull();
    expect(await loadDetectedChangepoints("tenant-a", NOW)).toHaveLength(0);
  });

  it("unknown tenant reads as absent", async () => {
    await writeAlgorithmWeatherSummary(summary());
    expect(await readAlgorithmWeatherSummary("tenant-z", NOW)).toBeNull();
  });

  it("a read failure reads as absent (null) AND logs (feeds the money-honest shock gate)", async () => {
    readRef.throws = true;
    vi.mocked(log.warn).mockClear();
    const back = await readAlgorithmWeatherSummary("tenant-a", NOW);
    expect(back).toBeNull();
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![0]).toContain("algorithm-weather-store");
  });

  it("merges clicks + impressions changepoints, deduping identical date+direction", async () => {
    await writeAlgorithmWeatherSummary(
      summary({
        clicksChangepoints: [cp({ date: "2026-06-28", direction: "up" })],
        impressionsChangepoints: [cp({ date: "2026-06-28", direction: "up" }), cp({ date: "2026-06-29", direction: "down" })],
      }),
    );
    const merged = await loadDetectedChangepoints("tenant-a", NOW);
    expect(merged).toHaveLength(2);
  });
});

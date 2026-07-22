/**
 * aa-calibration-store (2026-07-02, master plan item 31).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the
 * store real: GLOBAL classification (cron fan-out, rows carry tenant_id) and
 * the Supabase mirror entry (Vercel durability). Same discipline as the
 * trend-query-spikes / language-gap-matrix siblings.
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
  readAaCalibration,
  writeAaCalibration,
  readFloorsFor,
  type AaCalibrationRow,
} from "@/domains/proof-gsc/aa-calibration-store";
import { classifyStore } from "@/lib/persistence/store-classification";
import { log } from "@/lib/logger";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function row(over: Partial<AaCalibrationRow> = {}): AaCalibrationRow {
  return {
    tenant_id: "tenant-a",
    computed_at: NOW.toISOString(),
    sampleSize: 20,
    falsePositiveRate: 0.05,
    byTrafficTier: [
      { tier: "low", sampleSize: 5, falsePositiveRate: 0.2, derivedMinLiftClicks: 3, derivedMinLiftCtr: 0.003 },
      { tier: "medium", sampleSize: 8, falsePositiveRate: 0.0, derivedMinLiftClicks: 3, derivedMinLiftCtr: 0.003 },
      { tier: "high", sampleSize: 7, falsePositiveRate: 0.05, derivedMinLiftClicks: 5, derivedMinLiftCtr: 0.004 },
    ],
    cumulativeSampleSize: 120,
    ...over,
  };
}

beforeEach(() => {
  stored = [];
  readRef.throws = false;
});

describe("registration pins", () => {
  it("aa-calibration is a GLOBAL store (cron fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("aa-calibration")).toBe("global");
  });

  it("aa-calibration is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../src/lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"aa-calibration"');
  });
});

describe("round-trip", () => {
  it("writes the latest pass and reads it back for the same tenant", async () => {
    await writeAaCalibration(row());
    const back = await readAaCalibration("tenant-a", NOW);
    expect(back?.sampleSize).toBe(20);
    expect(back?.byTrafficTier).toHaveLength(3);
  });

  it("latest write wins per tenant; other tenants are untouched", async () => {
    await writeAaCalibration(row({ tenant_id: "tenant-b", sampleSize: 1 }));
    await writeAaCalibration(row({ computed_at: "2026-07-01T02:00:00.000Z", sampleSize: 99 }));
    await writeAaCalibration(row({ computed_at: "2026-07-02T02:00:00.000Z", sampleSize: 20 }));
    expect(stored).toHaveLength(2);
    const back = await readAaCalibration("tenant-a", NOW);
    expect(back?.computed_at).toBe("2026-07-02T02:00:00.000Z");
    expect(back?.sampleSize).toBe(20);
    expect((await readAaCalibration("tenant-b", NOW))?.sampleSize).toBe(1);
  });

  it("a pass older than 30 days is honest staleness: reads as absent", async () => {
    await writeAaCalibration(row({ computed_at: "2026-05-01T00:00:00.000Z" }));
    expect(await readAaCalibration("tenant-a", NOW)).toBeNull();
  });

  it("unknown tenant reads as absent", async () => {
    await writeAaCalibration(row());
    expect(await readAaCalibration("tenant-z", NOW)).toBeNull();
  });

  it("a read failure reads as absent (null) AND logs (floors then fall back to defaults, visibly)", async () => {
    readRef.throws = true;
    vi.mocked(log.warn).mockClear();
    const back = await readAaCalibration("tenant-a", NOW);
    expect(back).toBeNull();
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![0]).toContain("aa-calibration-store");
  });
});

describe("readFloorsFor — the measure.ts integration point", () => {
  it("returns {} (fail-soft default) when no calibration exists", async () => {
    expect(await readFloorsFor("tenant-none", "medium", NOW)).toEqual({});
  });

  it("returns the tier's derived floors when a fresh calibration exists", async () => {
    await writeAaCalibration(row());
    expect(await readFloorsFor("tenant-a", "high", NOW)).toEqual({ minLiftClicks: 5, minLiftCtr: 0.004 });
    expect(await readFloorsFor("tenant-a", "low", NOW)).toEqual({ minLiftClicks: 3, minLiftCtr: 0.003 });
  });

  it("returns {} when the calibration has no data for the requested tier", async () => {
    await writeAaCalibration(row({ byTrafficTier: [row().byTrafficTier[0]!] })); // only "low"
    expect(await readFloorsFor("tenant-a", "high", NOW)).toEqual({});
  });

  it("returns {} when the calibration is stale (never silently applies old floors)", async () => {
    await writeAaCalibration(row({ computed_at: "2026-01-01T00:00:00.000Z" }));
    expect(await readFloorsFor("tenant-a", "high", NOW)).toEqual({});
  });
});

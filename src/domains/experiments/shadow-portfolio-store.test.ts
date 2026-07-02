/**
 * shadow-portfolio-store (2026-07-02, master plan item 65).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the
 * store real: GLOBAL classification (captured at plan time, rows carry
 * tenant_id) and the Supabase mirror entry (Vercel durability). Same
 * discipline as the trend-radar spike-store sibling, except APPEND-ONLY:
 * each night's batch is its own historical fact, never overwritten by a
 * later batch (unlike spike-store's latest-wins).
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
  writeShadowPortfolioBatch,
  readShadowPortfolioBatches,
  readShadowPortfolioCandidates,
  type ShadowPortfolioBatch,
  type ShadowCandidate,
} from "./shadow-portfolio-store";
import { classifyStore } from "@/lib/persistence/store-classification";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function candidate(over: Partial<ShadowCandidate> = {}): ShadowCandidate {
  return {
    page: "https://iranopedia.com/persian-cat-names",
    pagePath: "/persian-cat-names",
    lever: "meta",
    pageFamily: "persian-cat-names",
    targetQuery: "persian cat names",
    score: 42.5,
    forecastLow: 5,
    forecastHigh: 15,
    ...over,
  };
}

function batch(over: Partial<ShadowPortfolioBatch> = {}): ShadowPortfolioBatch {
  return {
    tenant_id: "tenant-a",
    plan_id: "tenant-a::2026-07-02::abc123",
    date: "2026-07-02",
    captured_at: NOW.toISOString(),
    candidates: [candidate()],
    ...over,
  };
}

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("shadow-portfolio-candidates is a GLOBAL store (captured at plan time; rows carry tenant_id)", () => {
    expect(classifyStore("shadow-portfolio-candidates")).toBe("global");
  });

  it("shadow-portfolio-candidates is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"shadow-portfolio-candidates"');
  });
});

describe("round-trip", () => {
  it("writes a batch and reads it back for the same tenant", async () => {
    await writeShadowPortfolioBatch(batch());
    const back = await readShadowPortfolioBatches("tenant-a", NOW);
    expect(back).toHaveLength(1);
    expect(back[0]?.candidates).toHaveLength(1);
    expect(await readShadowPortfolioCandidates("tenant-a", NOW)).toHaveLength(1);
  });

  it("caps a batch to the top 5 candidates even if more are passed in", async () => {
    const many = Array.from({ length: 8 }, (_, i) => candidate({ page: `https://iranopedia.com/p${i}` }));
    await writeShadowPortfolioBatch(batch({ candidates: many }));
    const back = await readShadowPortfolioBatches("tenant-a", NOW);
    expect(back[0]?.candidates).toHaveLength(5);
  });

  it("is append-only across nights: two different plan ids both survive", async () => {
    await writeShadowPortfolioBatch(batch({ plan_id: "plan-1", date: "2026-06-30", captured_at: "2026-06-30T02:00:00.000Z" }));
    await writeShadowPortfolioBatch(batch({ plan_id: "plan-2", date: "2026-07-01", captured_at: "2026-07-01T02:00:00.000Z" }));
    const back = await readShadowPortfolioBatches("tenant-a", NOW);
    expect(back).toHaveLength(2);
    // Oldest first.
    expect(back[0]?.plan_id).toBe("plan-1");
    expect(back[1]?.plan_id).toBe("plan-2");
  });

  it("re-planning the same day (same plan id) replaces that day's batch, not accumulates", async () => {
    await writeShadowPortfolioBatch(batch({ candidates: [candidate({ score: 1 })] }));
    await writeShadowPortfolioBatch(batch({ candidates: [candidate({ score: 2 })] }));
    const back = await readShadowPortfolioBatches("tenant-a", NOW);
    expect(back).toHaveLength(1);
    expect(back[0]?.candidates[0]?.score).toBe(2);
  });

  it("other tenants are untouched", async () => {
    await writeShadowPortfolioBatch(batch({ tenant_id: "tenant-b" }));
    expect(await readShadowPortfolioBatches("tenant-a", NOW)).toHaveLength(0);
    expect(await readShadowPortfolioBatches("tenant-b", NOW)).toHaveLength(1);
  });

  it("an empty candidate list round-trips (checked, nothing eligible-but-skipped is a real state)", async () => {
    await writeShadowPortfolioBatch(batch({ candidates: [] }));
    const back = await readShadowPortfolioBatches("tenant-a", NOW);
    expect(back).toHaveLength(1);
    expect(back[0]?.candidates).toHaveLength(0);
  });

  it("a batch older than the max age is honest staleness: reads as absent", async () => {
    await writeShadowPortfolioBatch(batch({ captured_at: "2026-01-01T00:00:00.000Z" }));
    expect(await readShadowPortfolioBatches("tenant-a", NOW)).toHaveLength(0);
    expect(await readShadowPortfolioCandidates("tenant-a", NOW)).toHaveLength(0);
  });

  it("unknown tenant reads as absent", async () => {
    await writeShadowPortfolioBatch(batch());
    expect(await readShadowPortfolioBatches("tenant-z", NOW)).toHaveLength(0);
  });

  it("readShadowPortfolioCandidates flattens batches and carries capturedAt/planId/date per candidate", async () => {
    await writeShadowPortfolioBatch(batch());
    const flat = await readShadowPortfolioCandidates("tenant-a", NOW);
    expect(flat[0]?.capturedAt).toBe(NOW.toISOString());
    expect(flat[0]?.planId).toBe("tenant-a::2026-07-02::abc123");
    expect(flat[0]?.date).toBe("2026-07-02");
    expect(flat[0]?.page).toBe("https://iranopedia.com/persian-cat-names");
  });
});

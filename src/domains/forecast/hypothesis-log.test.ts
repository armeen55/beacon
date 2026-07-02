/**
 * hypothesis-log (2026-07-02, DREAM SITE V1 item D7).
 *
 * Round-trip on an in-memory json-store + idempotency (a rendered hypothesis logs once per
 * hypothesisId) + the registration pins that make the store real: GLOBAL classification (rows
 * carry tenant_id) and the Supabase mirror entry (Vercel durability) - same discipline as
 * forecast-calibration-store.test.ts.
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
  captureHypothesis,
  hasHypothesisRecord,
  loadHypothesisLog,
  computeAndCaptureOpportunity,
} from "./hypothesis-log";
import { computeOpportunity, type OpportunityForecast } from "./opportunity-math";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("opportunity-hypotheses is a GLOBAL store (fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("opportunity-hypotheses")).toBe("global");
  });

  it("opportunity-hypotheses is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"opportunity-hypotheses"');
  });
});

const fx: OpportunityForecast = {
  lowPerMonth: 20,
  highPerMonth: 60,
  days: 14,
  basis: "Based on your own click rates at each Google position, a meta change at position 8 usually adds 20 to 60 clicks a month within 14 days.",
  hypothesisId: "h1",
};

describe("round-trip", () => {
  it("captures and reads back a hypothesis for the right tenant", async () => {
    const wrote = await captureHypothesis("tenant-a", "https://s.com/a", "meta", fx, "2026-07-02T00:00:00Z");
    expect(wrote).toBe(true);
    const rows = await loadHypothesisLog("tenant-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hypothesisId).toBe("h1");
    expect(rows[0]!.lowPerMonth).toBe(20);
    expect(rows[0]!.highPerMonth).toBe(60);
    expect(rows[0]!.days).toBe(14);
    expect(rows[0]!.basis).toBe(fx.basis);
  });

  it("scopes reads to the requesting tenant only", async () => {
    await captureHypothesis("tenant-a", "u", "meta", { ...fx, hypothesisId: "h1" });
    await captureHypothesis("tenant-b", "u", "meta", { ...fx, hypothesisId: "h2" });
    expect(await loadHypothesisLog("tenant-a")).toHaveLength(1);
    expect(await loadHypothesisLog("tenant-b")).toHaveLength(1);
  });

  it("idempotent: capturing the same hypothesisId twice is a no-op (never overwrites)", async () => {
    expect(await captureHypothesis("t", "u", "meta", { ...fx, hypothesisId: "h1", lowPerMonth: 20 })).toBe(true);
    expect(await captureHypothesis("t", "u", "meta", { ...fx, hypothesisId: "h1", lowPerMonth: 999 })).toBe(false);
    const rows = await loadHypothesisLog("t");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lowPerMonth).toBe(20); // the FIRST capture stands - never mutated
  });

  it("hasHypothesisRecord reflects the idempotency guard", async () => {
    expect(await hasHypothesisRecord("t", "h1")).toBe(false);
    await captureHypothesis("t", "u", "meta", { ...fx, hypothesisId: "h1" });
    expect(await hasHypothesisRecord("t", "h1")).toBe(true);
  });

  it("captures a null-range (honest 'not enough history') hypothesis too - the absence itself is falsifiable", async () => {
    const honest: OpportunityForecast = { lowPerMonth: null, highPerMonth: null, days: 28, basis: "I do not have enough history to size this yet.", hypothesisId: "h-none" };
    await captureHypothesis("t", "u", "create_page", honest);
    const rows = await loadHypothesisLog("t");
    expect(rows[0]!.lowPerMonth).toBeNull();
    expect(rows[0]!.highPerMonth).toBeNull();
  });

  it("read is fail-soft: a throwing store reads as an empty list", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "readStore").mockRejectedValueOnce(new Error("disk gone"));
    expect(await loadHypothesisLog("t")).toEqual([]);
    spy.mockRestore();
  });

  it("capture is fail-soft: a throwing store returns false, never throws", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "writeStore").mockRejectedValueOnce(new Error("disk gone"));
    await expect(captureHypothesis("t", "u", "meta", fx)).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe("never mutates existing rows on append (additive-only ledger)", () => {
  it("keeps every prior record byte-identical after a new capture", async () => {
    await captureHypothesis("t", "u1", "meta", { ...fx, hypothesisId: "h1" }, "2026-07-01T00:00:00Z");
    const before = JSON.stringify((await loadHypothesisLog("t"))[0]);
    await captureHypothesis("t", "u2", "title", { ...fx, hypothesisId: "h2" }, "2026-07-02T00:00:00Z");
    const after = (await loadHypothesisLog("t")).find((r) => r.hypothesisId === "h1");
    expect(JSON.stringify(after)).toBe(before);
  });
});

describe("computeAndCaptureOpportunity - compute-and-log in one call", () => {
  it("returns the computed forecast and logs it exactly once", async () => {
    const input = { tenantId: "t", page: "https://s.com/p", lever: "meta", currentPosition: 8, impressions90d: 5000, clicks90d: 100 };
    const result = await computeAndCaptureOpportunity(input, computeOpportunity);
    expect(result.lowPerMonth).not.toBeNull();
    const rows = await loadHypothesisLog("t");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hypothesisId).toBe(result.hypothesisId);
  });

  it("still returns the forecast even if the capture write fails (render must never break on a logging hiccup)", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "writeStore").mockRejectedValueOnce(new Error("disk gone"));
    const input = { tenantId: "t", page: "https://s.com/p", lever: "meta" };
    const result = await computeAndCaptureOpportunity(input, computeOpportunity);
    expect(result.basis).toContain("I do not have enough history to size this yet");
    spy.mockRestore();
  });
});

/**
 * hypothesis-log (2026-07-02, DREAM SITE V1 item D7; pruned 2026-07-21 to the surviving
 * write-only API after the dead read side was deleted).
 *
 * Round-trip on an in-memory json-store + idempotency (a rendered hypothesis logs once per
 * hypothesisId) + the registration pins that make the store real: GLOBAL classification (rows
 * carry tenant_id) and the Supabase mirror entry (Vercel durability) - same discipline as
 * forecast-calibration-store.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let stored: Array<Record<string, unknown>> = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: Array<Record<string, unknown>>) => {
    stored = data;
  },
}));

import { captureHypothesis } from "./hypothesis-log";
import type { OpportunityForecast } from "./opportunity-math";
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

describe("captureHypothesis", () => {
  it("captures a hypothesis with the forecast's exact numbers", async () => {
    const wrote = await captureHypothesis("tenant-a", "https://s.com/a", "meta", fx, "2026-07-02T00:00:00Z");
    expect(wrote).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      tenantId: "tenant-a",
      hypothesisId: "h1",
      lowPerMonth: 20,
      highPerMonth: 60,
      days: 14,
      basis: fx.basis,
      at: "2026-07-02T00:00:00Z",
    });
  });

  it("idempotent: capturing the same hypothesisId twice is a no-op (never overwrites)", async () => {
    expect(await captureHypothesis("t", "u", "meta", { ...fx, hypothesisId: "h1", lowPerMonth: 20 })).toBe(true);
    expect(await captureHypothesis("t", "u", "meta", { ...fx, hypothesisId: "h1", lowPerMonth: 999 })).toBe(false);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.lowPerMonth).toBe(20); // the FIRST capture stands - never mutated
  });

  it("the same hypothesisId under a DIFFERENT tenant still logs (scoped idempotency)", async () => {
    await captureHypothesis("tenant-a", "u", "meta", { ...fx, hypothesisId: "h1" });
    await captureHypothesis("tenant-b", "u", "meta", { ...fx, hypothesisId: "h1" });
    expect(stored).toHaveLength(2);
  });

  it("captures a null-range (honest 'not enough history') hypothesis too - the absence itself is falsifiable", async () => {
    const honest: OpportunityForecast = { lowPerMonth: null, highPerMonth: null, days: 28, basis: "I do not have enough history to size this yet.", hypothesisId: "h-none" };
    await captureHypothesis("t", "u", "create_page", honest);
    expect(stored[0]!.lowPerMonth).toBeNull();
    expect(stored[0]!.highPerMonth).toBeNull();
  });

  it("capture is fail-soft: a throwing store returns false, never throws", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "writeStore").mockRejectedValueOnce(new Error("disk gone"));
    await expect(captureHypothesis("t", "u", "meta", fx)).resolves.toBe(false);
    spy.mockRestore();
  });

  it("never mutates existing rows on append (additive-only ledger)", async () => {
    await captureHypothesis("t", "u1", "meta", { ...fx, hypothesisId: "h1" }, "2026-07-01T00:00:00Z");
    const before = JSON.stringify(stored[0]);
    await captureHypothesis("t", "u2", "title", { ...fx, hypothesisId: "h2" }, "2026-07-02T00:00:00Z");
    const after = stored.find((r) => r.hypothesisId === "h1");
    expect(JSON.stringify(after)).toBe(before);
  });
});

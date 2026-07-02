/**
 * publish-canary-store (2026-07-02, master plan item 86).
 *
 * Round-trip on an in-memory json-store + the registration pins that make the
 * store real: GLOBAL classification (cron fan-out, rows carry tenant_id) and
 * the Supabase mirror entry (Vercel durability). Mirrors the
 * pipeline-health-store test shape exactly.
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
  readPublishHealth,
  writePublishHealth,
  type PublishHealthRow,
} from "./publish-canary-store";
import { classifyStore } from "@/lib/persistence/store-classification";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function row(over: Partial<PublishHealthRow> = {}): PublishHealthRow {
  return {
    tenant_id: "tenant-a",
    whenIso: NOW.toISOString(),
    tokenOk: true,
    urlMapOk: true,
    dryRunOk: true,
    ...over,
  };
}

beforeEach(() => {
  stored = [];
});

describe("registration pins", () => {
  it("publish-health is a GLOBAL store (cron fan-out; rows carry tenant_id)", () => {
    expect(classifyStore("publish-health")).toBe("global");
  });

  it("publish-health is Supabase-mirrored (survives Vercel read-only fs)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/persistence/json-store.ts"), "utf8");
    const mirrorBlock = src.slice(src.indexOf("SUPABASE_MIRRORED_STORES"), src.indexOf("BLOBS_TABLE"));
    expect(mirrorBlock).toContain('"publish-health"');
  });
});

describe("round-trip", () => {
  it("writes the latest check and reads it back for the same tenant", async () => {
    await writePublishHealth(row());
    const back = await readPublishHealth("tenant-a", NOW);
    expect(back).not.toBeNull();
    expect(back!.tenant_id).toBe("tenant-a");
    expect(back!.tokenOk).toBe(true);
    expect(back!.urlMapOk).toBe(true);
    expect(back!.dryRunOk).toBe(true);
  });

  it("latest wins per tenant; other tenants untouched", async () => {
    await writePublishHealth(row({ tenant_id: "tenant-b" }));
    await writePublishHealth(row({ tokenOk: false, fixHint: "reconnect" }));
    await writePublishHealth(row());
    expect((await readPublishHealth("tenant-a", NOW))!.tokenOk).toBe(true);
    expect(await readPublishHealth("tenant-b", NOW)).not.toBeNull();
    expect((stored as PublishHealthRow[]).filter((r) => r.tenant_id === "tenant-a")).toHaveLength(1);
  });

  it("hides a check older than 7 days (honest staleness) and missing tenants", async () => {
    await writePublishHealth(row({ whenIso: "2026-06-20T12:00:00.000Z" }));
    expect(await readPublishHealth("tenant-a", NOW)).toBeNull();
    expect(await readPublishHealth("tenant-never", NOW)).toBeNull();
  });

  it("read is fail-soft: a throwing store reads as null", async () => {
    const mod = await import("@/lib/persistence/json-store");
    const spy = vi.spyOn(mod, "readStore").mockRejectedValueOnce(new Error("disk gone"));
    expect(await readPublishHealth("tenant-a", NOW)).toBeNull();
    spy.mockRestore();
  });
});

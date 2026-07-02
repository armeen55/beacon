import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

import { alreadyWarnedThisCycle, recordWarningSent } from "./token-expiry-warning-store";
import { classifyStore } from "@/lib/persistence/store-classification";

beforeEach(() => {
  stored = [];
});

describe("token-expiry-warning-store", () => {
  it("reports not-warned when there is no history", async () => {
    expect(await alreadyWarnedThisCycle("tenant-a", "google_gsc", "2026-07-01T00:00:00Z")).toBe(false);
  });

  it("records a warning and then reports it as already-warned for the SAME connected_at", async () => {
    await recordWarningSent("tenant-a", "google_gsc", "2026-07-01T00:00:00Z");
    expect(await alreadyWarnedThisCycle("tenant-a", "google_gsc", "2026-07-01T00:00:00Z")).toBe(true);
  });

  it("treats a different connected_at (post-reconnect) as a fresh cycle", async () => {
    await recordWarningSent("tenant-a", "google_gsc", "2026-07-01T00:00:00Z");
    expect(await alreadyWarnedThisCycle("tenant-a", "google_gsc", "2026-07-10T00:00:00Z")).toBe(false);
  });

  it("keeps different providers independent", async () => {
    await recordWarningSent("tenant-a", "google_gsc", "2026-07-01T00:00:00Z");
    expect(await alreadyWarnedThisCycle("tenant-a", "google_ga4", "2026-07-01T00:00:00Z")).toBe(false);
  });

  it("keeps different tenants independent", async () => {
    await recordWarningSent("tenant-a", "google_gsc", "2026-07-01T00:00:00Z");
    expect(await alreadyWarnedThisCycle("tenant-b", "google_gsc", "2026-07-01T00:00:00Z")).toBe(false);
  });

  it("is registered as a GLOBAL store", () => {
    expect(classifyStore("token-expiry-warnings")).toBe("global");
  });
});

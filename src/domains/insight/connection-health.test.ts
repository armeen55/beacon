import { describe, expect, it, vi } from "vitest";

const getConnectorInfoRef = { throws: false };
vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async () => {
    if (getConnectorInfoRef.throws) throw new Error("connector store down");
    return null;
  },
}));
vi.mock("@/domains/serp/dataforseo-serp", () => ({
  isDataForSeoConfigured: () => false,
}));

import { deriveConnectionHealth, loadConnectionHealth, CONNECTION_SOURCES } from "./connection-health";
import type { ConnectorInfo } from "@/lib/connector-store";
import { log } from "@/lib/logger";

const meta = CONNECTION_SOURCES[0]; // google_gsc
const now = new Date("2026-06-19T00:00:00Z");

function info(partial: Partial<ConnectorInfo>): ConnectorInfo {
  return { status: "connected", connected_at: null, expires_at: null, last_synced_at: null, ...partial };
}

describe("deriveConnectionHealth", () => {
  it("disconnected when no token / not connected", () => {
    expect(deriveConnectionHealth(meta, null, now).severity).toBe("disconnected");
    expect(deriveConnectionHealth(meta, info({ status: "disconnected" }), now).severity).toBe("disconnected");
  });

  it("needs_setup when connected but never synced", () => {
    expect(deriveConnectionHealth(meta, info({ last_synced_at: null }), now).severity).toBe("needs_setup");
  });

  it("healthy when synced within 3 days", () => {
    const h = deriveConnectionHealth(meta, info({ last_synced_at: "2026-06-18T00:00:00Z" }), now);
    expect(h.severity).toBe("healthy");
    expect(h.daysStale).toBe(1);
  });

  it("stale when last sync > 3 days", () => {
    const h = deriveConnectionHealth(meta, info({ last_synced_at: "2026-06-10T00:00:00Z" }), now);
    expect(h.severity).toBe("stale");
    expect(h.note).toContain("days ago");
  });

  it("carries role + unlocks + blocked copy", () => {
    const h = deriveConnectionHealth(meta, null, now);
    expect(h.unlocks.length).toBeGreaterThan(0);
    expect(h.blockedWhenMissing.length).toBeGreaterThan(0);
  });
});

describe("loadConnectionHealth", () => {
  it("logs a connector read failure instead of silently rendering it as disconnected", async () => {
    getConnectorInfoRef.throws = true;
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const health = await loadConnectionHealth("tenant-1", now);
    // Shape is preserved: every token connector still resolves to a row (as
    // "disconnected", the existing conservative state), but the transient
    // read failure is now visible in the logs, once per failing source.
    const tokenSources = CONNECTION_SOURCES.filter((s) => s.key !== "dataforseo").length;
    expect(warn).toHaveBeenCalledTimes(tokenSources);
    expect(warn.mock.calls[0]![0]).toContain("connection-health");
    expect(health.find((h) => h.key === "google_gsc")!.severity).toBe("disconnected");
    warn.mockRestore();
    getConnectorInfoRef.throws = false;
  });
});

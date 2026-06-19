import { describe, expect, it } from "vitest";
import { deriveConnectionHealth, CONNECTION_SOURCES } from "./connection-health";
import type { ConnectorInfo } from "@/lib/connector-store";

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

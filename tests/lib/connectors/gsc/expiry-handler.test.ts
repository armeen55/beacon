/**
 * 2026-05-18 — Section 8 J2 — `evaluateExpiry` + `formatLastRefreshedCopy`
 * unit tests.
 *
 * Pure-function coverage of the three expiry-status bands +
 * boundary conditions + the operator-side staleness copy.
 *
 * Pinned by the Section 8 J2 locked decision: token is fresh while
 * still inside the access window (with a 60s refresh buffer); stale
 * but recoverable within 7 days; stale beyond recovery after 7 days.
 */

import { describe, it, expect } from "vitest";

import {
  evaluateExpiry,
  formatLastRefreshedCopy,
  REFRESH_BUFFER_MS,
  STALE_OVER_THRESHOLD_MS,
} from "@/lib/connectors/gsc/expiry-handler";
import type { GoogleConnectorToken } from "@/lib/connector-store";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const NOW_MS = Date.UTC(2026, 4, 18, 12, 0, 0); // 2026-05-18T12:00:00Z

function makeToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "access-abc",
    refresh_token: "refresh-xyz",
    expires_at: NOW_MS + 30 * 60 * 1000, // fresh: 30 minutes from now
    connected_at: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// evaluateExpiry — three-state classifier
// ─────────────────────────────────────────────────────────────────────

describe("evaluateExpiry — fresh", () => {
  it("returns 'fresh' when expires_at is well in the future", () => {
    const token = makeToken({ expires_at: NOW_MS + 30 * 60 * 1000 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("fresh");
  });

  it("returns 'fresh' when expires_at is just past the 60s buffer", () => {
    // expires_at − 60_000 > now → fresh.
    const token = makeToken({ expires_at: NOW_MS + REFRESH_BUFFER_MS + 1 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("fresh");
  });
});

describe("evaluateExpiry — stale_under_7d", () => {
  it("returns 'stale_under_7d' inside the 60s refresh buffer", () => {
    // expires_at − 60_000 <= now < expires_at → buffer window.
    const token = makeToken({ expires_at: NOW_MS + 30_000 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_under_7d");
  });

  it("returns 'stale_under_7d' immediately after expiry", () => {
    const token = makeToken({ expires_at: NOW_MS - 1 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_under_7d");
  });

  it("returns 'stale_under_7d' at 1 day past expiry", () => {
    const token = makeToken({ expires_at: NOW_MS - 24 * 60 * 60 * 1000 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_under_7d");
  });

  it("returns 'stale_under_7d' at the 7-day boundary minus 1ms", () => {
    const token = makeToken({ expires_at: NOW_MS - STALE_OVER_THRESHOLD_MS + 1 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_under_7d");
  });
});

describe("evaluateExpiry — stale_over_7d", () => {
  it("returns 'stale_over_7d' exactly 7 days past expiry", () => {
    const token = makeToken({ expires_at: NOW_MS - STALE_OVER_THRESHOLD_MS });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_over_7d");
  });

  it("returns 'stale_over_7d' at 30 days past expiry", () => {
    const token = makeToken({
      expires_at: NOW_MS - 30 * 24 * 60 * 60 * 1000,
    });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_over_7d");
  });

  it("returns 'stale_over_7d' when expires_at is missing (non-finite)", () => {
    const token = makeToken({ expires_at: NaN });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_over_7d");
  });

  it("returns 'stale_over_7d' when expires_at is type-mismatched", () => {
    // Simulates a corrupted payload where expires_at is missing/null.
    // TypeScript would flag this at compile time, but evaluateExpiry
    // defends against the runtime case at the parse boundary.
    const token = makeToken();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (token as any).expires_at;
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("stale_over_7d");
  });
});

describe("evaluateExpiry — now accepts Date | number", () => {
  it("accepts a Date object", () => {
    const token = makeToken({ expires_at: NOW_MS + 60 * 60 * 1000 });
    expect(evaluateExpiry({ token, now: new Date(NOW_MS) })).toBe("fresh");
  });

  it("accepts a number (ms since epoch)", () => {
    const token = makeToken({ expires_at: NOW_MS + 60 * 60 * 1000 });
    expect(evaluateExpiry({ token, now: NOW_MS })).toBe("fresh");
  });
});

// ─────────────────────────────────────────────────────────────────────
// formatLastRefreshedCopy — operator-side staleness copy
// ─────────────────────────────────────────────────────────────────────

describe("formatLastRefreshedCopy", () => {
  it("renders 'less than a day' copy when staleness < 1 day", () => {
    const copy = formatLastRefreshedCopy({
      lastSyncedMs: NOW_MS - 60_000,
      now: NOW_MS,
    });
    expect(copy).toBe("GSC data last refreshed less than a day ago.");
  });

  it("renders 1-day copy with singular noun", () => {
    const copy = formatLastRefreshedCopy({
      lastSyncedMs: NOW_MS - 24 * 60 * 60 * 1000,
      now: NOW_MS,
    });
    expect(copy).toBe("GSC data last refreshed 1 day ago. Reconnect to refresh.");
  });

  it("renders N-day copy with plural noun for staleness >= 2 days", () => {
    const copy = formatLastRefreshedCopy({
      lastSyncedMs: NOW_MS - 5 * 24 * 60 * 60 * 1000,
      now: NOW_MS,
    });
    expect(copy).toBe("GSC data last refreshed 5 days ago. Reconnect to refresh.");
  });

  it("clamps negative staleness to 0 (less-than-a-day branch)", () => {
    // expires_at in the future → diffMs goes negative → clamped to 0.
    const copy = formatLastRefreshedCopy({
      lastSyncedMs: NOW_MS + 60 * 60 * 1000,
      now: NOW_MS,
    });
    expect(copy).toBe("GSC data last refreshed less than a day ago.");
  });

  it("accepts Date for now", () => {
    const copy = formatLastRefreshedCopy({
      lastSyncedMs: NOW_MS - 3 * 24 * 60 * 60 * 1000,
      now: new Date(NOW_MS),
    });
    expect(copy).toBe("GSC data last refreshed 3 days ago. Reconnect to refresh.");
  });
});

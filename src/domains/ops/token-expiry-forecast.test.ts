import { describe, it, expect } from "vitest";
import {
  daysUntilExpiry,
  buildExpiryForecast,
  buildExpiryWarningEmail,
  TESTING_MODE_REFRESH_TOKEN_LIFETIME_DAYS,
  WARNING_THRESHOLD_DAYS,
} from "./token-expiry-forecast";

describe("daysUntilExpiry", () => {
  it("returns 7 days remaining right at grant time", () => {
    const now = new Date("2026-07-03T00:00:00.000Z");
    const days = daysUntilExpiry("2026-07-03T00:00:00.000Z", now);
    expect(days).toBe(TESTING_MODE_REFRESH_TOKEN_LIFETIME_DAYS);
  });

  it("counts down as time passes", () => {
    const connectedAt = "2026-07-01T00:00:00.000Z";
    const now = new Date("2026-07-06T00:00:00.000Z"); // 5 days later
    expect(daysUntilExpiry(connectedAt, now)).toBe(2);
  });

  it("goes negative once past the 7-day window", () => {
    const connectedAt = "2026-06-20T00:00:00.000Z";
    const now = new Date("2026-07-03T00:00:00.000Z"); // 13 days later
    expect(daysUntilExpiry(connectedAt, now)).toBeLessThan(0);
  });

  it("treats an unparseable connectedAt as already-expired", () => {
    expect(daysUntilExpiry("not-a-date")).toBe(-Infinity);
  });
});

describe("buildExpiryForecast", () => {
  it("flags shouldWarn at exactly the threshold", () => {
    const connectedAt = "2026-07-01T00:00:00.000Z";
    // 7 - 2 = 5 days later -> 2 days remaining, at threshold.
    const now = new Date("2026-07-06T00:00:00.000Z");
    const forecast = buildExpiryForecast("tenant-a", "google_gsc", connectedAt, now);
    expect(forecast.daysUntilExpiry).toBe(WARNING_THRESHOLD_DAYS);
    expect(forecast.shouldWarn).toBe(true);
  });

  it("does not warn well before the threshold", () => {
    const connectedAt = "2026-07-03T00:00:00.000Z";
    const now = new Date("2026-07-03T01:00:00.000Z");
    const forecast = buildExpiryForecast("tenant-a", "google_gsc", connectedAt, now);
    expect(forecast.shouldWarn).toBe(false);
  });

  it("still warns (shouldWarn true) once already past expiry", () => {
    const connectedAt = "2026-06-01T00:00:00.000Z";
    const now = new Date("2026-07-03T00:00:00.000Z");
    const forecast = buildExpiryForecast("tenant-a", "google_gsc", connectedAt, now);
    expect(forecast.shouldWarn).toBe(true);
    expect(forecast.daysUntilExpiry).toBeLessThan(0);
  });
});

describe("buildExpiryWarningEmail", () => {
  it("names the plain provider, a concrete day count, and the reconnect link", () => {
    const forecast = buildExpiryForecast("tenant-a", "google_ga4", "2026-07-01T00:00:00.000Z", new Date("2026-07-06T00:00:00.000Z"));
    const email = buildExpiryWarningEmail(forecast, "https://app.example.com/settings/connectors");
    expect(email.subject).toContain("Google Analytics");
    expect(email.text).toContain("2 days");
    expect(email.text).toContain("https://app.example.com/settings/connectors");
    expect(email.text).not.toMatch(/[—–]/);
  });

  it("floors negative days to 0 in the copy rather than showing a negative number", () => {
    const forecast = buildExpiryForecast("tenant-a", "google_gsc", "2026-06-01T00:00:00.000Z", new Date("2026-07-03T00:00:00.000Z"));
    const email = buildExpiryWarningEmail(forecast, "/settings/connectors");
    expect(email.text).not.toMatch(/-\d+ days/);
  });
});

describe("provenPublished (evidence of life beats grant-age arithmetic)", () => {
  const now = new Date("2026-07-02T20:00:00Z");
  const grant = "2026-06-22T18:40:00Z"; // 10 days ago - past the 7-day window

  it("suppresses the warning when a sync succeeded AFTER the computed death", () => {
    const f = buildExpiryForecast("t", "google_gsc", grant, now, "2026-07-02T17:00:00Z");
    expect(f.provenPublished).toBe(true);
    expect(f.shouldWarn).toBe(false);
    expect(f.daysUntilExpiry).toBeLessThan(0);
  });

  it("still warns when the last sync predates the death (no proof of life)", () => {
    const f = buildExpiryForecast("t", "google_gsc", grant, now, "2026-06-25T00:00:00Z");
    expect(f.provenPublished).toBe(false);
    expect(f.shouldWarn).toBe(true);
  });

  it("still warns when lastSyncedAt is absent (unknown is not proof)", () => {
    const f = buildExpiryForecast("t", "google_gsc", grant, now, null);
    expect(f.provenPublished).toBe(false);
    expect(f.shouldWarn).toBe(true);
    const g = buildExpiryForecast("t", "google_gsc", grant, now);
    expect(g.provenPublished).toBe(false);
  });

  it("a healthy young connection stays quiet either way", () => {
    const f = buildExpiryForecast("t", "google_ga4", "2026-07-01T00:00:00Z", now, null);
    expect(f.shouldWarn).toBe(false);
    expect(f.provenPublished).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { connectorFailureStreak } from "./connector-failure-streak";
import type { ProviderStreak } from "@/domains/ops/cron-streak";

function streak(over: Partial<ProviderStreak> = {}): ProviderStreak {
  return {
    tenantId: "tenant-a",
    provider: "google_gsc",
    consecutiveFailures: 3,
    lastRunAt: "2026-07-03T09:00:00Z",
    lastFailureDetail: "http_401: invalid_grant",
    ...over,
  };
}

const SITE_ROOT = "https://example.com/";
const SIGNAL_AT = "2026-07-03T10:00:00Z";

describe("connectorFailureStreak", () => {
  it("emits one watch candidate per eligible streak", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak()],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("watch");
    expect(rows[0]!.target_url).toBe(SITE_ROOT);
    expect(rows[0]!.trigger_signal).toBe("connector_failure_streak");
  });

  it("names the real provider, night count, and error in customer_copy", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak({ consecutiveFailures: 4, lastFailureDetail: "http_403: forbidden" })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.customer_copy).toContain("Google Search Console");
    expect(rows[0]!.customer_copy).toContain("4 nights");
    expect(rows[0]!.customer_copy).toContain("http_403: forbidden");
    expect(rows[0]!.customer_copy).not.toMatch(/[—–]/); // no em/en dash
  });

  it("filters out streaks belonging to a different tenant", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak({ tenantId: "tenant-b" })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(0);
  });

  it("filters out streaks below the alert threshold", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak({ consecutiveFailures: 2 })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(0);
  });

  it("abstains entirely when there is no site root url", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak()],
      siteRootUrl: null,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(0);
  });

  it("returns no rows for an empty streak list", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(0);
  });

  it("sorts worst streak first and produces stable dedupe/cooldown keys per provider", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [
        streak({ provider: "clarity", consecutiveFailures: 3 }),
        streak({ provider: "profound", consecutiveFailures: 6 }),
      ],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.operator_evidence).toContain("provider=profound");
    expect(rows[1]!.operator_evidence).toContain("provider=clarity");
    // dedupe_key includes the topic_cluster_label (per-provider), so the two
    // rows differ there even though they share a (tenant, action, url)
    // cooldown_key (cooldown is intentionally coarser than dedupe, same as
    // every other trigger in this codebase).
    expect(rows[0]!.dedupe_key).not.toBe(rows[1]!.dedupe_key);
  });

  it("upgrades confidence to high at 5+ consecutive failures", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak({ consecutiveFailures: 5 })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.confidence).toBe("high");
  });

  it("stays at medium confidence right at the 3-night threshold", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak({ consecutiveFailures: 3 })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.confidence).toBe("medium");
  });

  it("falls back to a placeholder when no failure detail was recorded", () => {
    const rows = connectorFailureStreak({
      tenantId: "tenant-a",
      streaks: [streak({ lastFailureDetail: null })],
      siteRootUrl: SITE_ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.customer_copy).toContain("no detail recorded");
  });
});

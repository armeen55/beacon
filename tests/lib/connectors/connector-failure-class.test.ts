/**
 * connector-failure-class (2026-07-06) - degraded vs broken run health.
 *
 * The bug this proves fixed: the nightly sync flipped its whole run red on ANY
 * per-connector failure (ok = failed === 0). In prod ONE dead GA4 login
 * (invalid_grant on both tenants) made the run red every night and masked
 * whether a REAL new failure happened. These tests pin the semantic split:
 * a dead login / not-wired / transient failure is DEGRADED (run stays green);
 * only an UNEXPECTED break (DB write / infra / unknown shape) is BROKEN (red).
 */
import { describe, expect, it } from "vitest";

import {
  classifyConnectorFailure,
  summarizeRunHealth,
  type ConnectorOutcome,
} from "@/lib/connectors/connector-failure-class";

describe("classifyConnectorFailure", () => {
  it("a dead login (GA4 token_expired, GSC gsc_token_expired) is degraded", () => {
    expect(classifyConnectorFailure("token_expired")).toBe("degraded");
    expect(classifyConnectorFailure("gsc_token_expired")).toBe("degraded");
    expect(classifyConnectorFailure("gsc_auth_failed_401")).toBe("degraded");
    expect(classifyConnectorFailure("gsc_auth_failed_403")).toBe("degraded");
  });

  it("a not-yet-wired source (no token / no property / no categories) is degraded", () => {
    expect(classifyConnectorFailure("no_token")).toBe("degraded");
    expect(classifyConnectorFailure("no_property")).toBe("degraded");
    expect(classifyConnectorFailure("no_property_derivable")).toBe("degraded");
    expect(classifyConnectorFailure("no_usable_gsc_token")).toBe("degraded");
    expect(classifyConnectorFailure("no_token_or_api_error")).toBe("degraded");
    expect(classifyConnectorFailure("no_profound_key")).toBe("degraded");
    expect(classifyConnectorFailure("no_categories_configured")).toBe("degraded");
    expect(classifyConnectorFailure("disconnected")).toBe("degraded");
  });

  it("a transient blip (retried tonight) is degraded, not a break", () => {
    expect(classifyConnectorFailure("gsc_auth_transient")).toBe("degraded");
    expect(classifyConnectorFailure("gsc_day_pull_failed")).toBe("degraded");
    expect(classifyConnectorFailure("profound_api_error")).toBe("degraded");
    expect(classifyConnectorFailure("gsc_client_misconfig")).toBe("degraded");
    expect(classifyConnectorFailure("sync reported not-synced")).toBe("degraded");
  });

  it("a thrown dead-login exception (invalid_grant / invalid_client) is degraded", () => {
    expect(classifyConnectorFailure("Google refresh failed: invalid_grant")).toBe("degraded");
    expect(classifyConnectorFailure("token endpoint returned invalid_client")).toBe("degraded");
  });

  it("an UNEXPECTED break (DB write / infra) is broken - turns the run red", () => {
    expect(classifyConnectorFailure("gsc_daily_rows_upsert_failed")).toBe("broken");
    expect(classifyConnectorFailure("gsc_page_totals_upsert_failed")).toBe("broken");
    expect(classifyConnectorFailure("upsert_failed")).toBe("broken");
    expect(classifyConnectorFailure("supabase_unavailable")).toBe("broken");
  });

  it("an unrecognized shape is broken by default (fail-loud on the unknown)", () => {
    expect(classifyConnectorFailure("some new never-seen error")).toBe("broken");
    expect(classifyConnectorFailure("")).toBe("broken");
  });

  it("ignores surrounding whitespace when matching a known reason", () => {
    expect(classifyConnectorFailure("  token_expired  ")).toBe("degraded");
  });
});

describe("summarizeRunHealth", () => {
  const ok = (provider: string, tenantId: string): ConnectorOutcome => ({
    provider,
    tenantId,
    ok: true,
    detail: "synced",
  });
  const fail = (provider: string, tenantId: string, detail: string): ConnectorOutcome => ({
    provider,
    tenantId,
    ok: false,
    detail,
  });

  it("PROD SCENARIO: dead GA4 logins + a GSC transient + no-token Clarity => run stays GREEN, core synced", () => {
    // Exactly the reported prod shape: Iranopedia GSC + Profound sync fine;
    // GA4 dead on both tenants; Ritz GSC transient; Clarity no token.
    const results: ConnectorOutcome[] = [
      ok("google_gsc", "iranopedia"),
      ok("profound", "iranopedia"),
      fail("google_ga4", "iranopedia", "token_expired"),
      fail("google_ga4", "ritz", "token_expired"),
      fail("google_gsc", "ritz", "gsc_auth_transient"),
      fail("clarity", "ritz", "no_token_or_api_error"),
    ];
    const health = summarizeRunHealth(results);
    expect(health.ok).toBe(true); // NOT red - the core worked, rest is degraded
    expect(health.broken).toHaveLength(0);
    expect(health.degraded.map((d) => `${d.provider}@${d.tenantId}`)).toEqual([
      "google_ga4@iranopedia",
      "google_ga4@ritz",
      "google_gsc@ritz",
      "clarity@ritz",
    ]);
  });

  it("a real regression (a DB write failure) turns the run RED", () => {
    const results: ConnectorOutcome[] = [
      ok("google_gsc", "iranopedia"),
      fail("google_ga4", "iranopedia", "token_expired"), // still degraded
      fail("google_gsc", "iranopedia", "gsc_daily_rows_upsert_failed"), // BROKEN
    ];
    const health = summarizeRunHealth(results);
    expect(health.ok).toBe(false);
    expect(health.broken).toHaveLength(1);
    expect(health.broken[0]!.provider).toBe("google_gsc");
    expect(health.degraded).toHaveLength(1);
  });

  it("a fully-healthy run is ok with nothing degraded or broken", () => {
    const results: ConnectorOutcome[] = [
      ok("google_gsc", "iranopedia"),
      ok("google_ga4", "iranopedia"),
      ok("profound", "iranopedia"),
    ];
    const health = summarizeRunHealth(results);
    expect(health).toEqual({ ok: true, degraded: [], broken: [] });
  });

  it("an empty run (no connected sources) is ok - nothing failed", () => {
    expect(summarizeRunHealth([])).toEqual({ ok: true, degraded: [], broken: [] });
  });

  it("successful outcomes never count as degraded or broken", () => {
    const health = summarizeRunHealth([ok("profound", "t1"), ok("clarity", "t1")]);
    expect(health.degraded).toHaveLength(0);
    expect(health.broken).toHaveLength(0);
  });
});

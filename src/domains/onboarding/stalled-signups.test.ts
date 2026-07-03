/**
 * stalled-signups tests (2026-07-03, BEACON_500 R12 / T0e).
 *
 * Pins the rescue classification: only pending signups older than 24h
 * surface, each in the honest stage with the recovery map's plain problem +
 * exact fix + the right one-click resume; moving or finished scans stay
 * quiet; oldest stalls sort first.
 */
import { describe, it, expect } from "vitest";

import { classifyStalledSignups, STALLED_AFTER_MS } from "./stalled-signups";

const NOW = new Date("2026-07-03T12:00:00.000Z");
const TWO_DAYS_AGO = new Date(NOW.getTime() - 2 * STALLED_AFTER_MS).toISOString();
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();

function tenant(over: Partial<Parameters<typeof classifyStalledSignups>[0][number]> = {}) {
  return {
    id: "tenant-a",
    status: "pending_onboarding" as const,
    business_name: "Acme Co",
    domain: "acme.com",
    created_at: TWO_DAYS_AGO,
    ...over,
  };
}

function frontier(over: Partial<Parameters<typeof classifyStalledSignups>[1][number]> = {}) {
  return {
    tenant_id: "tenant-a",
    status: "in_progress" as const,
    pages_crawled: 5,
    last_batch_at: TWO_DAYS_AGO,
    updated_at: TWO_DAYS_AGO,
    ...over,
  };
}

describe("classifyStalledSignups", () => {
  it("ignores fresh signups, active tenants, and completed first looks", () => {
    expect(
      classifyStalledSignups(
        [
          tenant({ created_at: ONE_HOUR_AGO }),
          tenant({ id: "t2", status: "active" as never }),
          tenant({ id: "t3" }),
        ],
        [frontier({ tenant_id: "t3", status: "complete" })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("classifies the four stalled stages with the right resume", () => {
    const rows = classifyStalledSignups(
      [
        tenant({ id: "t-nourl", domain: "" }),
        tenant({ id: "t-noscan" }),
        tenant({ id: "t-dead" }),
        tenant({ id: "t-wedged" }),
      ],
      [
        frontier({ tenant_id: "t-dead", status: "unreachable", pages_crawled: 0 }),
        frontier({ tenant_id: "t-wedged", pages_crawled: 9, last_batch_at: TWO_DAYS_AGO }),
      ],
      NOW,
    );
    const byId = new Map(rows.map((r) => [r.tenantId, r]));

    expect(byId.get("t-nourl")?.stage).toBe("no_site_url");
    expect(byId.get("t-nourl")?.recovery.resume).toBeUndefined();
    expect(byId.get("t-nourl")?.recovery.href).toBe("/onboard");

    expect(byId.get("t-noscan")?.stage).toBe("no_scan");
    expect(byId.get("t-noscan")?.recovery.resume).toEqual({
      kind: "start_first_look",
      tenantId: "t-noscan",
    });

    expect(byId.get("t-dead")?.stage).toBe("site_unreachable");
    expect(byId.get("t-dead")?.recovery.resume?.kind).toBe("start_first_look");

    expect(byId.get("t-wedged")?.stage).toBe("scan_stalled");
    expect(byId.get("t-wedged")?.pagesRead).toBe(9);
    expect(byId.get("t-wedged")?.recovery.resume).toEqual({
      kind: "continue_crawl",
      tenantId: "t-wedged",
    });
  });

  it("an in-progress crawl that moved recently is NOT stalled", () => {
    const rows = classifyStalledSignups(
      [tenant()],
      [frontier({ pages_crawled: 3, last_batch_at: ONE_HOUR_AGO, updated_at: ONE_HOUR_AGO })],
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("an in-progress crawl with zero pages read is stalled even if recently touched", () => {
    const rows = classifyStalledSignups(
      [tenant()],
      [frontier({ pages_crawled: 0, last_batch_at: ONE_HOUR_AGO, updated_at: ONE_HOUR_AGO })],
      NOW,
    );
    expect(rows[0]?.stage).toBe("scan_stalled");
  });

  it("sorts oldest first and reports honest hours + dash-free copy", () => {
    const rows = classifyStalledSignups(
      [
        tenant({ id: "newer", created_at: new Date(NOW.getTime() - 30 * 60 * 60 * 1000).toISOString() }),
        tenant({ id: "older", created_at: TWO_DAYS_AGO }),
      ],
      [],
      NOW,
    );
    expect(rows.map((r) => r.tenantId)).toEqual(["older", "newer"]);
    expect(rows[0]?.stalledHours).toBe(48);
    for (const r of rows) {
      expect(`${r.recovery.plainProblem} ${r.recovery.exactFix}`).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
    }
  });
});

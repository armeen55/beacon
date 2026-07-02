import { describe, expect, it } from "vitest";

import {
  assessSourceFreshness,
  buildTeammateFreshnessMap,
  STALE_LIMIT_DAYS,
  type SourceFreshnessInput,
} from "./source-freshness";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const NOW = new Date("2026-07-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const base = (over: Partial<SourceFreshnessInput> = {}): SourceFreshnessInput => ({
  label: "Search Console",
  connected: true,
  authFailedAt: null,
  lastSyncedAt: daysAgo(0),
  ...over,
});

describe("assessSourceFreshness - matrix", () => {
  it("never connected -> dead, actionable sentence", () => {
    const r = assessSourceFreshness(base({ connected: false, lastSyncedAt: null }), NOW);
    expect(r.status).toBe("dead");
    expect(r.ageDays).toBeNull();
    expect(r.sentence).toContain("not connected");
    expect(r.sentence).toContain("Reconnect in Settings.");
  });

  it("auth_failed_at set (the real 401-in-the-logs case) -> dead, names the days since it broke", () => {
    const r = assessSourceFreshness(base({ authFailedAt: daysAgo(3) }), NOW);
    expect(r.status).toBe("dead");
    expect(r.ageDays).toBe(3);
    expect(r.sentence).toBe("Search Console lost its connection 3 days ago. Reconnect in Settings.");
  });

  it("auth_failed_at set with an unparseable timestamp still reads dead, without a fabricated age", () => {
    const r = assessSourceFreshness(base({ authFailedAt: "not-a-date" }), NOW);
    expect(r.status).toBe("dead");
    expect(r.ageDays).toBeNull();
    expect(r.sentence).toBe("Search Console lost its connection. Reconnect in Settings.");
  });

  it("auth_failed_at outranks a stale lastSyncedAt (a broken grant is worse than an old sync)", () => {
    const r = assessSourceFreshness(base({ authFailedAt: daysAgo(1), lastSyncedAt: daysAgo(10) }), NOW);
    expect(r.status).toBe("dead");
  });

  it("connected, never synced -> stale with no fabricated age, not dead", () => {
    const r = assessSourceFreshness(base({ lastSyncedAt: null }), NOW);
    expect(r.status).toBe("stale");
    expect(r.ageDays).toBeNull();
    expect(r.sentence).toContain("has not finished a first sync yet");
  });

  it(`connected + last sync exactly at the ${STALE_LIMIT_DAYS}-day limit -> still fresh`, () => {
    const r = assessSourceFreshness(base({ lastSyncedAt: daysAgo(STALE_LIMIT_DAYS) }), NOW);
    expect(r.status).toBe("fresh");
  });

  it("connected + last sync just past the limit -> stale, names the real day count", () => {
    const r = assessSourceFreshness(base({ lastSyncedAt: daysAgo(3) }), NOW);
    expect(r.status).toBe("stale");
    expect(r.ageDays).toBe(3);
    expect(r.sentence).toBe("Search Console data is 3 days old. Reconnect in Settings.");
  });

  it("connected + synced today -> fresh, empty sentence (nothing to warn about)", () => {
    const r = assessSourceFreshness(base({ lastSyncedAt: daysAgo(0) }), NOW);
    expect(r.status).toBe("fresh");
    expect(r.ageDays).toBe(0);
    expect(r.sentence).toBe("");
  });

  it("publishOnly source (Wix) with no lastSyncedAt reads fresh, not stale (never pulls a reading)", () => {
    const r = assessSourceFreshness(base({ label: "Wix", lastSyncedAt: null, publishOnly: true }), NOW);
    expect(r.status).toBe("fresh");
    expect(r.sentence).toBe("");
  });

  it("publishOnly still reads dead when disconnected", () => {
    const r = assessSourceFreshness(base({ label: "Wix", connected: false, publishOnly: true }), NOW);
    expect(r.status).toBe("dead");
  });

  it("unparseable lastSyncedAt (real timestamp corruption) reads stale, never throws", () => {
    const r = assessSourceFreshness(base({ lastSyncedAt: "garbage" }), NOW);
    expect(r.status).toBe("stale");
    expect(r.ageDays).toBeNull();
  });

  it("singular day wording ('1 day', not '1 days') on the auth-failed sentence", () => {
    const r = assessSourceFreshness(base({ authFailedAt: daysAgo(1) }), NOW);
    expect(r.sentence).toContain("1 day ago");
    expect(r.sentence).not.toContain("1 days ago");
  });
});

describe("buildTeammateFreshnessMap", () => {
  it("keys the map by whatever caller keys were passed, omits nulls", () => {
    const map = buildTeammateFreshnessMap(
      {
        gsc: base({ label: "Search Console", lastSyncedAt: daysAgo(0) }),
        profound: base({ label: "the AI answer feed", authFailedAt: daysAgo(4) }),
        clarity: undefined,
      },
      NOW,
    );
    expect(map.size).toBe(2);
    expect(map.get("gsc")?.status).toBe("fresh");
    expect(map.get("profound")?.status).toBe("dead");
    expect(map.has("clarity")).toBe(false);
  });

  it("empty input -> empty map, never throws", () => {
    expect(buildTeammateFreshnessMap({}, NOW).size).toBe(0);
  });
});

describe("no em or en dashes anywhere in generated sentences", () => {
  it("every state's sentence is dash-clean", () => {
    const cases: SourceFreshnessInput[] = [
      base({ connected: false }),
      base({ authFailedAt: daysAgo(5) }),
      base({ lastSyncedAt: null }),
      base({ lastSyncedAt: daysAgo(9) }),
      base({ lastSyncedAt: daysAgo(0) }),
    ];
    for (const c of cases) {
      const r = assessSourceFreshness(c, NOW);
      expect(hasBannedDash(r.sentence)).toBe(false);
    }
  });
});

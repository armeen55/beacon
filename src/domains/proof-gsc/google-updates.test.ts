/**
 * google-updates (2026-07-02, master plan item 32) - the seed list must be
 * well-formed (every entry has a start <= end, a real id, a plain label) and
 * dash-clean. This does NOT re-verify the dates against Google (that was done
 * by hand against status.search.google.com when the list was seeded) - it only
 * guards the SHAPE so a future bad edit fails loudly instead of silently
 * breaking the overlap math in algorithm-weather.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONFIRMED_GOOGLE_UPDATES, DEFAULT_ROLLOUT_DAYS } from "./google-updates";

describe("CONFIRMED_GOOGLE_UPDATES - shape", () => {
  it("every entry has a start on/before its end", () => {
    for (const u of CONFIRMED_GOOGLE_UPDATES) {
      expect(u.start <= u.end, `${u.id}: start ${u.start} must be <= end ${u.end}`).toBe(true);
    }
  });

  it("every entry has a non-empty id and label", () => {
    for (const u of CONFIRMED_GOOGLE_UPDATES) {
      expect(u.id.length).toBeGreaterThan(0);
      expect(u.label.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = CONFIRMED_GOOGLE_UPDATES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DEFAULT_ROLLOUT_DAYS is a sane positive number", () => {
    expect(DEFAULT_ROLLOUT_DAYS).toBeGreaterThan(0);
    expect(DEFAULT_ROLLOUT_DAYS).toBeLessThan(60);
  });
});

describe("dash guard (hard rule)", () => {
  it("google-updates.ts contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "google-updates.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("no label contains an em or en dash", () => {
    for (const u of CONFIRMED_GOOGLE_UPDATES) {
      expect(u.label).not.toMatch(/[–—]/);
    }
  });
});

/**
 * Source-freshness surface + wiring pins (2026-07-02, master plan item 46 / CARRY-OVER 115).
 *
 * Source-level pins: the daily card's "how we know" brief notes when a voice's source was
 * stale/dead, composed additively beside every other evidence section. Also the no-dash hard
 * rule over every touched surface.
 *
 * (The former "standup strip" block here pinned team-standup.tsx, which was deleted as
 * unmounted dead code — nothing renders it.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PREVIEW = readFileSync(resolve(__dirname, "../experiments/build-today-preview.ts"), "utf8");
const CARD = readFileSync(resolve(__dirname, "../../app/(shell)/daily-experiments-section.tsx"), "utf8");

describe("daily plan builder (build-today-preview.ts) - honest degradation wiring", () => {
  it("loads teammate freshness once per plan build, fail-soft to an empty map", () => {
    expect(PREVIEW).toContain('from "@/domains/team/source-freshness"');
    expect(PREVIEW).toContain("loadTeammateFreshness(tenantId, now)");
  });

  it("attaches the stale-source note to a pick's evidence brief via the shared pure builder", () => {
    expect(PREVIEW).toContain("buildStaleSourceNote(");
    expect(PREVIEW).toContain("staleSource: staleNote");
  });

  it("keys the note lookup off the SAME specialist ids the team-review voices already carry", () => {
    expect(PREVIEW).toContain("c.teamReview.voices.map((v) => v.specialist)");
  });

  it("contains no em or en dashes in the item-46 wiring block", () => {
    const start = PREVIEW.indexOf("buildStaleSourceNote(");
    const end = PREVIEW.indexOf("staleSource: staleNote", start) + 40;
    expect(PREVIEW.slice(start, end)).not.toMatch(/[–—]/);
  });
});

describe("daily card (daily-experiments-section.tsx) - stale-source note", () => {
  it("renders the note inside the how-we-know brief, honest silence when absent", () => {
    expect(CARD).toContain("function StaleSourceNote");
    expect(CARD).toContain("e.evidenceBrief?.staleSource");
    expect(CARD).toContain("<StaleSourceNote e={e} />");
  });

  it("places the note ahead of the other evidence sections (surfaces the caveat first)", () => {
    const staleIdx = CARD.indexOf("<StaleSourceNote e={e} />");
    const kwIdx = CARD.indexOf("<KeywordResearch e={e} />");
    expect(staleIdx).toBeGreaterThan(-1);
    expect(kwIdx).toBeGreaterThan(staleIdx);
  });

  it("runs the sentence through the shared dash-stripper before render", () => {
    const idx = CARD.indexOf("function StaleSourceNote");
    const block = CARD.slice(idx, idx + 400);
    expect(block).toContain("stripBannedDashes(s.sentence)");
  });
});

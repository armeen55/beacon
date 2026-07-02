/**
 * AI Overview citation gap surface + wiring pins (2026-07-02, master plan item 20).
 *
 * Source-level pins (the sibling pattern used for item 14's spike rows and item
 * 21's seasonal row): the Today AI band shows the honest Google AI Overview
 * citation-gap line, the quiet-day line accounts for it, and the touched
 * surface carries no em or en dashes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WAR_ROOM = readFileSync(resolve(__dirname, "../../app/(shell)/war-room-sections.tsx"), "utf8");

describe("AI Overview citation gap line (war-room-sections)", () => {
  it("reads the $0 history-backed gap line and renders it in the AI band", () => {
    expect(WAR_ROOM).toContain('from "@/domains/serp/serp-history"');
    expect(WAR_ROOM).toContain("loadAiOverviewGapTodayLine(tenantId).catch(() => null)");
    expect(WAR_ROOM).toContain("{aiOverviewGapLine ? (");
  });

  it("the AI band's silence gate accounts for the AI Overview gap line", () => {
    expect(WAR_ROOM).toContain("!aiOverviewGapLine\n    )\n      return null;");
  });

  it("the quiet line only claims a clean day when the AI Overview gap is also quiet", () => {
    const quiet = WAR_ROOM.slice(WAR_ROOM.indexOf("export async function WarRoomQuietLine"));
    expect(quiet).toContain("loadAiOverviewGapTodayLine(tenantId).catch(() => null)");
    expect(quiet).toContain("!aiOverviewGapLine,");
  });

  it("contains no em or en dashes anywhere", () => {
    expect(WAR_ROOM).not.toMatch(/[–—]/);
  });
});

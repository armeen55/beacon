/**
 * ChangesListClient - B-15 (operator spec 2026-07-09) Today-to-Changes deep link.
 *
 * Source-pinning test (this repo's convention for this interactive client
 * component with no jsdom/@testing-library/react configured - see
 * changes-list-client-session.test.ts). Pins that ?focus=<id> reuses the
 * row's OWN existing detail affordance (selectedId + the same scrollIntoView
 * pattern already wired for session.nextBest) instead of a new route or a
 * new detail surface.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "changes-list-client.tsx"), "utf8");

describe("ChangesListClient - B-15 ?focus=<id> deep link", () => {
  it("reads the focus param the same way status/goal/search already are", () => {
    expect(SRC).toContain('const focusId = params.get("focus");');
  });

  it("opens the SAME row detail a click would (setSelectedId), not a new surface", () => {
    expect(SRC).toMatch(/focusId[\s\S]{0,400}setSelectedId\(focusId\)/);
  });

  it("scrolls to the focused row using the SAME rowRefs/scrollIntoView pattern as session.nextBest", () => {
    expect(SRC).toMatch(/focusId[\s\S]{0,500}rowRefs\.current\.get\(focusId\)[\s\S]{0,80}scrollIntoView/);
  });

  it("consumes the focus once so closing the panel by hand does not keep re-opening it", () => {
    expect(SRC).toContain("consumedFocusRef.current = true");
    expect(SRC).toMatch(/if \(consumedFocusRef\.current \|\| !focusId\) return;/);
  });

  it("only opens a row that is actually in the visible (ranked + filtered) list", () => {
    expect(SRC).toMatch(/const match = visible\.find\(\(c\) => c\.id === focusId\);/);
    expect(SRC).toContain("if (!match) return;");
  });
});

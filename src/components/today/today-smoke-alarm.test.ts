import { describe, expect, it } from "vitest";
import { buildTodaySmokeAlarm } from "./today-smoke-alarm";

describe("buildTodaySmokeAlarm", () => {
  it("returns null when no page's drop clears the floor", () => {
    const r = buildTodaySmokeAlarm({
      decay: [{ page: "/a", clicksNow: 98, clicksPrior: 100 }], // lost 2, under the floor
      pagesWithFixReady: new Set(),
    });
    expect(r).toBeNull();
  });

  it("returns null for a real-looking drop off a tiny prior base (small sample)", () => {
    const r = buildTodaySmokeAlarm({
      decay: [{ page: "/tiny", clicksNow: 1, clicksPrior: 15 }], // lost 14 but prior < 25
      pagesWithFixReady: new Set(),
    });
    expect(r).toBeNull();
  });

  it("names the worst-bleeding page and the exact click loss", () => {
    const r = buildTodaySmokeAlarm({
      decay: [
        { page: "/nowruz", clicksNow: 42, clicksPrior: 60 }, // lost 18
        { page: "/other", clicksNow: 90, clicksPrior: 100 }, // lost 10
      ],
      pagesWithFixReady: new Set(),
    });
    expect(r).not.toBeNull();
    expect(r!.page).toBe("/nowruz");
    expect(r!.clicksLost).toBe(18);
    expect(r!.sentence).toBe("Heads up: /nowruz lost 18 clicks in the last 4 weeks. Worth a look before it slides further.");
    expect(r!.actionLabel).toBe("Review the page");
  });

  it("says 'I have a fix ready' only when a fix is queued for the bleeding page", () => {
    const r = buildTodaySmokeAlarm({
      decay: [{ page: "/nowruz", clicksNow: 42, clicksPrior: 60 }],
      pagesWithFixReady: new Set(["/nowruz"]),
    });
    expect(r!.sentence).toContain("I have a fix ready.");
    expect(r!.actionLabel).toBe("See the fix");
  });

  it("never emits an em or en dash", () => {
    const r = buildTodaySmokeAlarm({
      decay: [{ page: "/nowruz", clicksNow: 42, clicksPrior: 60 }],
      pagesWithFixReady: new Set(["/nowruz"]),
    });
    expect(r!.sentence).not.toMatch(/[‒–—―]/);
  });
});

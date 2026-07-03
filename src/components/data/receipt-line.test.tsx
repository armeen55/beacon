/**
 * receipt-line (R14b) - pins THE one-line receipt convention: source + through
 * date + relative checked label, one muted line, Beacon voice, no em/en dashes.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReceiptLine, checkedAgoLabel, monthDayLabel, ReceiptLine } from "./receipt-line";

const NOW = Date.parse("2026-07-03T18:00:00Z");

describe("buildReceiptLine", () => {
  it("renders the full convention: source, through date, checked label", () => {
    expect(
      buildReceiptLine({
        source: "your Search Console data",
        through: "2026-07-02",
        checkedAt: "2026-07-03T17:59:30Z",
        nowMs: NOW,
      }),
    ).toBe("From your Search Console data through Jul 2, checked just now.");
  });

  it("renders a through-only receipt with an optional note", () => {
    expect(
      buildReceiptLine({
        source: "your Search Console data",
        through: "2026-06-30",
        nowMs: NOW,
        note: "Google reports a few days behind.",
      }),
    ).toBe("From your Search Console data through Jun 30. Google reports a few days behind.");
  });

  it("renders a checked-only receipt with a custom verb", () => {
    expect(
      buildReceiptLine({
        source: "your latest Search Console read",
        checkedAt: "2026-07-03T13:00:00Z",
        verb: "planned",
        nowMs: NOW,
      }),
    ).toBe("From your latest Search Console read, planned 5 hours ago.");
  });

  it("returns null when neither timestamp parses (never a decorative receipt)", () => {
    expect(buildReceiptLine({ source: "your data", through: "garbage", checkedAt: null, nowMs: NOW })).toBeNull();
  });

  it("never emits an em or en dash", () => {
    const line = buildReceiptLine({
      source: "your Search Console data",
      through: "2026-07-02",
      checkedAt: "2026-07-01T12:00:00Z",
      nowMs: NOW,
    });
    expect(line).not.toMatch(/[‒–—―]/);
  });
});

describe("checkedAgoLabel", () => {
  it("walks the ladder: just now, minutes, hours, yesterday, days", () => {
    expect(checkedAgoLabel("2026-07-03T17:59:00Z", NOW)).toBe("just now");
    expect(checkedAgoLabel("2026-07-03T17:30:00Z", NOW)).toBe("30 minutes ago");
    expect(checkedAgoLabel("2026-07-03T13:00:00Z", NOW)).toBe("5 hours ago");
    expect(checkedAgoLabel("2026-07-02T10:00:00Z", NOW)).toBe("yesterday");
    expect(checkedAgoLabel("2026-06-29T10:00:00Z", NOW)).toBe("4 days ago");
  });
  it("is null on garbage", () => {
    expect(checkedAgoLabel("not-a-date", NOW)).toBeNull();
    expect(checkedAgoLabel(null, NOW)).toBeNull();
  });
});

describe("monthDayLabel", () => {
  it("handles bare dates and full timestamps", () => {
    expect(monthDayLabel("2026-07-02")).toBe("Jul 2");
    expect(monthDayLabel("2026-07-02T23:10:00Z")).toBe("Jul 2");
    expect(monthDayLabel("nope")).toBeNull();
  });
});

describe("ReceiptLine component", () => {
  it("renders the muted line with the receipt marker", () => {
    const html = renderToStaticMarkup(<ReceiptLine line="From your Search Console data through Jul 2, checked just now." />);
    expect(html).toContain("data-receipt-line");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("From your Search Console data through Jul 2, checked just now.");
  });
  it("renders nothing for a null line", () => {
    expect(renderToStaticMarkup(<ReceiptLine line={null} />)).toBe("");
  });
});

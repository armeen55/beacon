/**
 * csv (R14b) - shape pins for the one CSV encoder behind every
 * "Download as spreadsheet" action.
 */
import { describe, expect, it } from "vitest";
import { buildCsv, csvResponseHeaders, toCsvValue } from "./csv";

describe("toCsvValue", () => {
  it("passes plain values through and blanks null/undefined", () => {
    expect(toCsvValue("hello")).toBe("hello");
    expect(toCsvValue(42)).toBe("42");
    expect(toCsvValue(null)).toBe("");
    expect(toCsvValue(undefined)).toBe("");
  });
  it("quotes commas, quotes, and newlines; doubles inner quotes", () => {
    expect(toCsvValue("a,b")).toBe('"a,b"');
    expect(toCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvValue("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("emits header + rows joined with CRLF, trailing newline", () => {
    const csv = buildCsv(["Page", "Clicks"], [["/cats", 12], ["/dogs, big", 3]]);
    expect(csv).toBe('Page,Clicks\r\n/cats,12\r\n"/dogs, big",3\r\n');
  });
  it("pads ragged rows to the header width so columns never shift", () => {
    const csv = buildCsv(["A", "B", "C"], [["x"], ["1", "2", "3", "4"]]);
    expect(csv.split("\r\n")[1]).toBe("x,,");
    expect(csv.split("\r\n")[2]).toBe("1,2,3");
  });
});

describe("csvResponseHeaders", () => {
  it("sets the download content type + attachment filename", () => {
    const h = csvResponseHeaders("beacon-results.csv") as Record<string, string>;
    expect(h["Content-Type"]).toContain("text/csv");
    expect(h["Content-Disposition"]).toBe('attachment; filename="beacon-results.csv"');
  });
});

/**
 * load-family-rows (2026-07-02, master plan item 53) - the pure family
 * sampling logic: top families by total clicks, top pages per family, hard
 * bounds so the downstream 16-page daily-clicks read is never exceeded.
 */
import { describe, expect, it } from "vitest";

import { pickRepresentativePages, MAX_FAMILIES, PAGES_PER_FAMILY, type PageClicksRow } from "./load-family-rows";

function row(page: string, clicks: number): PageClicksRow {
  return { page, clicks };
}

describe("pickRepresentativePages", () => {
  it("keeps at most MAX_FAMILIES * PAGES_PER_FAMILY pages", () => {
    const rows: PageClicksRow[] = [];
    for (let f = 0; f < 30; f++) {
      for (let p = 0; p < 5; p++) {
        rows.push(row(`https://www.example.com/family-${f}/page-${p}`, 100 - f));
      }
    }
    const out = pickRepresentativePages(rows);
    expect(out.length).toBeLessThanOrEqual(MAX_FAMILIES * PAGES_PER_FAMILY);
  });

  it("picks the highest-clicks page as each family's representative", () => {
    const rows = [
      row("https://www.example.com/cheetah/small", 10),
      row("https://www.example.com/cheetah/big", 500),
    ];
    const out = pickRepresentativePages(rows, 5, 1);
    expect(out).toEqual(["https://www.example.com/cheetah/big"]);
  });

  it("ranks families by TOTAL clicks, not by their single biggest page", () => {
    const rows = [
      // Family "many": three mid pages, total 300.
      row("https://www.example.com/many/a", 100),
      row("https://www.example.com/many/b", 100),
      row("https://www.example.com/many/c", 100),
      // Family "one": a single 150-click page.
      row("https://www.example.com/one/x", 150),
    ];
    const out = pickRepresentativePages(rows, 1, 1);
    expect(out).toEqual(["https://www.example.com/many/a"]);
  });

  it("preserves the RAW GSC url form verbatim (www stays www)", () => {
    const out = pickRepresentativePages([row("https://www.iranopedia.com/persian-male-names", 100)], 1, 1);
    expect(out).toEqual(["https://www.iranopedia.com/persian-male-names"]);
  });

  it("drops zero-click pages entirely", () => {
    expect(pickRepresentativePages([row("https://www.example.com/dead/page", 0)])).toEqual([]);
  });

  it("empty input produces an empty page list", () => {
    expect(pickRepresentativePages([])).toEqual([]);
  });
});

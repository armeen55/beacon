import { describe, it, expect } from "vitest";
import { analyzeImageAlt, suggestAltText, summarizeImageAlt } from "./image-alt-analyzer";

describe("suggestAltText", () => {
  it("derives a phrase from the filename stem", () => {
    expect(suggestAltText("https://x.com/img/persian-rug-red.jpg")).toBe("Persian Rug Red");
  });
  it("drops long numeric ids and falls back to page title for hash-only filenames", () => {
    expect(suggestAltText("/media/9f3a8b2c10293.png", "Iran Flag History")).toBe("Iran Flag History");
  });
  it("returns null when nothing is derivable", () => {
    expect(suggestAltText("/x/12345.png", null)).toBeNull();
  });
});

describe("analyzeImageAlt", () => {
  it("flags missing, empty (non-decorative), and generic alt; passes good alt", () => {
    const html = `
      <img src="/a/nowruz-table.jpg">
      <img src="/b/photo.png" alt="image">
      <img src="/c/good.jpg" alt="A haft-sin table set for Nowruz">
      <img src="/d/decor.png" alt="">
    `;
    const out = analyzeImageAlt(html, { pageTitle: "Nowruz" });
    const bylabel = Object.fromEntries(out.map((f) => [f.src, f.quality]));
    expect(bylabel["/a/nowruz-table.jpg"]).toBe("missing");
    expect(bylabel["/b/photo.png"]).toBe("poor");
    expect(bylabel["/c/good.jpg"]).toBeUndefined(); // good alt → not flagged
    // empty alt IS surfaced (could be wrongly-decorative) but with the right reason
    expect(bylabel["/d/decor.png"]).toBe("empty");
    // suggestions are grounded
    expect(out.find((f) => f.src === "/a/nowruz-table.jpg")!.suggestedAlt).toBe("Nowruz Table");
  });

  it("skips decorative (role=presentation / aria-hidden) + tracking pixels", () => {
    const html = `
      <img src="/x/real.jpg">
      <img src="/y/icon.svg" role="presentation">
      <img src="/z/thing.png" aria-hidden="true">
      <img src="/t/tracking-pixel.gif">
    `;
    const out = analyzeImageAlt(html);
    expect(out.map((f) => f.src)).toEqual(["/x/real.jpg"]);
  });

  it("empty/garbage html → [] (fail soft)", () => {
    expect(analyzeImageAlt("")).toEqual([]);
    expect(analyzeImageAlt("<p>no images</p>")).toEqual([]);
  });

  it("summarizeImageAlt counts buckets", () => {
    const out = analyzeImageAlt(`<img src="/a.jpg"><img src="/b.png" alt="img">`, { pageTitle: "T" });
    const s = summarizeImageAlt(out);
    expect(s.total).toBe(2);
    expect(s.missing).toBe(1);
    expect(s.poor).toBe(1);
  });
});

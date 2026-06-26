import { describe, it, expect } from "vitest";
import { fuseTeardownTargets, pickOverlapTeardownUrl, rootDomainOf } from "./serp-teardown-fusion";

describe("rootDomainOf", () => {
  it("strips scheme/www/subdomain to the registrable domain", () => {
    expect(rootDomainOf("https://www.theknot.com/path")).toBe("theknot.com");
    expect(rootDomainOf("seriouseats.com")).toBe("seriouseats.com");
    expect(rootDomainOf("blog.example.co/x")).toBe("example.co");
  });
});

describe("fuseTeardownTargets", () => {
  it("ranks Google+AI overlap first, then AI-only, then Google-only", () => {
    const out = fuseTeardownTargets({
      competitorUrls: ["https://theknot.com/persian-wedding", "https://aionly.com/x"],
      serpTopDomains: ["theknot.com", "googleonly.com"],
      ownDomain: "iranopedia.com",
    });
    expect(out[0].value).toContain("theknot.com");
    expect(out[0].isOverlap).toBe(true);
    expect(out[0].sources).toEqual(["ai", "google"]);
    const aiOnly = out.find((t) => t.value.includes("aionly.com"))!;
    expect(aiOnly.sources).toEqual(["ai"]);
    const googleOnly = out.find((t) => t.value === "googleonly.com")!;
    expect(googleOnly.kind).toBe("domain");
    expect(googleOnly.sources).toEqual(["google"]);
    expect(out[0].priority).toBeLessThanOrEqual(aiOnly.priority);
    expect(aiOnly.priority).toBeLessThanOrEqual(googleOnly.priority);
  });

  it("excludes the tenant's own domain", () => {
    const out = fuseTeardownTargets({
      competitorUrls: ["https://iranopedia.com/self"],
      serpTopDomains: ["iranopedia.com", "rival.com"],
      ownDomain: "iranopedia.com",
    });
    expect(out.find((t) => t.value.includes("iranopedia.com"))).toBeUndefined();
    expect(out.find((t) => t.value === "rival.com")).toBeDefined();
  });

  it("no SERP data → Profound order preserved (no fabrication)", () => {
    const out = fuseTeardownTargets({
      competitorUrls: ["https://a.com/x", "https://b.com/y"],
      serpTopDomains: [],
      ownDomain: "me.com",
    });
    expect(out.map((t) => rootDomainOf(t.value))).toEqual(["a.com", "b.com"]);
    expect(out.every((t) => !t.isOverlap)).toBe(true);
  });
});

describe("pickOverlapTeardownUrl", () => {
  it("prefers the overlap URL when one ranks on Google", () => {
    const r = pickOverlapTeardownUrl(
      ["https://aionly.com/x", "https://theknot.com/p"],
      ["theknot.com"],
      "iranopedia.com",
    );
    expect(r).toEqual({ url: "https://theknot.com/p", overlap: true });
  });
  it("falls back to the first usable URL with no overlap", () => {
    const r = pickOverlapTeardownUrl(["https://aionly.com/x"], ["googleonly.com"], "iranopedia.com");
    expect(r).toEqual({ url: "https://aionly.com/x", overlap: false });
  });
  it("skips own-domain + bad URLs, returns null when nothing usable", () => {
    const r = pickOverlapTeardownUrl(["https://iranopedia.com/self", "https://bad.com/x"], [], "iranopedia.com", (u) => u.includes("bad.com"));
    expect(r).toBeNull();
  });
});

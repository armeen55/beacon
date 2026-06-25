import { describe, it, expect } from "vitest";

import { buildEntitySchema, buildEntitySchemaScript } from "@/domains/demand-graph/entity-schema";

describe("buildEntitySchema", () => {
  it("builds an Organization + WebSite @graph from name + domain", () => {
    const json = buildEntitySchema({ name: "Iranopedia", domain: "iranopedia.com" });
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed["@context"]).toBe("https://schema.org");
    const types = parsed["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite"]);
    const org = parsed["@graph"][0];
    expect(org["@id"]).toBe("https://iranopedia.com/#organization");
    expect(org.url).toBe("https://iranopedia.com/");
    expect(org.name).toBe("Iranopedia");
    const site = parsed["@graph"][1];
    expect(site.publisher["@id"]).toBe(org["@id"]);
  });

  it("normalizes a full URL or trailing-slash domain to one origin", () => {
    const a = JSON.parse(buildEntitySchema({ name: "X", domain: "https://www.x.com/foo/" })!);
    expect(a["@graph"][0].url).toBe("https://www.x.com/");
  });

  it("includes description + sameAs only when provided", () => {
    const bare = JSON.parse(buildEntitySchema({ name: "X", domain: "x.com" })!);
    expect(bare["@graph"][0].description).toBeUndefined();
    expect(bare["@graph"][0].sameAs).toBeUndefined();
    const rich = JSON.parse(
      buildEntitySchema({ name: "X", domain: "x.com", description: "The thing", sameAs: ["https://twitter.com/x", " "] })!,
    );
    expect(rich["@graph"][0].description).toBe("The thing");
    expect(rich["@graph"][0].sameAs).toEqual(["https://twitter.com/x"]);
  });

  it("adds knowsAbout (deduped case-insensitively, capped at 12)", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Topic ${i}`);
    const dup = JSON.parse(
      buildEntitySchema({ name: "X", domain: "x.com", knowsAbout: ["Persian Names", "persian names", "Iran Flag", " ", ...many] })!,
    );
    const ka = dup["@graph"][0].knowsAbout as string[];
    expect(ka[0]).toBe("Persian Names");
    expect(ka).toContain("Iran Flag");
    expect(ka.filter((t) => t.toLowerCase() === "persian names")).toHaveLength(1); // deduped
    expect(ka.length).toBe(12); // capped
  });

  it("returns null without a name or a usable domain", () => {
    expect(buildEntitySchema({ name: "", domain: "x.com" })).toBeNull();
    expect(buildEntitySchema({ name: "X", domain: "" })).toBeNull();
    expect(buildEntitySchema({ name: "X", domain: "localhost" })).toBeNull();
  });

  it("wraps in a paste-ready script tag", () => {
    const tag = buildEntitySchemaScript({ name: "Iranopedia", domain: "iranopedia.com" });
    expect(tag).toContain('<script type="application/ld+json">');
    expect(tag).toContain('"@type": "Organization"');
  });
});

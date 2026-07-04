import { describe, expect, it } from "vitest";

import { detectCms } from "./cms-detect";

describe("detectCms", () => {
  it("returns null when no signal matches (custom-coded site, empty-safe)", () => {
    expect(detectCms({})).toBeNull();
    expect(
      detectCms({
        generatorMeta: null,
        schemaTypes: ["Organization", "WebSite"],
        url: "https://example.com/",
        bodyMarkers: ["some-random-class", "https://example.com/assets/app.js"],
      }),
    ).toBeNull();
  });

  it("detects Wix from generator meta and offers push + draft (push lane exists)", () => {
    const fact = detectCms({ generatorMeta: "Wix.com Website Builder" });
    expect(fact).not.toBeNull();
    expect(fact!.platform).toBe("Wix");
    expect(fact!.capability).toBe("push_and_draft");
    expect(fact!.detectedFrom).toBe("generator_meta");
    expect(fact!.headline).toBe(
      "You are on Wix. I can push SEO fields here, and draft the rest for you to paste.",
    );
  });

  it("detects Shopify from generator meta as draft-only (no push lane yet)", () => {
    const fact = detectCms({ generatorMeta: "Shopify" });
    expect(fact!.platform).toBe("Shopify");
    expect(fact!.capability).toBe("draft_only");
    expect(fact!.headline).toContain("You are on Shopify.");
    expect(fact!.headline).toContain("draft every change for you to paste in.");
  });

  it("detects WordPress from a body asset marker (wp-content)", () => {
    const fact = detectCms({
      bodyMarkers: ["https://site.com/wp-content/themes/x/style.css"],
    });
    expect(fact!.platform).toBe("WordPress");
    expect(fact!.detectedFrom).toBe("body_marker");
    expect(fact!.capability).toBe("draft_only");
  });

  it("detects Squarespace from a staging URL host", () => {
    const fact = detectCms({ url: "https://acme.squarespace.com/about" });
    expect(fact!.platform).toBe("Squarespace");
    expect(fact!.detectedFrom).toBe("url_marker");
  });

  it("detects Wix from a wixstatic asset host in body markers", () => {
    const fact = detectCms({
      bodyMarkers: ["https://static.wixstatic.com/media/abc.jpg"],
    });
    expect(fact!.platform).toBe("Wix");
    expect(fact!.detectedFrom).toBe("body_marker");
  });

  it("prefers generator meta over body markers when both present", () => {
    const fact = detectCms({
      generatorMeta: "Squarespace",
      bodyMarkers: ["https://static.wixstatic.com/media/abc.jpg"],
    });
    expect(fact!.platform).toBe("Squarespace");
    expect(fact!.detectedFrom).toBe("generator_meta");
  });

  it("does not false-positive on an unrelated generator string", () => {
    expect(detectCms({ generatorMeta: "Hand-coded static HTML" })).toBeNull();
  });

  it("carries an operator-evidence trace", () => {
    const fact = detectCms({ generatorMeta: "WordPress 6.5" });
    expect(fact!.platform).toBe("WordPress");
    expect(fact!.operatorEvidence).toContain("platform=WordPress");
    expect(fact!.operatorEvidence).toContain("detected_from=generator_meta");
  });

  it("emits no em or en dashes in the capability sentence", () => {
    const wix = detectCms({ generatorMeta: "Wix" });
    const shopify = detectCms({ generatorMeta: "Shopify" });
    expect(wix!.headline).not.toMatch(/[–—]/);
    expect(shopify!.headline).not.toMatch(/[–—]/);
  });
});

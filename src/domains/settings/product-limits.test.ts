/**
 * product-limits (P21, v1 356) - pins for the honest "what I cannot do yet" registry:
 * it covers the promised limits, stays in first person, never overpromises, and carries
 * no em/en dash or lab jargon.
 */
import { describe, expect, it } from "vitest";
import { PRODUCT_LIMITS } from "./product-limits";

describe("PRODUCT_LIMITS", () => {
  it("names the core limits the operator must trust the tool about", () => {
    const ids = new Set(PRODUCT_LIMITS.map((l) => l.id));
    expect(ids.has("full-page-content")).toBe(true);
    expect(ids.has("email-digests")).toBe(true);
    expect(ids.has("verdict-timing")).toBe(true);
  });

  it("states the full-page-content limit honestly (SEO fields yes, full content drafted)", () => {
    const l = PRODUCT_LIMITS.find((x) => x.id === "full-page-content")!;
    expect(l.sentence).toContain("I can push SEO fields");
    expect(l.sentence).toContain("Wix");
    expect(l.sentence).toContain("draft it for you to paste");
  });

  it("states the email-digest limit plainly", () => {
    const l = PRODUCT_LIMITS.find((x) => x.id === "email-digests")!;
    expect(l.sentence).toContain("I do not send email digests yet");
  });

  it("states the verdict-timing limit with the Search Console basis and a few weeks", () => {
    const l = PRODUCT_LIMITS.find((x) => x.id === "verdict-timing")!;
    expect(l.sentence).toContain("Search Console");
    expect(l.sentence).toContain("few weeks");
  });

  it("stays first person and never emits an em or en dash", () => {
    for (const l of PRODUCT_LIMITS) {
      expect(l.sentence).not.toMatch(/[‒–—―]/);
      expect(l.label).not.toMatch(/[‒–—―]/);
      // First person: every sentence speaks as "I".
      expect(/\bI\b/.test(l.sentence)).toBe(true);
    }
  });

  it("uses no lab jargon on this operator-facing surface", () => {
    const banned = /\b(experiment|control|baseline|treatment|reservation|SERP|verdict)\b/i;
    for (const l of PRODUCT_LIMITS) {
      expect(banned.test(l.sentence), `lab jargon in "${l.sentence}"`).toBe(false);
      expect(banned.test(l.label)).toBe(false);
    }
  });
});

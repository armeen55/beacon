import { describe, it, expect } from "vitest";
import {
  classifyAltTextGap,
  ALT_TEXT_MIN_IMPRESSIONS_90D,
  type AltGapPageInput,
} from "./classify";
import type { PageImage } from "@/domains/pages/types";

function img(alt: string | null, src: string): PageImage {
  return { src, alt, width: null, height: null };
}

const BASE: AltGapPageInput = {
  url: "https://x.com/persian-food",
  images: [
    img(null, "https://x.com/img/persian-koobideh-kabob.jpg"),
    img("ok", "https://x.com/img/rice.jpg"),
    img(null, "https://x.com/img/saffron-tea.jpg"),
  ],
  h1: "Persian Food",
  pageTitle: "Persian Food | Iranopedia",
  topQuery: "persian food",
  impressions90d: 900,
};

describe("classifyAltTextGap", () => {
  it("fires on a demand page with missing-alt pictures and drafts descriptions", () => {
    const f = classifyAltTextGap(BASE);
    expect(f).not.toBeNull();
    expect(f!.missingCount).toBe(2);
    expect(f!.totalImages).toBe(3);
    expect(f!.examples.length).toBeGreaterThanOrEqual(1);
    // First drafted example comes from the descriptive filename.
    expect(f!.examples[0]!.draft).toBe("Persian koobideh kabob");
    expect(f!.impressions90d).toBe(900);
  });

  it("returns null (empty-safe) when every picture already has alt text", () => {
    const f = classifyAltTextGap({
      ...BASE,
      images: [img("a", "https://x.com/1.jpg"), img("b", "https://x.com/2.jpg")],
    });
    expect(f).toBeNull();
  });

  it("returns null (empty-safe) below the demand floor", () => {
    const f = classifyAltTextGap({
      ...BASE,
      impressions90d: ALT_TEXT_MIN_IMPRESSIONS_90D - 1,
    });
    expect(f).toBeNull();
  });

  it("returns null (empty-safe) when the page has no images (old snapshot)", () => {
    const f = classifyAltTextGap({ ...BASE, images: undefined });
    expect(f).toBeNull();
  });

  it("returns null when no missing picture can be grounded into a draft", () => {
    // Generic filenames + no H1/title/query -> the drafter grounds nothing, so
    // we do not raise a card we cannot help with.
    const f = classifyAltTextGap({
      url: "https://x.com/gallery",
      images: [img(null, "https://x.com/IMG_0001.jpg"), img(null, "https://x.com/IMG_0002.jpg")],
      h1: null,
      pageTitle: null,
      topQuery: null,
      impressions90d: 900,
    });
    expect(f).toBeNull();
  });

  it("ignores decorative (empty-alt) pictures - they are not gaps", () => {
    const f = classifyAltTextGap({
      ...BASE,
      images: [img("", "https://x.com/spacer.gif"), img("", "https://x.com/line.gif")],
    });
    expect(f).toBeNull();
  });

  it("caps drafted examples at 3 even when many pictures miss alt", () => {
    const many: PageImage[] = Array.from({ length: 10 }, (_, i) =>
      img(null, `https://x.com/img/persian-dish-number-${i}.jpg`),
    );
    const f = classifyAltTextGap({ ...BASE, images: many });
    expect(f).not.toBeNull();
    expect(f!.missingCount).toBe(10);
    expect(f!.examples.length).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { addImageAltText } from "./add-image-alt-text";
import type { AltTextGapFinding } from "@/domains/image-seo/classify";

const SIGNAL_AT = "2026-07-03T00:00:00.000Z";

function finding(over: Partial<AltTextGapFinding> = {}): AltTextGapFinding {
  return {
    url: "https://x.com/persian-food",
    missingCount: 3,
    totalImages: 8,
    examples: [
      { src: "https://x.com/img/kabob.jpg", draft: "Plate of Persian koobideh kabob with saffron rice" },
    ],
    impressions90d: 900,
    evidence: "alt_text_gap path=/persian-food; missing=3/8; impressions_90d=900",
    ...over,
  };
}

describe("addImageAltText trigger", () => {
  it("emits one candidate per finding with the drafted alt in the copy", () => {
    const rows = addImageAltText({
      tenantId: "tenant-a",
      findings: [finding()],
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.action_type).toBe("add_image_alt_text");
    expect(r.trigger_signal).toBe("add_image_alt_text");
    expect(r.confidence).toBe("medium");
    expect(r.target_url).toBe("https://x.com/persian-food");
    expect(r.generator_kind).toBe("deterministic");
    expect(r.customer_copy).toContain("3 pictures on /persian-food");
    expect(r.customer_copy).toContain("Plate of Persian koobideh kabob with saffron rice");
    expect(r.customer_copy).toContain("Google Images and screen readers");
    expect(r.evidence.length).toBeGreaterThanOrEqual(1);
    expect(r.safety_flags).toEqual([]);
  });

  it("is empty-safe: no findings -> no rows", () => {
    expect(
      addImageAltText({ tenantId: "tenant-a", findings: [], signalAt: SIGNAL_AT }),
    ).toEqual([]);
  });

  it("uses singular copy for one missing picture", () => {
    const rows = addImageAltText({
      tenantId: "tenant-a",
      findings: [finding({ missingCount: 1 })],
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.customer_copy).toContain("1 picture on /persian-food");
    expect(rows[0]!.customer_copy).toContain("has no alt text");
  });

  it("ranks by demand (highest impressions first) and caps emissions", () => {
    const findings: AltTextGapFinding[] = Array.from({ length: 12 }, (_, i) =>
      finding({
        url: `https://x.com/p${i}`,
        impressions90d: i * 100,
      }),
    );
    const rows = addImageAltText({
      tenantId: "tenant-a",
      findings,
      signalAt: SIGNAL_AT,
    });
    // Capped at the default max (8).
    expect(rows).toHaveLength(8);
    // Highest-demand page first.
    expect(rows[0]!.target_url).toBe("https://x.com/p11");
  });

  it("produces distinct dedupe/cooldown keys per page", () => {
    const rows = addImageAltText({
      tenantId: "tenant-a",
      findings: [finding({ url: "https://x.com/a" }), finding({ url: "https://x.com/b" })],
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.cooldown_key).not.toBe(rows[1]!.cooldown_key);
    expect(rows[0]!.dedupe_key).not.toBe(rows[1]!.dedupe_key);
  });
});

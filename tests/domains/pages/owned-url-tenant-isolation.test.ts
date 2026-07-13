import { describe, expect, it } from "vitest";
import {
  canonicalizeOwnedUrl,
  normalizePageUrl,
} from "@/domains/pages/classify";

describe("owned URL canonicalization is explicit and tenant-isolated", () => {
  it("is stable across A → B → A calls in one process", () => {
    const parsed = normalizePageUrl("https://rfritz.com/palo-alto");
    expect(parsed).not.toBeNull();

    const a1 = canonicalizeOwnedUrl(
      parsed!,
      "ritzbuilders.com",
      ["rfritz.com"],
    );
    const b = canonicalizeOwnedUrl(parsed!, "iranopedia.com");
    const a2 = canonicalizeOwnedUrl(
      parsed!,
      "ritzbuilders.com",
      ["rfritz.com"],
    );

    expect(a1).toEqual({
      url: "https://ritzbuilders.com/palo-alto",
      domain: "ritzbuilders.com",
      path: "/palo-alto",
    });
    expect(b).toEqual(parsed);
    expect(b.url).not.toContain("iranopedia.com");
    expect(a2).toEqual(a1);
  });

  it("never treats a legacy domain as owned unless that tenant supplies it", () => {
    const parsed = normalizePageUrl("https://legacy.example/topic")!;
    expect(canonicalizeOwnedUrl(parsed, "tenant-a.example")).toEqual(parsed);
    expect(
      canonicalizeOwnedUrl(parsed, "tenant-b.example", ["legacy.example"]),
    ).toMatchObject({
      url: "https://tenant-b.example/topic",
      domain: "tenant-b.example",
    });
  });
});

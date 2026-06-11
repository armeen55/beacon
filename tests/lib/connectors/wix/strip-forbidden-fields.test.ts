/**
 * 2026-06-11 (night shift, fuel #4) — exhaustive pins for
 * stripForbiddenFields, the Wix write filter that enforces caps §3
 * (a push may never modify slug/url/id-bearing fields). Previously
 * one case in push-service.test; this pins every drop rule + that
 * legitimate content fields survive untouched.
 */

import { describe, it, expect } from "vitest";

import { stripForbiddenFields } from "@/lib/connectors/wix/client";

describe("stripForbiddenFields — caps §3 write filter", () => {
  it("drops the exact forbidden keys", () => {
    const out = stripForbiddenFields({
      slug: "x", url: "x", link: "x", "page-url": "x", pageUrl: "x",
      _id: "x", id: "x", description: "keep me",
    });
    expect(Object.keys(out)).toEqual(["description"]);
  });

  it("drops ANY key containing 'slug' (case-insensitive)", () => {
    const out = stripForbiddenFields({
      customSlugField: "x", SLUG_alt: "x", productSlug: "x", title: "keep",
    });
    expect(Object.keys(out)).toEqual(["title"]);
  });

  it("drops Wix auto-generated link-* URL fields (the 2026-06-10 gap)", () => {
    const out = stripForbiddenFields({
      "link-foods-title": "x", "link-foods-all": "x", "Link-Foo": "x",
      body: "keep",
    });
    expect(Object.keys(out)).toEqual(["body"]);
  });

  it("does NOT drop legitimate fields that merely START with 'link' but aren't link- (e.g. 'linkedinUrl')", () => {
    // "linkedinurl" includes neither 'slug' nor starts with 'link-';
    // it is === "link"? no. So it survives. (A real content field.)
    const out = stripForbiddenFields({ linkedinHandle: "x", title: "keep" });
    expect(Object.keys(out).sort()).toEqual(["linkedinHandle", "title"]);
  });

  it("preserves real content fields untouched (values intact)", () => {
    const out = stripForbiddenFields({
      title: "Ghormeh Sabzi",
      description: "A Persian herb stew.",
      ingredients: ["herbs", "beans"],
      count: 7,
    });
    expect(out).toEqual({
      title: "Ghormeh Sabzi",
      description: "A Persian herb stew.",
      ingredients: ["herbs", "beans"],
      count: 7,
    });
  });

  it("empty input → empty output (no throw)", () => {
    expect(stripForbiddenFields({})).toEqual({});
  });
});

/**
 * 2026-06-16 — pure mapping-suggestion engine (§Phase 2 mapper).
 *
 * Pins the heuristics that pre-fill the guided collection mapper:
 *   • slug / label / content-role detection incl. case-insensitivity +
 *     mapping the role to the REAL field key,
 *   • roles OMITTED when no field matches (mapping stays paste-ready),
 *   • urlPrefix slugify,
 *   • a title-only collection + an empty-fields collection (no crash).
 * No I/O, no hardcoding — every output derives from the discovered shape.
 */

import { describe, it, expect } from "vitest";

import {
  suggestCollectionMapping,
  slugifyForUrlPrefix,
  isSystemWixCollection,
  partitionWixCollectionsBySystem,
} from "@/lib/connectors/wix/suggest-mapping";
import type { WixDiscoveredCollection } from "@/lib/connectors/wix/types";

function field(key: string, type = "TEXT") {
  return { key, displayName: key, type };
}
function collection(
  displayName: string,
  fields: ReadonlyArray<{ key: string; displayName: string; type: string }>,
  id = `col-${displayName}`,
): WixDiscoveredCollection {
  return { id, displayName, fields: [...fields] };
}

describe("slugifyForUrlPrefix", () => {
  it("kebab-cases a display name into a leading-slash prefix", () => {
    expect(slugifyForUrlPrefix("Persian Recipes")).toBe("/persian-recipes");
  });
  it("normalizes underscores, punctuation, and repeated dashes", () => {
    expect(slugifyForUrlPrefix("  Famous_Iranians!! (people) ")).toBe(
      "/famous-iranians-people",
    );
  });
  it("falls back to '/' when nothing url-safe remains", () => {
    expect(slugifyForUrlPrefix("！？")).toBe("/");
    expect(slugifyForUrlPrefix("")).toBe("/");
  });
});

describe("suggestCollectionMapping — slug field", () => {
  it("prefers an exact 'slug' field (case-insensitive)", () => {
    const c = collection("Recipes", [field("Title"), field("Slug")]);
    expect(suggestCollectionMapping(c).slugField).toBe("Slug"); // real key
  });
  it("falls back to a link-* / slug-ish field when no exact slug", () => {
    const c = collection("Names", [field("name"), field("link-names-title")]);
    expect(suggestCollectionMapping(c).slugField).toBe("link-names-title");
  });
  it("falls back to title/name when no slug-ish field", () => {
    const c = collection("Cities", [field("body"), field("name")]);
    expect(suggestCollectionMapping(c).slugField).toBe("name");
  });
  it("falls back to the first field as a last resort", () => {
    const c = collection("Misc", [field("alpha"), field("beta")]);
    expect(suggestCollectionMapping(c).slugField).toBe("alpha");
  });
});

describe("suggestCollectionMapping — urlPrefix + label", () => {
  it("suggests a slugified urlPrefix from the display name", () => {
    const c = collection("Persian Recipes", [field("slug"), field("title")]);
    expect(suggestCollectionMapping(c).urlPrefix).toBe("/persian-recipes");
  });
  it("labels with title, else name, else a text-ish field, else slug", () => {
    expect(
      suggestCollectionMapping(collection("A", [field("slug"), field("title")]))
        .labelField,
    ).toBe("title");
    expect(
      suggestCollectionMapping(collection("B", [field("slug"), field("name")]))
        .labelField,
    ).toBe("name");
    // no title/name → first text-ish (not the slug, not a url field)
    expect(
      suggestCollectionMapping(
        collection("C", [field("slug"), field("body", "RICH_TEXT")]),
      ).labelField,
    ).toBe("body");
  });
});

describe("suggestCollectionMapping — content roles", () => {
  it("maps each role to the REAL field key, case-insensitively", () => {
    const c = collection("Posts", [
      field("Slug"),
      field("SeoTitle"),
      field("H1Text"),
      field("MetaDescription"),
    ]);
    const roles = suggestCollectionMapping(c).contentFieldRoles;
    expect(roles).toEqual({
      title: "SeoTitle",
      heading: "H1Text",
      description: "MetaDescription",
    });
  });

  it("matches synonyms (excerpt → description, mainHeading → heading)", () => {
    const c = collection("Articles", [
      field("slug"),
      field("excerpt"),
      field("mainHeading"),
    ]);
    const roles = suggestCollectionMapping(c).contentFieldRoles;
    expect(roles?.description).toBe("excerpt");
    expect(roles?.heading).toBe("mainHeading");
    expect(roles?.title).toBeUndefined();
  });

  it("OMITS contentFieldRoles entirely when nothing matches (paste-ready)", () => {
    const c = collection("Raw", [field("slug"), field("body"), field("aux")]);
    expect(suggestCollectionMapping(c).contentFieldRoles).toBeUndefined();
  });

  it("never suggests a URL/slug/link field as a content role", () => {
    // "slug" matches the title synonym list? no — but a field literally named
    // a protected key must never become a content role. Use a slug-ish field
    // that also collides with a synonym path to prove the guard.
    const c = collection("Tricky", [
      field("title-url"), // ends with "url" → protected
      field("slug"),
    ]);
    const roles = suggestCollectionMapping(c).contentFieldRoles;
    // title-url is protected → not used as the title role; no other match.
    expect(roles).toBeUndefined();
  });
});

describe("suggestCollectionMapping — edge collections", () => {
  it("handles a title-only collection (slug=title, role title set)", () => {
    const c = collection("Solo", [field("title")]);
    const m = suggestCollectionMapping(c);
    expect(m.slugField).toBe("title");
    expect(m.labelField).toBe("title");
    expect(m.contentFieldRoles).toEqual({ title: "title" });
  });

  it("handles an empty-fields collection without crashing", () => {
    const c = collection("Empty", []);
    const m = suggestCollectionMapping(c);
    expect(m.dataCollectionId).toBe(c.id);
    expect(m.slugField).toBe("slug"); // well-formed placeholder
    expect(m.urlPrefix).toBe("/empty");
    expect(m.labelField).toBe("slug");
    expect(m.contentFieldRoles).toBeUndefined();
  });
});

describe("isSystemWixCollection — content vs system/private (trust audit F)", () => {
  it("flags Wix system namespaces (forms / members / marketing)", () => {
    expect(isSystemWixCollection("Forms/contact03")).toBe(true);
    expect(isSystemWixCollection("Members/PrivateMembersData")).toBe(true);
    expect(isSystemWixCollection("Members/FullData")).toBe(true);
    expect(isSystemWixCollection("Members/PublicData")).toBe(true);
    expect(isSystemWixCollection("Marketing/Coupons")).toBe(true);
  });
  it("flags transactional Stores subtypes (orders / inventory / variants)", () => {
    expect(isSystemWixCollection("Stores/Orders")).toBe(true);
    expect(isSystemWixCollection("Stores/InventoryItems")).toBe(true);
    expect(isSystemWixCollection("Stores/Variants")).toBe(true);
  });
  it("treats real content collections (incl. product/category pages) as content", () => {
    expect(isSystemWixCollection("IranAnimals")).toBe(false);
    expect(isSystemWixCollection("PersianKabobs")).toBe(false);
    expect(isSystemWixCollection("Import977")).toBe(false); // odd id, still content
    expect(isSystemWixCollection("Stores/Products")).toBe(false); // product pages have URLs
    expect(isSystemWixCollection("Stores/Collections")).toBe(false);
  });
  it("is case-insensitive and safe on empty input", () => {
    expect(isSystemWixCollection("forms/CONTACT")).toBe(true);
    expect(isSystemWixCollection("")).toBe(false);
  });
});

describe("partitionWixCollectionsBySystem — content first, system tucked away", () => {
  const rows = [
    { collection: { id: "IranFlags" } },
    { collection: { id: "Forms/contact03" } },
    { collection: { id: "PersianRugs" } },
    { collection: { id: "Members/PrivateMembersData" } },
    { collection: { id: "Stores/Orders" } },
    { collection: { id: "PersianKabobs" } },
  ];
  it("partitions into content vs system, preserving input order", () => {
    const { content, system } = partitionWixCollectionsBySystem(rows);
    expect(content.map((r) => r.collection.id)).toEqual([
      "IranFlags",
      "PersianRugs",
      "PersianKabobs",
    ]);
    expect(system.map((r) => r.collection.id)).toEqual([
      "Forms/contact03",
      "Members/PrivateMembersData",
      "Stores/Orders",
    ]);
  });
  it("returns empty system group when all collections are content", () => {
    const { content, system } = partitionWixCollectionsBySystem([
      { collection: { id: "IranAnimals" } },
    ]);
    expect(content).toHaveLength(1);
    expect(system).toHaveLength(0);
  });
});

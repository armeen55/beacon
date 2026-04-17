import { describe, it, expect } from "vitest";
import {
  validateSchema,
  validateSchemaToStrings,
  formatWarning,
} from "./schema-validator";

describe("validateSchema — FAQPage", () => {
  it("passes on a well-formed FAQPage block", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "What is X?",
          acceptedAnswer: { "@type": "Answer", text: "X is a thing." },
        },
        {
          "@type": "Question",
          name: "How does Y work?",
          acceptedAnswer: { "@type": "Answer", text: "Y works like this." },
        },
      ],
    };
    expect(validateSchema(data)).toEqual([]);
  });

  it("flags missing mainEntity array", () => {
    const data = { "@type": "FAQPage" };
    const w = validateSchema(data);
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("critical");
    expect(w[0].message).toMatch(/no mainEntity/i);
  });

  it("flags questions missing acceptedAnswer.text", () => {
    const data = {
      "@type": "FAQPage",
      mainEntity: [
        {
          name: "Q1",
          acceptedAnswer: { text: "A1" },
        },
        {
          name: "Q2", // no acceptedAnswer
        },
        {
          name: "Q3",
          acceptedAnswer: { text: "" }, // empty
        },
      ],
    };
    const w = validateSchema(data);
    const msg = w.find((x) => x.message.includes("acceptedAnswer"));
    expect(msg).toBeDefined();
    expect(msg!.message).toMatch(/2 of 3/);
  });

  it("flags questions missing name", () => {
    const data = {
      "@type": "FAQPage",
      mainEntity: [
        { name: "", acceptedAnswer: { text: "A" } },
        { acceptedAnswer: { text: "A" } },
        { name: "Good Q", acceptedAnswer: { text: "A" } },
      ],
    };
    const w = validateSchema(data);
    const nameW = w.find((x) => x.message.includes("missing name"));
    expect(nameW).toBeDefined();
    expect(nameW!.message).toMatch(/2 of 3/);
  });
});

describe("validateSchema — Product", () => {
  it("passes with name + offers.price + offers.priceCurrency", () => {
    const data = {
      "@type": "Product",
      name: "Widget",
      offers: { price: "99.00", priceCurrency: "USD" },
    };
    expect(validateSchema(data)).toEqual([]);
  });

  it("flags missing name, offers, price, priceCurrency", () => {
    const withoutName = validateSchema({ "@type": "Product" });
    expect(
      withoutName.some((w) => w.message.includes("Product missing name")),
    ).toBe(true);

    const withoutPrice = validateSchema({
      "@type": "Product",
      name: "X",
      offers: {},
    });
    expect(
      withoutPrice.some((w) => w.message.includes("price missing")),
    ).toBe(true);
    expect(
      withoutPrice.some((w) => w.message.includes("priceCurrency missing")),
    ).toBe(true);
  });
});

describe("validateSchema — Article", () => {
  it("passes with headline, author, datePublished", () => {
    const data = {
      "@type": "Article",
      headline: "My article",
      author: { "@type": "Person", name: "Alice" },
      datePublished: "2026-04-16",
    };
    expect(validateSchema(data)).toEqual([]);
  });

  it("accepts author as a string", () => {
    const data = {
      "@type": "Article",
      headline: "Hi",
      author: "Alice",
      datePublished: "2026-04-16",
    };
    expect(validateSchema(data)).toEqual([]);
  });

  it("flags missing headline as critical", () => {
    const w = validateSchema({
      "@type": "Article",
      author: "Alice",
      datePublished: "2026-04-16",
    });
    expect(w.some((x) => x.severity === "critical" && x.message.includes("headline"))).toBe(
      true,
    );
  });
});

describe("validateSchema — BreadcrumbList", () => {
  it("passes with full itemListElement", () => {
    const data = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://x.com/" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Locations",
          item: "https://x.com/locations",
        },
      ],
    };
    expect(validateSchema(data)).toEqual([]);
  });

  it("flags missing position and name", () => {
    const data = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { item: "https://x.com/" }, // missing position + name
        { position: 2, item: "https://x.com/about" }, // missing name
      ],
    };
    const w = validateSchema(data);
    expect(w.some((x) => x.message.includes("missing position"))).toBe(true);
    expect(w.some((x) => x.message.includes("missing name"))).toBe(true);
  });
});

describe("validateSchema — @graph recursion", () => {
  it("walks @graph container", () => {
    const data = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "FAQPage" }, // missing mainEntity → critical
        {
          "@type": "Product",
          name: "X",
          offers: { price: "1", priceCurrency: "USD" },
        },
      ],
    };
    const w = validateSchema(data);
    expect(w.some((x) => x.type === "FAQPage")).toBe(true);
    // Product is well-formed → no warning for it
    expect(w.some((x) => x.type === "Product")).toBe(false);
  });

  it("walks top-level arrays", () => {
    const data = [
      { "@type": "Organization" }, // missing name → critical
      { "@type": "FAQPage", mainEntity: [{ name: "Q", acceptedAnswer: { text: "A" } }] }, // valid
    ];
    const w = validateSchema(data);
    expect(w.some((x) => x.type === "Organization")).toBe(true);
    expect(w.some((x) => x.type === "FAQPage")).toBe(false);
  });
});

describe("validateSchema — unknown types return no warnings", () => {
  it("ignores types we don't validate", () => {
    const data = {
      "@type": "WebPage",
      name: "Home",
    };
    expect(validateSchema(data)).toEqual([]);
  });
});

describe("formatWarning + validateSchemaToStrings", () => {
  it("formats with severity and type prefix", () => {
    const s = formatWarning({
      type: "FAQPage",
      severity: "critical",
      message: "Missing mainEntity.",
    });
    expect(s).toBe("schema_critical:FAQPage: Missing mainEntity.");
  });

  it("validateSchemaToStrings returns all formatted", () => {
    const data = {
      "@type": "FAQPage",
      mainEntity: [{ name: "" }],
    };
    const strings = validateSchemaToStrings(data);
    expect(strings.every((s) => s.startsWith("schema_"))).toBe(true);
    expect(strings.length).toBeGreaterThan(0);
  });
});

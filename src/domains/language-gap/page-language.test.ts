/**
 * page-language tests (2026-07-02, master plan item 24) - classifying an owned
 * page's crawled content language from its page_snapshots text fields.
 */
import { describe, expect, it } from "vitest";
import { classifyPageLanguage, classifyPageLanguages, MIN_LETTERS_FOR_CONFIDENT_RATIO } from "./page-language";

describe("classifyPageLanguage", () => {
  it("reports no Farsi content for an all-English page", () => {
    const p = classifyPageLanguage({
      url: "/persian-new-year",
      title: "Persian New Year Guide",
      meta_description: "Everything about the Persian New Year celebration.",
      h1: "Persian New Year",
      body_paragraph_sample: ["The Persian New Year is celebrated every March with family gatherings and a special table."],
    });
    expect(p.hasFarsiContent).toBe(false);
    expect(p.farsiRatio).toBe(0);
  });

  it("detects Farsi content when the page carries real Farsi-script text", () => {
    const p = classifyPageLanguage({
      url: "/norooz",
      title: "نوروز چیست",
      meta_description: null,
      h1: "نوروز، سال نو ایرانی",
      body_paragraph_sample: ["نوروز جشن سال نو ایرانی است که هر سال در ماه مارس برگزار می شود."],
    });
    expect(p.hasFarsiContent).toBe(true);
    expect(p.farsiRatio).toBeGreaterThan(0.5);
  });

  it("credits a handful of interspersed Farsi words inside a mostly-English page", () => {
    const p = classifyPageLanguage({
      url: "/mixed",
      title: "Chaharshanbe Soori (چهارشنبه سوری) Guide",
      meta_description: "Learn about the fire jumping festival.",
      h1: "What is Chaharshanbe Soori",
      body_paragraph_sample: [
        "Chaharshanbe Soori, known in Farsi as چهارشنبه سوری, is a fire jumping festival celebrated the last Tuesday night before Norooz every single year.",
      ],
    });
    expect(p.hasFarsiContent).toBe(true);
  });

  it("reports low lettersSampled for a thin/empty page (distinguish from confidently-English)", () => {
    const p = classifyPageLanguage({ url: "/thin", title: null, meta_description: null, h1: null, body_paragraph_sample: [] });
    expect(p.lettersSampled).toBeLessThan(MIN_LETTERS_FOR_CONFIDENT_RATIO);
    expect(p.hasFarsiContent).toBe(false);
  });

  it("reads FAQ question/answer text as part of the page sample", () => {
    const p = classifyPageLanguage({
      url: "/faq",
      title: null,
      meta_description: null,
      h1: null,
      faqs: [{ question: "چهارشنبه سوری چیست", answer: "چهارشنبه سوری یک جشن قدیمی ایرانی است که هر سال برگزار می شود." }],
    });
    expect(p.hasFarsiContent).toBe(true);
  });

  it("reads h2_list text as part of the page sample", () => {
    const p = classifyPageLanguage({
      url: "/h2s",
      title: null,
      meta_description: null,
      h1: null,
      h2_list: ["تاریخچه نوروز و جشن های ایرانی باستان"],
    });
    expect(p.hasFarsiContent).toBe(true);
  });
});

describe("classifyPageLanguages (batch)", () => {
  it("builds one profile per snapshot, keyed by url", () => {
    const out = classifyPageLanguages([
      { url: "/a", title: "English title", meta_description: null, h1: null },
      { url: "/b", title: "نوروز", meta_description: null, h1: null },
    ]);
    expect(out.size).toBe(2);
    expect(out.get("/a")!.hasFarsiContent).toBe(false);
    expect(out.get("/b")!.hasFarsiContent).toBe(true);
  });

  it("skips snapshots with no url", () => {
    const out = classifyPageLanguages([{ url: "", title: "x", meta_description: null, h1: null }]);
    expect(out.size).toBe(0);
  });
});

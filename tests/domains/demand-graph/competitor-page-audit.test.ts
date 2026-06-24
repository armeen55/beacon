import { describe, it, expect } from "vitest";
import {
  extractCompetitorFacts,
  auditCompetitorPage,
  whatWins,
  type CompetitorFetchResult,
} from "@/domains/demand-graph/competitor-page-audit";

const RICH_HTML = `<!doctype html><html><head>
  <title>Persian Wedding Traditions: The Complete Guide</title>
  <meta name="description" content="Everything about a Persian wedding — sofreh aghd, ceremony order, and customs." />
  <link rel="canonical" href="https://www.theknot.com/content/persian-wedding" />
  <meta property="og:title" content="Persian Wedding Traditions" />
  <meta property="og:type" content="article" />
  <meta property="article:published_time" content="2025-03-01T10:00:00Z" />
  <script type="application/ld+json">{"@context":"https://schema.org","@type":["Article","FAQPage"],"datePublished":"2025-03-01","mainEntity":[{"@type":"Question","name":"What is a sofreh aghd?","acceptedAnswer":{"@type":"Answer","text":"A ceremonial spread."}}]}</script>
</head><body>
  <nav><a href="/menu">Menu</a></nav>
  <main>
    <h1>Persian Wedding Traditions</h1>
    <p>A Persian wedding blends ancient Zoroastrian customs with modern celebration, centered on the sofreh aghd, a beautifully arranged ceremonial spread that symbolizes the couple's future together.</p>
    <h2>The Sofreh Aghd</h2>
    <p>The sofreh aghd holds mirrors, candles, honey, and herbs, each carrying meaning for the marriage.</p>
    <h2>Ceremony Order</h2>
    <h3>Knife Dance</h3>
    <h2>Modern Persian Weddings</h2>
    <a href="https://www.theknot.com/persian-food">Persian food</a>
    <a href="https://example.com/external">External</a>
    <img src="/a.jpg"/><img src="/b.jpg"/><img src="/c.jpg"/><img src="/d.jpg"/><img src="/e.jpg"/>
  </main>
  <footer><a href="/privacy">Privacy</a></footer>
</body></html>`;

describe("extractCompetitorFacts (deterministic teardown)", () => {
  const f = extractCompetitorFacts(RICH_HTML, "https://www.theknot.com/content/persian-wedding");

  it("pulls title / meta / h1 / canonical / og", () => {
    expect(f.title).toContain("Persian Wedding Traditions");
    expect(f.metaDescription).toContain("sofreh aghd");
    expect(f.h1).toBe("Persian Wedding Traditions");
    expect(f.canonicalUrl).toBe("https://www.theknot.com/content/persian-wedding");
    expect(f.ogType).toBe("article");
  });

  it("counts headings + builds an outline", () => {
    expect(f.h2Count).toBe(3);
    expect(f.h3Count).toBe(1);
    expect(f.outline).toContain("The Sofreh Aghd");
  });

  it("extracts schema types + FAQ questions (schema)", () => {
    expect(f.schemaTypes).toEqual(expect.arrayContaining(["Article", "FAQPage"]));
    expect(f.hasFaq).toBe(true);
    expect(f.faqQuestions).toContain("What is a sofreh aghd?");
  });

  it("detects an answer block + counts words (boilerplate stripped)", () => {
    expect(f.hasAnswerBlock).toBe(true);
    expect(f.wordCount).toBeGreaterThan(40);
  });

  it("classifies internal vs external links by host + counts images", () => {
    expect(f.internalLinkCount).toBeGreaterThanOrEqual(1); // /persian-food on theknot
    expect(f.externalLinkCount).toBeGreaterThanOrEqual(1); // example.com
    expect(f.imageCount).toBe(5);
  });

  it("reads a freshness date + top terms", () => {
    expect(f.freshnessDate).toBeTruthy();
    expect(f.topTerms).toContain("persian");
  });

  it("whatWins summarizes the strong signals deterministically", () => {
    const w = whatWins(f);
    expect(w).toContain("FAQ schema");
    expect(w).toContain("answer block");
  });
});

describe("extractCompetitorFacts — tool/calculator + thin page", () => {
  it("flags an interactive tool/calculator", () => {
    const html = `<html><head><title>ADU Cost Calculator</title></head><body><main><h1>ADU Cost Calculator</h1><form><input name="size"/></form></main></body></html>`;
    expect(extractCompetitorFacts(html, "https://x.com/calc").hasToolOrCalculator).toBe(true);
  });
  it("a thin page reads as low structure", () => {
    const html = `<html><head><title>Thin</title></head><body><main><p>hi</p></main></body></html>`;
    const f = extractCompetitorFacts(html, "https://x.com/thin");
    expect(f.hasFaq).toBe(false);
    expect(whatWins(f)).toContain("thin page");
  });
});

describe("auditCompetitorPage (fail-soft fetch)", () => {
  const okFetch = (html: string) =>
    async (): Promise<CompetitorFetchResult> => ({ ok: true, html, status: 200 });

  it("ok → facts + content hash + ok status", async () => {
    const a = await auditCompetitorPage("https://www.theknot.com/content/persian-wedding", {
      fetchHtml: okFetch(RICH_HTML),
      now: () => "2026-06-24T00:00:00Z",
    });
    expect(a.fetchStatus).toBe("ok");
    expect(a.facts?.h1).toBe("Persian Wedding Traditions");
    expect(a.contentHash).toBeTruthy();
    expect(a.domain).toBe("theknot.com");
  });

  it("robots blocked → blocked_robots, no facts, honest", async () => {
    const a = await auditCompetitorPage("https://x.com/p", {
      fetchHtml: async () => ({ ok: false, reason: "robots_blocked" }),
    });
    expect(a.fetchStatus).toBe("blocked_robots");
    expect(a.facts).toBeNull();
  });

  it("http error → http_error with status", async () => {
    const a = await auditCompetitorPage("https://x.com/p", {
      fetchHtml: async () => ({ ok: false, reason: "fetch_failed", status: 404 }),
    });
    expect(a.fetchStatus).toBe("http_error");
    expect(a.httpStatus).toBe(404);
  });

  it("network failure → fetch_failed (never throws)", async () => {
    const a = await auditCompetitorPage("https://x.com/p", {
      fetchHtml: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    expect(a.fetchStatus).toBe("fetch_failed");
    expect(a.facts).toBeNull();
  });

  it("empty/tiny body → empty", async () => {
    const a = await auditCompetitorPage("https://x.com/p", {
      fetchHtml: async () => ({ ok: true, html: "<html></html>", status: 200 }),
    });
    expect(a.fetchStatus).toBe("empty");
  });
});

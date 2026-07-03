import { describe, it, expect } from "vitest";
import {
  extractCompetitorFacts,
  auditCompetitorPage,
  whatWins,
  isTeardownFresh,
  planNativeCitedTargets,
  type CompetitorFetchResult,
} from "@/domains/demand-graph/competitor-page-audit";
import type { NativeObservationInput } from "@/domains/ai-visibility/native-intel";

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

describe("isTeardownFresh (cache TTL — teardown refreshes after competitors change)", () => {
  const now = Date.parse("2026-06-25T00:00:00Z");
  const DAY = 86_400_000;
  it("reuses a recent audit (1 day old, within 14d)", () => {
    expect(isTeardownFresh(new Date(now - 1 * DAY).toISOString(), now)).toBe(true);
  });
  it("re-fetches a stale audit (20 days old, past 14d)", () => {
    expect(isTeardownFresh(new Date(now - 20 * DAY).toISOString(), now)).toBe(false);
  });
  it("treats a missing/garbage auditedAt as stale (never reuse forever)", () => {
    expect(isTeardownFresh(null, now)).toBe(false);
    expect(isTeardownFresh("not-a-date", now)).toBe(false);
  });
  it("respects an explicit maxAge override", () => {
    expect(isTeardownFresh(new Date(now - 2 * DAY).toISOString(), now, 1 * DAY)).toBe(false);
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

describe("planNativeCitedTargets (master plan item D2: native poll cited pages as teardown targets)", () => {
  function row(over: Partial<NativeObservationInput> = {}): NativeObservationInput {
    return {
      promptId: "p1",
      promptText: "What is a Persian wedding?",
      engine: "chatgpt",
      topic: null,
      observedAt: "2026-07-01T00:00:00Z",
      answerText: "",
      citationDomains: [],
      citationUrls: [],
      trackedBrandMentioned: null,
      trackedBrandCited: null,
      ...over,
    };
  }

  it("groups by prompt and dedupes by domain, most-cited-first", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", engine: "chatgpt", citationUrls: ["https://theknot.com/a", "https://theknot.com/b"] }),
      row({ promptId: "p1", engine: "gemini", citationUrls: ["https://theknot.com/a", "https://brides.com/x"] }),
    ];
    const targets = planNativeCitedTargets(rows);
    expect(targets).toHaveLength(1);
    const t = targets[0]!;
    expect(t.promptId).toBe("p1");
    // theknot.com/a cited twice -> ranked first; theknot.com/b same domain as /a -> deduped out.
    expect(t.urls[0]).toBe("https://theknot.com/a");
    expect(t.urls).not.toContain("https://theknot.com/b");
    expect(t.urls).toContain("https://brides.com/x");
  });

  it("caps at 5 URLs per prompt", () => {
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com"];
    const rows: NativeObservationInput[] = domains.map((d) => row({ citationUrls: [`https://${d}/page`] }));
    const targets = planNativeCitedTargets(rows);
    expect(targets[0]!.urls.length).toBe(5);
  });

  it("excludes the tenant's own domain (never tears down our own page)", () => {
    const rows: NativeObservationInput[] = [
      row({ citationUrls: ["https://iranopedia.com/persian-wedding", "https://theknot.com/x"] }),
    ];
    const targets = planNativeCitedTargets(rows, { ownedRoot: "iranopedia.com" });
    expect(targets[0]!.urls).toEqual(["https://theknot.com/x"]);
  });

  it("excludes noise/aggregator domains via the existing relevance-gate list", () => {
    const rows: NativeObservationInput[] = [
      row({ citationUrls: ["https://reddit.com/r/x", "https://theknot.com/x"] }),
    ];
    const targets = planNativeCitedTargets(rows);
    expect(targets[0]!.urls).toEqual(["https://theknot.com/x"]);
  });

  it("skips prompts with zero usable cited URLs (no fabricated target)", () => {
    const rows: NativeObservationInput[] = [row({ citationUrls: [] })];
    expect(planNativeCitedTargets(rows)).toEqual([]);
  });

  it("orders prompts by most-recently-observed first", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "old", observedAt: "2026-06-01T00:00:00Z", citationUrls: ["https://a.com/x"] }),
      row({ promptId: "new", observedAt: "2026-07-01T00:00:00Z", citationUrls: ["https://b.com/x"] }),
    ];
    const targets = planNativeCitedTargets(rows);
    expect(targets.map((t) => t.promptId)).toEqual(["new", "old"]);
  });

  it("handles multiple distinct prompts independently", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", citationUrls: ["https://a.com/x"] }),
      row({ promptId: "p2", citationUrls: ["https://b.com/x"] }),
    ];
    const targets = planNativeCitedTargets(rows);
    expect(targets).toHaveLength(2);
  });
});

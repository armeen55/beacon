import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteHealthPanel } from "./site-health-panel";
import { detectAiCrawlerBlock } from "@/domains/site-health/ai-crawler-block";
import { detectJsShellFact } from "@/domains/site-health/js-shell-fact";
import { detectCms } from "@/domains/site-health/cms-detect";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";

const NOW = Date.parse("2026-07-03T18:00:00Z");

function idx(
  robots: Partial<OwnedUrlIndexability["signals"]["robots_txt"]>,
): Pick<OwnedUrlIndexability, "signals"> {
  return {
    signals: {
      sitemap_membership: { in_sitemap: true, sitemap_url: null },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
        ...robots,
      },
      page_snapshot: null,
      gsc: null,
    },
  };
}

describe("SiteHealthPanel (renderToStaticMarkup)", () => {
  it("renders nothing when every fact is empty (self-hiding)", () => {
    const html = renderToStaticMarkup(
      <SiteHealthPanel aiCrawlerBlock={null} jsShell={[]} cms={null} nowMs={NOW} />,
    );
    expect(html).toBe("");
  });

  it("renders the AI-crawler-block card naming the blocked bots plainly", () => {
    const fact = detectAiCrawlerBlock(
      idx({ gptbot_allowed: false, claudebot_allowed: false }),
    );
    const html = renderToStaticMarkup(
      <SiteHealthPanel aiCrawlerBlock={fact} jsShell={[]} cms={null} nowMs={NOW} />,
    );
    expect(html).toContain("Site health");
    expect(html).toContain("GPTBot");
    expect(html).toContain("ClaudeBot");
    expect(html).toContain("can never recommend you");
    expect(html).toContain("AI cannot read you");
    expect(html).not.toMatch(/[–—]/);
  });

  it("renders a JS-shell card with server-render advice", () => {
    const fact = detectJsShellFact({
      url: "https://example.com/app",
      wordCount: 4,
      bodyExcerptCount: 0,
      hasTitle: true,
      hasH1: false,
      httpStatus: 200,
      impressions90d: 300,
    });
    const html = renderToStaticMarkup(
      <SiteHealthPanel aiCrawlerBlock={null} jsShell={[fact!]} cms={null} nowMs={NOW} />,
    );
    expect(html).toContain("loads almost empty until JavaScript runs");
    expect(html).toContain("Add server-rendered text so they can read it.");
  });

  it("renders the CMS capability card for a push platform", () => {
    const fact = detectCms({ generatorMeta: "Wix.com Website Builder" });
    const html = renderToStaticMarkup(
      <SiteHealthPanel aiCrawlerBlock={null} jsShell={[]} cms={fact} nowMs={NOW} />,
    );
    expect(html).toContain("You are on Wix.");
    expect(html).toContain("I can push SEO fields here");
    expect(html).toContain("I can push here");
  });

  it("renders all three facts together with a receipt line", () => {
    const html = renderToStaticMarkup(
      <SiteHealthPanel
        aiCrawlerBlock={detectAiCrawlerBlock(idx({ gptbot_allowed: false }))}
        jsShell={[
          detectJsShellFact({
            url: "https://example.com/app",
            wordCount: 4,
            bodyExcerptCount: 0,
            hasTitle: true,
            hasH1: false,
            httpStatus: 200,
            impressions90d: 300,
          })!,
        ]}
        cms={detectCms({ generatorMeta: "Shopify" })}
        dataThrough="2026-07-02"
        checkedAt="2026-07-03T17:58:00Z"
        nowMs={NOW}
      />,
    );
    expect(html).toContain("GPTBot");
    expect(html).toContain("loads almost empty until JavaScript runs");
    expect(html).toContain("You are on Shopify.");
    expect(html).toContain("From your site scan");
    expect(html).not.toMatch(/[–—]/);
  });
});

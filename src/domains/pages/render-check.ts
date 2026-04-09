/**
 * Raw-vs-rendered verification for owned pages.
 *
 * Compares the cheerio-extracted snapshot (raw HTML) against
 * a headless Chrome render to detect client-side rendering issues
 * where the actual DOM differs from what crawlers see.
 */

import { existsSync } from "node:fs";
import type { PageSnapshot } from "./types";

export type RenderMismatch = {
  field: string;
  raw: string | number | null;
  rendered: string | number | null;
};

export type RenderCheckResult = {
  url: string;
  page_id: string;
  checked_at: string;
  render_ok: boolean;
  mismatches: RenderMismatch[];
  rendered_title: string | null;
  rendered_h1: string | null;
  rendered_faq_count: number;
  rendered_schema_count: number;
  error: string | null;
};

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function findChrome(): string | null {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function checkPageRender(
  snapshot: PageSnapshot
): Promise<RenderCheckResult> {
  const base: Omit<RenderCheckResult, "render_ok" | "mismatches"> = {
    url: snapshot.url,
    page_id: snapshot.page_id,
    checked_at: new Date().toISOString(),
    rendered_title: null,
    rendered_h1: null,
    rendered_faq_count: 0,
    rendered_schema_count: 0,
    error: null,
  };

  const chromePath = findChrome();
  if (!chromePath) {
    return {
      ...base,
      render_ok: true,
      mismatches: [],
      error: "Chrome not found — skipping render check",
    };
  }

  let browser;
  try {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (compatible; BeaconRenderCheck/1.0)"
    );
    await page.goto(snapshot.url, {
      waitUntil: "networkidle2",
      timeout: 20_000,
    });

    const rendered = await page.evaluate(() => {
      const title = document.title?.trim() || null;
      const h1El = document.querySelector("h1");
      const h1 = h1El?.textContent?.trim() || null;

      let faqCount = 0;
      const jsonLds = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      const schemaTypes: string[] = [];

      jsonLds.forEach((el) => {
        try {
          const data = JSON.parse(el.textContent || "");
          function collectTypes(obj: Record<string, unknown>) {
            if (typeof obj["@type"] === "string") {
              schemaTypes.push(obj["@type"]);
              if (obj["@type"] === "FAQPage" && Array.isArray(obj.mainEntity)) {
                faqCount += obj.mainEntity.length;
              }
            }
            if (Array.isArray(obj["@graph"])) {
              obj["@graph"].forEach((n: Record<string, unknown>) => collectTypes(n));
            }
          }
          collectTypes(data);
        } catch {}
      });

      const detailsFaqs = document.querySelectorAll("details summary");
      faqCount += detailsFaqs.length;

      return { title, h1, faqCount, schemaTypes };
    });

    await browser.close();

    const mismatches: RenderMismatch[] = [];

    if (rendered.title !== snapshot.title) {
      mismatches.push({
        field: "title",
        raw: snapshot.title,
        rendered: rendered.title,
      });
    }
    if (rendered.h1 !== snapshot.h1) {
      mismatches.push({
        field: "h1",
        raw: snapshot.h1,
        rendered: rendered.h1,
      });
    }
    if (rendered.faqCount !== snapshot.faqs.length) {
      mismatches.push({
        field: "faq_count",
        raw: snapshot.faqs.length,
        rendered: rendered.faqCount,
      });
    }
    if (rendered.schemaTypes.length !== snapshot.schema_types.length) {
      mismatches.push({
        field: "schema_count",
        raw: snapshot.schema_types.length,
        rendered: rendered.schemaTypes.length,
      });
    }

    return {
      ...base,
      rendered_title: rendered.title,
      rendered_h1: rendered.h1,
      rendered_faq_count: rendered.faqCount,
      rendered_schema_count: rendered.schemaTypes.length,
      render_ok: mismatches.length === 0,
      mismatches,
    };
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      render_ok: true,
      mismatches: [],
      error: `Render check failed: ${msg.slice(0, 300)}`,
    };
  }
}

export async function checkTopPages(
  snapshots: PageSnapshot[],
  citationsByUrl: Map<string, number>,
  maxPages: number = 5
): Promise<RenderCheckResult[]> {
  const ranked = snapshots
    .map((s) => ({
      snap: s,
      citations: citationsByUrl.get(s.url.replace(/\/+$/, "").toLowerCase()) ?? 0,
    }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, maxPages);

  const results: RenderCheckResult[] = [];
  for (const { snap } of ranked) {
    const result = await checkPageRender(snap);
    results.push(result);
  }
  return results;
}

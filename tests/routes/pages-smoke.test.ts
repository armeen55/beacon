import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * M5 (operator audit, 2026-05-05) — /pages is now a deliberate
 * not-ready placeholder. The previous 882-line route depended on ~15
 * domain stores (page-snapshots, render-checks, sitemap-reconciliation,
 * page-issues, outcome-watch, etc.), several returning empty on Vercel.
 * Operator brief: "Do not build a giant page analytics product yet."
 *
 * This smoke test pins the not-ready contract:
 *   - Default export renders without throwing under RSC (no DB reads).
 *   - Heading "Pages" + subheading "Pages isn't ready yet".
 *   - At least one link to each working surface (/today, /recommendations,
 *     /changes) so the route remains useful when reached directly.
 *   - No half-broken table / empty placeholder grid markup.
 *
 * No mocks needed — the route is a pure RSC with no I/O.
 */
describe("M5 — /pages not-ready route smoke", () => {
  it("renders the Pages heading + the not-ready explanation", async () => {
    const { default: PagesPage } = await import("@/app/(shell)/pages/page");
    const tree = PagesPage();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain("Pages");
    expect(html).toContain("Pages isn");
    expect(html).toContain("ready yet");
    expect(html).toContain('data-pages-state="not-ready"');
  });

  it("includes navigational links to /, /recommendations, /changes", async () => {
    const { default: PagesPage } = await import("@/app/(shell)/pages/page");
    const tree = PagesPage();
    const html = renderToStaticMarkup(tree as ReactElement);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/recommendations"');
    expect(html).toContain('href="/changes"');
  });

  it("does not render any of the legacy 'half-broken' markers", async () => {
    const { default: PagesPage } = await import("@/app/(shell)/pages/page");
    const tree = PagesPage();
    const html = renderToStaticMarkup(tree as ReactElement);
    // The previous route's headline copy + the demo-mode empty-state
    // copy must not appear — those were the half-broken signals the
    // operator wanted gone.
    expect(html).not.toContain(
      "Health, citations, and the next step for each URL.",
    );
    expect(html).not.toContain("Import your data to see your real page list");
    // Stub class from the previous client-component mock must not
    // appear — the new route has no client component.
    expect(html).not.toContain("pages-smoke-stub");
  });

  it("default export is a synchronous RSC (no async I/O)", async () => {
    const mod = await import("@/app/(shell)/pages/page");
    // Synchronous component returns a ReactElement directly (not a
    // Promise). This guards against a future regression that re-adds
    // server-side data fetching in PagesPage.
    const result = mod.default();
    expect(result).toBeDefined();
    // ReactElement has $$typeof; Promise<ReactElement> wouldn't.
    const maybeThenable = result as unknown as Record<string, unknown>;
    expect(
      typeof maybeThenable.then,
      "PagesPage must be a synchronous RSC after M5 — async DB reads are forbidden until /pages is rebuilt",
    ).toBe("undefined");
  });
});

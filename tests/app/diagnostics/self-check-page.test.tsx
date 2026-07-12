/**
 * /diagnostics/self-check contract (BEACON_500 R22b, 2026-07-03): operator gate,
 * the honest benchmark line, and the four self-check sections render. This is a
 * read-only, PURE surface (no I/O), so the page renders deterministically with no
 * mocks beyond the operator gate.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
}));

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));

import SelfCheckPage from "@/app/(shell)/diagnostics/self-check/page";

beforeEach(() => {
  _operator = true;
});

describe("/diagnostics/self-check", () => {
  it("renders the honest benchmark line and all four sections when in operator mode", async () => {
    const el = await SelfCheckPage();
    const html = renderToStaticMarkup(el);
    // The honest headline line, in Beacon voice.
    expect(html).toContain("I rechecked 8 known cases and still get all 8 right. This catches regressions, but it is not a blind test.");
    expect(html).toContain("No fresh blind result is registered for this release.");
    // The four self-check sections.
    expect(html).toContain("Did I change any past call?");
    expect(html).toContain("Which signals are pulling their weight?");
    expect(html).toContain("Is my model fallback plan sound?");
    // The ablation names its most load-bearing signal in plain English.
    expect(html).toContain("Removing GSC demand drops 4 gold cases.");
    // No banned dashes anywhere on the surface.
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("declares force-dynamic and an operator gate so the build never prerenders it and non-operators 404", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "..", "..", "..", "src/app/(shell)/diagnostics/self-check/page.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
    expect(src).toMatch(/notFound\s*\(\s*\)/);
  });
});

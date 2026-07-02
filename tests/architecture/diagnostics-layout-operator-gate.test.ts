/**
 * Architecture invariant — /diagnostics route-tree operator gate (fix batch
 * D2, 2026-07-02). The `/diagnostics` route tree exposes engineer-facing
 * language ("Set BEACON_FOUNDER_NAMES in .env.local", "known Bay Area
 * geographies") that must never render for a non-operator visitor. Rather
 * than trust every one of the 23+ pages under `/diagnostics` to gate itself,
 * `src/app/(shell)/diagnostics/layout.tsx` gates the ENTIRE subtree once:
 * any request where `isOperatorModeServer()` is false gets a plain 404 via
 * `notFound()`, before any child page renders.
 *
 * This pins that single choke point so a future refactor can't quietly
 * remove it (e.g. by inlining children or replacing the layout).
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LAYOUT_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "layout.tsx",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

let _operatorModeEnabled = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operatorModeEnabled,
}));

describe("Architecture — /diagnostics/layout.tsx gates the whole route tree", () => {
  it("layout.tsx exists at the canonical path", () => {
    expect(() => readFileSync(LAYOUT_PATH, "utf-8")).not.toThrow();
  });

  it("imports isOperatorModeServer from the locked operator-gate helper", () => {
    const src = readFileSync(LAYOUT_PATH, "utf-8");
    expect(src).toMatch(/from\s+["']@\/lib\/operator-mode["']/);
    expect(stripComments(src)).toMatch(/\bisOperatorModeServer\b/);
  });

  it("imports notFound from next/navigation and calls it when the gate is false", () => {
    const src = readFileSync(LAYOUT_PATH, "utf-8");
    expect(src).toMatch(/from\s+["']next\/navigation["']/);
    const stripped = stripComments(src);
    expect(stripped).toMatch(/notFound\s*\(\s*\)/);
    expect(stripped).toMatch(/!\s*operator\b|!\s*isOperatorModeServer\s*\(\s*\)/);
  });

  it("default-exports a layout component that renders children only when gated open", () => {
    const stripped = stripComments(readFileSync(LAYOUT_PATH, "utf-8"));
    expect(stripped).toMatch(/export default function DiagnosticsLayout/);
    expect(stripped).toMatch(/children/);
  });
});

describe("Behavioral proof — non-operators 404, operators see children", () => {
  it("calls notFound() (and never renders children) when isOperatorModeServer() is false", async () => {
    _operatorModeEnabled = false;
    const { default: DiagnosticsLayout } = await import("@/app/(shell)/diagnostics/layout");
    expect(() =>
      DiagnosticsLayout({ children: "SECRET_ENGINEER_ONLY_CONTENT" as unknown as React.ReactNode }),
    ).toThrow(NotFoundError);
  });

  it("renders children unchanged when isOperatorModeServer() is true", async () => {
    _operatorModeEnabled = true;
    const { default: DiagnosticsLayout } = await import("@/app/(shell)/diagnostics/layout");
    const result = DiagnosticsLayout({ children: "OPERATOR_CONTENT" as unknown as React.ReactNode });
    // The gated-open path returns a fragment wrapping children unchanged.
    expect(JSON.stringify(result)).toContain("OPERATOR_CONTENT");
  });
});

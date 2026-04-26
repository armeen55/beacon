/**
 * Sprint 7 Phase 7.5c/4 (2026-04-25) — diagnostics page module-level state
 * lift invariant.
 *
 * Pre-7.5c/4: `src/app/(shell)/diagnostics/page.tsx` declared module-level
 * `const repo = getRepository().forTenant(await currentTenantId())`,
 * `const pageSnapshots = await repo.getPageSnapshots()`, and
 * `let allPages: PageEntity[]` set per-render. Multi-tenant correctness
 * required lifting all three into request scope and threading data through
 * helper React components.
 *
 * Post-7.5c/4: no module-level repo / data state. Each render calls
 * `currentTenantId()`, fetches via `getRepository().forTenant(tenantId)`,
 * and threads results to helpers via a `ctx: DiagnosticsContext` prop.
 *
 * This invariant catches regressions: any future drift back to module-level
 * `getRepository()` calls or `let allPages` / `const pageSnapshots`
 * declarations at the top of the file fails the test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIAGNOSTICS_PATH = resolve(
  __dirname,
  "../../src/app/(shell)/diagnostics/page.tsx",
);
const SRC = readFileSync(DIAGNOSTICS_PATH, "utf8");

// Slice the source to lines BEFORE `export default async function DiagnosticsPage`
// — that's the module scope. References to `pageSnapshots`/`allPages` inside
// that prefix are forbidden (except inside type definitions and comments).
function moduleScopeSlice(): string {
  const idx = SRC.indexOf("export default async function DiagnosticsPage");
  expect(idx).toBeGreaterThan(0);
  return SRC.slice(0, idx);
}

describe("Sprint 7 Phase 7.5c/4 — diagnostics module-level state lift", () => {
  it("no module-level `getRepository()` call before DiagnosticsPage", () => {
    const slice = moduleScopeSlice();
    // Forbidden: `const repo = getRepository(`, `let repo = getRepository(`,
    // or any module-level `await getRepository(...)` invocation. Imports of
    // the function name are allowed (those don't invoke).
    expect(slice).not.toMatch(/^\s*(?:const|let|var)\s+repo\s*=\s*getRepository\(/m);
    expect(slice).not.toMatch(/^\s*await\s+getRepository\(/m);
  });

  it("no module-level `pageSnapshots` declaration before DiagnosticsPage", () => {
    const slice = moduleScopeSlice();
    // Forbidden: `const pageSnapshots = ...`, `let pageSnapshots = ...`.
    // Allow: type def fields like `pageSnapshots: PageSnapshot[]` (those
    // start with the indented type-property syntax, not `const|let|var`).
    expect(slice).not.toMatch(/^\s*(?:const|let|var)\s+pageSnapshots\b/m);
  });

  it("no module-level `allPages` declaration before DiagnosticsPage", () => {
    const slice = moduleScopeSlice();
    expect(slice).not.toMatch(/^\s*(?:const|let|var)\s+allPages\b/m);
  });

  it("DiagnosticsContext type is defined and threads through helpers", () => {
    expect(SRC).toMatch(/type\s+DiagnosticsContext\s*=\s*\{[\s\S]*pages:\s*PageEntity\[\][\s\S]*pageSnapshots:\s*PageSnapshot\[\]/);
    // Helper components accept `ctx: DiagnosticsContext`.
    expect(SRC).toMatch(/function\s+EntityRepresentationSection\(\{\s*ctx\s*\}/);
    expect(SRC).toMatch(/function\s+BeaconScoreSection\(\{\s*ctx\s*\}/);
    expect(SRC).toMatch(/function\s+GeoCoverageSection\(\{\s*ctx\s*\}/);
    expect(SRC).toMatch(/function\s+ExtractabilitySection\(\{\s*ctx\s*\}/);
    expect(SRC).toMatch(/function\s+SnippetIntelSection\(\{\s*ctx\s*\}/);
    expect(SRC).toMatch(/function\s+PulseBanner\(\{\s*ctx\s*\}/);
    expect(SRC).toMatch(/function\s+AdvancedReadinessSection\(\{\s*ctx\s*\}/);
  });

  it("DiagnosticsPage resolves currentTenantId() and threads through forTenant()", () => {
    const idx = SRC.indexOf("export default async function DiagnosticsPage");
    const body = SRC.slice(idx);
    expect(body).toMatch(/await\s+currentTenantId\(\)/);
    expect(body).toMatch(/getRepository\(\)\.forTenant\(/);
  });
});

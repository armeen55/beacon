import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const executable = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("Profound import has one explicit tenant boundary", () => {
  it("resolves the request tenant in the server action and passes it explicitly", () => {
    const action = executable(read("src/adapters/profound/actions.ts"));
    expect(action).toMatch(/const tenantId = await currentTenantId\(\)/);
    expect(action).toMatch(/runProfoundImport\(tenantId\)/);
    expect(action).not.toContain("ritz-builders");
  });

  it("does not recover tenant or owned identity from process-global defaults", () => {
    const orchestrator = executable(
      read("src/adapters/profound/import-orchestrator.ts"),
    );
    const seed = executable(read("src/adapters/profound/entity-seed.ts"));
    const benchmark = executable(
      read("src/adapters/profound/benchmark-adapter.ts"),
    );

    expect(orchestrator).not.toMatch(
      /(?:const|let|var)\s+tenantId\s*=\s*process\.env\.BEACON_TENANT_ID/,
    );
    expect(orchestrator).toMatch(/configuredTenantId !== tenantId/);
    expect(orchestrator).toMatch(/process\.env\.VERCEL === ["']1["']/);
    expect(orchestrator).not.toContain("getSiteConfig");
    expect(orchestrator).not.toMatch(/\?\?\s*["']ritz["']/i);
    expect(seed).not.toContain("getSiteConfig");
    expect(seed).not.toMatch(/ritzbuilders\.com/i);
    expect(benchmark).not.toContain("getSiteConfig");
    expect(benchmark).not.toMatch(/legacyRitz|ritz builders/i);
  });
});

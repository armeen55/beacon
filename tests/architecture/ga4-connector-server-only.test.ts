/**
 * Architecture invariant — Slice 9.A1 (2026-05-18).
 *
 * The GA4 connector lives under `src/lib/connectors/ga4/`. Every
 * file in that directory MUST start with `import "server-only"` so
 * Next.js refuses to bundle it into client components. The
 * connector reads tokens + hits the Analytics Admin API; leaking it
 * into a client bundle would either crash at build time (server-only
 * module is correctly imported in a Client Component → build error)
 * or — worse — expose access tokens to the browser.
 *
 * Negative invariant: the directory MUST NOT contain any file that
 * lacks the `server-only` import. Positive invariant: at least one
 * file exists (sanity floor).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const GA4_DIR = join(REPO_ROOT, "src/lib/connectors/ga4");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function listGa4Files(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(GA4_DIR)) {
    const full = join(GA4_DIR, name);
    if (statSync(full).isDirectory()) continue;
    if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out.sort();
}

describe("ga4 connector — server-only posture", () => {
  it("at least one TypeScript file exists under src/lib/connectors/ga4/", () => {
    expect(listGa4Files().length).toBeGreaterThan(0);
  });

  it("every file under src/lib/connectors/ga4/ imports 'server-only'", () => {
    const offenders: string[] = [];
    for (const path of listGa4Files()) {
      const code = stripComments(readFileSync(path, "utf-8"));
      if (!/import\s+["']server-only["']/.test(code)) {
        offenders.push(path.replace(REPO_ROOT + "/", ""));
      }
    }
    expect(
      offenders,
      "These GA4 connector files must add `import \"server-only\";` so " +
        "they cannot be bundled into client components:\n" +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("no file under src/lib/connectors/ga4/ imports a customer-facing surface", () => {
    const forbiddenImports = [
      /from\s+["']@\/app\//,
      /from\s+["']@\/components\//,
      /from\s+["']@\/domains\/today["']/,
      /from\s+["']@\/domains\/today\//,
      /from\s+["']@\/domains\/recommendations["']/,
      /from\s+["']@\/domains\/recommendations\//,
      /from\s+["']@\/domains\/changes["']/,
      /from\s+["']@\/domains\/changes\//,
    ];
    const offenders: string[] = [];
    for (const path of listGa4Files()) {
      const code = stripComments(readFileSync(path, "utf-8"));
      for (const pat of forbiddenImports) {
        if (pat.test(code)) {
          offenders.push(`${path.replace(REPO_ROOT + "/", "")} (matched ${pat.source})`);
        }
      }
    }
    expect(
      offenders,
      "GA4 connector is operator-substrate only; it must not import " +
        "customer-facing surfaces. Offenders:\n" +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});

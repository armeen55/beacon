/**
 * PS10 (2026-06-19) — Page Surgeon title isolation.
 *
 * The Page Surgeon owns its OWN title logic (evaluate-title / title-candidates /
 * title-scorers). The legacy recommendations queue has a SEPARATE, older title
 * stack (build-title, recommendation-title-humanizer, providers/generators/
 * edit-title, the compose*RowTitle helpers in recommendation-action-rows). These
 * must stay isolated so stale legacy title heuristics can never contaminate a
 * Page Surgeon artifact. This test pins that boundary: no file under
 * page-surgeon/ may import a legacy title module.
 *
 * No network. Reads source text only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const PAGE_SURGEON_ROOT = resolve(REPO_ROOT, "src/domains/recommendation-intelligence/page-surgeon");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      yield full;
    }
  }
}

// Legacy title modules the Page Surgeon must never import.
const FORBIDDEN_TITLE_IMPORTS = [
  "recommendations/build-title",
  "recommendations/recommendation-title-humanizer",
  "recommendations/providers/generators/edit-title",
];

describe("PS10 — Page Surgeon title isolation", () => {
  it("no page-surgeon file imports a legacy recommendations title module", () => {
    const offenders: string[] = [];
    for (const f of walk(PAGE_SURGEON_ROOT)) {
      if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
      const src = readFileSync(f, "utf8");
      for (const mod of FORBIDDEN_TITLE_IMPORTS) {
        // Match an import/from referencing the module (alias or relative).
        if (new RegExp(`(from|import)\\s+["'][^"']*${mod.replace(/\//g, "\\/")}`).test(src)) {
          offenders.push(`${f.slice(REPO_ROOT.length + 1)} → ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Page Surgeon's own title evaluator exists (it has its own stack)", () => {
    const own = readdirSync(PAGE_SURGEON_ROOT);
    expect(own).toContain("evaluate-title.ts");
    expect(own).toContain("title-candidates.ts");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Sprint 6A.2g.A (2026-04-26) — strict target-URL alignment invariant.
//
// `buildAllowedTargetUrls` in specific-edit-evidence.ts uses `singleTargetUrl`
// to decide whether to anchor the LLM to the rec's resolved page or fall
// through to the legacy candidate-set + sentinel path. The off-target bug
// observed in Sprint 6A.2f traced back to a packet where `singleTargetUrl`
// was effectively absent — the matcher returned multiple candidate URLs and
// the model picked the wrong one.
//
// This file pins the routing contract:
//   1. `buildSpecificEditEvidencePacket` is invoked only by approved src/
//      callers. Tests are exempt.
//   2. The single approved production caller (`load-queue.ts`) sources
//      `singleTargetUrl` from `rec.resolution?.targetUrl` (the page-intent
//      resolver's stamped value). Future callers that bypass the resolver
//      and pass a literal `null` get caught here, even if the call still
//      compiles.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = resolve(REPO_ROOT, "src");

// `specific-edit-evidence.ts` is the DECLARATION site (it defines + exports
// the function). Production callers (real invocations) are gated to the
// load-queue.ts orchestration module — the resolver-aware path.
const APPROVED_PRODUCTION_CALLERS = new Set<string>([
  "src/domains/recommendations/specific-edit-evidence.ts",
  "src/domains/recommendations/load-queue.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (
        st.isFile() &&
        (full.endsWith(".ts") || full.endsWith(".tsx")) &&
        !full.endsWith(".test.ts") &&
        !full.endsWith(".test.tsx")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("Sprint 6A.2g.A — buildSpecificEditEvidencePacket caller routing", () => {
  it("only approved files in src/ invoke buildSpecificEditEvidencePacket(", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      const src = readFileSync(f, "utf8");
      if (/\bbuildSpecificEditEvidencePacket\s*\(/.test(src)) {
        if (!APPROVED_PRODUCTION_CALLERS.has(rel)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the approved caller (load-queue.ts) sources singleTargetUrl from rec.resolution", () => {
    const loadQueuePath = resolve(
      REPO_ROOT,
      "src/domains/recommendations/load-queue.ts",
    );
    const src = readFileSync(loadQueuePath, "utf8");
    // The literal threading must be present somewhere in the file. The
    // exact `?? null` form is locked so a future refactor that drops the
    // resolution lookup (and silently passes a literal `null`) trips the
    // test instead of regressing the off-target fix.
    expect(src).toMatch(
      /singleTargetUrl:\s*rec\.resolution\?\.targetUrl\s*\?\?\s*null/,
    );
  });

  it("the buildAllowedTargetUrls helper accepts singleTargetUrl (signature lock)", () => {
    const evidencePath = resolve(
      REPO_ROOT,
      "src/domains/recommendations/specific-edit-evidence.ts",
    );
    const src = readFileSync(evidencePath, "utf8");
    // Pin the function signature shape — the helper must take
    // singleTargetUrl as a parameter so the strict-anchor branch can
    // fire. Catches accidental signature regressions.
    expect(src).toMatch(/function\s+buildAllowedTargetUrls\s*\(/);
    expect(src).toMatch(/singleTargetUrl:\s*string\s*\|\s*null/);
  });
});

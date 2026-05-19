/**
 * Architecture invariant — Slice 9.A2γ.1 (2026-05-19).
 *
 * The `ga4_url_traffic` write path normalizes GA4 Data API `pagePath`
 * dimension values (which are path-only, e.g. `/services/whole-home-
 * remodel`) into full URLs (e.g.
 * `https://ritzbuilders.com/services/whole-home-remodel`) BEFORE the
 * upsert. The Mode A read model's canonicalizer
 * (`canonicalize-url.ts`) has a locked "full URLs only" contract; if
 * a future drive-by removes the normalizer, Mode A silently falls
 * back to `ineligible: no_traffic_data` for every edit.
 *
 * Pins:
 *   1. `persist-url-traffic.ts` imports `normalizeGa4PagePathToFullUrl`
 *      from `./normalize-page-path`.
 *   2. `persist-url-traffic.ts` imports `getBusinessConfig` from
 *      `@/lib/business-config` (positive sanity: the domain source
 *      is wired).
 *   3. `persist-url-traffic.ts` invokes `normalizeGa4PagePathToFullUrl`
 *      inside the upsert-rows construction (source-text check: the
 *      identifier appears in the same statement as `pagePath:`).
 *   4. `persist-url-traffic.ts` does NOT upsert raw `row.url` — i.e.
 *      the upserted `url` field is computed via the normalizer, not
 *      a direct passthrough of `row.url`.
 *   5. `normalize-page-path.ts` declares `import "server-only"`.
 *   6. No customer surface (under `src/app/(shell)/{today,
 *      recommendations,changes,prompts,local,competitors}/**` or
 *      `src/components/{today,recommendations,changes,prompts,
 *      local}/**`) imports the normalizer or references the named
 *      identifier `normalizeGa4PagePathToFullUrl`.
 *   7. Mode A's compute module
 *      (`src/domains/outcome-attribution/mode-a-cited-here-traffic-
 *      here.ts`) does NOT import the normalizer — the normalizer is
 *      strictly a persist-time helper. Mode A continues to use
 *      `canonicalizeCitationUrl` only.
 *   8. `canonicalize-url.ts` is byte-unchanged relative to its
 *      Phase A.1 contract — the surface marker
 *      `Phase A.1's contract is full URLs only` remains present.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const PERSIST_PATH = join(
  REPO_ROOT,
  "src/lib/connectors/ga4/persist-url-traffic.ts",
);
const NORMALIZER_PATH = join(
  REPO_ROOT,
  "src/lib/connectors/ga4/normalize-page-path.ts",
);
const MODE_A_PATH = join(
  REPO_ROOT,
  "src/domains/outcome-attribution/mode-a-cited-here-traffic-here.ts",
);
const CANONICALIZER_PATH = join(
  REPO_ROOT,
  "src/domains/citation-lifecycle/canonicalize-url.ts",
);

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const PERSIST_RAW = readFileSync(PERSIST_PATH, "utf-8");
const PERSIST_CODE = stripComments(PERSIST_RAW);
const NORMALIZER_RAW = readFileSync(NORMALIZER_PATH, "utf-8");
const MODE_A_RAW = readFileSync(MODE_A_PATH, "utf-8");
const MODE_A_CODE = stripComments(MODE_A_RAW);
const CANONICALIZER_RAW = readFileSync(CANONICALIZER_PATH, "utf-8");

describe("ga4_url_traffic write path — stored-as-full-url", () => {
  it("persist-url-traffic.ts imports normalizeGa4PagePathToFullUrl", () => {
    expect(
      /from\s+["']\.\/normalize-page-path["']/.test(PERSIST_CODE) ||
        /from\s+["']@\/lib\/connectors\/ga4\/normalize-page-path["']/.test(
          PERSIST_CODE,
        ),
      "persist-url-traffic.ts must import from ./normalize-page-path " +
        "(or the absolute @/-aliased equivalent).",
    ).toBe(true);
    expect(
      /normalizeGa4PagePathToFullUrl/.test(PERSIST_CODE),
      "persist-url-traffic.ts must reference normalizeGa4PagePathToFullUrl.",
    ).toBe(true);
  });

  it("persist-url-traffic.ts imports getBusinessConfig from @/lib/business-config (domain source)", () => {
    expect(
      /from\s+["']@\/lib\/business-config["']/.test(PERSIST_CODE),
      "persist-url-traffic.ts must import from @/lib/business-config.",
    ).toBe(true);
    expect(
      /getBusinessConfig/.test(PERSIST_CODE),
      "persist-url-traffic.ts must reference getBusinessConfig — the " +
        "domain source for the normalizer.",
    ).toBe(true);
  });

  it("the upsert-rows construction passes row.url through the normalizer (NOT raw pagePath)", () => {
    // Collapse whitespace + the normalizer invocation should appear
    // with `pagePath: row.url` in the same call. Defensive against
    // future reformatting.
    const collapsed = PERSIST_CODE.replace(/\s+/g, " ");
    const pattern =
      /url:\s*normalizeGa4PagePathToFullUrl\s*\(\s*\{\s*pagePath:\s*row\.url/;
    expect(
      pattern.test(collapsed),
      "The upsert payload's `url` field MUST be computed via " +
        "normalizeGa4PagePathToFullUrl({ pagePath: row.url, ... }). " +
        "Storing raw `row.url` (path-only) breaks Mode A matching.",
    ).toBe(true);
  });

  it("normalize-page-path.ts declares `import \"server-only\";`", () => {
    expect(
      /^import\s+["']server-only["']/m.test(NORMALIZER_RAW),
      "normalize-page-path.ts must start with `import \"server-only\";` " +
        "to prevent client-bundle inclusion.",
    ).toBe(true);
  });

  // ─── Customer-surface scan ──────────────────────────────────────

  const SCAN_ROOTS = [
    "src/app/(shell)/today",
    "src/app/(shell)/recommendations",
    "src/app/(shell)/changes",
    "src/app/(shell)/prompts",
    "src/app/(shell)/local",
    "src/app/(shell)/competitors",
    "src/components/today",
    "src/components/recommendations",
    "src/components/changes",
    "src/components/prompts",
    "src/components/local",
  ];

  function walk(dir: string): string[] {
    const out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        out.push(...walk(full));
      } else if (
        (name.endsWith(".ts") || name.endsWith(".tsx")) &&
        !name.endsWith(".test.ts") &&
        !name.endsWith(".test.tsx")
      ) {
        out.push(full);
      }
    }
    return out;
  }

  const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
    /from\s+["']@\/lib\/connectors\/ga4\/normalize-page-path["']/,
    /\bnormalizeGa4PagePathToFullUrl\b/,
  ];

  it("no customer surface imports normalize-page-path or references normalizeGa4PagePathToFullUrl", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = join(REPO_ROOT, root);
      for (const path of walk(abs)) {
        const code = stripComments(readFileSync(path, "utf-8"));
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(code)) {
            offenders.push(
              `${path.replace(REPO_ROOT + "/", "")} (matched ${pat.source})`,
            );
            break;
          }
        }
      }
    }
    expect(
      offenders,
      "These customer-surface files reference the operator-only " +
        "GA4 path normalizer. The normalizer is a persist-time helper " +
        "only:\n" + offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("Mode A read model does NOT import the normalizer (separation of concerns: normalize at write, canonicalize at read)", () => {
    expect(
      /normalize-page-path/.test(MODE_A_CODE),
      "Mode A (mode-a-cited-here-traffic-here.ts) must NOT import the " +
        "GA4 path normalizer. Mode A matches via canonicalizeCitationUrl; " +
        "the normalizer is exclusively a persist-time helper.",
    ).toBe(false);
    expect(
      /normalizeGa4PagePathToFullUrl/.test(MODE_A_CODE),
      "Mode A must NOT reference normalizeGa4PagePathToFullUrl.",
    ).toBe(false);
  });

  it("canonicalize-url.ts retains its 'full URLs only' contract marker (unchanged by this slice)", () => {
    // Surface marker is a multi-line comment. Strip `//` markers and
    // whitespace-normalize before substring match.
    const normalized = CANONICALIZER_RAW
      .replace(/^\s*\/\/\s?/gm, "")
      .replace(/\s+/g, " ");
    expect(
      normalized.includes("full URLs only"),
      "canonicalize-url.ts must retain its locked 'full URLs only' " +
        "contract marker. If this slice or a future one needed to " +
        "change the canonicalizer, that decision belongs in a separate " +
        "Phase-A.1 amendment — not a GA4-side slice.",
    ).toBe(true);
  });
});

/**
 * Architecture invariants — repeat-citation (Section 5.A/5.A.2;
 * consolidated 2026-07-20 architecture-suite diet).
 *
 * ONE file for the repeat-citation family; every prior file's invariant
 * preserved verbatim, the shared comment-strip / visible-text /
 * template-interpolation-strip helpers deduplicated.
 *
 * Subsumes (deleted; each pin survives once here):
 *   • repeat-citation-forbidden-vocab           (§5.A compute+loader vocab)
 *   • repeat-citation-pure-purity               (§5.A compute pure module)
 *   • repeat-citation-loader-tenant-scope       (§5.A loader tenant scope)
 *   • repeat-citation-operator-page-vocab       (§5.A.2 page visible-text vocab)
 *   • repeat-citation-operator-page-discipline  (§5.A.2 page operator gate)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE = "src/app/(shell)/diagnostics/repeat-citation/page.tsx";
const COMPUTE = "src/domains/citation-lifecycle/compute-repeat-citation.ts";
const LOADER = "src/domains/citation-lifecycle/load-repeat-citation.ts";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
/** Drop `${...}` interpolation chunks so the `$` ban doesn't trip on template syntax. */
function stripTemplateInterpolations(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}
/** Extract string-literal bodies + template-literal static segments (skip ${...}). */
function extractVisibleText(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let buf = "";
      while (j < src.length) {
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        buf += src[j];
        j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      let buf = "";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          continue;
        }
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        buf += src[j];
        j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("\n");
}
function firstIndex(src: string, needle: string | RegExp): number {
  if (typeof needle === "string") return src.indexOf(needle);
  const m = needle.exec(src);
  return m ? m.index : -1;
}

// §5.A source vocab ban (compute + loader).
const FORBIDDEN_SOURCE: ReadonlyArray<string> = [
  "drove", "caused", "generated", " made ", "led to",
  "$", "revenue", "dollars", "sales", "leads",
  "Mode A", "Mode B", "Mode C",
  "will improve rankings", "will drive", "will make AI cite",
  "you must", "you need to",
  "primary recommendation", "primary_recommendation",
];
// §5.A.2 operator-page visible-text ban (adds 'scored', 'AI cites you').
const FORBIDDEN_VISIBLE: ReadonlyArray<string> = [
  "drove", "caused", "generated", " made ", "led to",
  "$", "revenue", "dollars", "sales", "leads",
  "Mode A", "Mode B", "Mode C",
  "will improve rankings", "will drive", "will make AI cite",
  "you must", "you need to",
  "primary recommendation", "primary_recommendation",
  "scored", "AI cites you",
];

describe("§5.A — repeat-citation source forbidden vocab (compute + loader)", () => {
  for (const rel of [COMPUTE, LOADER]) {
    const active = stripTemplateInterpolations(stripComments(read(rel)));
    for (const phrase of FORBIDDEN_SOURCE) {
      it(`${rel}: does NOT contain '${phrase}'`, () => {
        expect(active.includes(phrase), `${rel} contains forbidden vocab '${phrase}'`).toBe(false);
      });
    }
  }
});

describe("§5.A — compute-repeat-citation pure-module purity", () => {
  const ACTIVE = stripComments(read(COMPUTE));
  const FORBIDDEN_IMPORTS = [
    "@/lib/persistence/repositories", "getRepository", "@/lib/business-config",
    "@/lib/connector-store", "@/lib/persistence/cold-store", "@/lib/tenant-context",
    "currentTenantId", "currentTenantSlug", "next/cache", "@/storage/canonical-store",
    "@/lib/url/normalize", "normalizeUrl", "@/domains/pages/classify", "normalizePageUrl",
    "OpenAI", "Anthropic", "openai", "anthropic", "BEACON_LLM_PROVIDER",
  ];
  for (const pattern of FORBIDDEN_IMPORTS) {
    it(`active source does NOT contain '${pattern}'`, () => {
      expect(ACTIVE.includes(pattern), `${COMPUTE} contains forbidden '${pattern}'`).toBe(false);
    });
  }
  it("imports canonicalizeCitationUrl from ./canonicalize-url", () => {
    expect(ACTIVE).toMatch(/import\s+\{[^}]*canonicalizeCitationUrl[^}]*\}\s+from\s+["']\.\/canonicalize-url["']/);
  });
  it("imports getTimeToCitationEligibility from ./eligibility", () => {
    expect(ACTIVE).toMatch(/import\s+\{[^}]*getTimeToCitationEligibility[^}]*\}\s+from\s+["']\.\/eligibility["']/);
  });
});

describe("§5.A — load-repeat-citation tenant-scope contracts", () => {
  const ACTIVE = stripComments(read(LOADER));
  it("imports getRepository from @/lib/persistence/repositories", () => {
    expect(ACTIVE).toMatch(/import\s+\{[^}]*\bgetRepository\b[^}]*\}\s+from\s+["']@\/lib\/persistence\/repositories["']/);
  });
  it("calls getRepository().forTenant(tenantId) in active source", () => {
    expect(ACTIVE).toMatch(/getRepository\(\)\.forTenant\s*\(\s*tenantId\s*\)/);
  });
  it("calls repo.getProfoundImportRuns() (Section 5 denominator source)", () => {
    expect(ACTIVE).toMatch(/\.getProfoundImportRuns\s*\(\s*\)/);
  });
  it("does NOT call repo.getObservationRuns() (wrong type — website-crawl)", () => {
    expect(ACTIVE).not.toMatch(/(?<!Profound)\.getObservationRuns\s*\(/);
  });
  it("wraps the read in unstable_cache", () => {
    expect(ACTIVE).toContain("unstable_cache");
  });
  it("cache key array contains the five required slots", () => {
    expect(ACTIVE).toContain('"repeat-citation:v1"');
    expect(ACTIVE).toContain("tenantId");
    expect(ACTIVE).toContain("recommendedEdit.id");
    expect(ACTIVE).toContain("recommendedEdit.live_at");
    expect(ACTIVE).toContain("windowDays");
  });
  it("declares the recommended_edits:${tenantId} cache tag", () => {
    expect(ACTIVE).toMatch(/`recommended_edits:\$\{tenantId\}`/);
  });
  it("does NOT import from @/storage/canonical-store", () => {
    expect(
      ACTIVE.includes('"@/storage/canonical-store"') || ACTIVE.includes("'@/storage/canonical-store'"),
    ).toBe(false);
  });
});

describe("§5.A.2 — repeat-citation operator-page vocab", () => {
  const VISIBLE = extractVisibleText(stripComments(read(PAGE)));
  for (const phrase of FORBIDDEN_VISIBLE) {
    it(`page visible text does NOT contain '${phrase}'`, () => {
      expect(VISIBLE.includes(phrase), `${PAGE} visible text contains '${phrase}'`).toBe(false);
    });
  }
  it("page visible text does NOT contain standalone 'missing'", () => {
    expect(/\bmissing\b/i.test(VISIBLE), `${PAGE} visible text contains standalone 'missing'`).toBe(false);
  });
});

describe("§5.A.2 — repeat-citation operator-page discipline", () => {
  const ACTIVE = stripComments(read(PAGE));
  it("declares export const dynamic = 'force-dynamic'", () => {
    expect(ACTIVE).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });
  it("imports isOperatorModeServer from @/lib/operator-mode", () => {
    expect(ACTIVE).toMatch(/import\s*\{[^}]*\bisOperatorModeServer\b[^}]*\}\s*from\s*["']@\/lib\/operator-mode["']/);
  });
  it("imports notFound from next/navigation", () => {
    expect(ACTIVE).toMatch(/import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/);
  });
  it("active source contains isOperatorModeServer( and notFound( invocations", () => {
    expect(ACTIVE).toMatch(/\bisOperatorModeServer\s*\(/);
    expect(ACTIVE).toMatch(/\bnotFound\s*\(/);
  });
  it("imports loadRepeatCitationForEdit from the Section 5.A loader", () => {
    expect(ACTIVE).toMatch(/import\s*\{[^}]*\bloadRepeatCitationForEdit\b[^}]*\}\s*from\s*["']@\/domains\/citation-lifecycle\/load-repeat-citation["']/);
  });
  it("does NOT import from @/storage/canonical-store", () => {
    expect(
      ACTIVE.includes('"@/storage/canonical-store"') || ACTIVE.includes("'@/storage/canonical-store'"),
    ).toBe(false);
  });
  it("does NOT call repo.getObservationRuns() (wrong type — website-crawl)", () => {
    expect(ACTIVE).not.toMatch(/(?<!Profound)\.getObservationRuns\s*\(/);
  });

  const gateOffset = ACTIVE.lastIndexOf("isOperatorModeServer(");
  it("operator gate is reachable (sanity)", () => {
    expect(gateOffset).toBeGreaterThan(0);
  });
  for (const reader of ["currentTenantId(", "getBusinessConfig(", "getRepository(", "getRecommendedEdits("]) {
    it(`operator gate precedes ${reader}`, () => {
      const readerOffset = ACTIVE.indexOf(reader, gateOffset + 1);
      if (readerOffset === -1) {
        throw new Error(`Expected ${reader} to be called AFTER isOperatorModeServer (gate at ${gateOffset}).`);
      }
      expect(readerOffset).toBeGreaterThan(gateOffset);
    });
  }
  it("operator gate precedes the first loadRepeatCitationForEdit( invocation", () => {
    const callOffset = firstIndex(ACTIVE.slice(gateOffset + 1), "loadRepeatCitationForEdit(");
    expect(callOffset).toBeGreaterThan(-1);
  });
});

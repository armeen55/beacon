/**
 * Architecture invariants — GA4 + GSC connector substrate (consolidated
 * 2026-07-20 architecture-suite diet).
 *
 * ONE file for the GA4/GSC connector source-scanner family. Every prior
 * file was a pure source-text scanner (readFileSync + regex); the
 * comment-strip / directory-walk helpers and the customer-surface
 * forbidden-import set were duplicated across all of them and are now
 * shared. Each regex is preserved verbatim; the fixed-file present/absent
 * checks are driven by the FIXED_FILE_ROWS table, the walk-shaped and
 * count/capture-shaped checks keep their own blocks.
 *
 * Subsumes (deleted; each pin survives exactly once here):
 *   • ga4-connector-server-only            (9.A1 server-only dir posture)
 *   • ga4-connector-tenant-isolation       (9.A1 explicit tenant scope)
 *   • ga4-data-api-non-2xx-logging         (9.A2α logging discipline)
 *   • ga4-data-api-tenant-isolation        (9.A2α explicit tenant scope)
 *   • ga4-scope-split                      (9.A1 OAuth scope split)
 *   • ga4-url-traffic-stored-as-full-url   (9.A2γ.1 normalize-at-write)
 *   • gsc-cache-no-disk-write              (A.3.b2 Supabase cache)
 *   • gsc-client-tenant-isolation          (A.3.b1α/b2 explicit tenant scope)
 *   • gsc-no-hardcoded-site-url            (A.3.b1β env-var site URL)
 *   • gsc-quota-stagger-tenant-isolation   (Section 8 J3 purity)
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Customer-facing surface import bans reused by the GA4 data-api + GSC
// client rows. The two variants differ only in the third domain
// (`changes` for GA4, `indexability` for GSC) — preserved exactly.
const CUSTOMER_SURFACE_FORBIDDEN_GA4: ReadonlyArray<RegExp> = [
  /from\s+["']@\/app\//,
  /from\s+["']@\/components\//,
  /from\s+["']@\/domains\/today["']/,
  /from\s+["']@\/domains\/today\//,
  /from\s+["']@\/domains\/recommendations["']/,
  /from\s+["']@\/domains\/recommendations\//,
  /from\s+["']@\/domains\/changes["']/,
  /from\s+["']@\/domains\/changes\//,
];
const CUSTOMER_SURFACE_FORBIDDEN_GSC: ReadonlyArray<RegExp> = [
  /from\s+["']@\/app\//,
  /from\s+["']@\/components\//,
  /from\s+["']@\/domains\/today["']/,
  /from\s+["']@\/domains\/today\//,
  /from\s+["']@\/domains\/recommendations["']/,
  /from\s+["']@\/domains\/recommendations\//,
  /from\s+["']@\/domains\/indexability["']/,
  /from\s+["']@\/domains\/indexability\//,
];

type FixedFileRow = {
  file: string;
  present?: ReadonlyArray<RegExp>;
  absent?: ReadonlyArray<RegExp>;
  presentCollapsed?: ReadonlyArray<RegExp>; // matched after /\s+/->" "
  presentRaw?: ReadonlyArray<RegExp>; // matched against UNSTRIPPED source
};

const FIXED_FILE_ROWS: ReadonlyArray<FixedFileRow> = [
  {
    file: "src/lib/connectors/ga4/client.ts",
    present: [
      /export\s+async\s+function\s+ga4ApiFetch/,
      /tenantId\s*:\s*string/,
      /analytics\.readonly/,
      /log\.warn\(\s*["'][^"']*\[ga4-client\][^"']*non-2xx/,
    ],
    presentCollapsed: [/\.slice\(\s*0\s*,\s*500\s*\)/],
    absent: [/\bcurrentTenantSlug\s*\(/, /\bcurrentTenantId\s*\(/],
  },
  {
    file: "src/lib/connectors/ga4/property-selection.ts",
    present: [
      /export\s+async\s+function\s+listGa4PropertiesForTenant/,
      /analyticsadmin\.googleapis\.com\/v1beta\/accountSummaries/,
    ],
    presentCollapsed: [/listGa4PropertiesForTenant\s*\(\s*tenantId\s*:\s*string/],
    absent: [/\bcurrentTenantSlug\s*\(/, /\bcurrentTenantId\s*\(/],
  },
  {
    file: "src/lib/connectors/ga4/types.ts",
    absent: [/\bcurrentTenantSlug\s*\(/, /\bcurrentTenantId\s*\(/],
  },
  {
    file: "src/lib/connectors/ga4/data-api.ts",
    present: [
      /log\.warn\(\s*["'][^"']*\[ga4-data-api\][^"']*non-2xx/,
      /\.slice\(0,\s*500\)/,
      /try\s*{[^}]*response\.text\(\)[^}]*\.slice\([^}]*}\s*catch/,
      /export\s+async\s+function\s+runGa4UrlTrafficReport/,
      /const\s*{\s*tenantId\s*,/,
      /import\s+["']server-only["']/,
      /analytics\.readonly/,
      /analyticsdata\.googleapis\.com/,
      /:runReport/,
    ],
    presentCollapsed: [
      /log\.warn\([^)]*\[ga4-data-api\][^)]*tenantId/,
      /log\.warn\([^)]*\[ga4-data-api\][^)]*status/,
      /log\.warn\([^)]*\[ga4-data-api\][^)]*body/,
      /runGa4UrlTrafficReport\s*\(\s*args\s*:\s*Ga4RunReportArgs/,
    ],
    absent: [
      /\bcurrentTenantSlug\s*\(/,
      /\bcurrentTenantId\s*\(/,
      ...CUSTOMER_SURFACE_FORBIDDEN_GA4,
    ],
  },
  {
    file: "src/lib/connectors/gsc/client.ts",
    present: [
      /from\s+["']@\/lib\/persistence\/supabase["']/,
      /\bgetSupabaseAdmin\b/,
      /gsc_url_inspections/,
      /\.select\s*\(/,
      /\.upsert\s*\(/,
      /export\s+async\s+function\s+gscUrlInspect\s*\(/,
      /tenantId\s*:\s*string/,
      /import\s+["']server-only["']/,
      /\.eq\(\s*["']tenant_id["']\s*,/,
      /onConflict\s*:\s*["']tenant_id,inspection_url["']/,
      /webmasters\.readonly/,
    ],
    presentRaw: [/A\.3\.b2/, /operator-substrate/i],
    absent: [
      /\bwriteFileSync\s*\(/,
      /\brenameSync\s*\(/,
      /\bmkdirSync\s*\(/,
      /\bunlinkSync\s*\(/,
      /\breadFileSync\s*\(/,
      /from\s+["']node:fs["']/,
      /from\s+["']node:path["']/,
      /\bgetDataDir\s*\(/,
      /\.data\/tenants/,
      /gsc-url-inspections\.json/,
      /\bcurrentTenantSlug\s*\(/,
      /\bcurrentTenantId\s*\(/,
      /from\s+["']@\/lib\/tenant["']/,
      /from\s+["']@\/domains\/tenants\/store["']/,
      ...CUSTOMER_SURFACE_FORBIDDEN_GSC,
    ],
  },
  {
    file: "src/lib/connectors/gsc/types.ts",
    present: [/import\s+["']server-only["']/],
  },
  {
    file: "src/lib/connectors/gsc/quota-stagger.ts",
    present: [
      /export\s+function\s+staggerSlotHour\s*\(\s*tenantId\s*:\s*string\s*\)/,
      /export\s+function\s+isStaggerSlotActive\s*\(\s*args\s*:\s*\{/,
      /tenantId\s*:\s*string/,
      /now\s*:\s*Date\s*\|\s*number/,
      /STAGGER_BUCKETS\s*=\s*6/,
      /STAGGER_WINDOW_HOURS\s*=\s*24\s*\/\s*STAGGER_BUCKETS/,
      /MAX_RETRIES_ON_429\s*=\s*3/,
    ],
    absent: [
      /from\s+["']@\/lib\/persistence\/supabase["']/,
      /from\s+["']@\/lib\/tenant-context["']/,
      /\bfetch\s*\(/,
      /\bcurrentTenantId\b/,
      /\bgetSupabaseAdmin\b/,
      /from\s+["']@\/lib\/connector-store["']/,
      /from\s+["']@\/lib\/connectors\/google-auth["']/,
      /\bOpenAI\b/,
      /\bAnthropic\b/,
      /Math\.random\s*\(/,
      /Date\.now\s*\(/,
    ],
  },
];

describe("GA4/GSC connector — fixed-file source pins", () => {
  for (const row of FIXED_FILE_ROWS) {
    const raw = read(row.file);
    const code = stripComments(raw);
    const collapsed = code.replace(/\s+/g, " ");
    for (const re of row.present ?? []) {
      it(`${row.file}: contains ${re.source}`, () => {
        expect(re.test(code), `${row.file} must match ${re.source}`).toBe(true);
      });
    }
    for (const re of row.presentCollapsed ?? []) {
      it(`${row.file}: contains (whitespace-collapsed) ${re.source}`, () => {
        expect(re.test(collapsed), `${row.file} must match ${re.source}`).toBe(true);
      });
    }
    for (const re of row.presentRaw ?? []) {
      it(`${row.file}: header/source contains ${re.source}`, () => {
        expect(re.test(raw), `${row.file} raw source must match ${re.source}`).toBe(true);
      });
    }
    for (const re of row.absent ?? []) {
      it(`${row.file}: does NOT contain ${re.source}`, () => {
        expect(re.test(code), `${row.file} must NOT match ${re.source}`).toBe(false);
      });
    }
  }
});

// ───────────────────── ga4-connector-server-only (dir scan) ─────────────────

describe("ga4 connector — server-only posture (directory scan)", () => {
  const GA4_DIR = join(REPO_ROOT, "src/lib/connectors/ga4");
  function listGa4Files(): string[] {
    const out: string[] = [];
    for (const name of readdirSync(GA4_DIR)) {
      const full = join(GA4_DIR, name);
      if (statSync(full).isDirectory()) continue;
      if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
    }
    return out.sort();
  }
  it("at least one TypeScript file exists under src/lib/connectors/ga4/", () => {
    expect(listGa4Files().length).toBeGreaterThan(0);
  });
  it("every file under src/lib/connectors/ga4/ imports 'server-only'", () => {
    const offenders: string[] = [];
    for (const path of listGa4Files()) {
      const code = stripComments(readFileSync(path, "utf-8"));
      if (!/import\s+["']server-only["']/.test(code)) offenders.push(path.replace(REPO_ROOT + "/", ""));
    }
    expect(offenders, `GA4 connector files missing server-only:\n${offenders.join("\n")}`).toEqual([]);
  });
  it("no file under src/lib/connectors/ga4/ imports a customer-facing surface", () => {
    const offenders: string[] = [];
    for (const path of listGa4Files()) {
      const code = stripComments(readFileSync(path, "utf-8"));
      for (const pat of CUSTOMER_SURFACE_FORBIDDEN_GA4) {
        if (pat.test(code)) offenders.push(`${path.replace(REPO_ROOT + "/", "")} (matched ${pat.source})`);
      }
    }
    expect(offenders, `GA4 connector imports customer surfaces:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ───────────────────── ga4-scope-split (count + capture) ────────────────────

describe("google-auth.ts — GA4 scope split", () => {
  const AUTH_SRC = read("src/lib/connectors/google-auth.ts");
  const AUTH_CODE = stripComments(AUTH_SRC);
  it("declares the analytics.readonly scope as a top-level constant", () => {
    expect(
      /const\s+GA4_SCOPE\s*=\s*["']https:\/\/www\.googleapis\.com\/auth\/analytics\.readonly["']/.test(AUTH_CODE),
    ).toBe(true);
  });
  it("maps the ga4 kind to GA4_SCOPE in the SCOPES record", () => {
    expect(
      /SCOPES\s*:\s*Record<GoogleConnectorKind,\s*string>\s*=\s*\{[\s\S]*?\bga4\s*:\s*GA4_SCOPE/.test(AUTH_CODE),
    ).toBe(true);
  });
  it("GoogleConnectorKind union includes 'ga4'", () => {
    expect(/export\s+type\s+GoogleConnectorKind\s*=\s*[^;]*\bga4\b/.test(AUTH_CODE)).toBe(true);
  });
  it("analytics.readonly literal appears exactly once (on the GA4_SCOPE constant)", () => {
    const occurrences = AUTH_CODE.match(/analytics\.readonly/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
  it("GSC + GBP scope constants do NOT include analytics.readonly", () => {
    const gscMatch = AUTH_CODE.match(/const\s+GSC_SCOPE\s*=\s*["']([^"']+)["']/);
    const gbpMatch = AUTH_CODE.match(/const\s+GBP_SCOPE\s*=\s*["']([^"']+)["']/);
    expect(gscMatch?.[1]).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(gbpMatch?.[1]).toBe("https://www.googleapis.com/auth/business.manage");
  });
  it("no combined-scopes constant has been re-introduced", () => {
    expect(/\bGOOGLE_OAUTH_SCOPES\b/.test(AUTH_CODE)).toBe(false);
  });
});

// ───────────────────── gsc-no-hardcoded-site-url (whole-src walk) ────────────

describe("gsc — no hardcoded site URL", () => {
  const SRC_ROOT = join(REPO_ROOT, "src");
  function* walkAll(dir: string): Generator<string> {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) yield* walkAll(full);
      else if (/\.(ts|tsx)$/.test(entry)) yield full;
    }
  }
  it("no `sc-domain:` literal in active src/ source (comments stripped)", () => {
    const violations: string[] = [];
    for (const file of walkAll(SRC_ROOT)) {
      const stripped = stripComments(readFileSync(file, "utf-8"));
      const match = stripped.match(/sc-domain:[a-zA-Z0-9._-]+/);
      if (match != null) violations.push(`${relative(REPO_ROOT, file)}: ${match[0]}`);
    }
    expect(violations, `Hardcoded GSC site URL:\n${violations.join("\n")}`).toEqual([]);
  });
  it("src/domains/indexability/load-gsc-signal.ts references BEACON_GSC_SITE_URL", () => {
    expect(/BEACON_GSC_SITE_URL/.test(read("src/domains/indexability/load-gsc-signal.ts"))).toBe(true);
  });
});

// ───────────────────── ga4-url-traffic-stored-as-full-url ────────────────────

describe("ga4_url_traffic write path — stored-as-full-url", () => {
  const PERSIST_RAW = read("src/lib/connectors/ga4/persist-url-traffic.ts");
  const PERSIST_CODE = stripComments(PERSIST_RAW);
  const NORMALIZER_RAW = read("src/lib/connectors/ga4/normalize-page-path.ts");
  const MODE_A_CODE = stripComments(read("src/domains/outcome-attribution/mode-a-cited-here-traffic-here.ts"));
  const CANONICALIZER_RAW = read("src/domains/citation-lifecycle/canonicalize-url.ts");

  it("persist-url-traffic.ts imports normalizeGa4PagePathToFullUrl", () => {
    expect(
      /from\s+["']\.\/normalize-page-path["']/.test(PERSIST_CODE) ||
        /from\s+["']@\/lib\/connectors\/ga4\/normalize-page-path["']/.test(PERSIST_CODE),
    ).toBe(true);
    expect(/normalizeGa4PagePathToFullUrl/.test(PERSIST_CODE)).toBe(true);
  });
  it("persist-url-traffic.ts imports getBusinessConfig from @/lib/business-config", () => {
    expect(/from\s+["']@\/lib\/business-config["']/.test(PERSIST_CODE)).toBe(true);
    expect(/getBusinessConfig/.test(PERSIST_CODE)).toBe(true);
  });
  it("the upsert-rows construction passes row.url through the normalizer (NOT raw pagePath)", () => {
    const collapsed = PERSIST_CODE.replace(/\s+/g, " ");
    expect(/url:\s*normalizeGa4PagePathToFullUrl\s*\(\s*\{\s*pagePath:\s*row\.url/.test(collapsed)).toBe(true);
  });
  it('normalize-page-path.ts declares `import "server-only";`', () => {
    expect(/^import\s+["']server-only["']/m.test(NORMALIZER_RAW)).toBe(true);
  });

  const SCAN_ROOTS = [
    "src/app/(shell)/today", "src/app/(shell)/recommendations", "src/app/(shell)/changes",
    "src/app/(shell)/prompts", "src/app/(shell)/local", "src/app/(shell)/competitors",
    "src/components/today", "src/components/recommendations", "src/components/changes",
    "src/components/prompts", "src/components/local",
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
      if (s.isDirectory()) out.push(...walk(full));
      else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(full);
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
      for (const path of walk(join(REPO_ROOT, root))) {
        const code = stripComments(readFileSync(path, "utf-8"));
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(code)) {
            offenders.push(`${path.replace(REPO_ROOT + "/", "")} (matched ${pat.source})`);
            break;
          }
        }
      }
    }
    expect(offenders, `Customer surface references the normalizer:\n${offenders.join("\n")}`).toEqual([]);
  });
  it("Mode A read model does NOT import the normalizer", () => {
    expect(/normalize-page-path/.test(MODE_A_CODE)).toBe(false);
    expect(/normalizeGa4PagePathToFullUrl/.test(MODE_A_CODE)).toBe(false);
  });
  it("canonicalize-url.ts retains its 'full URLs only' contract marker", () => {
    const normalized = CANONICALIZER_RAW.replace(/^\s*\/\/\s?/gm, "").replace(/\s+/g, " ");
    expect(normalized.includes("full URLs only")).toBe(true);
  });
});

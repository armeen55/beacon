/**
 * Architecture invariants — off-site authority / off-site action types
 * (Section 7 C7a–C7g; consolidated 2026-07-20 architecture-suite diet).
 *
 * ONE file for the off-site family. Every prior file's invariant is
 * preserved verbatim below (grouped by kind); the walk / comment-strip /
 * visible-text / import-extraction helpers were duplicated identically
 * across all of them and are now shared.
 *
 * Subsumes (deleted; each row here is the single surviving pin):
 *   • off-site-action-types-customer-vocab            (C7b operatorLabel vocab)
 *   • off-site-action-types-no-write-paths            (C7b no network/automation/LLM)
 *   • off-site-action-types-not-llm-allowed           (C7b generatorActive=false)
 *   • off-site-action-types-suggested-copy-suppressed (C7b Act-4 suppression)
 *   • off-site-authority-customer-copy                (C7a operator-page copy)
 *   • off-site-authority-loader-allowed-imports       (C7a loader import allowlist)
 *   • off-site-authority-no-paid-or-scan-or-llm       (C7a no paid/scan/LLM)
 *   • off-site-authority-operator-page-discipline     (C7a operator gate ordering)
 *   • off-site-authority-pure-module-purity           (C7a pure module purity)
 *   • off-site-profile-urls-no-fetch                  (C7g v1 no fetch)
 *   • off-site-profile-urls-source-discipline         (C7g v1 source discipline)
 *   • off-site-recommendation-rules-customer-copy     (C7c customer copy)
 *   • off-site-recommendation-rules-no-persistence    (C7c no persistence)
 *   • off-site-recommendation-rules-pure-purity       (C7c pure module purity)
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  listActiveActionTypes,
  type ActionType,
} from "@/domains/recommendations/action-types";
import { actionRowTypeForEdit } from "@/domains/recommendations/recommendation-action-rows";
import {
  supportsSuggestedCopy,
  SUGGESTED_COPY_ACTION_ROW_TYPES,
} from "@/domains/recommendations/suggested-copy-adapters";

const REPO_ROOT = resolve(__dirname, "..", "..");

const OFF_SITE_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
];

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
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
function extractFromPaths(src: string): string[] {
  const out: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]!);
  return out;
}
function extractSideEffectImports(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\s+["']([^"']+)["'];?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]!);
  return out;
}
function extractImportLines(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*import\b[\s\S]*?from\s+["']([^"']+)["'][;\s]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[0]);
  return out;
}
/** import type X … OR every brace binding prefixed `type ` */
function importLineIsTypeOnly(line: string): boolean {
  if (/^\s*import\s+type\b/.test(line)) return true;
  const braceMatch = line.match(/import\s+\{([^}]*)\}\s*from/);
  if (!braceMatch) return false;
  const bindings = braceMatch[1]!
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  return bindings.length > 0 && bindings.every((b) => /^type\s+/.test(b));
}
/**
 * Walk `src` and accumulate visible-text candidates: double/single-quoted
 * string-literal contents + template-literal static segments (skipping
 * `${...}` substitution expressions, tracking nested braces).
 */
function extractCustomerVisibleText(src: string): string {
  const segments: string[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === '"') {
      i += 1;
      const start = i;
      while (i < len && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        i += 1;
      }
      segments.push(src.slice(start, i));
      i += 1;
      continue;
    }
    if (ch === "'") {
      i += 1;
      const start = i;
      while (i < len && src[i] !== "'") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        i += 1;
      }
      segments.push(src.slice(start, i));
      i += 1;
      continue;
    }
    if (ch === "`") {
      i += 1;
      let chunkStart = i;
      while (i < len && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && i + 1 < len && src[i + 1] === "{") {
          if (i > chunkStart) segments.push(src.slice(chunkStart, i));
          i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") depth -= 1;
            i += 1;
          }
          chunkStart = i;
          continue;
        }
        i += 1;
      }
      if (i > chunkStart) segments.push(src.slice(chunkStart, i));
      i += 1;
      continue;
    }
    i += 1;
  }
  return segments.join("\n");
}

// Base customer-vocab ban set (C7a operator-page + C7b operatorLabel).
const FORBIDDEN_BASE: ReadonlyArray<string> = [
  "drove",
  "caused",
  "generated",
  " made ",
  "led to",
  "$",
  "revenue",
  "dollars",
  "sales",
  "leads",
  "Mode A",
  "Mode B",
  "Mode C",
  "primary_recommendation_count",
  "total_possible",
  "scope_type",
  "claimable",
  "still_learning",
  " GBP ",
  "missing",
];
// C7c rules copy adds automation + outcome-promise bans (superset).
const FORBIDDEN_C7C: ReadonlyArray<string> = [
  ...FORBIDDEN_BASE,
  "auto-claim",
  "auto-post",
  "auto-review-request",
  "automated outreach",
  "will improve rankings",
  "will make AI cite you",
  "will drive",
  "you must",
  "you need to",
];

// ───────────────────────── C7b behavioral: action-type registry ─────────────

describe("C7b — off-site operatorLabel customer vocabulary", () => {
  for (const t of OFF_SITE_ACTION_TYPES) {
    const label = ACTION_TYPE_REGISTRY[t].operatorLabel;
    const labelLower = label.toLowerCase();
    it(`${t}: operatorLabel is a non-empty string`, () => {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });
    it(`${t}: operatorLabel contains no forbidden customer vocab`, () => {
      const hits = FORBIDDEN_BASE.filter((p) => labelLower.includes(p.toLowerCase()));
      expect(hits, `${t}: operatorLabel "${label}" contains ${hits.join(", ")}`).toEqual([]);
    });
  }
});

describe("C7b — off-site types are NOT LLM-allowed", () => {
  it("every off-site type has generatorActive: false", () => {
    for (const t of OFF_SITE_ACTION_TYPES) {
      expect(ACTION_TYPE_REGISTRY[t].generatorActive).toBe(false);
    }
  });
  it("listActiveActionTypes() excludes all 7 off-site types", () => {
    const active = new Set(listActiveActionTypes());
    for (const t of OFF_SITE_ACTION_TYPES) expect(active.has(t)).toBe(false);
  });
  it("ACTION_TYPES.filter(generatorActive) excludes all 7 (parallel proof)", () => {
    const active = ACTION_TYPES.filter((t) => ACTION_TYPE_REGISTRY[t].generatorActive);
    for (const t of OFF_SITE_ACTION_TYPES) expect(active).not.toContain(t);
  });
  it("specific-edit-evidence.ts:defaultAllowedActionTypes filters on generatorActive (source-text shape pin)", () => {
    const active = stripComments(read("src/domains/recommendations/specific-edit-evidence.ts"));
    expect(active).toMatch(
      /function\s+defaultAllowedActionTypes\s*\(\s*\)\s*:\s*ActionType\[\]\s*\{\s*return\s+ACTION_TYPES\.filter\(\s*\([^)]*\)\s*=>\s*ACTION_TYPE_REGISTRY\[[a-zA-Z_]+\]\.generatorActive\s*,?\s*\)\s*;\s*\}/,
    );
  });

  const domainFiles = listTsFiles(resolve(REPO_ROOT, "src/domains/recommendations"));
  it("scanned a non-trivial number of recommendation-domain files", () => {
    expect(domainFiles.length).toBeGreaterThan(10);
  });
  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`no "${t}" literal appears inside any allowedActionTypes: construction`, () => {
      for (const f of domainFiles) {
        const active = stripComments(readFileSync(f, "utf-8"));
        const re = /allowedActionTypes\s*[:=]\s*(\[[\s\S]*?\])/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(active)) !== null) {
          if (m[1]!.includes(`"${t}"`)) {
            throw new Error(
              `${f.replace(REPO_ROOT + "/", "")}: off-site type "${t}" appears inside an allowedActionTypes construction:\n  ${m[1]!.replace(/\s+/g, " ").slice(0, 200)}`,
            );
          }
        }
        expect(true).toBe(true);
      }
    });
  }
});

describe("C7b — Suggested Copy is suppressed for off-site rows", () => {
  it("SUGGESTED_COPY_ACTION_ROW_TYPES does not include 'review_decision'", () => {
    expect(SUGGESTED_COPY_ACTION_ROW_TYPES).not.toContain("review_decision");
  });
  it("supportsSuggestedCopy('review_decision') returns false", () => {
    expect(supportsSuggestedCopy("review_decision")).toBe(false);
  });
  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`actionRowTypeForEdit("${t}") returns "review_decision"`, () => {
      expect(actionRowTypeForEdit(t)).toBe("review_decision");
    });
    it(`supportsSuggestedCopy(actionRowTypeForEdit("${t}")) is false`, () => {
      expect(supportsSuggestedCopy(actionRowTypeForEdit(t))).toBe(false);
    });
  }

  const active = stripComments(read("src/domains/recommendations/recommendation-action-rows.ts"));
  for (const t of OFF_SITE_ACTION_TYPES) {
    it(`recommendation-action-rows.ts contains a case "${t}": arm`, () => {
      expect(active).toMatch(new RegExp(`case\\s+["']${t}["']\\s*:`));
    });
  }
  it("the 7 off-site case arms route to `return \"review_decision\"`", () => {
    const firstArmIdx = active.indexOf(`case "claim_gbp":`);
    expect(firstArmIdx).toBeGreaterThanOrEqual(0);
    const trailing = active.slice(firstArmIdx);
    const nextCaseIdx = trailing.indexOf(`case "update_intro":`);
    const closeIdx = trailing.indexOf("}");
    expect(closeIdx).toBeGreaterThan(0);
    const sliceEnd = nextCaseIdx > 0 && nextCaseIdx < closeIdx ? nextCaseIdx : closeIdx;
    const offSiteBlock = trailing.slice(0, sliceEnd);
    const returnMatches = offSiteBlock.match(/return\s+["']review_decision["']\s*;/g);
    expect(returnMatches).not.toBeNull();
    expect(returnMatches!.length).toBe(1);
  });
});

// ───────────────────── source-text: no network / persistence / LLM ──────────

type NoNetworkRow = { label: string; files: ReadonlyArray<string>; banned: ReadonlyArray<string> };
const NO_NETWORK_ROWS: ReadonlyArray<NoNetworkRow> = [
  {
    label: "C7b action-types: no write paths (hosts/automation/http/llm)",
    files: [
      "src/domains/recommendations/action-types.ts",
      "src/domains/recommendations/recommendation-action-rows.ts",
    ],
    banned: [
      "mybusiness.googleapis.com", "api.yelp.com", "houzz.com/api", "angi.com/api", "bbb.org/api",
      "auto-claim", "auto-post", "auto-review-request", "automated outreach",
      "fetch(", "axios", "httpsAgent", "OpenAI", "Anthropic", "BEACON_LLM_PROVIDER",
    ],
  },
  {
    label: "C7a authority: no paid host / scan API / http / LLM",
    files: [
      "src/domains/off-site-authority/types.ts",
      "src/domains/off-site-authority/compute-snapshot.ts",
      "src/domains/off-site-authority/load-snapshot.ts",
      "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
    ],
    banned: [
      "fetch(", "axios", "httpsAgent",
      "mybusiness.googleapis.com", "api.yelp.com", "searchanalytics", "urlInspection", "searchconsole",
      "OpenAI", "Anthropic", "openai", "anthropic", "BEACON_LLM_PROVIDER",
    ],
  },
  {
    label: "C7g v1 profile URLs: no fetch / anchor tag",
    files: [
      "src/lib/business-config.ts",
      "src/domains/off-site-authority/load-snapshot.ts",
      "src/domains/off-site-authority/compute-snapshot.ts",
      "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
    ],
    banned: ["fetch(", "axios", "httpsAgent", "<a href="],
  },
  {
    label: "C7c rules: no persistence / host / automation / http / LLM",
    files: [
      "src/domains/off-site-authority/recommendation-rules.ts",
      "src/domains/off-site-authority/load-recommendation-candidates.ts",
      "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
    ],
    banned: [
      "runProviderAndPersist", "saveRecommendedEdit", "getRecommendedEdits", ".insert(", ".upsert(", ".update(",
      "mybusiness.googleapis.com", "api.yelp.com", "houzz.com/api", "angi.com/api", "bbb.org/api",
      "auto-claim", "auto-post", "auto-review-request", "automated outreach",
      "fetch(", "axios", "httpsAgent", "OpenAI", "Anthropic", "BEACON_LLM_PROVIDER",
    ],
  },
];

describe("off-site — no network / persistence / LLM in substrate source", () => {
  for (const row of NO_NETWORK_ROWS) {
    for (const rel of row.files) {
      it(`${row.label} — ${rel}`, () => {
        const active = stripComments(read(rel));
        const hits = row.banned.filter((b) => active.includes(b));
        expect(hits, `${rel} contains forbidden token(s): ${hits.join(", ")}`).toEqual([]);
      });
    }
  }
});

// ─────────────────────────── purity / import allowlists ─────────────────────

describe("C7a — pure module purity (types.ts, compute-snapshot.ts)", () => {
  const PURE_MODULES = [
    "src/domains/off-site-authority/types.ts",
    "src/domains/off-site-authority/compute-snapshot.ts",
  ];
  const FORBIDDEN_IDENTIFIERS = [
    "getBusinessConfig", "isPlaceholderConfig", "readLocalReviews",
    "getConnectorToken", "getGoogleConnectorToken", "getYelpConnectorToken",
    "currentTenantId", "currentTenantSlug", "getRepository",
  ];
  const FORBIDDEN_IMPORT_PATHS = [
    "@/lib/business-config", "@/lib/local-reviews-store", "@/lib/connector-store",
    "@/lib/tenant-context", "@/lib/persistence/repositories",
  ];
  for (const rel of PURE_MODULES) {
    const active = stripComments(read(rel));
    for (const id of FORBIDDEN_IDENTIFIERS) {
      it(`${rel}: does NOT reference identifier '${id}'`, () => {
        expect(active).not.toMatch(new RegExp(`\\b${id}\\b`));
      });
    }
    for (const path of FORBIDDEN_IMPORT_PATHS) {
      it(`${rel}: does NOT import from '${path}'`, () => {
        expect(active).not.toMatch(
          new RegExp(`from\\s*["']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`),
        );
      });
    }
  }
});

describe("C7a — loader allowed imports (load-snapshot.ts)", () => {
  const ACTIVE = stripComments(read("src/domains/off-site-authority/load-snapshot.ts"));
  const ALLOWED_PATHS = [
    "server-only", "@/lib/business-config", "@/lib/local-reviews-store",
    "@/lib/connector-store", "@/lib/tenant-context", "./types", "./compute-snapshot",
  ];
  it("every `from \"...\"` import path is in the allowlist", () => {
    const paths = extractFromPaths(ACTIVE);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(ALLOWED_PATHS.includes(p), `Loader imports '${p}' not in allowlist`).toBe(true);
    }
  });
  it("every side-effect import is in the allowlist", () => {
    for (const p of extractSideEffectImports(ACTIVE)) {
      expect(ALLOWED_PATHS.includes(p), `Loader side-effect import '${p}' not in allowlist`).toBe(true);
    }
  });
  it("does NOT import getRepository", () => {
    expect(ACTIVE).not.toMatch(/\bgetRepository\b/);
  });
  it("does NOT import from @/lib/persistence/repositories", () => {
    expect(ACTIVE).not.toMatch(/from\s+["']@\/lib\/persistence\/repositories["']/);
  });
  it("does NOT import from @/lib/connectors/*", () => {
    expect(ACTIVE).not.toMatch(/from\s+["']@\/lib\/connectors\/[^"']+["']/);
  });
  it("does NOT contain HTTP-client identifiers", () => {
    expect(ACTIVE).not.toMatch(/\bfetch\s*\(/);
    expect(ACTIVE).not.toMatch(/\baxios\b/);
    expect(ACTIVE).not.toMatch(/\bhttpsAgent\b/);
  });
});

describe("C7c — recommendation-rules.ts pure purity", () => {
  const ACTIVE = stripComments(read("src/domains/off-site-authority/recommendation-rules.ts"));
  const FORBIDDEN_IDENTIFIERS = [
    "getBusinessConfig", "isPlaceholderConfig", "readLocalReviews",
    "getConnectorToken", "getGoogleConnectorToken", "getYelpConnectorToken",
    "currentTenantId", "currentTenantSlug", "getRepository",
    "OpenAI", "Anthropic", "BEACON_LLM_PROVIDER",
  ];
  const FORBIDDEN_IMPORT_PATHS = [
    "@/lib/business-config", "@/lib/local-reviews-store", "@/lib/connector-store",
    "@/lib/tenant-context", "@/lib/persistence/repositories", "@/lib/persistence/cold-store", "next/cache",
  ];
  for (const id of FORBIDDEN_IDENTIFIERS) {
    it(`recommendation-rules.ts: does NOT reference identifier '${id}'`, () => {
      expect(ACTIVE).not.toMatch(new RegExp(`\\b${id}\\b`));
    });
  }
  for (const path of FORBIDDEN_IMPORT_PATHS) {
    it(`recommendation-rules.ts: does NOT import from '${path}'`, () => {
      expect(ACTIVE).not.toMatch(
        new RegExp(`from\\s*["']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`),
      );
    });
  }
  it("recommendation-rules.ts: every import is restricted to the allowed set", () => {
    const allowedExact = new Set(["./types", "@/domains/recommendations/action-types"]);
    const paths = extractFromPaths(ACTIVE);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(allowedExact.has(p), `recommendation-rules.ts imports '${p}' not in allowed set`).toBe(true);
    }
  });
  it("recommendation-rules.ts: import from action-types is TYPE-ONLY", () => {
    const importLines = extractImportLines(ACTIVE).filter((l) =>
      /from\s*["']@\/domains\/recommendations\/action-types["']/.test(l),
    );
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(importLineIsTypeOnly(line), `import from action-types must be type-only.\nLine: ${line}`).toBe(true);
    }
  });
  it("recommendation-rules.ts: import from ./types is TYPE-ONLY", () => {
    const importLines = extractImportLines(ACTIVE).filter((l) => /from\s*["']\.\/types["']/.test(l));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) expect(importLineIsTypeOnly(line)).toBe(true);
  });
});

// ─────────────────────────────── customer copy ──────────────────────────────

type CopyRow = { label: string; files: ReadonlyArray<string>; forbidden: ReadonlyArray<string>; minLen: number };
const COPY_ROWS: ReadonlyArray<CopyRow> = [
  {
    label: "C7a operator-page copy",
    files: ["src/app/(shell)/diagnostics/off-site-authority/page.tsx"],
    forbidden: FORBIDDEN_BASE,
    minLen: 150,
  },
  {
    label: "C7c rules customer copy",
    files: [
      "src/domains/off-site-authority/recommendation-rules.ts",
      "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
    ],
    forbidden: FORBIDDEN_C7C,
    minLen: 50,
  },
];

describe("off-site — customer-visible copy discipline", () => {
  for (const row of COPY_ROWS) {
    for (const rel of row.files) {
      const visible = extractCustomerVisibleText(stripComments(read(rel)));
      const visibleLower = visible.toLowerCase();
      it(`${row.label} — ${rel}: extracted non-trivial visible text`, () => {
        expect(visible.length).toBeGreaterThan(row.minLen);
      });
      it(`${row.label} — ${rel}: no forbidden customer vocab`, () => {
        const hits: string[] = [];
        for (const phrase of row.forbidden) {
          const idx = visibleLower.indexOf(phrase.toLowerCase());
          if (idx >= 0) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(visible.length, idx + phrase.length + 40);
            hits.push(`"${phrase}" @${idx}: ...${visible.slice(start, end)}...`);
          }
        }
        expect(hits, `${rel} forbidden phrase(s):\n${hits.join("\n")}`).toEqual([]);
      });
    }
  }
});

// ─────────────────────────── operator-page discipline ───────────────────────

describe("C7a — operator-page discipline (page.tsx)", () => {
  const ACTIVE = stripComments(read("src/app/(shell)/diagnostics/off-site-authority/page.tsx"));
  it("declares export const dynamic = 'force-dynamic'", () => {
    expect(ACTIVE).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });
  it("imports isOperatorModeServer from @/lib/operator-mode", () => {
    expect(ACTIVE).toMatch(/import\s*\{[^}]*\bisOperatorModeServer\b[^}]*\}\s*from\s*["']@\/lib\/operator-mode["']/);
  });
  it("imports notFound from next/navigation", () => {
    expect(ACTIVE).toMatch(/import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/);
  });
  it("contains both isOperatorModeServer(...) and notFound(...) invocations", () => {
    expect(ACTIVE).toMatch(/\bisOperatorModeServer\s*\(/);
    expect(ACTIVE).toMatch(/\bnotFound\s*\(/);
  });
  it("operator gate appears BEFORE the first off-site data loader invocation", () => {
    const ALLOWED_LOADER_INVOCATIONS = [
      "loadOffSitePresenceSnapshot(",
      "loadOffSiteRecommendationPreview(",
    ];
    const gateIdx = ACTIVE.indexOf("isOperatorModeServer(");
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    const loaderIndices = ALLOWED_LOADER_INVOCATIONS.map((n) => ACTIVE.indexOf(n)).filter((idx) => idx >= 0);
    expect(loaderIndices.length, "Operator page must invoke an allowed off-site loader").toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(Math.min(...loaderIndices));
  });
  it("does NOT import from @/lib/business-config directly", () => {
    expect(ACTIVE).not.toMatch(/from\s+["']@\/lib\/business-config["']/);
  });
});

describe("C7g v1 — profile-URL source discipline", () => {
  it("compute-snapshot.ts declares operatorVouchedProfileUrl helper", () => {
    expect(read("src/domains/off-site-authority/compute-snapshot.ts")).toMatch(
      /function\s+operatorVouchedProfileUrl\b/,
    );
  });
  it("operatorVouchedProfileUrl enforces http(s) prefix gate", () => {
    const src = read("src/domains/off-site-authority/compute-snapshot.ts");
    expect(src).toContain('"https://"');
    expect(src).toContain('"http://"');
  });
  it("configured row uses source=business_config and confidence=medium", () => {
    const src = read("src/domains/off-site-authority/compute-snapshot.ts");
    expect(src).toMatch(/source:\s*"business_config"/);
    expect(src).toMatch(/function\s+buildConfiguredRow[\s\S]*?confidence:\s*"medium"/);
  });
  it("BusinessConfig declares the four profile URL fields", () => {
    const src = read("src/lib/business-config.ts");
    expect(src).toMatch(/houzzProfileUrl\s*:\s*string/);
    expect(src).toMatch(/angiProfileUrl\s*:\s*string/);
    expect(src).toMatch(/bbbProfileUrl\s*:\s*string/);
    expect(src).toMatch(/industryDirectoryProfileUrl\s*:\s*string/);
  });
  it("loader threads the four URL fields into the compute input", () => {
    const src = read("src/domains/off-site-authority/load-snapshot.ts");
    expect(src).toContain("houzzProfileUrl");
    expect(src).toContain("angiProfileUrl");
    expect(src).toContain("bbbProfileUrl");
    expect(src).toContain("industryDirectoryProfileUrl");
  });
  it("operator diagnostic distinguishes Configured from Confirmed by source", () => {
    const src = read("src/app/(shell)/diagnostics/off-site-authority/page.tsx");
    expect(src).toContain('"Configured"');
    expect(src).toContain('"Confirmed"');
    expect(src).toMatch(/source\s*===\s*"business_config"/);
  });
});

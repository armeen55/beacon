/**
 * Architecture invariant — Profound runtime isolation (May 10, 2026).
 *
 * Profound's API access expires on 2026-05-10. The 2026-05-06 readiness
 * audit confirmed that Beacon's runtime is Profound-free: every `/api/*`
 * route and every shell route outside `/settings/import` operate without
 * touching `src/adapters/profound`. The Advanced-gated import button on
 * `/settings/import` is the ONE exception — it's the legacy import surface
 * and is allowed to call `importProfoundData()`.
 *
 * This invariant pins that posture forward. If a future PR
 * accidentally re-introduces a Profound runtime dependency — by
 * importing the adapter from a /api/* handler, a non-import shell
 * route, or by adding a `PROFOUND_*` env var — the build fails before
 * the regression can silently land in production.
 *
 * De-bloat (2026-06-15): the scheduled-automation items (daily cron
 * workflows + scheduled-job scripts) were dropped because those
 * artifacts were deleted with the abandoned native-poll cron. The
 * surviving runtime-isolation items below are the live posture.
 *
 * Pinned (per operator brief):
 *   1. No `/api/*` route imports from `src/adapters/profound`.
 *   2. No shell route outside `/settings/import` imports or
 *      references `src/adapters/profound`, `runProfoundImport`,
 *      `bridgeProfoundResults`, or `importProfoundData`.
 *   3. `/settings/import` is the ONLY UI path allowed to call
 *      `importProfoundData`.
 *   4. No `PROFOUND_*` env vars appear in workflows, package
 *      scripts, or env examples.
 *
 * See `docs/PROFOUND_MAY_10_READINESS.md` for the operator-readable
 * checklist this invariant protects.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");
const API_ROOT = join(REPO_ROOT, "src/app/api");
const SHELL_ROOT = join(REPO_ROOT, "src/app/(shell)");
const ENV_EXAMPLE = join(REPO_ROOT, ".env.local.example");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");
const VERCEL_JSON = join(REPO_ROOT, "vercel.json");
const ADAPTER_ROOT_REL = "src/adapters/profound";

/**
 * Strip block + line comments before identifier checks so docstring
 * mentions of forbidden APIs (which are intentional — they document
 * the contract) don't trip negative invariants. Same trick the
 * dry-run-harness no-persistence and LR-N allowlist invariants use.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Recursively walk a directory and return all .ts / .tsx files.
 * Skips dot-dirs (e.g. .next).
 */
function walkTs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTs(full, out);
    } else if (
      st.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Detect whether a TypeScript source carries any of the Profound
 * runtime entry points in EXECUTABLE code (i.e. comments stripped).
 *
 * The check is intentionally broad — any of the four canonical entry
 * point names triggers, plus any import path that touches the adapter
 * directory. False positives are unlikely because the adapter has no
 * legitimate caller outside `/settings/import` + the adapter itself.
 */
const FORBIDDEN_RUNTIME_NAMES = [
  "runProfoundImport",
  "bridgeProfoundResults",
  "importProfoundData",
  "ProfoundImportResult",
] as const;

function findProfoundReferences(srcCode: string): string[] {
  const hits: string[] = [];
  for (const name of FORBIDDEN_RUNTIME_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(srcCode)) hits.push(name);
  }
  // Import-path patterns: covers `@/adapters/profound`,
  // `../adapters/profound`, etc. Path-traversal forms are matched by
  // the trailing `adapters/profound` substring.
  if (/from\s+["'][^"']*\badapters\/profound\b/.test(srcCode)) {
    hits.push("import from src/adapters/profound");
  }
  // Dynamic import variant: `await import("@/adapters/profound/...")`.
  if (/import\s*\(\s*["'][^"']*\badapters\/profound\b/.test(srcCode)) {
    hits.push("dynamic import of src/adapters/profound");
  }
  return [...new Set(hits)];
}

// ────────────────────────────────────────────────────────────────────────
// 1. No /api/* route imports from src/adapters/profound
// ────────────────────────────────────────────────────────────────────────

describe("Profound runtime isolation — Item 1: /api/* routes are Profound-free", () => {
  const apiFiles = walkTs(API_ROOT).filter((f) => !f.endsWith(".test.ts"));

  it("at least one /api route was discovered", () => {
    expect(
      apiFiles.length,
      "Walking src/app/api should find at least one route file",
    ).toBeGreaterThan(0);
  });

  for (const file of apiFiles) {
    const rel = relative(REPO_ROOT, file);
    it(`${rel} imports nothing from src/adapters/profound`, () => {
      const code = stripComments(readFileSync(file, "utf-8"));
      const hits = findProfoundReferences(code);
      expect(
        hits,
        `${rel} must not reference Profound runtime entry points. ` +
          `/api/* routes read from native Supabase tables; no /api/* path ` +
          `is allowed to depend on src/adapters/profound.`,
      ).toEqual([]);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// 2. No shell route outside /settings/import imports from Profound
// ────────────────────────────────────────────────────────────────────────

describe("Profound runtime isolation — Item 2: shell routes outside /settings/import are Profound-free", () => {
  const shellFiles = walkTs(SHELL_ROOT).filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
  );

  // The allow-listed surface: the Advanced-gated import page + the
  // server action it calls. Both live under settings/import; nothing
  // else may.
  const ALLOWED_SHELL_PREFIX = join(SHELL_ROOT, "settings/import");

  it("at least one shell file was discovered", () => {
    expect(
      shellFiles.length,
      "Walking src/app/(shell) should find at least one route file",
    ).toBeGreaterThan(0);
  });

  for (const file of shellFiles) {
    if (file.startsWith(ALLOWED_SHELL_PREFIX)) continue;
    const rel = relative(REPO_ROOT, file);
    it(`${rel} does not import or reference Profound runtime entry points`, () => {
      const code = stripComments(readFileSync(file, "utf-8"));
      const hits = findProfoundReferences(code);
      expect(
        hits,
        `${rel} is OUTSIDE /settings/import — it must not import from ` +
          `src/adapters/profound or reference runProfoundImport / ` +
          `bridgeProfoundResults / importProfoundData / ProfoundImportResult. ` +
          `If a new caller is genuinely needed, gate it behind the same ` +
          `Advanced disclosure /settings/import uses (D2 contract).`,
      ).toEqual([]);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// 3. /settings/import is the ONLY UI path that calls importProfoundData
// ────────────────────────────────────────────────────────────────────────

describe("Profound runtime isolation — Item 3: /settings/import is the only importProfoundData caller", () => {
  // Walk the entire UI tree (shell + public + api). The ONE allowed
  // caller is `src/app/(shell)/settings/import/import-page.tsx`. The
  // ONE allowed definition site is `src/adapters/profound/actions.ts`.
  const candidateRoots = [
    join(REPO_ROOT, "src/app"),
    join(REPO_ROOT, "src/components"),
    join(REPO_ROOT, "src/lib"),
    join(REPO_ROOT, "src/domains"),
  ];
  const allFiles = candidateRoots
    .flatMap((root) => walkTs(root))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  const importPagePath = join(
    SHELL_ROOT,
    "settings/import/import-page.tsx",
  );
  const definitionPath = join(REPO_ROOT, "src/adapters/profound/actions.ts");

  it(`only /settings/import/import-page.tsx calls importProfoundData`, () => {
    const callers: string[] = [];
    for (const file of allFiles) {
      if (file === definitionPath) continue; // it's defined here
      const code = stripComments(readFileSync(file, "utf-8"));
      // We're looking for actual call sites: `importProfoundData(`
      // (function-call shape) — not bare references, since the
      // function-call shape is the only thing that triggers a runtime
      // import attempt.
      if (/\bimportProfoundData\s*\(/.test(code)) {
        callers.push(relative(REPO_ROOT, file));
      }
    }
    const expected = [relative(REPO_ROOT, importPagePath)];
    expect(callers.sort()).toEqual(expected.sort());
  });

  it(`importProfoundData is exported from src/adapters/profound/actions.ts`, () => {
    expect(existsSync(definitionPath)).toBe(true);
    const code = stripComments(readFileSync(definitionPath, "utf-8"));
    expect(/export\s+async\s+function\s+importProfoundData/.test(code)).toBe(
      true,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. No PROFOUND_* env vars in workflows, package scripts, or env examples
// ────────────────────────────────────────────────────────────────────────

describe("Profound runtime isolation — Item 4: zero PROFOUND_* env vars", () => {
  const ENV_VAR_RE = /\bPROFOUND_[A-Z][A-Z0-9_]*\b/;

  it(".env.local.example has no PROFOUND_* vars", () => {
    if (!existsSync(ENV_EXAMPLE)) return; // file may not exist; tolerated
    const src = readFileSync(ENV_EXAMPLE, "utf-8");
    const match = src.match(ENV_VAR_RE);
    expect(
      match,
      `.env.local.example must not declare a PROFOUND_* env var. ` +
        `Found: ${match?.[0] ?? "(none)"}`,
    ).toBeNull();
  });

  it("package.json scripts section has no PROFOUND_* vars", () => {
    const pkg = readFileSync(PACKAGE_JSON, "utf-8");
    const json = JSON.parse(pkg) as { scripts?: Record<string, string> };
    const offenders: string[] = [];
    for (const [name, body] of Object.entries(json.scripts ?? {})) {
      if (ENV_VAR_RE.test(body)) offenders.push(`${name}: ${body}`);
    }
    expect(
      offenders,
      `package.json scripts must not reference PROFOUND_* env vars. ` +
        `Offenders: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("vercel.json has no PROFOUND_* vars (when present)", () => {
    if (!existsSync(VERCEL_JSON)) return; // tolerated absence
    const src = readFileSync(VERCEL_JSON, "utf-8");
    expect(ENV_VAR_RE.test(src)).toBe(false);
  });

  it("no .github/workflows/*.yml file declares a PROFOUND_* env var", () => {
    if (!existsSync(WORKFLOWS_DIR)) return;
    const offenders: string[] = [];
    for (const file of readdirSync(WORKFLOWS_DIR)) {
      if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
      const src = readFileSync(join(WORKFLOWS_DIR, file), "utf-8");
      if (ENV_VAR_RE.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `Workflow files must not declare PROFOUND_* env vars. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cross-check: the readiness doc exists (operator-readable handoff)
// ────────────────────────────────────────────────────────────────────────

describe("Profound runtime isolation — readiness doc handoff", () => {
  it("docs/PROFOUND_MAY_10_READINESS.md exists", () => {
    const path = join(REPO_ROOT, "docs/PROFOUND_MAY_10_READINESS.md");
    expect(
      existsSync(path),
      "The readiness checklist doc must exist alongside this invariant. " +
        "Operator brief: 'Item 2 — Profound May 10 readiness doc'.",
    ).toBe(true);
  });

  it("readiness doc references this invariant by name", () => {
    const path = join(REPO_ROOT, "docs/PROFOUND_MAY_10_READINESS.md");
    if (!existsSync(path)) return; // covered by previous test
    const src = readFileSync(path, "utf-8");
    expect(
      /profound-runtime-isolation\.test\.ts/.test(src),
      "Readiness doc must name this invariant so a future reader can " +
        "find the CI guardrail that backs the GREEN status.",
    ).toBe(true);
  });
});

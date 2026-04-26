/**
 * Sprint 7 Phase 7.8b-2-e (2026-04-26) — architectural invariants for the
 * json-store async + tenant-routing contract.
 *
 * Phase 7.8b-2-b made `readStore`/`writeStore` async and dispatched every
 * `.data/*.json` access through `resolveDataPath`. The full caller cascade
 * landed in 7.8b-2-c/d. These invariants pin the contract so a future
 * refactor can't silently drop an `await` (which would assign a Promise
 * to an array variable) or bypass `resolveDataPath` (which would defeat
 * tenant routing).
 *
 * Five invariants:
 *   1. No un-awaited `readStore(...)` in src/ or scripts/.
 *   2. `json-store.ts` imports `resolveDataPath`.
 *   3. `json-store.ts` emits a `[json-store] flat-fallback read` warn log.
 *   4. `json-store.ts` keys the in-process cache + writeLocks by resolved
 *      `cacheKey`, not bare store name.
 *   5. The import-runs anti-race guard (refuses to overwrite non-empty file
 *      with `[]`) is still present in `json-store.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = resolve(REPO_ROOT, "src");
const SCRIPTS_ROOT = resolve(REPO_ROOT, "scripts");
const JSON_STORE_PATH = resolve(SRC_ROOT, "lib/persistence/json-store.ts");

// ---------------------------------------------------------------------------
// Allowlist — files that legitimately reference `readStore` without an
// await on every call site. Each is documented with the reason.
// ---------------------------------------------------------------------------

const READSTORE_ALLOWLIST = new Set<string>([
  // json-store.ts is where readStore is DEFINED. The string appears in the
  // export, in JSDoc, and in the implementation. Not a call site.
  resolve(SRC_ROOT, "lib/persistence/json-store.ts"),
  // file-backend.ts and supabase-backend.ts wrap readStore in async arrow
  // functions: `getX: async () => readStore<T>(...)`. The arrow body returns
  // the Promise, which the async wrapper auto-flattens — equivalent to
  // `async () => await readStore(...)`. Adding explicit `await` is a
  // stylistic choice but not required for correctness.
  resolve(SRC_ROOT, "lib/persistence/repositories/file-backend.ts"),
  resolve(SRC_ROOT, "lib/persistence/repositories/supabase-backend.ts"),
  // types.ts only contains type definitions; no runtime calls.
  resolve(SRC_ROOT, "lib/persistence/repositories/types.ts"),
  // index.ts re-exports; readStore appears in import lines only.
  resolve(SRC_ROOT, "lib/persistence/repositories/index.ts"),
  // seed-data.server.ts uses `readStoreLocal` (not readStore); the substring
  // match here is a false positive. The lint below excludes that prefix.
  resolve(SRC_ROOT, "lib/seed-data.server.ts"),
]);

function* walkFiles(
  dir: string,
  exts: ReadonlyArray<string>,
): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const s = statSync(path);
    if (s.isDirectory()) {
      yield* walkFiles(path, exts);
      continue;
    }
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (exts.some((e) => entry.endsWith(e))) yield path;
  }
}

/**
 * A `readStore(...)` call is "properly awaited" if its line contains one of:
 *   - `await readStore`
 *   - `return readStore` (auto-flattens inside an async function)
 *   - `=> readStore`    (arrow-body return; same auto-flatten)
 *   - `, readStore`     (inside Promise.all([readStore(...)]) etc.)
 *   - `[readStore`      (also inside a literal array passed to Promise.all)
 *
 * Anything else — `const x = readStore(`, `if (readStore(`, etc. — assigns
 * the unresolved Promise to a value used as an array, which is the bug this
 * invariant exists to catch.
 */
function findUnawaitedReadStoreCalls(file: string): {
  line: number;
  text: string;
}[] {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const violations: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Match readStore (with optional generic) followed by `(`. Exclude the
    // `readStoreLocal` / `readStoreScoped` / `readStoreFile` substrings.
    if (!/(^|[^A-Za-z0-9_])readStore\s*[<(]/.test(raw)) continue;
    if (/readStoreLocal|readStoreScoped|readStoreFile/.test(raw)) continue;
    // Skip import / export / re-export lines.
    if (/^\s*(import|export)\s/.test(raw)) continue;
    // Skip lines that are pure comments.
    const codeOnly = raw.split("//")[0];
    if (!/(^|[^A-Za-z0-9_])readStore\s*[<(]/.test(codeOnly)) continue;
    // Skip lines that are inside JSDoc / multi-line comments by a coarse
    // heuristic — they typically begin with `*`.
    if (/^\s*\*/.test(raw)) continue;
    // Allow the recognized awaited shapes.
    const awaitedShapes =
      /\bawait\s+readStore\b/.test(codeOnly) ||
      /\breturn\s+(?:await\s+)?readStore\b/.test(codeOnly) ||
      /=>\s*readStore\b/.test(codeOnly) ||
      /[,[]\s*readStore\b/.test(codeOnly) ||
      // Multi-line Promise.all([...]) literal: a line that starts with
      // optional whitespace + readStore<T>(...) and ends with `,` is an
      // array element passed into Promise.all (the surrounding `await
      // Promise.all([` lives a few lines up).
      /^\s*readStore\s*[<(][\s\S]*\),\s*$/.test(codeOnly);
    if (awaitedShapes) continue;
    violations.push({ line: i + 1, text: raw.trim().slice(0, 140) });
  }
  return violations;
}

describe("Phase 7.8b-2-e — json-store async invariants", () => {
  const srcFiles = [...walkFiles(SRC_ROOT, [".ts", ".tsx"])];
  const scriptFiles = [...walkFiles(SCRIPTS_ROOT, [".ts"])];
  const allFiles = [...srcFiles, ...scriptFiles].filter(
    (f) => !READSTORE_ALLOWLIST.has(f),
  );

  it("collected enough files for the scan to be meaningful", () => {
    expect(allFiles.length).toBeGreaterThan(50);
  });

  it("no un-awaited readStore() calls in src/ or scripts/", () => {
    const allViolations: { file: string; line: number; text: string }[] = [];
    for (const file of allFiles) {
      const v = findUnawaitedReadStoreCalls(file);
      for (const entry of v) {
        allViolations.push({
          file: file.replace(REPO_ROOT, "."),
          line: entry.line,
          text: entry.text,
        });
      }
    }
    expect(
      allViolations,
      "Phase 7.8b-2-e invariant: every `readStore(...)` call must be awaited " +
        "(or returned from an async function / arrow body). An un-awaited call " +
        "assigns Promise<T[]> to a variable used as T[], a silent bug post-7.8b-2-b.\n" +
        allViolations
          .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
          .join("\n"),
    ).toEqual([]);
  });
});

describe("Phase 7.8b-2-e — json-store routing contract", () => {
  const src = readFileSync(JSON_STORE_PATH, "utf8");

  it("json-store.ts imports resolveDataPath from the shared resolver", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bresolveDataPath\b[^}]*\}\s*from\s*["']\.\/resolve-data-path["']/,
    );
  });

  it("json-store.ts keys cache + writeLocks by resolved cacheKey", () => {
    // Every cache.get / cache.set / cache.has / writeLocks.get / writeLocks.set
    // must use `resolved.cacheKey` as the key, not a bare store name.
    const cacheLines = src
      .split("\n")
      .map((l, i) => ({ l, i: i + 1 }))
      .filter(
        ({ l }) =>
          /\b(cache|writeLocks)\.(get|set|has|delete)\s*\(/.test(l),
      );
    // Sanity: there should be multiple cache/writeLocks operations.
    expect(cacheLines.length).toBeGreaterThan(3);
    for (const { l, i } of cacheLines) {
      expect(
        l,
        `json-store.ts:${i} — cache/writeLocks call must key by resolved.cacheKey: ${l.trim()}`,
      ).toMatch(/\bresolved\.cacheKey\b/);
    }
  });

  it("json-store.ts retains the import-runs anti-race guard", () => {
    // The guard refuses to overwrite a non-empty file with []. The marker is
    // the comment + the structural shape (existsSync + length check).
    expect(src).toMatch(/import[-_]runs/);
    expect(src).toMatch(/anti[-\s]?race/i);
    expect(src).toMatch(/existsSync\(/);
  });
});

// ── Phase 7.8e-2: no module-level canonical-store value imports ──────

describe("Phase 7.8e-2 — canonical-store is request-scope only", () => {
  it("canonical-store.ts has no module-level `await readStore` or `await repo.getX`", () => {
    const src = readFileSync(
      resolve(SRC_ROOT, "storage/canonical-store.ts"),
      "utf8",
    );
    const lines = src.split("\n");
    const offending: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (
        /^export\s+const\s+\w+[^=]*=\s*await\s+(readStore|repo\.|getRepository)/.test(
          l,
        )
      ) {
        offending.push(i + 1);
      }
    }
    expect(
      offending,
      "Phase 7.8e-2 invariant: canonical-store.ts must not perform " +
        "module-level `await readStore(...)` or `await repo.getX()`. Use " +
        "cached async getters (getTrackedPrompts, getTrackedEntities, etc.) " +
        "instead.\n" +
        offending.map((n) => `  line ${n}`).join("\n"),
    ).toEqual([]);
  });

  it("canonical-store.ts exports the 8 cached async getters", () => {
    const src = readFileSync(
      resolve(SRC_ROOT, "storage/canonical-store.ts"),
      "utf8",
    );
    for (const name of [
      "getTrackedPrompts",
      "getTrackedEntities",
      "getObservationRuns",
      "getPromptAnswerObservations",
      "getDailyMetricSnapshots",
      "getOutcomeEvents",
      "getCandidateCauses",
      "getEventDecisions",
    ]) {
      expect(
        src,
        `Phase 7.8e-2 invariant: canonical-store.ts must export \`${name}\``,
      ).toMatch(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*cache\\(`));
    }
  });

  it("no callers `import { <module-level array> } from '@/storage/canonical-store'`", () => {
    const srcFiles = [...walkFiles(SRC_ROOT, [".ts", ".tsx"])];
    const offenders: { file: string; line: number; text: string }[] = [];
    const forbidden = new Set([
      "trackedPrompts",
      "trackedEntities",
      "observationRuns",
      "promptAnswerObservations",
      "dailyMetricSnapshots",
      "outcomeEvents",
      "candidateCauses",
      "eventDecisions",
    ]);
    for (const file of srcFiles) {
      if (file === resolve(SRC_ROOT, "storage/canonical-store.ts")) continue;
      const src = readFileSync(file, "utf8");
      const importRe = /import\s*\{([^}]*)\}\s*from\s*["']@\/storage\/canonical-store["']/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const before = src.slice(0, m.index);
        const lineNo = before.split("\n").length;
        const names = m[1]
          .split(",")
          .map((n) => n.trim().split(/\s+as\s+/)[0]);
        const bad = names.filter((n) => forbidden.has(n));
        if (bad.length > 0) {
          offenders.push({
            file: file.replace(REPO_ROOT, "."),
            line: lineNo,
            text: `forbidden: ${bad.join(", ")}`,
          });
        }
      }
    }
    expect(
      offenders,
      "Phase 7.8e-2 invariant: canonical-store.ts no longer exports the " +
        "module-level mutable arrays. Use the cached async getters instead.\n" +
        offenders
          .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
          .join("\n"),
    ).toEqual([]);
  });
});

// ── Phase 7.8e-1: no module-level seed-data value imports ────────────

describe("Phase 7.8e-1 — seed-data.server is request-scope only", () => {
  it("no `import { results | changelogEntries | opportunities | competitors | briefs | competitorSnapshots | importRuns } from '@/lib/seed-data.server'` anywhere in src/", () => {
    const srcFiles = [...walkFiles(SRC_ROOT, [".ts", ".tsx"])];
    const offenders: { file: string; line: number; text: string }[] = [];
    // Match `from "@/lib/seed-data.server"` and look at the preceding
    // import-clause names. Forbidden names = the array exports that
    // existed pre-7.8e-1.
    const forbidden = new Set([
      "results",
      "changelogEntries",
      "opportunities",
      "competitors",
      "briefs",
      "competitorSnapshots",
      "importRuns",
    ]);
    for (const file of srcFiles) {
      // Skip seed-data.server.ts itself (defines the now-removed exports
      // were here pre-refactor).
      if (file === resolve(SRC_ROOT, "lib/seed-data.server.ts")) continue;
      const src = readFileSync(file, "utf8");
      // Find import statements that resolve to the seed-data module.
      const importRe = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/seed-data\.server["']/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const before = src.slice(0, m.index);
        const lineNo = before.split("\n").length;
        const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]);
        const bad = names.filter((n) => forbidden.has(n));
        if (bad.length > 0) {
          offenders.push({
            file: file.replace(REPO_ROOT, "."),
            line: lineNo,
            text: `forbidden: ${bad.join(", ")}`,
          });
        }
      }
    }
    expect(
      offenders,
      "Phase 7.8e-1 invariant: seed-data.server.ts no longer exports the " +
        "module-level mutable arrays. Use the cached async getters " +
        "(getResults, getChangelogEntries, getOpportunities, getCompetitors, " +
        "getBriefs, getCompetitorSnapshots, getImportRuns) instead.\n" +
        offenders
          .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
          .join("\n"),
    ).toEqual([]);
  });
});

// ── Phase 7.8d-1: flat fallback removed; unknown throws ──────────────

const DOTDATA_JSON_PATH = resolve(SRC_ROOT, "lib/persistence/dotdata-json.ts");

describe("Phase 7.8d-1 — flat fallback removed; unknown throws", () => {
  const jsonStoreSrc = readFileSync(JSON_STORE_PATH, "utf8");
  const dotdataJsonSrc = readFileSync(DOTDATA_JSON_PATH, "utf8");

  it("json-store.ts does NOT log a flat-fallback warning", () => {
    expect(jsonStoreSrc).not.toContain("[json-store] flat-fallback read");
  });

  it("dotdata-json.ts does NOT log a flat-fallback warning", () => {
    expect(dotdataJsonSrc).not.toContain("[dotdata-json] flat-fallback read");
  });

  it("json-store.ts throws fail-loud on unknown scope", () => {
    // Source must contain a throw whose message names the classification module.
    expect(jsonStoreSrc).toMatch(
      /scope === "unknown"[\s\S]{0,400}throw new Error[\s\S]{0,400}store-classification/,
    );
  });

  it("dotdata-json.ts throws fail-loud on unknown scope", () => {
    expect(dotdataJsonSrc).toMatch(
      /scope === "unknown"[\s\S]{0,400}throw new Error[\s\S]{0,400}store-classification/,
    );
  });

  it("json-store.ts has no read-side flat-fallback branch", () => {
    // Heuristic: a flat-fallback branch checks `existsSync(resolved.flatPath)`
    // outside the import-runs anti-race guard. After 7.8d-1, json-store.ts
    // should never reference `resolved.flatPath` at all.
    expect(jsonStoreSrc).not.toMatch(/resolved\.flatPath/);
  });

  it("dotdata-json.ts has no read-side flat-fallback branch", () => {
    expect(dotdataJsonSrc).not.toMatch(/resolved\.flatPath/);
  });
});

// ── Phase 7.8e-3: Group 2/3 mutable-array stores must export async getters ──

describe("Phase 7.8e-3 — mutable-array stores expose cached async getters", () => {
  // For each store, the only export name in this list MUST NOT appear as
  // a value-import binding in callers (we only allow type imports). The
  // async getter is the contract.
  const FORBIDDEN_VALUE_IMPORTS: Array<{ module: string; name: string }> = [
    { module: "@/domains/attribution/store", name: "candidateLinks" },
    { module: "@/domains/attribution/store", name: "truthLabels" },
    { module: "@/domains/attribution/store", name: "eventDecisions" },
    { module: "@/domains/attribution/url-change-outcome", name: "urlChangeOutcomes" },
    { module: "@/domains/changelog/change-contract", name: "changeContracts" },
    { module: "@/domains/pages/issues", name: "pageIssues" },
    { module: "@/domains/pages/issues", name: "rolloutExecutions" },
    { module: "@/domains/pages/issues", name: "patternEvidence" },
    { module: "@/domains/pages/wave-planner", name: "rolloutWaves" },
    { module: "@/domains/brief-generation/store", name: "briefStates" },
    { module: "@/domains/actions/store", name: "actionStates" },
    { module: "@/domains/observations/visibility-observation-explicit-store", name: "visibilityObservationRunsExplicit" },
    { module: "@/domains/product/outcome-store", name: "outcomeRecords" },
    { module: "@/domains/product/recommendation-response-store", name: "recommendationResponses" },
    { module: "@/domains/answer-snapshots/store", name: "answerSnapshots" },
  ];

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        yield* walk(full);
      } else if (
        entry.endsWith(".ts") ||
        entry.endsWith(".tsx") ||
        entry.endsWith(".mts")
      ) {
        yield full;
      }
    }
  }

  it("no production caller imports the legacy mutable-array names as values", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const src = readFileSync(f, "utf8");
      for (const { module, name } of FORBIDDEN_VALUE_IMPORTS) {
        // import { name, ... } from "module" — but allow `import type {...}`.
        const re = new RegExp(
          String.raw`import\s*(?!type\s)\{[^}]*\b${name}\b[^}]*\}\s*from\s*["']${module.replace(/[/]/g, "\\/")}["']`,
        );
        if (re.test(src)) {
          offenders.push(`${f.slice(REPO_ROOT.length + 1)}: imports ${name} from ${module}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

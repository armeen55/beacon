import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Step 1.2 (master plan) — guard against operator-facing jargon
 * sneaking back into UI surfaces.
 *
 * Scope: src/app and src/components only. Domain modules + libs may
 * still reference these strings in internal logic / methodology /
 * historical migration code; that is intentional and out of scope.
 *
 * The test strips comments (block + line + JSDoc) before matching so
 * code documentation that uses the words descriptively does not trip
 * the invariant. We match the disallowed strings inside surviving
 * source — string literals + JSX text — only.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SCOPED_ROOTS = [
  path.join(ROOT, "src", "app"),
  path.join(ROOT, "src", "components"),
];

const FILE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
// Test fixtures and storybook stories may reference banned words for
// regression coverage. Skip them — the invariant only protects shipped
// UI source.
const SKIP_PATTERN = /\.test\.|\.stories\.|__mocks__|__fixtures__/;

type Banned = {
  needle: string;
  reason: string;
};

const BANNED: ReadonlyArray<Banned> = [
  {
    needle: "Decide tonight",
    reason: 'operator-facing jargon — use "Action queue"',
  },
  {
    needle: '"Heuristic"',
    reason:
      'operator-facing jargon — use "Pattern-based" (evidence/confidence) or "Rule of thumb"',
  },
  {
    needle: "'Heuristic'",
    reason:
      'operator-facing jargon — use "Pattern-based" (evidence/confidence) or "Rule of thumb"',
  },
  {
    needle: "Profound-style",
    reason:
      "vendor reference must not leak to operator UI surfaces (src/app, src/components)",
  },
  // M3 (operator audit, 2026-05-05) — attribution-overclaim bans.
  // The win-card narrative was reframed from "X is winning after your
  // change" to "Citation lift detected after the X change" so the copy
  // stays correlation-toned (URL-level correlation, not proof of
  // causation). These literals must not return to UI surfaces.
  {
    needle: "is winning after",
    reason:
      "M3: causal overclaim — use 'Citation lift detected after the X change' (URL-level correlation, not proof of causation)",
  },
  {
    needle: "winning after your",
    reason:
      "M3: causal overclaim — operator-facing copy must not assert causation. Reframe as 'Citation lift detected after the … change'",
  },
];

function listSourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(fp);
        continue;
      }
      const ext = path.extname(e.name);
      if (!FILE_EXTS.has(ext)) continue;
      if (SKIP_PATTERN.test(fp)) continue;
      out.push(fp);
    }
  }
  return out;
}

/**
 * Strip block comments (/* ... *\/, including JSDoc and JSX comments
 * of the form `{/* ... *\/}`) and line comments (// ...) so we only
 * inspect runtime-emitted text.
 */
function stripComments(source: string): string {
  // Block comments — non-greedy, multi-line.
  let s = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments — only when // is not preceded by ":" (URL guard) or
  // inside an obvious string. Heuristic is "good enough" for invariant;
  // if it ever drops a real banned string, the test will fail loud
  // either way.
  s = s.replace(/^[ \t]*\/\/.*$/gm, "");
  return s;
}

type Violation = {
  file: string;
  needle: string;
  reason: string;
  lineNumbers: number[];
};

function inspectFile(file: string): Violation[] {
  const raw = fs.readFileSync(file, "utf8");
  const stripped = stripComments(raw);
  const violations: Violation[] = [];
  for (const b of BANNED) {
    if (!stripped.includes(b.needle)) continue;
    // Find original line numbers for the needle in the raw source so the
    // report points the dev at the right place. We re-strip per-line so
    // we never report a hit that lives entirely inside a comment.
    const lineNumbers: number[] = [];
    const rawLines = raw.split("\n");
    let inBlockComment = false;
    rawLines.forEach((line, idx) => {
      let scan = line;
      // Track multi-line block comment state.
      if (inBlockComment) {
        const end = scan.indexOf("*/");
        if (end === -1) return;
        scan = scan.slice(end + 2);
        inBlockComment = false;
      }
      // Strip single-line block comments + then catch unterminated.
      while (true) {
        const start = scan.indexOf("/*");
        if (start === -1) break;
        const end = scan.indexOf("*/", start + 2);
        if (end === -1) {
          scan = scan.slice(0, start);
          inBlockComment = true;
          break;
        }
        scan = scan.slice(0, start) + scan.slice(end + 2);
      }
      // Strip line comments.
      scan = scan.replace(/\/\/.*$/, "");
      if (scan.includes(b.needle)) lineNumbers.push(idx + 1);
    });
    if (lineNumbers.length > 0) {
      violations.push({
        file: path.relative(ROOT, file),
        needle: b.needle,
        reason: b.reason,
        lineNumbers,
      });
    }
  }
  return violations;
}

describe("no-operator-jargon — Step 1.2 invariant", () => {
  it("no banned operator-facing strings in src/app or src/components", () => {
    const files = SCOPED_ROOTS.flatMap(listSourceFiles);
    const allViolations = files.flatMap((f) => inspectFile(f));
    if (allViolations.length > 0) {
      const detail = allViolations
        .map(
          (v) =>
            `${v.file}:${v.lineNumbers.join(",")} — ${v.needle} (${v.reason})`,
        )
        .join("\n  ");
      throw new Error(
        `Found ${allViolations.length} operator-jargon violation(s):\n  ${detail}`,
      );
    }
    expect(allViolations).toEqual([]);
  });

  it("inspectFile detects banned strings outside comments", () => {
    // Self-test: synthesize a file in memory by writing a temp file.
    const tmp = path.join(ROOT, "tests", "architecture", "_tmp-jargon.ts");
    fs.writeFileSync(
      tmp,
      [
        `// "Decide tonight" — internal comment, allowed`,
        `/* Profound-style block comment, allowed */`,
        `export const HEADER = "Decide tonight";`,
        `export const LABEL = "Heuristic";`,
      ].join("\n"),
      "utf8",
    );
    try {
      const v = inspectFile(tmp);
      const needles = v.map((x) => x.needle).sort();
      expect(needles).toEqual(['"Heuristic"', "Decide tonight"]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// M3 (operator audit, 2026-05-05) — positive-presence narrative invariant.
//
// The win-card narrative must lead with correlation-toned copy, not
// causal-toned copy. Pin the specific phrases the operator audit asked for
// so a future refactor can't quietly revert to "winning after your change".
// This is the inverse of the BANNED list: the file MUST contain these
// strings. 2026-07-01 (item 101): the legacy today-data.ts was deleted;
// the win-card assembly lives in today-v2-data.ts.
// ---------------------------------------------------------------------------

describe("M3 - today win-card narrative includes correlation phrasing", () => {
  it("today-v2-data.ts contains 'Citation lift detected' and 'URL-level correlation'", () => {
    const todayDataPath = path.join(
      ROOT,
      "src",
      "app",
      "(shell)",
      "today-v2-data.ts",
    );
    if (!fs.existsSync(todayDataPath)) {
      throw new Error(`today-v2-data.ts not found at ${todayDataPath}`);
    }
    const src = fs.readFileSync(todayDataPath, "utf8");
    expect(
      src.includes("Citation lift detected"),
      "today-v2-data.ts must use 'Citation lift detected' headline phrasing (M3, replaces 'is winning after your change')",
    ).toBe(true);
    expect(
      src.includes("URL-level correlation"),
      "today-v2-data.ts must use the 'URL-level correlation ... not proof of causation' qualifier (M3)",
    ).toBe(true);
  });
});
